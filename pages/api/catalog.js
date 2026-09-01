export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const token = process.env.SQUARE_TOKEN
  const baseUrl = 'https://connect.squareup.com/v2'

  try {
    let cursor = null
    let allObjects = []

    do {
      const params = new URLSearchParams({ types: 'ITEM,CATEGORY' })
      if (cursor) params.append('cursor', cursor)

      const r = await fetch(`${baseUrl}/catalog/list?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Square-Version': '2024-02-22',
          'Content-Type': 'application/json'
        }
      })

      const data = await r.json()
      if (!r.ok) throw new Error(data.errors?.[0]?.detail || 'Square error')
      if (data.objects) allObjects = allObjects.concat(data.objects)
      cursor = data.cursor
    } while (cursor)

    // Build category map
    const catMap = {}
    allObjects.filter(o => o.type === 'CATEGORY').forEach(c => {
      catMap[c.id] = c.category_data?.name || 'Other'
    })

    // Build items list
    const items = []
    allObjects.filter(o => o.type === 'ITEM').forEach(item => {
      const catId = item.item_data?.category_id
      const catName = catId && catMap[catId] ? catMap[catId] : 'Uncategorized'
      const itemName = item.item_data?.name || 'Unknown';

      (item.item_data?.variations || []).forEach(v => {
        const vn = (v.item_variation_data?.name || '').trim()
        const plain = ['Regular', 'Standard', ''].includes(vn)
        items.push({
          variationId: v.id,
          name: plain ? itemName : `${itemName} (${vn})`,
          categoryId: catId || '__none__',
          categoryName: catName
        })
      })
    })

    // Build sorted category list
    const catSet = {}
    items.forEach(i => { catSet[i.categoryId] = i.categoryName })
    const categories = Object.entries(catSet)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))

    items.sort((a, b) => a.name.localeCompare(b.name))

    res.status(200).json({ categories, items })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
