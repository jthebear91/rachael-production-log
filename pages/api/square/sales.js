import { withSalesSensitiveGet } from '../../../lib/bridge-auth'
import { jsonData } from '../../../lib/square-client'
import { fetchAccountSales } from '../../../lib/square-sales'

export default withSalesSensitiveGet(async (req, res) => {
  const data = await fetchAccountSales(req.query.account, {
    locationId: req.query.locationId
  })
  jsonData(res, data)
})
