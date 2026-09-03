// Logs a single Todoist "Package" task as a cooked batch in Supabase, then
// marks that task complete in Todoist. This is what the red Todoist category
// on the Daily Log screen calls when you tap an item and log it — it's the
// same effect as the bulk "Sync from Todoist" button, but for one task at
// the moment you log it, so Batch Tracker updates automatically without a
// separate manual sync step.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { taskId, itemName, batchSize } = req.body
  if (!itemName) return res.status(400).json({ error: 'Missing itemName' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const todoistToken = process.env.TODOIST_TOKEN

  try {
    const body = {
      todoist_task_id: taskId ? String(taskId) : `manual-${Date.now()}`,
      item_name: itemName,
      batch_size: batchSize || '1 Batch',
      cooked_at: new Date().toISOString(),
      status: 'cooked'
    }

    const sbRes = await fetch(`${supabaseUrl}/rest/v1/batches`, {
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

    // Best-effort: mark the task complete in Todoist so it drops off the
    // Daily Log's Todoist category. Not fatal if this fails.
    if (taskId && todoistToken) {
      try {
        await fetch(`https://api.todoist.com/api/v1/tasks/${taskId}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${todoistToken}` }
        })
      } catch (e) {
        // ignore — the batch is already logged, that's what matters
      }
    }

    res.status(200).json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
