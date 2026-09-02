import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const todoistToken = process.env.TODOIST_TOKEN
  if (!todoistToken) return res.status(500).json({ error: 'TODOIST_TOKEN not set in environment variables' })
  try {
    const projectsRes = await fetch('https://api.todoist.com/rest/v2/projects', {
      headers: { 'Authorization': `Bearer ${todoistToken}` }
    })
    if (!projectsRes.ok) throw new Error('Could not connect to Todoist — check your token')
    const projects = await projectsRes.json()
    const packageProject = projects.find(p => p.name.toLowerCase().includes('package'))
    if (!packageProject) return res.status(404).json({ error: 'No project named "Package" found in Todoist' })
    const tasksRes = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${packageProject.id}`, {
      headers: { 'Authorization': `Bearer ${todoistToken}` }
    })
    if (!tasksRes.ok) throw new Error('Could not load Package board tasks')
    const tasks = await tasksRes.json()
    function parseBatch(content) {
      const match = content.match(/^(\d+\s+\w+(?:\s+of)?)\s+(.+)$/i)
      if (match) return { batchSize: match[1].trim(), itemName: match[2].trim() }
      return { batchSize: '1 Batch', itemName: content.trim() }
    }
    let added = 0
    for (const task of tasks) {
      const { batchSize, itemName } = parseBatch(task.content || '')
      const { error } = await supabase.from('batches').upsert({
        todoist_task_id: String(task.id),
        item_name: itemName,
        batch_size: batchSize,
        cooked_at: task.created_at || new Date().toISOString(),
        status: 'cooked'
      }, { onConflict: 'todoist_task_id' })
      if (!error) added++
    }
    res.status(200).json({ synced: added, total: tasks.length, project: packageProject.name })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
