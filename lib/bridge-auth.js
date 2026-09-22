import crypto from 'crypto'
import { isSalesAuthenticated, salesUnauthorizedMessage } from './sales-auth'
import { sanitizeErrorMessage } from './square-client'

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

function providedBridgeKey(req) {
  const headerAuth = req.headers.authorization
  const auth = Array.isArray(headerAuth) ? headerAuth[0] : headerAuth
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim()
  }
  const alt = req.headers['x-bridge-key']
  const key = Array.isArray(alt) ? alt[0] : alt
  return typeof key === 'string' ? key.trim() : ''
}

export function isBridgeAuthorized(req) {
  const expected = process.env.BRIDGE_API_KEY
  if (!expected) return false
  return safeEqual(providedBridgeKey(req), expected)
}

export function authorizeBridge(req, res) {
  const expected = process.env.BRIDGE_API_KEY
  if (!expected) {
    res.status(503).json({ error: 'Bridge is not configured' })
    return false
  }
  if (!safeEqual(providedBridgeKey(req), expected)) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

export function sendBridgeError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 500
  res.status(status).json({ error: sanitizeErrorMessage(err?.message || 'Request failed') })
}

export function withBridgeGet(handler) {
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!authorizeBridge(req, res)) return
    try {
      await handler(req, res)
    } catch (err) {
      sendBridgeError(res, err)
    }
  }
}

// Server-only Square writes (unpaid invoices). Same BRIDGE_API_KEY gate as GET.
export function withBridgePost(handler) {
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!authorizeBridge(req, res)) return
    try {
      await handler(req, res)
    } catch (err) {
      sendBridgeError(res, err)
    }
  }
}

// Sales totals/payments/orders: PIN cookie (dashboard) or BRIDGE_API_KEY (assistants).
export function withSalesSensitiveGet(handler) {
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    if (!isBridgeAuthorized(req) && !isSalesAuthenticated(req)) {
      return res.status(401).json({ error: salesUnauthorizedMessage() })
    }
    try {
      await handler(req, res)
    } catch (err) {
      sendBridgeError(res, err)
    }
  }
}
