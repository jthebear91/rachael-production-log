// Given a Todoist batch's item name (e.g. "stuffed jalapenos"), finds the
// Square catalog items whose name looks like the same product — since one
// batch can become more than one finished case (a frozen 12ct case AND a
// fresh restaurant case, say) — so Daily Log can offer them as a short
// pick-list instead of the whole catalog. Also returns whichever case was
// picked last time for this exact item name, so that can be pre-selected.
//
// Only items in a VISIBLE category (per HIDDEN_CATEGORIES) are eligible —
// raw ingredients and location categories aren't finished products you'd
// package a batch into, so they're filtered out the same way they're
// hidden from the Daily Log's category row.
import { fetchCatalog } from '../../lib/square-catalog'
import { HIDDEN_CATEGORIES } from '../../lib/hidden-categories'

const STOPWORDS = new Set(['of', 'and', 'the', 'a', 'an', 'with', 'for'])

function words(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
}

function scoreMatch(itemWords, catalogWords) {
  const catSet = new Set(catalogWords)
  let shared = 0
  itemWords.forEach(w => { if (catSet.has(w)) shared++ })
  return shared
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const itemName = (req.query.itemName || '').trim()
  if (!itemName) return res.status(400).json({ error: 'Missing itemName' })

  let supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  try {
    const { items, categories } = await fetchCatalog()

    // Which category ids are hidden, by name (case-insensitive) — same
    // rule the Daily Log category row uses.
    const hiddenIds = new Set(
      categories
        .filter(c => HIDDEN_CATEGORIES.some(h => h.toLowerCase() === (c.name || '').toLowerCase()))
        .map(c => c.id)
    )
    // Keep an item only if at least one of its categories is NOT hidden.
    const visibleItems = items.filter(i => (i.categoryIds || []).some(id => !hiddenIds.has(id)))

    const itemWords = words(itemName)

    const scored = visibleItems
      .map(i => ({ ...i, score: scoreMatch(itemWords, words(i.name)) }))
      .filter(i => i.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(({ variationId, name }) => ({ variationId, name }))

    let lastUsed = null
    try {
      const key = itemName.toLowerCase()
      const r = await fetch(
        `${supabaseUrl}/rest/v1/item_case_mappings?item_name=eq.${encodeURIComponent(key)}&select=variation_id,case_name`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      )
      const rows = await r.json()
      if (Array.isArray(rows) && rows[0]) {
        lastUsed = { variationId: rows[0].variation_id, name: rows[0].case_name }
      }
    } catch (e) {
      // No mapping table yet, or lookup failed — just skip the default, the
      // matches list still works fine without it.
    }

    res.status(200).json({ matches: scored, lastUsed })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
