import { withBridgeGet } from '../../../lib/bridge-auth'

export default withBridgeGet(async (req, res) => {
  res.status(200).json({
    ok: true,
    accounts: {
      wholesale: Boolean(process.env.SQUARE_TOKEN),
      restaurant: Boolean(process.env.SQUARE_RESTAURANT_TOKEN)
    }
  })
})
