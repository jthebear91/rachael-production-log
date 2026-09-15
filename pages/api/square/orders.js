import { withBridgeGet } from '../../../lib/bridge-auth'
import {
  jsonData,
  money,
  parseLimit,
  resolveAccount,
  resolveLocationId,
  resolveTimeRange,
  squareFetch
} from '../../../lib/square-client'

function normalizeLineItem(item) {
  return {
    uid: item.uid || null,
    name: item.name || null,
    quantity: item.quantity || null,
    catalogObjectId: item.catalog_object_id || null,
    variationName: item.variation_name || null,
    note: item.note || null,
    basePriceMoney: money(item.base_price_money),
    totalMoney: money(item.total_money)
  }
}

function normalizeOrder(order) {
  return {
    id: order.id,
    locationId: order.location_id || null,
    state: order.state || null,
    createdAt: order.created_at || null,
    updatedAt: order.updated_at || null,
    closedAt: order.closed_at || null,
    source: order.source?.name || null,
    totalMoney: money(order.total_money),
    totalTaxMoney: money(order.total_tax_money),
    totalDiscountMoney: money(order.total_discount_money),
    totalTipMoney: money(order.total_tip_money),
    netAmounts: order.net_amounts
      ? {
          totalMoney: money(order.net_amounts.total_money),
          taxMoney: money(order.net_amounts.tax_money),
          discountMoney: money(order.net_amounts.discount_money),
          tipMoney: money(order.net_amounts.tip_money),
          serviceChargeMoney: money(order.net_amounts.service_charge_money)
        }
      : null,
    lineItems: (order.line_items || []).map(normalizeLineItem),
    tenders: (order.tenders || []).map(t => ({
      id: t.id || null,
      type: t.type || null,
      amountMoney: money(t.amount_money)
    }))
  }
}

export default withBridgeGet(async (req, res) => {
  const account = resolveAccount(req.query.account)
  const locationId = resolveLocationId(req.query.locationId, account)
  const { begin, end } = resolveTimeRange(req.query)
  const limit = parseLimit(req.query.limit, { fallback: 50, max: 100 })
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined

  const body = {
    location_ids: [locationId],
    limit,
    query: {
      filter: {
        date_time_filter: {
          created_at: {
            start_at: begin,
            end_at: end
          }
        }
      },
      sort: {
        sort_field: 'CREATED_AT',
        sort_order: 'DESC'
      }
    }
  }
  if (cursor) body.cursor = cursor

  const result = await squareFetch({
    token: account.token,
    path: '/orders/search',
    method: 'POST',
    body
  })

  jsonData(res, (result.orders || []).map(normalizeOrder), result.cursor)
})
