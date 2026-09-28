import { handleTodoistOAuth } from '../../../lib/todoist-oauth'

function one(value) {
  return Array.isArray(value) ? value[0] : value
}

function redirectUri() {
  const configured = String(process.env.TODOIST_OAUTH_REDIRECT_URI || '').trim()
  return configured || 'https://rachael-production-log.vercel.app/api/wholesale-pull/todoist-oauth'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const result = await handleTodoistOAuth({
      query: { code: one(req.query.code), state: one(req.query.state), error: one(req.query.error) },
      cookieHeader: req.headers.cookie,
      env: process.env,
      redirectUri: redirectUri()
    })
    if (result.cookie) res.setHeader('Set-Cookie', result.cookie)
    if (result.location) {
      res.setHeader('Location', result.location)
      return res.status(result.status).end()
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(result.status).send(result.html)
  } catch {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(500).send('Todoist authorization failed. Try again.')
  }
}
