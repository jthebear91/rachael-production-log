export default async function handler(req, res) {
  const token = process.env.TODOIST_TOKEN

  if (!token) return res.status(200).json({ step: 'FAIL', reason: 'No token in environment' })

  const trimmed = token.trim()

  const r = await fetch('https://api.todoist.com/rest/v2/projects', {
    headers: { 'Authorization': `Bearer ${trimmed}` }
  })

  const raw = await r.text()

  res.status(200).json({
    httpStatus: r.status,
    tokenLength: trimmed.length,
    tokenStart: trimmed.substring(0, 8),
    rawResponse: raw.substring(0, 300)
  })
}
