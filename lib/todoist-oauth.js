// One-time Todoist OAuth for the "Wholesale Pull Signature Print" app.
//
// Todoist only delivers app webhooks (item:completed) for users who finished the
// app's OAuth flow, token exchange included. That also applies to the account
// that created the app. This helper runs that flow server-side so the client
// secret never leaves Vercel. The access token is not stored or logged: the
// webhook is activated by the exchange itself, and the app keeps using
// TODOIST_TOKEN for API calls.
//
// Env: TODOIST_CLIENT_ID (App Console "Client ID", not secret) and
// TODOIST_WEBHOOK_SECRET (the same app's client secret, already used for HMAC).
// App Console OAuth redirect URL must be
// https://rachael-production-log.vercel.app/api/wholesale-pull/todoist-oauth

const crypto = require('crypto')

const AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize'
const TOKEN_URL = 'https://api.todoist.com/oauth/access_token'
const STATE_COOKIE = 'wp_todoist_oauth_state'
const SCOPE = 'data:read'

function clientConfig(env) {
  const clientId = String((env && env.TODOIST_CLIENT_ID) || '').trim()
  const clientSecret = String((env && env.TODOIST_WEBHOOK_SECRET) || '').trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function authorizeUrl({ clientId, state, redirectUri }) {
  const params = new URLSearchParams({ client_id: clientId, scope: SCOPE, state })
  if (redirectUri) params.set('redirect_uri', redirectUri)
  return `${AUTHORIZE_URL}?${params}`
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''))
  const bufB = Buffer.from(String(b || ''))
  if (!bufA.length || bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function page(title, body) {
  const esc = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto"><h1>${esc(title)}</h1><p>${esc(body)}</p></body>`
}

const OAUTH_ERROR_CODES = new Set([
  'access_denied',
  'invalid_application_status',
  'invalid_request',
  'invalid_scope',
  'unsupported_response_type',
  'bad_authorization_code',
  'incorrect_application_credentials',
  'invalid_client',
  'invalid_grant',
  'server_error',
  'temporarily_unavailable'
])

function publicOAuthError(value, secret) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || (secret && raw.includes(secret))) return 'the token exchange was rejected'
  if (/^HTTP \d{3}$/.test(raw)) return raw
  if (OAUTH_ERROR_CODES.has(raw)) return raw
  return 'the token exchange was rejected'
}

async function handleTodoistOAuth({ query = {}, cookieHeader, env = {}, redirectUri, fetchImpl = globalThis.fetch.bind(globalThis), randomState }) {
  const config = clientConfig(env)
  if (!config) {
    return { status: 503, html: page('Not configured', 'Set TODOIST_CLIENT_ID and TODOIST_WEBHOOK_SECRET in Vercel, then redeploy.') }
  }
  if (query.error) {
    return { status: 400, html: page('Todoist authorization was not completed', `Todoist returned: ${publicOAuthError(String(query.error), config.clientSecret)}`) }
  }
  if (!query.code) {
    const state = randomState || crypto.randomBytes(24).toString('hex')
    return {
      status: 302,
      location: authorizeUrl({ clientId: config.clientId, state, redirectUri }),
      cookie: `${STATE_COOKIE}=${state}; Path=/api/wholesale-pull/todoist-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    }
  }
  const expected = readCookie(cookieHeader, STATE_COOKIE)
  if (!safeEqual(expected, query.state)) {
    return { status: 400, html: page('Authorization expired', 'Start again from /api/wholesale-pull/todoist-oauth in the same browser.') }
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: String(query.code)
  })
  if (redirectUri) body.set('redirect_uri', redirectUri)
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  const clearCookie = `${STATE_COOKIE}=; Path=/api/wholesale-pull/todoist-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  const granted = Boolean(data && typeof data.access_token === 'string' && data.access_token)
  const reason = publicOAuthError((data && data.error) || (!res.ok ? `HTTP ${res.status}` : ''), config.clientSecret)
  data = null
  if (!res.ok || !granted) {
    return { status: 502, cookie: clearCookie, html: page('Todoist token exchange failed', `Todoist said: ${reason}`) }
  }
  return {
    status: 200,
    cookie: clearCookie,
    html: page('Todoist webhooks activated', 'Wholesale Pull Signature Print is authorized for this Todoist account. Completing a wholesale Takeout task now queues the signature invoice. You can close this tab.')
  }
}

module.exports = {
  AUTHORIZE_URL,
  SCOPE,
  STATE_COOKIE,
  TOKEN_URL,
  authorizeUrl,
  handleTodoistOAuth
}
