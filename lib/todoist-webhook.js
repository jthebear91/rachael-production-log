// Todoist webhook signature: base64 HMAC-SHA256 of the raw body.
// Header: X-Todoist-Hmac-SHA256. Key: the Todoist app client secret
// (TODOIST_WEBHOOK_SECRET), not the API token.
// https://developer.todoist.com/sync/v9/#webhooks

const crypto = require('crypto')

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    if (bufA.length > 0) crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

function rawBytes(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody
  return Buffer.from(String(rawBody || ''), 'utf8')
}

function todoistSignature({ key, rawBody }) {
  return crypto.createHmac('sha256', key).update(rawBytes(rawBody)).digest('base64')
}

function verifyTodoistSignature({ key, rawBody, signature }) {
  if (!key || !signature) return false
  const expected = todoistSignature({ key, rawBody })
  return safeEqual(expected, String(signature).trim())
}

function devBypassAllowed(env) {
  return env.NODE_ENV !== 'production' && String(env.WHOLESALE_PULL_DEV_BYPASS || '') === '1'
}

function evaluateTodoistWebhookAuth({ env, signature, rawBody }) {
  const key = String(env.TODOIST_WEBHOOK_SECRET || '').trim()
  if (!key) {
    if (devBypassAllowed(env)) {
      return { ok: true, devBypass: true, headers: { 'X-Wholesale-Pull-Dev-Bypass': '1' } }
    }
    return { ok: false, status: 503, error: 'Todoist webhook secret is not configured' }
  }
  if (!verifyTodoistSignature({ key, rawBody, signature })) {
    return { ok: false, status: 403, error: 'Invalid Todoist webhook signature' }
  }
  return { ok: true, devBypass: false, headers: null }
}

module.exports = {
  devBypassAllowed,
  evaluateTodoistWebhookAuth,
  todoistSignature,
  verifyTodoistSignature
}
