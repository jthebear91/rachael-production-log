import { sendBridgeError } from '../../../../lib/bridge-auth'
import { sendMauricePick } from '../../../../lib/maurice-pick'
import { resolveAccount, squareFetch } from '../../../../lib/square-client.js'

// The unguessable pick token is the capability. The phone that scans the
// sheet does not have BRIDGE_API_KEY, so this route does not use that gate.
// Create stays on the bridge key. Send adjusts wholesale inventory only
// when live deduct is armed, appends priced lines to the week log, and
// notifies Jordan. It does not create an invoice and does not call Payments.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const data = await sendMauricePick({
      token: req.query.token,
      body: req.body,
      resolveAccount,
      squareFetch
    })
    res.status(200).json(data)
  } catch (err) {
    sendBridgeError(res, err)
  }
}
