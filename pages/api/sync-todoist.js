import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const todoistToken = process.env.TODOIST_TOKEN
  const projectId = process.env.TODOIST_COOK_PROJECT_ID

  try {
    // Fetch recently completed tasks from Todoist
    const url = projectId
      ? `https://api.todoist.com/rest/v2/tasks?project_id=${projectId}&filter=completed`
      : `https://api.todoist.com/rest/v2/tasks`

    // Get completed tasks via sync API
    const syncRes = await fetch('https://api.todoist.com/sync/v9/items/completed/get_all', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${todoistToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        limit: 50,
        project_id: projectId || undefined
      })
    })

    const syncData = await syncRes.json()
    if (!syncRes.ok) throw new Error('Todoist sync failed')

    const completedTasks = syncData.items || []

    // Parse batch size from task name
    // e.g. "12 Gallon Seafood Gumbo" → batchSize: "12 Gallon", itemName: "Seafood Gumbo"
    function parseBatch(content) {
      const match = content.match(/^(\d+\s+\w+(?:\s+\w+)?)\s+(.+)$/i)
      if (match) {
        return { batchSize: match[1], itemName: match[2] }
      }
      return { batchSize: '1 batch', itemName: content }
    }

    let added = 0
    for (const task of completedTasks) {
      const { batchSize, itemName } = parseBatch(task.content || '')
      const completedAt = task.completed_at || task.date_completed || new Date().toISOString()

      // Upsert to Supabase — skip if already logged
      const { error } = await supabase.from('batches').upsert({
        todoist_task_id: String(task.id),
        item_name: itemName,
        batch_size: batchSize,
        cooked_at: completedAt,
        status: 'cooked'
      }, { onConflict: 'todoist_task_id' })

      if (!error) added++
    }

    res.status(200).json({ synced: added, total: completedTasks.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
