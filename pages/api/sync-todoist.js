export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const token = process.env.TODOIST_TOKEN
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  try {
    // Get projects from Todoist
    const projectsRes = await fetch('https://api.todoist.com/api/v1/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const projectData = await projectsRes.json()
    const projects = projectData.results || projectData
    const packageProject = projects.find(p => p.name.toLowerCase().includes('package'))
    if (!packageProject) return res.status(404).json({ error: 'No Package project found' })

    // Get tasks from Package board
    const tasksRes = await fetch(`https://api.todoist.com/api/v1/tasks?project_id=${packageProject.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const taskData = await tasksRes.json()
    const tasks = Array.isArray(taskData) ? taskData : (taskData.results || [])

    function parseBatch(content) {
      const match = content.match(/^(\d+\s+\w+(?:\s+of)?)\s+(.+)$/i)
      if (match) return { batchSize: match[1].trim(), itemName: match[2].trim() }
      return { batchSize: '1 Batch', itemName: content.trim() }
    }

    // Write each task directly to Supabase REST API
    let added = 0
    const errors = []
    for (const task of tasks) {
      const { batchSize, itemName } = parseBatch(task.content || '')
      const body = {
        todoist_task_id: String(task.id),
        item_name: itemName,
        batch_size: batchSize,
        cooked_at: task.created_at || new Date().toISOString(),
        status: 'cooked'
      }

      const sbRes = await fetch(`${supabaseUrl}/rest/v1/batches`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(body)
      })

      if (sbRes.ok || sbRes.status === 201 || sbRes.status === 204) {
        added++
      } else {
        const errText = await sbRes.text()
        errors.push({ task: task.content, status: sbRes.status, error: errText })
      }
    }

    res.status(200).json({ 
      synced: added, 
      total: tasks.length, 
      errors,
      project: packageProject.name 
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
