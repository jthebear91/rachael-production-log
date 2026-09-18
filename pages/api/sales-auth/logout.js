import { clearSalesAuthCookie } from '../../../lib/sales-auth'

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  clearSalesAuthCookie(res)
  return res.status(200).json({ ok: true })
}
