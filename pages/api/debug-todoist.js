export default async function handler(req, res) {
  const token = process.env.TODOIST_TOKEN

  const projectsRes = await fetch('https://api.todoist.com/api/v1/projects', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const projectData = await projectsRes.json()
  const projects = projectData.results || projectData

  const packageProject = projects.find(p => p.name.toLowerCase().includes('package'))
  if (!packageProject) return res.status(200).json({ error: 'No package project', allProjects: projects.map(p => p.name) })

  const tasksRes = await fetch(`https://api.todoist.com/api/v1/tasks?project_id=${packageProject.id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const taskData = await tasksRes.json()

  res.status(200).json({
    project: packageProject.name,
    projectId: packageProject.id,
    taskCount: Array.isArray(taskData) ? taskData.length : taskData.results?.length,
    rawTaskData: JSON.stringify(taskData).substring(0, 500)
  })
}
