import { authorizeBridge, sendBridgeError } from '../../../../lib/bridge-auth'
import { createMauricePick } from '../../../../lib/maurice-pick'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!authorizeBridge(req, res)) return
  try {
    const data = await createMauricePick({ body: req.body, req })
    res.status(200).json(data)
  } catch (err) {
    sendBridgeError(res, err)
  }
}
