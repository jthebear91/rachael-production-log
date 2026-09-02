export default async function handler(req, res) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  const testRow = {
    todoist_task_id: 'debug-' + Date.now(),
    item_name: 'Debug Test',
    batch_size: '1 Batch',
    status: 'cooked'
  }

  const sbRes = await fetch(`${supabaseUrl}/rest/v1/batches`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(testRow)
  })

  const responseText = await sbRes.text()

  res.status(200).json({
    httpStatus: sbRes.status,
    supabaseUrl: supabaseUrl ? supabaseUrl.substring(0, 30) : 'NOT SET',
    serviceKeySet: !!serviceKey,
    serviceKeyStart: serviceKey ? serviceKey.substring(0, 10) : 'NOT SET',
    response: responseText.substring(0, 500)
  })
}
