export default async function handler(req, res) {
  const token = process.env.TODOIST_TOKEN
  if (!token) return res.status(200).json({ error: 'No token found' })

  try {
    const r = await fetch('https://api.todoist.com/rest/v2/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await r.json()
    if (!r.ok) return res.status(200).json({ todoistError: data })

    const packageProject = data.find(p => p.name.toLowerCase().includes('package'))
    if (!packageProject) return res.status(200).json({ 
      error: 'No Package project found', 
      projectNames: data.map(p => p.name) 
    })

    const tasksRes = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${packageProject.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const tasks = await tasksRes.json()

    res.status(200).json({ 
      success: true, 
      project: packageProject.name,
      taskCount: tasks.length,
      tasks: tasks.map(t => t.content)
    })
  } catch(e) {
    res.status(200).json({ error: e.message })
  }
}
