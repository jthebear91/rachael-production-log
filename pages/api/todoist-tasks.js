// Read-only: lists pending tasks in the Todoist "Package" project so the
// Daily Log screen can show them as tappable items under the red Todoist
// category. Does not write anything, and does not touch Supabase.
export default async function handler(req, res) {
  const token = process.env.TODOIST_TOKEN

  try {
    const projectsRes = await fetch('https://api.todoist.com/api/v1/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const projectData = await projectsRes.json()
    const projects = projectData.results || projectData
    const packageProject = projects.find(p => p.name.toLowerCase().includes('package'))
    if (!packageProject) return res.status(200).json([])

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

    const items = tasks.map(t => {
      const { batchSize, itemName } = parseBatch(t.content || '')
      return { taskId: String(t.id), itemName, batchSize }
    })

    res.status(200).json(items)
  } catch (e) {
    res.status(200).json([])
  }
}
