const crypto = require('crypto')

const SALES_AUTH_COOKIE = 'sales_ok'
const SALES_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
const HMAC_MESSAGE = 'rachael-sales-ok'

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

function getSalesPin(env = process.env) {
  return String(env.SALES_DASHBOARD_PIN || '').trim()
}

function isProductionRuntime(env = process.env) {
  return env.VERCEL === '1' || env.NODE_ENV === 'production'
}

function isPinConfigured(env = process.env) {
  return getSalesPin(env).length > 0
}

function productionPinMissing(env = process.env) {
  return isProductionRuntime(env) && !isPinConfigured(env)
}

function salesSessionToken(pin = getSalesPin()) {
  return crypto.createHmac('sha256', pin).update(HMAC_MESSAGE).digest('hex')
}

function pinsMatch(candidate, env = process.env) {
  const expected = getSalesPin(env)
  if (!expected) return false
  return safeEqual(String(candidate || ''), expected)
}

function readCookie(req, name) {
  if (!req) return ''
  if (req.cookies && typeof req.cookies[name] === 'string') {
    return req.cookies[name]
  }
  const header = req.headers && req.headers.cookie
  const raw = Array.isArray(header) ? header.join('; ') : header
  if (typeof raw !== 'string' || !raw) return ''
  const parts = raw.split(';')
  for (const part of parts) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key === name) return part.slice(idx + 1).trim()
  }
  return ''
}

function isSalesAuthenticated(req, env = process.env) {
  const pin = getSalesPin(env)
  if (!pin) return !isProductionRuntime(env)
  const token = readCookie(req, SALES_AUTH_COOKIE)
  if (!token) return false
  return safeEqual(token, salesSessionToken(pin))
}

function salesUnauthorizedMessage(env = process.env) {
  if (productionPinMissing(env)) return 'PIN not configured'
  return 'Unauthorized'
}

function serializeSalesCookie(value, maxAge = SALES_COOKIE_MAX_AGE, env = process.env) {
  const parts = [
    `${SALES_AUTH_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ]
  if (maxAge > 0) {
    parts.push(`Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`)
  } else {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  }
  if (isProductionRuntime(env)) parts.push('Secure')
  return parts.join('; ')
}

function setSalesAuthCookie(res, env = process.env) {
  const pin = getSalesPin(env)
  res.setHeader('Set-Cookie', serializeSalesCookie(salesSessionToken(pin), SALES_COOKIE_MAX_AGE, env))
}

function clearSalesAuthCookie(res, env = process.env) {
  res.setHeader('Set-Cookie', serializeSalesCookie('', 0, env))
}

module.exports = {
  SALES_AUTH_COOKIE,
  SALES_COOKIE_MAX_AGE,
  getSalesPin,
  isProductionRuntime,
  isPinConfigured,
  productionPinMissing,
  salesSessionToken,
  pinsMatch,
  isSalesAuthenticated,
  salesUnauthorizedMessage,
  serializeSalesCookie,
  setSalesAuthCookie,
  clearSalesAuthCookie
}
