import { withBridgeGet } from '../../../lib/bridge-auth'
import { jsonData } from '../../../lib/square-client'
import { fetchBridgeCatalog } from '../../../lib/square-catalog'

export default withBridgeGet(async (req, res) => {
  const data = await fetchBridgeCatalog(req.query.account)
  jsonData(res, data)
})
