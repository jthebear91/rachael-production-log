import { withSalesSensitiveGet } from '../../../lib/bridge-auth'
import {
  jsonData,
  money,
  parseLimit,
  resolveAccount,
  resolveLocationId,
  resolveTimeRange,
  squareFetch
} from '../../../lib/square-client'

function normalizePayment(payment) {
  return {
    id: payment.id,
    createdAt: payment.created_at || null,
    updatedAt: payment.updated_at || null,
    status: payment.status || null,
    sourceType: payment.source_type || null,
    locationId: payment.location_id || null,
    orderId: payment.order_id || null,
    receiptNumber: payment.receipt_number || null,
    amountMoney: money(payment.amount_money),
    tipMoney: money(payment.tip_money),
    totalMoney: money(payment.total_money),
    refundedMoney: money(payment.refunded_money)
  }
}

export default withSalesSensitiveGet(async (req, res) => {
  const account = resolveAccount(req.query.account)
  const locationId = resolveLocationId(req.query.locationId, account)
  const { begin, end } = resolveTimeRange(req.query)
  const limit = parseLimit(req.query.limit, { fallback: 100, max: 100 })
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined

  const result = await squareFetch({
    token: account.token,
    path: '/payments',
    query: {
      location_id: locationId,
      begin_time: begin,
      end_time: end,
      sort_order: 'DESC',
      limit,
      ...(cursor ? { cursor } : {})
    }
  })

  jsonData(res, (result.payments || []).map(normalizePayment), result.cursor)
})
