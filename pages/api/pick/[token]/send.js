import { sendBridgeError } from '../../../../lib/bridge-auth'
import { sendMauricePick } from '../../../../lib/maurice-pick'
import { createUnpaidInvoice } from '../../../../lib/square-invoices.js'
import { resolveAccount, squareFetch } from '../../../../lib/square-client.js'

// The unguessable pick token is the capability. The phone that scans the
// sheet does not have BRIDGE_API_KEY, so this route does not use that gate.
// Create stays on the bridge key. This handler books an unpaid invoice
// through createUnpaidInvoice and a wholesale inventory decrease. It does
// not call a charge endpoint.

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
      squareFetch,
      createUnpaidInvoice
    })
    res.status(200).json(data)
  } catch (err) {
    sendBridgeError(res, err)
  }
}
