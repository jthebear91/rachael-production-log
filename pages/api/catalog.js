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

    function isExcludedName(name) {
      const n = name.toLowerCase()
      return EXCLUDED_CATEGORIES.includes(n) || n.includes('order guide') || n.includes('vendor')
    }

    // Build items list. An item in Square can belong to more than one
    // category (e.g. a location category like "Walk-In Freezer" AND a
    // type category like "Frozen") — we keep every category id it's
    // assigned to, so the Daily Log screen can show the item under
    // whichever of those categories isn't hidden, regardless of which
    // order Square stores them in.
    const items = []
    allObjects.filter(o => o.type === 'ITEM').forEach(item => {
      const itemName = item.item_data?.name || 'Unknown'

      // Handle both old (category_id) and new (categories array) Square formats
      let rawCatIds = []
      if (item.item_data?.categories && item.item_data.categories.length > 0) {
        // New format: categories is an array of {id, ordinal}
        rawCatIds = item.item_data.categories.map(c => c.id).filter(Boolean)
      } else if (item.item_data?.category_id) {
        // Old format: single category_id string
        rawCatIds = [item.item_data.category_id]
      }

      // Drop any assigned category that's excluded outright (Order Guide, Vendor, ...)
      const keptCatIds = [...new Set(rawCatIds)].filter(id => !isExcludedName(catMap[id] || ''))

      // If the item had categories but ALL of them were excluded, skip the
      // item entirely (matches the old behavior for Order Guide items).
      if (rawCatIds.length > 0 && keptCatIds.length === 0) return

      const categoryIds = keptCatIds.length > 0 ? keptCatIds : ['__none__']

      ;(item.item_data?.variations || []).forEach(v => {
        const vn = (v.item_variation_data?.name || '').trim()
        const plain = ['Regular', 'Standard', ''].includes(vn)
        items.push({
          variationId: v.id,
          name: plain ? itemName : `${itemName} (${vn})`,
          categoryIds
        })
      })
    })

    // Build sorted category list from every category id that made it
    // through, across all items (so an item's second/third category shows
    // up as a pill too, not just its first one).
    const catSet = {}
    items.forEach(i => {
      i.categoryIds.forEach(id => {
        catSet[id] = id === '__none__' ? 'Uncategorized' : (catMap[id] || 'Uncategorized')
      })
    })
    const categories = Object.entries(catSet)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))

    items.sort((a, b) => a.name.localeCompare(b.name))

    res.status(200).json({ categories, items })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
