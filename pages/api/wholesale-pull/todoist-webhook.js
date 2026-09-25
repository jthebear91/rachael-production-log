import { sanitizeErrorMessage, squareFetch } from '../../../lib/square-client'
import { handleTodoistWebhook } from '../../../lib/wholesale-pull'

export const config = {
  api: { bodyParser: false }
}

function headerValue(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const result = await handleTodoistWebhook({
      rawBody: await readRawBody(req),
      signature: headerValue(req, 'x-todoist-hmac-sha256'),
      env: process.env,
      squareFetch
    })
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value)
    }
    res.status(result.status).json(result.json)
  } catch (err) {
    const status = Number.isInteger(err && err.status) ? err.status : 500
    res.status(status).json({ error: sanitizeErrorMessage(err && err.message) })
  }
}
