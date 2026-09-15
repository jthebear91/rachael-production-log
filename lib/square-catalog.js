// Shared Square catalog fetch/parse logic, used by both /api/catalog (the
// Daily Log category+item list) and /api/case-matches (matching a Todoist
// batch to the right finished-case SKU). Keeping this in one place means
// both endpoints always agree on what "an item" looks like.
//
// The read-only /api/square/catalog bridge reuses the same list call, then
// returns a richer item+variation+price shape (no Daily Log exclusions).

import { money, resolveAccount, squareFetch } from './square-client'

const EXCLUDED_CATEGORIES = ['order guide', 'order guides', 'vendor', 'vendors']

function isExcludedName(name) {
  const n = name.toLowerCase()
  return EXCLUDED_CATEGORIES.includes(n) || n.includes('order guide') || n.includes('vendor')
}

function categoryName(c) {
  return c.category_data?.name || c.category_v2_data?.name || 'Other'
}

function itemCategoryIds(item) {
  if (item.item_data?.categories && item.item_data.categories.length > 0) {
    return item.item_data.categories.map(c => c.id).filter(Boolean)
  }
  if (item.item_data?.category_id) return [item.item_data.category_id]
  return []
}

export async function listCatalogObjects({ token, account } = {}) {
  const resolvedToken = token || resolveAccount(account).token
  let cursor = null
  let allObjects = []

  do {
    const data = await squareFetch({
      token: resolvedToken,
      path: '/catalog/list',
      query: { types: 'ITEM,CATEGORY', ...(cursor ? { cursor } : {}) }
    })
    if (data.objects) allObjects = allObjects.concat(data.objects)
    cursor = data.cursor
  } while (cursor)

  return allObjects
}

function categoryMap(allObjects) {
  const catMap = {}
  allObjects.filter(o => o.type === 'CATEGORY').forEach(c => {
    catMap[c.id] = categoryName(c)
  })
  return catMap
}

export function normalizeDailyLogCatalog(allObjects) {
  const catMap = categoryMap(allObjects)
  const items = []

  allObjects.filter(o => o.type === 'ITEM').forEach(item => {
    const itemName = item.item_data?.name || 'Unknown'
    const rawCatIds = itemCategoryIds(item)
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

  return { categories, items }
}

export function normalizeBridgeCatalog(allObjects) {
  const catMap = categoryMap(allObjects)
  const items = []

  allObjects.filter(o => o.type === 'ITEM').forEach(item => {
    const rawCatIds = itemCategoryIds(item)
    const categoryIds = [...new Set(rawCatIds)]
    const variations = (item.item_data?.variations || []).map(v => {
      const vd = v.item_variation_data || {}
      return {
        id: v.id,
        name: (vd.name || '').trim() || 'Regular',
        sku: vd.sku || null,
        ordinal: vd.ordinal ?? null,
        pricingType: vd.pricing_type || null,
        price: money(vd.price_money)
      }
    })

    items.push({
      id: item.id,
      name: item.item_data?.name || 'Unknown',
      description: item.item_data?.description || null,
      categoryIds: categoryIds.length > 0 ? categoryIds : ['__none__'],
      variations
    })
  })

  const catSet = {}
  Object.entries(catMap).forEach(([id, name]) => { catSet[id] = name })
  items.forEach(i => {
    i.categoryIds.forEach(id => {
      if (!catSet[id]) catSet[id] = id === '__none__' ? 'Uncategorized' : 'Uncategorized'
    })
  })

  const categories = Object.entries(catSet)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  items.sort((a, b) => a.name.localeCompare(b.name))

  return { categories, items }
}

export async function fetchCatalog() {
  const allObjects = await listCatalogObjects({ token: process.env.SQUARE_TOKEN })
  return normalizeDailyLogCatalog(allObjects)
}

export async function fetchBridgeCatalog(accountParam) {
  const { token } = resolveAccount(accountParam)
  const allObjects = await listCatalogObjects({ token })
  return normalizeBridgeCatalog(allObjects)
}
