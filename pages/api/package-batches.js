import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { batchIds, totalCases } = req.body
  if (!batchIds?.length || !totalCases) {
    return res.status(400).json({ error: 'Missing batchIds or totalCases' })
  }

  try {
    // Split cases evenly across batches
    const casesPerBatch = Math.floor(totalCases / batchIds.length)
    const remainder = totalCases % batchIds.length

    const now = new Date().toISOString()

    for (let i = 0; i < batchIds.length; i++) {
      const cases = casesPerBatch + (i === 0 ? remainder : 0)
      await supabase.from('batches').update({
        cases_produced: cases,
        packaged_at: now,
        status: 'packaged'
      }).eq('id', batchIds[i])
    }

    res.status(200).json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
