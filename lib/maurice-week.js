// Monday rollup: one unpaid wholesale invoice for the prior Mon–Sat of
// live Maurice pick Sends. Daily Send does not call this. This module does
// not touch Lafayette and does not call Payments.

const { priorMonSat } = require('./chicago-time')
const { findPaymentKey } = require('./invoice-write')
const {
  WHOLESALE_PICK_LOCATION_ID,
  assertMauriceSquarePath,
  mauriceCustomerId
} = require('./maurice-pick')

const MAX_INVOICE_LINES = 80

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function addIsoDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day + days))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isMonday(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1
}

function resolveWeek(body, now) {
  const input = body == null || body === '' ? {} : body
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'JSON object required')
  }
  if (findPaymentKey(input)) throw httpError(400, 'Payment fields are not accepted')
  for (const key of Object.keys(input)) {
    if (key !== 'weekStart') throw httpError(400, `Unexpected field: ${key}`)
  }
  if (input.weekStart == null) return priorMonSat(now)
  if (!isIsoDate(input.weekStart) || !isMonday(input.weekStart)) {
    throw httpError(400, 'weekStart must be a Monday YYYY-MM-DD')
  }
  return {
    timezone: 'America/Chicago',
    weekStart: input.weekStart,
    weekEnd: addIsoDays(input.weekStart, 5)
  }
}

function sumQty(left, right) {
  const scale = 100000
  const total = Math.round(Number(left) * scale) + Math.round(Number(right) * scale)
  const abs = Math.abs(total)
  const whole = Math.floor(abs / scale)
  const frac = String(abs % scale).padStart(5, '0').replace(/0+$/, '')
  const text = frac ? `${whole}.${frac}` : String(whole)
  return total < 0 ? `-${text}` : text
}

function dollarsFromCents(cents) {
  return (cents / 100).toFixed(2)
}

function linesOf(pick) {
  if (Array.isArray(pick.pricedLines) && pick.pricedLines.length) return pick.pricedLines
  return (pick.sentLines || []).map(line => ({
    sellableCatalogObjectId: line.sellableCatalogObjectId,
    name: line.name,
    qtySent: line.qtySent,
    lineTotalCents: null
  }))
}

function isLivePick(pick) {
  return Boolean(pick && pick.notify && pick.notify.inventoryAdjusted === true)
}

function aggregateLivePicks(picks) {
  const live = []
  let dryRunSkipped = 0
  for (const pick of picks) {
    if (isLivePick(pick)) live.push(pick)
    else dryRunSkipped += 1
  }
  const byId = new Map()
  let cents = 0
  let priced = true
  for (const pick of live) {
    for (const line of linesOf(pick)) {
      const qty = Number(line.qtySent)
      if (!Number.isFinite(qty) || qty <= 0) continue
      const id = line.sellableCatalogObjectId
      const current = byId.get(id) || {
        sellableCatalogObjectId: id,
        name: line.name || id,
        qty: '0',
        loggedTotalCents: 0,
        linePriced: true
      }
      current.qty = sumQty(current.qty, line.qtySent)
      if (!Number.isInteger(line.lineTotalCents)) {
        current.linePriced = false
        priced = false
      } else {
        current.loggedTotalCents += line.lineTotalCents
        cents += line.lineTotalCents
      }
      byId.set(id, current)
    }
  }
  const lines = [...byId.values()].map(line => ({
    sellableCatalogObjectId: line.sellableCatalogObjectId,
    name: line.name,
    qty: line.qty,
    loggedTotal: line.linePriced ? dollarsFromCents(line.loggedTotalCents) : null
  }))
  return {
    live,
    dryRunSkipped,
    lines,
    loggedTotal: priced && lines.length ? dollarsFromCents(cents) : null
  }
}

function storedResult(row, alreadyInvoiced) {
  return {
    alreadyInvoiced,
    invoiced: true,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    customerId: row.customerId || null,
    invoiceId: row.invoiceId || null,
    invoiceNumber: row.invoiceNumber || null,
    orderId: row.orderId || null,
    publicUrl: row.publicUrl || null,
    lines: row.lines || [],
    loggedTotal: row.loggedTotal || null,
    pickCount: row.pickCount || 0,
    dryRunSkipped: row.dryRunSkipped || 0
  }
}

async function createMauriceWeekInvoice({
  body,
  env = process.env,
  store,
  now = () => new Date(),
  createUnpaidInvoice,
  resolveAccount,
  squareFetch
}) {
  if (!store || typeof store.listSentByPickDate !== 'function' || typeof store.insertWeekInvoice !== 'function') {
    throw httpError(500, 'Week invoice store is not configured')
  }
  const clock = now()
  const week = resolveWeek(body, clock)
  const existing = await store.getWeekInvoice(week.weekStart)
  if (existing && existing.invoiceId) return storedResult(existing, true)

  const picks = await store.listSentByPickDate(week.weekStart, week.weekEnd)
  const rolled = aggregateLivePicks(picks)
  const customerId = mauriceCustomerId(env)
  if (rolled.lines.length === 0) {
    return {
      alreadyInvoiced: false,
      invoiced: false,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      customerId,
      invoiceId: null,
      invoiceNumber: null,
      orderId: null,
      publicUrl: null,
      lines: [],
      loggedTotal: null,
      pickCount: 0,
      dryRunSkipped: rolled.dryRunSkipped,
      reason: 'No live sent picks in this week'
    }
  }
  if (rolled.lines.length > MAX_INVOICE_LINES) {
    throw httpError(400, `Week has more than ${MAX_INVOICE_LINES} distinct items`)
  }
  if (typeof createUnpaidInvoice !== 'function' || typeof resolveAccount !== 'function' || typeof squareFetch !== 'function') {
    throw httpError(500, 'Week invoice is not configured')
  }
  const account = resolveAccount('wholesale')
  if (!account || account.account !== 'wholesale') {
    throw httpError(400, 'Invoice writes are limited to the wholesale Square account')
  }

  const invoice = await createUnpaidInvoice({
    account: 'wholesale',
    customerId,
    lines: rolled.lines.map(line => ({
      catalogObjectId: line.sellableCatalogObjectId,
      quantity: line.qty
    })),
    title: `Maurice week ${week.weekStart}`,
    description: `Unpaid wholesale pick totals ${week.weekStart} through ${week.weekEnd} (Mon-Sat). No payment taken. Jordan settles this invoice later.`,
    dueDays: 0,
    idempotencyKey: `mp-week-${week.weekStart}`
  }, {
    squareFetch: args => {
      assertMauriceSquarePath(args && args.path)
      return squareFetch(args)
    },
    resolveAccount: () => account,
    resolveLocationId: () => WHOLESALE_PICK_LOCATION_ID,
    now: clock
  })

  const record = {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    customerId,
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    publicUrl: invoice.publicUrl,
    lines: rolled.lines,
    loggedTotal: rolled.loggedTotal,
    pickCount: rolled.live.length,
    dryRunSkipped: rolled.dryRunSkipped,
    createdAt: clock.toISOString()
  }
  const saved = await store.insertWeekInvoice(record)
  if (!saved) {
    const raced = await store.getWeekInvoice(week.weekStart)
    if (raced && raced.invoiceId) return storedResult(raced, true)
    throw httpError(500, 'Could not record the week invoice')
  }
  console.log(JSON.stringify({
    event: 'maurice_week_invoice',
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    invoiceId: invoice.invoiceId,
    customerId,
    pickCount: rolled.live.length,
    dryRunSkipped: rolled.dryRunSkipped,
    loggedTotal: rolled.loggedTotal
  }))
  return storedResult(saved, false)
}

module.exports = {
  addIsoDays,
  aggregateLivePicks,
  createMauriceWeekInvoice,
  isMonday,
  resolveWeek
}
