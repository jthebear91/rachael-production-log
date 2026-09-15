import { withBridgeGet } from '../../../lib/bridge-auth'
import {
  jsonData,
  parseLimit,
  resolveAccount,
  resolveLocationId,
  squareFetch
} from '../../../lib/square-client'

function normalizeCount(count) {
  return {
    catalogObjectId: count.catalog_object_id,
    catalogObjectType: count.catalog_object_type || null,
    state: count.state || null,
    locationId: count.location_id || null,
    quantity: count.quantity ?? null,
    calculatedAt: count.calculated_at || null
  }
}

export default withBridgeGet(async (req, res) => {
  const account = resolveAccount(req.query.account)
  const locationId = resolveLocationId(req.query.locationId, account)
  const limit = parseLimit(req.query.limit, { fallback: 100, max: 200 })
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined

  const body = {
    location_ids: [locationId],
    limit
  }
  if (cursor) body.cursor = cursor

  const result = await squareFetch({
    token: account.token,
    path: '/inventory/counts/batch-retrieve',
    method: 'POST',
    body
  })

  jsonData(res, (result.counts || []).map(normalizeCount), result.cursor)
})
