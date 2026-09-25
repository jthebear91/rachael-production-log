// Square webhook signature: HMAC-SHA256 of notificationUrl + raw body, base64.
// https://developer.squareup.com/docs/webhooks/step3validate-signatures
// The signature key is the webhook subscription key, not the Square access token.

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

function squareSignature({ key, notificationUrl, rawBody }) {
  return crypto
    .createHmac('sha256', key)
    .update(String(notificationUrl || '') + String(rawBody || ''), 'utf8')
    .digest('base64')
}

function verifySquareSignature({ key, notificationUrl, rawBody, signature }) {
  if (!key || !signature || !notificationUrl) return false
  const expected = squareSignature({ key, notificationUrl, rawBody })
  return safeEqual(expected, String(signature).trim())
}

function devBypassAllowed(env) {
  return env.NODE_ENV !== 'production' && String(env.WHOLESALE_PULL_DEV_BYPASS || '') === '1'
}

function evaluateSquareWebhookAuth({ env, signature, notificationUrl, rawBody }) {
  const key = String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim()
  if (!key) {
    if (devBypassAllowed(env)) {
      return { ok: true, devBypass: true, headers: { 'X-Wholesale-Pull-Dev-Bypass': '1' } }
    }
    return { ok: false, status: 503, error: 'Square webhook signature key is not configured' }
  }
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  const url = String(notificationUrl || '').trim()
  if (!verifySquareSignature({ key, notificationUrl: url, rawBody: raw, signature })) {
    return { ok: false, status: 403, error: 'Invalid Square webhook signature' }
  }
  return { ok: true, devBypass: false, headers: null }
}

module.exports = {
  devBypassAllowed,
  evaluateSquareWebhookAuth,
  squareSignature,
  verifySquareSignature
}
