// Read-only: returns every batch row for Batch Tracker to display. Falls
// back to an empty list on any error so the screen still renders instead
// of breaking.
export default async function handler(req, res) {
  // Trim stray whitespace/newlines and any trailing "/rest/v1" or slash
  // that may have been pasted into the Vercel env var by accident — either
  // one corrupts the request path and Supabase's gateway rejects it with a
  // routing error instead of a normal database error.
  let supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  res.setHeader('Cache-Control', 'no-store')

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/batches?select=*&order=cooked_at.desc`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    })
    const text = await r.text()
    if (!r.ok) {
      return res.status(200).json([])
    }
    const data = JSON.parse(text)
    res.status(200).json(Array.isArray(data) ? data : [])
  } catch (e) {
    res.status(200).json([])
  }
}
