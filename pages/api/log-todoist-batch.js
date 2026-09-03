// Logs one or more Todoist "Package" tasks as ONE combined, already-packaged
// batch in Supabase — merging same-item batches together when more than one
// task is selected — then marks every included task complete in Todoist.
//
// This is called straight from the Daily Log's Todoist category, in one
// step: you pick the batch(es), enter the cases produced, and it's done —
// Batch Tracker just displays the result, no separate packaging step there.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { taskIds, itemName, batchSize, casesProduced } = req.body
  if (!itemName || !casesProduced || !Array.isArray(taskIds) || !taskIds.length) {
    return res.status(400).json({ error: 'Missing itemName, casesProduced, or taskIds' })
  }

  // Trim stray whitespace/newlines and any trailing "/rest/v1" or slash that
  // may have been pasted into the Vercel env var by accident — either one
  // would corrupt the request path and the Supabase gateway would reject it
  // with a routing error (PGRST125) rather than a normal database error.
  let supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const todoistToken = process.env.TODOIST_TOKEN

  try {
    const now = new Date().toISOString()
    const body = {
      todoist_task_id: String(taskIds[0]),
      item_name: itemName,
      batch_size: taskIds.length > 1
        ? `${taskIds.length} batches — ${batchSize || '1 Batch'}`
        : (batchSize || '1 Batch'),
      cooked_at: now,
      packaged_at: now,
      status: 'packaged',
      cases_produced: casesProduced
    }

    // on_conflict tells Supabase which column identifies a "duplicate" —
    // required for resolution=merge-duplicates to know what to match on.
    const sbRes = await fetch(`${supabaseUrl}/rest/v1/batches?on_conflict=todoist_task_id`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(body)
    })

    if (!sbRes.ok && sbRes.status !== 201 && sbRes.status !== 204) {
      const errText = await sbRes.text()
      return res.status(500).json({ error: errText })
    }

    // Best-effort: check off every included task in Todoist so they drop
    // out of the Daily Log's Todoist category. Not fatal if this fails —
    // the batch is already logged, which is what matters most.
    if (todoistToken) {
      await Promise.all(taskIds.map(id =>
        fetch(`https://api.todoist.com/api/v1/tasks/${id}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${todoistToken}` }
        }).catch(() => {})
      ))
    }

    res.status(200).json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
