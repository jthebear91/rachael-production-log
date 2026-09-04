// Logs one or more Todoist "Package" tasks straight from the Daily Log's
// Todoist category, in one step: pick the batch(es), pick which finished
// case(s) they became, enter cases produced, and it's done.
//
// A single selection can now be SPLIT across more than one finished case —
// e.g. part of a tilt-skillet batch goes out as fresh soup base, and the
// rest gets turned into crab and corn — so `splits` is always an array,
// even when there's only one destination. Each split becomes its own
// packaged row in Supabase, Square's on-hand count goes up for each case
// SKU, and every included Todoist task gets checked off.
//
// Batch Tracker just displays the result — no separate packaging step there.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { taskIds, itemName, batchSize, splits } = req.body
  if (!itemName || !Array.isArray(taskIds) || !taskIds.length || !Array.isArray(splits) || !splits.length) {
    return res.status(400).json({ error: 'Missing itemName, taskIds, or splits' })
  }
  for (const sp of splits) {
    if (!sp.caseVariationId || !sp.casesProduced) {
      return res.status(400).json({ error: 'Each split needs a case picked and a cases-produced amount' })
    }
  }

  // Trim stray whitespace/newlines and any trailing "/rest/v1" or slash that
  // may have been pasted into the Vercel env var by accident — either one
  // would corrupt the request path and the Supabase gateway would reject it
  // with a routing error (PGRST125) rather than a normal database error.
  let supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const todoistToken = process.env.TODOIST_TOKEN
  const squareToken = process.env.SQUARE_TOKEN
  const locationId = process.env.SQUARE_LOCATION_ID

  try {
    const now = new Date().toISOString()
    const label = taskIds.length > 1
      ? `${taskIds.length} batches — ${batchSize || '1 Batch'}`
      : (batchSize || '1 Batch')

    // Insert one row per split. Plain inserts (no upsert/on_conflict) —
    // every tap of "Log & Package" is a fresh event, so there's nothing to
    // merge into, and this avoids any dependence on a unique constraint
    // existing on todoist_task_id.
    const insertedIds = []
    for (let i = 0; i < splits.length; i++) {
      const sp = splits[i]
      const body = {
        todoist_task_id: i === 0 ? String(taskIds[0]) : `${taskIds.join('_')}-split-${i}`,
        item_name: itemName,
        batch_size: splits.length > 1 ? `${label} (split ${i + 1} of ${splits.length})` : label,
        cooked_at: now,
        packaged_at: now,
        status: 'packaged',
        cases_produced: sp.casesProduced,
        case_sku_id: sp.caseVariationId,
        case_sku_name: sp.caseName || null
      }

      const sbRes = await fetch(`${supabaseUrl}/rest/v1/batches`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(body)
      })

      const resultText = await sbRes.text()
      if (!sbRes.ok) {
        return res.status(500).json({ error: `Could not save split ${i + 1} of ${splits.length}: ${resultText}` })
      }
      try {
        const rows = JSON.parse(resultText)
        if (Array.isArray(rows) && rows[0]) insertedIds.push(rows[0].id)
      } catch (e) {}
    }

    // Best-effort: remember the first split's case choice for next time this
    // same Todoist item is logged, so the picker can default to it. Not
    // fatal if the mappings table doesn't exist yet or this fails.
    try {
      await fetch(`${supabaseUrl}/rest/v1/item_case_mappings?on_conflict=item_name`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          item_name: itemName.toLowerCase(),
          variation_id: splits[0].caseVariationId,
          case_name: splits[0].caseName || null,
          updated_at: now
        })
      })
    } catch (e) {}

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

    // Add the produced cases into Square's on-hand inventory for each case
    // SKU. Reported back as a warning (not a hard failure) since the batch
    // is already safely logged in Supabase either way.
    let squareWarning = null
    if (!squareToken || !locationId) {
      squareWarning = 'Square inventory was not updated — SQUARE_TOKEN or SQUARE_LOCATION_ID is missing.'
    } else {
      try {
        const changes = splits.map(sp => ({
          type: 'ADJUSTMENT',
          adjustment: {
            catalog_object_id: sp.caseVariationId,
            location_id: locationId,
            quantity: String(sp.casesProduced),
            from_state: 'NONE',
            to_state: 'IN_STOCK',
            occurred_at: now
          }
        }))
        const sqRes = await fetch('https://connect.squareup.com/v2/inventory/changes/batch-create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${squareToken}`,
            'Square-Version': '2024-02-22',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ changes, idempotency_key: 'rw-todoist-' + Date.now() })
        })
        const sqData = await sqRes.json()
        if (!sqRes.ok) squareWarning = sqData.errors?.[0]?.detail || 'Square inventory update failed.'
      } catch (e) {
        squareWarning = 'Square inventory update failed: ' + e.message
      }
    }

    res.status(200).json({ success: true, insertedIds, squareWarning })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
