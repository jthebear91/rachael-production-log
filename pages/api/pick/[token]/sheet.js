import { loadPickSheet, renderPickMessagePage } from '../../../../lib/pick-sheet'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).type('html').send(renderPickMessagePage('Method not allowed'))
  }
  try {
    const html = await loadPickSheet({ token: req.query.token, req })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(html)
  } catch (err) {
    const status = Number.isInteger(err && err.status) ? err.status : 500
    const message = status === 404
      ? 'Pick list not found'
      : status === 503
        ? 'Pick list store is not configured'
        : 'Could not load pick sheet'
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(status).send(renderPickMessagePage(message))
  }
}
