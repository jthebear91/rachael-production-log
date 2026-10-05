// Cafe gumbo fridge counts for the sales dashboard.
//
// Wholesale reads the five fresh Gumbo Cooler cafe variations (live Square).
// Maurice column reads the five wholesale "(Inventory)" variations written by
// the nightly Maurice order scan-in (same SKUs Jordan adjusts in Square). Freezer 6-count wholesale items are not included.
//
// Counts come from POST /inventory/counts/batch-retrieve scoped to those
// catalog variation ids and one location. Only IN_STOCK is displayed.
// A variation with no count row is null (the dashboard shows an em dash),
// not zero. A missing account token marks that side not configured and
// does not fail the rest of the dashboard.

import { peekAccountFromEnv } from './square-accounts.js'
import {
  resolveAccount,
  resolveLocationId,
  sanitizeErrorMessage,
  squareFetch
} from './square-client.js'

export { FRIDGE_REFRESH_MS, FRIDGE_QTY_MISSING, formatFridgeQty, isNegativeFridgeQty } from './gumbo-fridge-display.js'

const WHOLESALE_CAFE = [
  { key: 'chicken', label: 'Chicken & Sausage', catalogObjectId: 'KSKQ3QG5XO4BNP5DISSCNYGW' },
  { key: 'seafood', label: 'Seafood', catalogObjectId: 'GOBEW6URKW5BHTZF36VPCEZC' },
  { key: 'shrimp', label: 'Shrimp & Okra', catalogObjectId: 'MXNS46SPRII4UBUGYO6EU6SO' },
  { key: 'signature', label: 'Signature', catalogObjectId: '3AAPOGWL6P4D4G63QOWYNZRU' },
  { key: 'bisque', label: 'Bisque', catalogObjectId: '6G4Y6H3OOUBOFGOYHKSTKSUN' }
]

// These are the wholesale-account "(Inventory)" variations. Nightly Maurice
// order scan-in (and Jordan's manual adjusts) write counts there — not on the
// identically named Maurice-merchant Inventory SKUs, which have no count rows.
const MAURICE_INVENTORY = [
  { key: 'chicken', label: 'Chicken & Sausage', catalogObjectId: 'AOETTPKX4HDGAECC6JEYCMLQ' },
  { key: 'seafood', label: 'Seafood', catalogObjectId: 'TYC37BA4GITAY5ZXWPWVOK4T' },
  { key: 'shrimp', label: 'Shrimp & Okra', catalogObjectId: 'WJ3VTZOM5EIGQOAOG4I7IA4Q' },
  { key: 'signature', label: 'Signature', catalogObjectId: 'DCIJMUOYFK6T3ATTWEB7RN3U' },
  { key: 'bisque', label: 'Bisque', catalogObjectId: '224MN7JX6PDKRHUNAVNEAOPY' }
]

export const FRIDGE_SIDES = [
  {
    id: 'wholesale',
    account: 'wholesale',
    title: 'Wholesale · Gumbo Cooler',
    detail: 'Fresh cafe containers',
    source: 'Live Square',
    items: WHOLESALE_CAFE
  },
  {
    // UI column is Maurice, but counts live on the wholesale Square account.
    id: 'maurice',
    account: 'wholesale',
    title: 'Maurice · Inventory SKUs',
    detail: 'Cafe containers',
    source: 'Updated by the nightly order scan-in',
    items: MAURICE_INVENTORY
  }
]

const MAX_COUNT_PAGES = 5

function catalogId(row) {
  if (!row) return ''
  return String(row.catalog_object_id || row.catalogObjectId || '')
}

function rowLocation(row) {
  if (!row) return ''
  return String(row.location_id || row.locationId || '')
}

function rawQuantity(row) {
  if (!row || row.quantity == null) return null
  const raw = String(row.quantity).trim()
  return raw === '' ? null : raw
}

// First IN_STOCK row for this variation. Other states are ignored.
// A location filter skips rows that name a different location. A missing
// count row, or an IN_STOCK row with no quantity, returns null.
export function selectInStockQuantity(counts, catalogObjectId, locationId) {
  const wantedId = String(catalogObjectId || '')
  const wantedLocation = locationId == null || locationId === '' ? null : String(locationId)
  const rows = Array.isArray(counts) ? counts : []
  for (const row of rows) {
    if (catalogId(row) !== wantedId) continue
    if (row.state !== 'IN_STOCK') continue
    const loc = rowLocation(row)
    if (wantedLocation && loc && loc !== wantedLocation) continue
    return rawQuantity(row)
  }
  return null
}

function emptyItems(definitions) {
  return definitions.map(item => ({
    key: item.key,
    label: item.label,
    catalogObjectId: item.catalogObjectId,
    quantity: null
  }))
}

function itemsFromCounts(definitions, counts, locationId) {
  return definitions.map(item => ({
    key: item.key,
    label: item.label,
    catalogObjectId: item.catalogObjectId,
    quantity: selectInStockQuantity(counts, item.catalogObjectId, locationId)
  }))
}

async function retrieveInStockCounts({ token, locationId, catalogObjectIds, squareFetch: fetchImpl }) {
  const counts = []
  let cursor = null
  let pages = 0
  do {
    pages += 1
    if (pages > MAX_COUNT_PAGES) break
    const body = {
      catalog_object_ids: catalogObjectIds,
      location_ids: [locationId],
      states: ['IN_STOCK'],
      limit: 100
    }
    if (cursor) body.cursor = cursor
    const result = await fetchImpl({
      token,
      path: '/inventory/counts/batch-retrieve',
      method: 'POST',
      body
    })
    if (Array.isArray(result?.counts)) counts.push(...result.counts)
    cursor = result?.cursor || null
  } while (cursor)
  return counts
}

async function loadSide(side, deps) {
  const peek = deps.peekAccount || ((id) => peekAccountFromEnv(id, deps.env || process.env))
  const peeked = peek(side.account)
  const base = {
    id: side.id || side.account,
    account: side.account,
    title: side.title,
    detail: side.detail,
    source: side.source,
    items: emptyItems(side.items)
  }
  if (!peeked || !peeked.configured) {
    return { ...base, configured: false, error: null }
  }

  try {
    const resolve = deps.resolveAccount || resolveAccount
    const resolveLoc = deps.resolveLocationId || resolveLocationId
    const fetchImpl = deps.squareFetch || squareFetch
    const account = resolve(side.account)
    const locationId = resolveLoc(null, account)
    const counts = await retrieveInStockCounts({
      token: account.token,
      locationId,
      catalogObjectIds: side.items.map(item => item.catalogObjectId),
      squareFetch: fetchImpl
    })
    return {
      ...base,
      configured: true,
      error: null,
      items: itemsFromCounts(side.items, counts, locationId)
    }
  } catch (err) {
    return {
      ...base,
      configured: true,
      error: sanitizeErrorMessage(err?.message || 'Could not load fridge counts')
    }
  }
}

export async function loadGumboFridge(deps = {}) {
  const sides = await Promise.all(FRIDGE_SIDES.map(side => loadSide(side, deps)))
  return {
    loadedAt: new Date().toISOString(),
    sides
  }
}
