import {
  isPinConfigured,
  pinsMatch,
  productionPinMissing,
  setSalesAuthCookie
} from '../../../lib/sales-auth'

function submittedPin(req) {
  const body = req.body
  if (!body) return ''
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return String(parsed.pin || '').trim()
    } catch {
      return ''
    }
  }
  return String(body.pin || '').trim()
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (productionPinMissing()) {
    return res.status(503).json({ error: 'PIN not configured' })
  }

  if (!isPinConfigured()) {
    return res.status(200).json({ ok: true })
  }

  if (!pinsMatch(submittedPin(req))) {
    return res.status(401).json({ error: 'Invalid PIN' })
  }

  setSalesAuthCookie(res)
  return res.status(200).json({ ok: true })
}
