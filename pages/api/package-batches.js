// Marks selected cooked batches as packaged with a total case count.
//
// If every selected batch is the same item (e.g. two "jalapenos" batches),
// they're merged into ONE packaged record with the full combined total,
// and the extra batch rows are deleted — so Batch Tracker shows a single
// real entry for that day instead of two artificial half-batches.
//
// If the selection mixes different items, the total is split evenly
// across each selected batch (the original behavior), since there's no
// single sensible item to merge them under.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { batchIds, totalCases } = req.body
  if (!batchIds?.length || !totalCases) {
    return res.status(400).json({ error: 'Missing batchIds or totalCases' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  }

  try {
    const now = new Date().toISOString()
    const idsCsv = batchIds.join(',')

    const lookupRes = await fetch(
      `${supabaseUrl}/rest/v1/batches?select=id,item_name&id=in.(${idsCsv})`,
      { headers }
    )
    const rows = await lookupRes.json()
    if (!lookupRes.ok) throw new Error(rows.message || 'Could not look up selected batches')

    const sameItem = rows.length > 1 && rows.every(r => r.item_name === rows[0].item_name)

    if (sameItem) {
      const [keepId, ...restIds] = batchIds

      const updRes = await fetch(`${supabaseUrl}/rest/v1/batches?id=eq.${keepId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ cases_produced: totalCases, packaged_at: now, status: 'packaged' })
      })
      if (!updRes.ok) throw new Error(await updRes.text())

      if (restIds.length) {
        const delRes = await fetch(`${supabaseUrl}/rest/v1/batches?id=in.(${restIds.join(',')})`, {
          method: 'DELETE',
          headers: { ...headers, 'Prefer': 'return=minimal' }
        })
        if (!delRes.ok) throw new Error(await delRes.text())
      }
    } else {
      const casesPerBatch = Math.floor(totalCases / batchIds.length)
      const remainder = totalCases % batchIds.length

      for (let i = 0; i < batchIds.length; i++) {
        const cases = casesPerBatch + (i === 0 ? remainder : 0)
        const r = await fetch(`${supabaseUrl}/rest/v1/batches?id=eq.${batchIds[i]}`, {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ cases_produced: cases, packaged_at: now, status: 'packaged' })
        })
        if (!r.ok) throw new Error(await r.text())
      }
    }

    res.status(200).json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
