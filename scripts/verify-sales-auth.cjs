'use strict'

const {
  getSalesPin,
  isPinConfigured,
  isProductionRuntime,
  isSalesAuthenticated,
  pinsMatch,
  productionPinMissing,
  salesSessionToken,
  salesUnauthorizedMessage,
  serializeSalesCookie,
  SALES_AUTH_COOKIE
} = require('../lib/sales-auth')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testPinEnv() {
  assert(getSalesPin({ SALES_DASHBOARD_PIN: '  1234  ' }) === '1234', 'trim pin')
  assert(!isPinConfigured({}), 'empty not configured')
  assert(isPinConfigured({ SALES_DASHBOARD_PIN: '1234' }), 'configured')
  assert(isProductionRuntime({ VERCEL: '1' }), 'vercel production')
  assert(isProductionRuntime({ NODE_ENV: 'production' }), 'node production')
  assert(!isProductionRuntime({ NODE_ENV: 'development' }), 'dev')
  assert(productionPinMissing({ VERCEL: '1' }), 'prod missing pin')
  assert(!productionPinMissing({ NODE_ENV: 'development' }), 'dev missing pin is ok')
  assert(!productionPinMissing({ VERCEL: '1', SALES_DASHBOARD_PIN: '9' }), 'prod with pin')
}

function testHmacAndCompare() {
  const a = salesSessionToken('1111')
  const b = salesSessionToken('2222')
  assert(a !== b, 'rotating pin changes cookie')
  assert(a.length === 64, 'sha256 hex')
  assert(a !== '1111', 'cookie is not the raw pin')
  assert(pinsMatch('abcd', { SALES_DASHBOARD_PIN: 'abcd' }), 'pin match')
  assert(!pinsMatch('abce', { SALES_DASHBOARD_PIN: 'abcd' }), 'pin mismatch')
  assert(!pinsMatch('abcd', { SALES_DASHBOARD_PIN: 'abcde' }), 'length mismatch')
}

function testAuthDecisions() {
  const envDev = { NODE_ENV: 'development' }
  assert(isSalesAuthenticated({}, envDev), 'dev open without pin')
  assert(salesUnauthorizedMessage({ VERCEL: '1' }) === 'PIN not configured', 'prod message')
  assert(salesUnauthorizedMessage({ VERCEL: '1', SALES_DASHBOARD_PIN: 'x' }) === 'Unauthorized', 'prod configured')

  const envProd = { NODE_ENV: 'production', SALES_DASHBOARD_PIN: '5555' }
  const token = salesSessionToken('5555')
  assert(!isSalesAuthenticated({ cookies: {} }, envProd), 'prod no cookie')
  assert(isSalesAuthenticated({ cookies: { [SALES_AUTH_COOKIE]: token } }, envProd), 'prod valid cookie')
  assert(
    !isSalesAuthenticated({ cookies: { [SALES_AUTH_COOKIE]: salesSessionToken('9999') } }, envProd),
    'old cookie invalid after rotation'
  )
}

function testCookieFlags() {
  const cookie = serializeSalesCookie('abc', 60, { NODE_ENV: 'production' })
  assert(cookie.includes(`${SALES_AUTH_COOKIE}=abc`), 'name')
  assert(cookie.includes('HttpOnly'), 'httpOnly')
  assert(cookie.includes('SameSite=Lax'), 'lax')
  assert(cookie.includes('Path=/'), 'path')
  assert(cookie.includes('Secure'), 'secure in production')
  const dev = serializeSalesCookie('abc', 60, { NODE_ENV: 'development' })
  assert(!dev.includes('Secure'), 'not secure in dev')
}

testPinEnv()
testHmacAndCompare()
testAuthDecisions()
testCookieFlags()
console.log('verify-sales-auth: ok')
