import { authorizeBridge, sendBridgeError } from '../../../lib/bridge-auth'
import { handlePullSheets } from '../../../lib/wholesale-pull'

function one(value) {
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (!authorizeBridge(req, res)) return
  try {
    const result = await handlePullSheets({
      method: req.method,
      query: {
        format: one(req.query.format),
        key: one(req.query.key),
        queue: one(req.query.queue)
      },
      body: req.body,
      env: process.env
    })
    if (result.allow) res.setHeader('Allow', result.allow)
    if (result.pdf) {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      res.status(result.status).send(result.pdf)
      return
    }
    res.status(result.status).json(result.json)
  } catch (err) {
    sendBridgeError(res, err)
  }
}
