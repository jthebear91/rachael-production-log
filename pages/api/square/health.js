import { withBridgeGet } from '../../../lib/bridge-auth'
import { accountPresence } from '../../../lib/square-client'

export default withBridgeGet(async (req, res) => {
  res.status(200).json({
    ok: true,
    accounts: accountPresence()
  })
})
