export default async function handler(req, res) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/batches?select=*&order=cooked_at.desc`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    })

    const text = await r.text()
    const data = JSON.parse(text)
    res.status(200).json(Array.isArray(data) ? data : [])
  } catch(e) {
    res.status(200).json([])
  }
}
