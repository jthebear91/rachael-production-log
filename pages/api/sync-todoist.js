import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const todoistToken = process.env.TODOIST_TOKEN

  try {
    // Step 1: Find the Package project by name
    const projectsRes = await fetch('https://api.todoist.com/rest/v2/projects', {
      headers: { 'Authorization': `Bearer ${todoistToken}` }
    })

    if (!projectsRes.ok) throw new Error('Could not connect to Todoist')
    const projects = await projectsRes.json()

    // Find a project with "package" in the name (case insensitive)
    const packageProject = projects.find(p =>
      p.name.toLowerCase().includes('package')
    )

    if (!packageProject) {
      return res.status(404).json({
        error: 'Could not find a Todoist project with "Package" in the name. Check your project name.'
      })
    }

    // Step 2: Get all active tasks currently sitting on the Package board
    const tasksRes = await fetch(
      `https://api.todoist.com/rest/v2/tasks?project_id=${packageProject.id}`,
      { headers: { 'Authorization': `Bearer ${todoistToken}` } }
    )

    if (!tasksRes.ok) throw new Error('Could not load Package board tasks')
    const tasks = await tasksRes.json()

    // Step 3: Parse batch size from task name
    // e.g. "12 Gallon Seafood Gumbo" → batchSize: "12 Gallon", itemName: "Seafood Gumbo"
    function parseBatch(content) {
      const match = content.match(/^(\d+\s+\w+(?:\s+of)?)\s+(.+)$/i)
      if (match) {
        return { batchSize: match[1].trim(), itemName: match[2].trim() }
      }
      return { batchSize: '1 Batch', itemName: content.trim() }
    }

    // Step 4: Upsert each task into Supabase batches table
    let added = 0
    for (const task of tasks) {
      const { batchSize, itemName } = parseBatch(task.content || '')
      const createdAt = task.created_at || new Date().toISOString()

      const { error } = await supabase.from('batches').upsert({
        todoist_task_id: String(task.id),
        item_name: itemName,
        batch_size: batchSize,
        cooked_at: createdAt,
        status: 'cooked'
      }, { onConflict: 'todoist_task_id' })

      if (!error) added++
    }

    res.status(200).json({
      synced: added,
      total: tasks.length,
      project: packageProject.name
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
