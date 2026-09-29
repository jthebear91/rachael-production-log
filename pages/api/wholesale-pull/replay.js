import { withBridgePost } from '../../../lib/bridge-auth'
import { squareFetch } from '../../../lib/square-client'
import { handleReplay } from '../../../lib/wholesale-pull'

export default withBridgePost(async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  const result = await handleReplay({
    body: req.body,
    env: process.env,
    squareFetch
  })
  res.status(result.status).json(result.json)
})
