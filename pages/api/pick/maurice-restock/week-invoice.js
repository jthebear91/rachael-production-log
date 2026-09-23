import { authorizeBridge, sendBridgeError } from '../../../../lib/bridge-auth'
import { createMauriceWeekInvoice } from '../../../../lib/maurice-week'
import { resolvePickStore } from '../../../../lib/pick-store'
import { createUnpaidInvoice } from '../../../../lib/square-invoices.js'
import { resolveAccount, squareFetch } from '../../../../lib/square-client.js'

// Monday job. One unpaid wholesale invoice for the prior Mon–Sat of live
// Maurice Sends. BRIDGE_API_KEY. Does not adjust inventory and does not
// call Payments. Lafayette's Monday house-account invoice is a different
// job and is not invoked here.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!authorizeBridge(req, res)) return
  try {
    const store = resolvePickStore()
    if (!store) {
      res.status(503).json({ error: 'Pick store is not configured' })
      return
    }
    const data = await createMauriceWeekInvoice({
      body: req.body,
      store,
      createUnpaidInvoice,
      resolveAccount,
      squareFetch
    })
    res.status(200).json(data)
  } catch (err) {
    sendBridgeError(res, err)
  }
}
