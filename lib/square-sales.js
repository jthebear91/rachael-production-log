import { getChicagoSalesWindows } from './chicago-time'
import { resolveAccount, resolveLocationId, sanitizeErrorMessage, squareFetch } from './square-client'
import { ACCOUNT_IDS, peekAccountFromEnv } from './square-accounts'

const MAX_PAYMENT_PAGES = 50
const PAGE_SIZE = 100

function moneyAmount(m) {
  if (!m || m.amount == null) return 0
  const n = Number(m.amount)
  return Number.isFinite(n) ? n : 0
}

function moneyCurrency(m, fallback = 'USD') {
  return (m && m.currency) || fallback
}

async function listPaymentsInRange({ token, locationId, begin, end }) {
  const payments = []
  let cursor
  let pages = 0
  let truncated = false

  do {
    pages += 1
    if (pages > MAX_PAYMENT_PAGES) {
      truncated = true
      break
    }
    const result = await squareFetch({
      token,
      path: '/payments',
      query: {
        location_id: locationId,
        begin_time: begin,
        end_time: end,
        sort_order: 'ASC',
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {})
      }
    })
    if (Array.isArray(result.payments)) payments.push(...result.payments)
    cursor = result.cursor || null
  } while (cursor)

  return { payments, truncated }
}

function summarizePeriod(payments, begin, end) {
  const beginMs = new Date(begin).getTime()
  const endMs = new Date(end).getTime()
  let gross = 0
  let tips = 0
  let refunds = 0
  let paymentCount = 0
  let currency = 'USD'

  for (const payment of payments) {
    if (payment.status !== 'COMPLETED') continue
    const created = new Date(payment.created_at).getTime()
    if (!Number.isFinite(created) || created < beginMs || created > endMs) continue
    paymentCount += 1
    gross += moneyAmount(payment.total_money)
    tips += moneyAmount(payment.tip_money)
    refunds += moneyAmount(payment.refunded_money)
    currency = moneyCurrency(payment.total_money, currency)
  }

  return {
    amount: gross - refunds,
    gross,
    tips,
    refunds,
    paymentCount,
    currency,
    begin,
    end
  }
}

export async function fetchAccountSales(accountParam, { locationId } = {}) {
  const account = resolveAccount(accountParam)
  const resolvedLocationId = resolveLocationId(locationId, account)
  const windows = getChicagoSalesWindows()
  const rangeBegin = windows.wtd.begin < windows.mtd.begin ? windows.wtd.begin : windows.mtd.begin

  const { payments, truncated } = await listPaymentsInRange({
    token: account.token,
    locationId: resolvedLocationId,
    begin: rangeBegin,
    end: windows.asOf
  })

  return {
    account: account.account,
    label: account.label,
    timezone: windows.timezone,
    weekStartsOn: windows.weekStartsOn,
    asOf: windows.asOf,
    locationId: resolvedLocationId,
    truncated,
    today: summarizePeriod(payments, windows.today.begin, windows.asOf),
    wtd: summarizePeriod(payments, windows.wtd.begin, windows.asOf),
    mtd: summarizePeriod(payments, windows.mtd.begin, windows.asOf)
  }
}

function publicPeriod(period) {
  if (!period) return null
  return {
    amount: period.amount,
    gross: period.gross,
    tips: period.tips,
    refunds: period.refunds,
    paymentCount: period.paymentCount,
    currency: period.currency || 'USD',
    begin: period.begin,
    end: period.end
  }
}

function combinePeriod(rows, key) {
  const ok = rows.filter(row => row.configured && !row.error && row[key])
  if (!ok.length) return null
  return {
    amount: ok.reduce((sum, row) => sum + (row[key].amount || 0), 0),
    gross: ok.reduce((sum, row) => sum + (row[key].gross || 0), 0),
    tips: ok.reduce((sum, row) => sum + (row[key].tips || 0), 0),
    refunds: ok.reduce((sum, row) => sum + (row[key].refunds || 0), 0),
    paymentCount: ok.reduce((sum, row) => sum + (row[key].paymentCount || 0), 0),
    currency: ok[0][key].currency || 'USD'
  }
}

export async function loadDashboardSales() {
  const windows = getChicagoSalesWindows()
  const accounts = await Promise.all(ACCOUNT_IDS.map(async (id) => {
    const peeked = peekAccountFromEnv(id)
    if (!peeked.configured) {
      return {
        account: id,
        label: peeked.label,
        configured: false,
        error: null,
        truncated: false,
        today: null,
        wtd: null,
        mtd: null
      }
    }
    try {
      const sales = await fetchAccountSales(id)
      return {
        account: sales.account,
        label: sales.label,
        configured: true,
        error: null,
        truncated: Boolean(sales.truncated),
        today: publicPeriod(sales.today),
        wtd: publicPeriod(sales.wtd),
        mtd: publicPeriod(sales.mtd)
      }
    } catch (err) {
      return {
        account: id,
        label: peeked.label,
        configured: true,
        error: sanitizeErrorMessage(err?.message || 'Could not load sales'),
        truncated: false,
        today: null,
        wtd: null,
        mtd: null
      }
    }
  }))

  return {
    timezone: windows.timezone,
    weekStartsOn: windows.weekStartsOn,
    asOf: windows.asOf,
    accounts,
    combined: {
      today: combinePeriod(accounts, 'today'),
      wtd: combinePeriod(accounts, 'wtd'),
      mtd: combinePeriod(accounts, 'mtd')
    }
  }
}
