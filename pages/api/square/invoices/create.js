import { jsonData } from '../../../../lib/square-client'
import { withBridgePost } from '../../../../lib/bridge-auth'
import { createUnpaidInvoice } from '../../../../lib/square-invoices'

export default withBridgePost(async (req, res) => {
  const data = await createUnpaidInvoice(req.body)
  jsonData(res, data)
})
