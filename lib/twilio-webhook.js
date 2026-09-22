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

function twilioSignature({ authToken, url, params }) {
  const keys = Object.keys(params || {}).sort()
  let data = String(url || '')
  for (const key of keys) {
    data += key + String(params[key] ?? '')
  }
  return crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

function validateTwilioSignature({ authToken, signature, url, params }) {
  if (!authToken || !signature || !url) return false
  const expected = twilioSignature({ authToken, url, params })
  return safeEqual(expected, signature)
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || ''
  return typeof value === 'string' ? value : ''
}

function publicRequestUrl({ headers = {}, url = '' } = {}) {
  const proto = headerValue(headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https'
  const host = headerValue(headers['x-forwarded-host'] || headers.host).split(',')[0].trim()
  return `${proto}://${host}${url || ''}`
}

function formParamsFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const params = {}
  for (const [key, value] of Object.entries(body)) {
    if (value == null || typeof value === 'object') continue
    params[key] = String(value)
  }
  return params
}

function twilioConfigured(env) {
  const sid = String(env.TWILIO_ACCOUNT_SID || '').trim()
  const token = String(env.TWILIO_AUTH_TOKEN || '').trim()
  return Boolean(sid && token)
}

function devBypassAllowed(env) {
  return env.NODE_ENV !== 'production' && env.WHOLESALE_TEXT_DEV_BYPASS === '1'
}

function evaluateTwilioAuth({ env, signature, url, params }) {
  if (!twilioConfigured(env)) {
    if (devBypassAllowed(env)) {
      return { ok: true, devBypass: true }
    }
    return { ok: false, status: 503, error: 'Twilio webhook is not configured' }
  }
  const token = String(env.TWILIO_AUTH_TOKEN || '').trim()
  if (!validateTwilioSignature({ authToken: token, signature, url, params })) {
    return { ok: false, status: 403, error: 'Invalid Twilio signature' }
  }
  return { ok: true, devBypass: false }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function twimlMessage(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`
}

module.exports = {
  twilioSignature,
  validateTwilioSignature,
  publicRequestUrl,
  formParamsFromBody,
  twilioConfigured,
  devBypassAllowed,
  evaluateTwilioAuth,
  escapeXml,
  twimlMessage
}
