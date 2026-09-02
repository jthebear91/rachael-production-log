export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const token = process.env.SQUARE_TOKEN
  const baseUrl = 'https://connect.squareup.com/v2'

  // Categories to exclude from the production log
  const EXCLUDED_CATEGORIES = ['order guide', 'order guides', 'vendor', 'vendors']

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

    // Build category map — handle both old and new Square API formats
    const catMap = {}
    allObjects.filter(o => o.type === 'CATEGORY').forEach(c => {
      const name = c.category_data?.name || c.category_v2_data?.name || 'Other'
      catMap[c.id] = name
    })

    // Build items list
    const items = []
    allObjects.filter(o => o.type === 'ITEM').forEach(item => {
      const itemName = item.item_data?.name || 'Unknown'

      // Handle both old (category_id) and new (categories array) Square formats
      let catId = null
      if (item.item_data?.categories && item.item_data.categories.length > 0) {
        // New format: categories is an array of {id, ordinal}
        catId = item.item_data.categories[0].id
      } else if (item.item_data?.category_id) {
        // Old format: single category_id string
        catId = item.item_data.category_id
      }

      const catName = catId && catMap[catId] ? catMap[catId] : 'Uncategorized'

      // Skip excluded categories like Order Guide
      if (EXCLUDED_CATEGORIES.includes(catName.toLowerCase())) return
      if (catName.toLowerCase().includes('order guide')) return
      if (catName.toLowerCase().includes('vendor')) return

      ;(item.item_data?.variations || []).forEach(v => {
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

    // Build sorted category list from items that made it through
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
