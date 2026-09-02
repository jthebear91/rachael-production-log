export default async function handler(req, res) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  const r = await fetch(`${supabaseUrl}/rest/v1/batches?order=cooked_at.desc`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  })

  const data = await r.json()
  res.status(200).json(data)
}
