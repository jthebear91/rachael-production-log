import { withBridgeGet } from '../../../lib/bridge-auth'
import { jsonData } from '../../../lib/square-client'
import { fetchAccountSales } from '../../../lib/square-sales'

export default withBridgeGet(async (req, res) => {
  const data = await fetchAccountSales(req.query.account, {
    locationId: req.query.locationId
  })
  jsonData(res, data)
})
