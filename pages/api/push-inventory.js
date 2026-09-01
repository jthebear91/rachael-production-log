export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const token = process.env.SQUARE_TOKEN
  const locationId = process.env.SQUARE_LOCATION_ID

  const { entries } = req.body
  if (!entries || !entries.length) return res.status(400).json({ error: 'No entries' })

  try {
    const changes = entries.map(e => ({
      type: 'ADJUSTMENT',
      adjustment: {
        catalog_object_id: e.variationId,
        location_id: locationId,
        quantity: String(e.qty),
        from_state: 'NONE',
        to_state: 'IN_STOCK',
        occurred_at: new Date().toISOString()
      }
    }))

    const r = await fetch('https://connect.squareup.com/v2/inventory/changes/batch-create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': '2024-02-22',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        changes,
        idempotency_key: 'rw-' + Date.now()
      })
    })

    const data = await r.json()
    if (!r.ok) throw new Error(data.errors?.[0]?.detail || 'Square push failed')

    res.status(200).json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
