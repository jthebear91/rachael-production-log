// Maurice nightly pick QR.
// Mint stores the night's payload and does not change Square inventory.
// Send is the deferred step-7 batchChange: IN_STOCK → SOLD at the wholesale
// location, for the quantities that actually left. Optional unpaid invoice
// is off unless the payload or env asks for it. Never Payments, never Twilio,
// never the INV001–INV056 counting items.

const crypto = require('crypto')
const { findPaymentKey } = require('./invoice-write')
const { resolvePickStore } = require('./pick-store')

const DEFAULT_MAURICE_CUSTOMER_ID = 'TQ8JFGXMZGTY8JNKCY1TV72618'
const DEFAULT_APP_BASE_URL = 'https://rachael-production-log.vercel.app'
const WHOLESALE_PICK_LOCATION_ID = 'L6D106R4VNA72'
const ALREADY_SENT_LABEL = 'Already sent'
const COUNTING_ITEM_ERROR = 'Counting items INV001-INV056 are not part of this pick'
const MAX_LINES = 80
const INVENTORY_PATH = '/inventory/changes/batch-create'

const ALLOWED_CREATE = new Set(['PRINT_DAY', 'date', 'lines', 'estimatedTotal', 'createInvoice'])
const ALLOWED_CREATE_LINE = new Set(['sellableCatalogObjectId', 'name', 'qtyOrdered'])
const ALLOWED_SEND = new Set(['lines'])
const ALLOWED_SEND_LINE = new Set(['sellableCatalogObjectId', 'qty'])

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function fail(status, error) {
  return { ok: false, status, error }
}

function requireStore(env) {
  const store = resolvePickStore(env || process.env)
  if (!store) throw httpError(503, 'Pick store is not configured')
  return store
}

function normalizeToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  return token
}

function mintToken() {
  return crypto.randomBytes(18).toString('base64url')
}

function unexpectedKey(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return key
  }
  return null
}

function normalizeQty(value, { allowZero }) {
  const raw = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : ''
  if (!/^\d+(\.\d{1,5})?$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 10000) return null
  if (n === 0) return allowZero ? '0' : null
  return String(n)
}

function optionalText(value, name, max) {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'string') return fail(400, `${name} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > max) return fail(400, `${name} is too long`)
  return { ok: true, value: trimmed }
}

function catalogId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(trimmed)) return null
  return trimmed
}

function isCountingItemCode(value) {
  const match = String(value || '').trim().toUpperCase().match(/^INV(\d{3})$/)
  if (!match) return false
  const n = Number(match[1])
  return n >= 1 && n <= 56
}

function assertSellableLine(id, name) {
  if (isCountingItemCode(id) || isCountingItemCode(name)) {
    return fail(400, COUNTING_ITEM_ERROR)
  }
  return null
}

function normalizeMoney(value) {
  const raw = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim().replace(/^\$/, '')
      : ''
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return null
  return n.toFixed(2)
}

function invoiceEnabled(body, env) {
  if (body.createInvoice == null) return String(env.MAURICE_PICK_CREATE_INVOICE || '') === '1'
  if (typeof body.createInvoice !== 'boolean') return null
  return body.createInvoice
}

function assertMauriceSquarePath(path) {
  const pathname = String(path || '').split('?')[0]
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    decoded = pathname
  }
  const segments = decoded.split('/').filter(Boolean).map(segment => segment.toLowerCase())
  const blocked = segments.some(segment => segment === 'payments' || segment === 'payment' || segment === 'pay')
  const inventoryOk = pathname === INVENTORY_PATH
  const head = segments[0]
  const invoiceOk = head === 'orders' || head === 'invoices' || head === 'catalog'
  if (blocked || (!inventoryOk && !invoiceOk)) {
    throw httpError(500, 'Refusing Square payment endpoint')
  }
}

function mauriceCustomerId(env = process.env) {
  const raw = env.SQUARE_MAURICE_CUSTOMER_ID
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_MAURICE_CUSTOMER_ID
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw httpError(500, 'SQUARE_MAURICE_CUSTOMER_ID is not a Square customer id')
  }
  return value
}

function originFromConfigured(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw httpError(500, 'APP_BASE_URL must be an http(s) origin')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError(500, 'APP_BASE_URL must be an http(s) origin')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw httpError(500, 'APP_BASE_URL must be an http(s) origin')
  }
  return url.origin
}

function originFromRequest(req) {
  if (!req || !req.headers) return null
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader || '').trim()
  if (!/^[\w.-]+(:\d+)?$/.test(host)) return null
  const protoHeader = req.headers['x-forwarded-proto'] || 'http'
  const protoRaw = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader
  const proto = String(protoRaw).split(',')[0].trim() === 'https' ? 'https' : 'http'
  return `${proto}://${host}`
}

function appBaseUrl(env = process.env, req) {
  const configured = typeof env.APP_BASE_URL === 'string' ? env.APP_BASE_URL.trim() : ''
  if (configured) return originFromConfigured(configured)
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || String(env.VERCEL || '') === '1'
  if (!production) {
    const fromReq = originFromRequest(req)
    if (fromReq) return fromReq
  }
  return DEFAULT_APP_BASE_URL
}

function pickUrls(base, token) {
  return {
    token,
    pickUrl: `${base}/pick/${token}`,
    sheetUrl: `${base}/api/pick/${token}/sheet`,
    qrUrl: `${base}/api/pick/${token}/qr`
  }
}

function parseCreateBody(body, env = process.env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'JSON object required')
  if (findPaymentKey(body)) return fail(400, 'Payment fields are not accepted')
  const extra = unexpectedKey(body, ALLOWED_CREATE)
  if (extra) return fail(400, `Unexpected field: ${extra}`)

  const printDay = optionalText(body.PRINT_DAY, 'PRINT_DAY', 32)
  if (!printDay.ok) return printDay
  if (!printDay.value) return fail(400, 'PRINT_DAY is required')

  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return fail(400, 'date must be YYYY-MM-DD')
  }
  const estimatedTotal = normalizeMoney(body.estimatedTotal)
  if (!estimatedTotal) return fail(400, 'estimatedTotal must be a dollar amount')

  const createInvoice = invoiceEnabled(body, env)
  if (createInvoice == null) return fail(400, 'createInvoice must be true or false')

  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) {
    return fail(400, 'lines must include a sellable variation id, name, and qtyOrdered')
  }
  const lines = []
  const seen = new Set()
  for (const line of body.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return fail(400, 'lines must include a sellable variation id, name, and qtyOrdered')
    }
    const lineExtra = unexpectedKey(line, ALLOWED_CREATE_LINE)
    if (lineExtra) return fail(400, `Unexpected field: ${lineExtra}`)
    const id = catalogId(line.sellableCatalogObjectId)
    const qtyOrdered = normalizeQty(line.qtyOrdered, { allowZero: false })
    if (!id || !qtyOrdered) {
      return fail(400, 'lines must include a sellable variation id, name, and qtyOrdered')
    }
    const blocked = assertSellableLine(id, line.name)
    if (blocked) return blocked
    if (seen.has(id)) return fail(400, 'Duplicate sellableCatalogObjectId')
    seen.add(id)
    const name = optionalText(line.name, 'name', 200)
    if (!name.ok) return name
    if (!name.value) return fail(400, 'lines must include a sellable variation id, name, and qtyOrdered')
    lines.push({ sellableCatalogObjectId: id, name: name.value, qtyOrdered })
  }
  return {
    ok: true,
    value: {
      printDay: printDay.value,
      pickDate: body.date,
      estimatedTotal,
      createInvoice,
      lines
    }
  }
}

function parseSendBody(record, body) {
  const input = body == null || body === '' ? {} : body
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'JSON object required')
  if (findPaymentKey(input)) return fail(400, 'Payment fields are not accepted')
  const extra = unexpectedKey(input, ALLOWED_SEND)
  if (extra) return fail(400, `Unexpected field: ${extra}`)

  const overrides = new Map()
  if (input.lines != null) {
    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_LINES) {
      return fail(400, 'lines must include a catalog variation id and qty')
    }
    for (const line of input.lines) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        return fail(400, 'lines must include a catalog variation id and qty')
      }
      const lineExtra = unexpectedKey(line, ALLOWED_SEND_LINE)
      if (lineExtra) return fail(400, `Unexpected field: ${lineExtra}`)
      const id = catalogId(line.sellableCatalogObjectId)
      if (!id || !record.lines.some(item => item.sellableCatalogObjectId === id)) {
        return fail(400, 'Unknown sellableCatalogObjectId')
      }
      const blocked = assertSellableLine(id, null)
      if (blocked) return blocked
      if (overrides.has(id)) return fail(400, 'Duplicate sellableCatalogObjectId')
      const qty = normalizeQty(line.qty, { allowZero: true })
      if (qty == null) return fail(400, 'Quantity must be a number from 0 up to the ordered quantity')
      const ordered = record.lines.find(item => item.sellableCatalogObjectId === id)
      if (Number(qty) > Number(ordered.qtyOrdered)) {
        return fail(400, 'Quantity cannot be higher than ordered')
      }
      overrides.set(id, qty)
    }
  }

  const lines = record.lines.map(line => ({
    sellableCatalogObjectId: line.sellableCatalogObjectId,
    name: line.name,
    qtyOrdered: line.qtyOrdered,
    qtySent: overrides.has(line.sellableCatalogObjectId) ? overrides.get(line.sellableCatalogObjectId) : line.qtyOrdered
  }))
  for (const line of lines) {
    const blocked = assertSellableLine(line.sellableCatalogObjectId, line.name)
    if (blocked) return blocked
  }
  if (!lines.some(line => Number(line.qtySent) > 0)) return fail(400, 'Send at least one item')
  return { ok: true, value: { lines } }
}

function pickIdempotencyKey(token) {
  return `mp-${token}`
}

// Inverse of the Daily Log increase (NONE → IN_STOCK in push-inventory.js).
// IN_STOCK → SOLD removes the quantity that actually left wholesale.
function buildInventoryDecreaseBody({ idempotencyKey, locationId, lines, occurredAt }) {
  return {
    idempotency_key: idempotencyKey,
    changes: lines.map(line => ({
      type: 'ADJUSTMENT',
      adjustment: {
        catalog_object_id: line.sellableCatalogObjectId,
        location_id: locationId,
        quantity: line.qtySent,
        from_state: 'IN_STOCK',
        to_state: 'SOLD',
        occurred_at: occurredAt,
        reference_id: idempotencyKey
      }
    }))
  }
}

function sentResult(record, alreadySent) {
  const notify = record.notify || {}
  return {
    alreadySent,
    token: record.token,
    status: 'sent',
    printDay: record.printDay || null,
    date: record.pickDate || null,
    estimatedTotal: record.estimatedTotal || null,
    finalTotal: notify.finalTotal == null ? null : notify.finalTotal,
    shorts: Array.isArray(notify.shorts) ? notify.shorts : [],
    invoiceId: record.invoiceId || null,
    invoiceNumber: record.invoiceNumber || null,
    orderId: record.orderId || null,
    lines: (record.sentLines || []).map(line => ({
      sellableCatalogObjectId: line.sellableCatalogObjectId,
      name: line.name || null,
      qtyOrdered: line.qtyOrdered,
      qtySent: line.qtySent
    }))
  }
}

function buildNotifySummary({ record, sentLines, facts }) {
  const shorts = []
  let cents = 0
  let priced = true
  for (const line of sentLines) {
    const ordered = Number(line.qtyOrdered)
    const sent = Number(line.qtySent)
    if (sent !== ordered) {
      shorts.push({
        sellableCatalogObjectId: line.sellableCatalogObjectId,
        name: line.name,
        qtyOrdered: line.qtyOrdered,
        qtySent: line.qtySent,
        delta: String(ordered - sent)
      })
    }
    if (sent > 0) {
      const fact = facts.get(line.sellableCatalogObjectId)
      if (!fact || fact.priceCents == null) priced = false
      else cents += Math.round(sent * fact.priceCents)
    }
  }
  return {
    printDay: record.printDay,
    date: record.pickDate,
    locationId: WHOLESALE_PICK_LOCATION_ID,
    estimatedTotal: record.estimatedTotal,
    finalTotal: priced ? (cents / 100).toFixed(2) : null,
    shorts
  }
}

function assertNotifyTarget(env) {
  const url = typeof env.JORDAN_NOTIFY_WEBHOOK === 'string' ? env.JORDAN_NOTIFY_WEBHOOK.trim() : ''
  if (!url) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw httpError(500, 'JORDAN_NOTIFY_WEBHOOK is not a URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw httpError(500, 'JORDAN_NOTIFY_WEBHOOK is not a URL')
  }
  if (/twilio/i.test(parsed.hostname)) {
    throw httpError(500, 'Maurice pick notify does not use Twilio')
  }
  return url
}

async function notifyJordan({ env, summary, fetchImpl }) {
  const body = { event: 'maurice_pick_notify', ...summary }
  console.log(JSON.stringify(body))
  const url = assertNotifyTarget(env)
  if (!url) return { ...summary, delivered: false }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res || res.ok === false) {
      return { ...summary, delivered: false, notifyWarning: 'Jordan notify webhook failed' }
    }
    return { ...summary, delivered: true }
  } catch {
    return { ...summary, delivered: false, notifyWarning: 'Jordan notify webhook failed' }
  }
}

function variationFacts(catalog, id) {
  const object = catalog && catalog.object
  if (!object || object.type !== 'ITEM_VARIATION' || object.is_deleted) {
    throw httpError(400, `sellableCatalogObjectId must be a Square catalog item variation (${id})`)
  }
  if (object.id && object.id !== id) {
    throw httpError(400, `sellableCatalogObjectId must be a Square catalog item variation (${id})`)
  }
  const data = object.item_variation_data || {}
  if (isCountingItemCode(data.sku) || isCountingItemCode(object.id)) {
    throw httpError(400, COUNTING_ITEM_ERROR)
  }
  const amount = data.price_money && data.price_money.amount
  return { priceCents: Number.isInteger(amount) ? amount : null }
}

async function readSellableFacts(squareFetch, token, lines) {
  const facts = new Map()
  for (const line of lines) {
    if (Number(line.qtySent) <= 0) continue
    const blocked = assertSellableLine(line.sellableCatalogObjectId, line.name)
    if (blocked) throw httpError(blocked.status, blocked.error)
    const catalog = await guardedSquareFetch(squareFetch, {
      token,
      path: `/catalog/object/${encodeURIComponent(line.sellableCatalogObjectId)}`
    })
    facts.set(line.sellableCatalogObjectId, variationFacts(catalog, line.sellableCatalogObjectId))
  }
  return facts
}

async function createMauricePick({ body, req, env = process.env, store, now = () => new Date() }) {
  const parsed = parseCreateBody(body, env)
  if (!parsed.ok) throw httpError(parsed.status, parsed.error)
  const activeStore = store || requireStore(env)
  const base = appBaseUrl(env, req)
  const recordBase = {
    status: 'open',
    lines: parsed.value.lines,
    printDay: parsed.value.printDay,
    pickDate: parsed.value.pickDate,
    estimatedTotal: parsed.value.estimatedTotal,
    createInvoice: parsed.value.createInvoice,
    note: null,
    sentLines: null,
    occurredAt: null,
    invoiceId: null,
    invoiceNumber: null,
    orderId: null,
    publicUrl: null,
    notify: null,
    createdAt: now().toISOString(),
    sentAt: null
  }
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = mintToken()
    try {
      await activeStore.insert({ ...recordBase, token })
      return pickUrls(base, token)
    } catch (err) {
      lastError = err
      if (err.status !== 409) throw err
    }
  }
  throw lastError || httpError(500, 'Could not save pick list')
}

async function getMauricePick(token, { env = process.env, store } = {}) {
  const checked = normalizeToken(token)
  if (!checked) return null
  const activeStore = store || requireStore(env)
  return activeStore.get(checked)
}

function toPageProps(record) {
  const sent = record.status === 'sent'
  const locked = record.status === 'sending'
  const source = (sent || locked) && Array.isArray(record.sentLines) ? record.sentLines : record.lines
  return {
    missing: false,
    misconfigured: false,
    error: '',
    token: record.token,
    status: record.status,
    printDay: record.printDay || '',
    pickDate: record.pickDate || '',
    estimatedTotal: record.estimatedTotal || '',
    finalTotal: record.notify && record.notify.finalTotal ? record.notify.finalTotal : '',
    shorts: record.notify && Array.isArray(record.notify.shorts) ? record.notify.shorts : [],
    note: record.note || '',
    alreadySent: sent,
    locked,
    invoiceNumber: record.invoiceNumber || '',
    lines: source.map(line => ({
      sellableCatalogObjectId: line.sellableCatalogObjectId,
      name: line.name || line.sellableCatalogObjectId,
      qtyOrdered: line.qtyOrdered,
      qty: line.qtySent || line.qtyOrdered
    }))
  }
}

async function loadPickPage(token, deps) {
  const record = await getMauricePick(token, deps)
  if (!record) {
    const err = new Error('Pick list not found')
    err.status = 404
    throw err
  }
  return toPageProps(record)
}

async function guardedSquareFetch(squareFetch, args) {
  assertMauriceSquarePath(args && args.path)
  return squareFetch(args)
}

async function sendMauricePick({
  token,
  body,
  env = process.env,
  store,
  now = () => new Date(),
  resolveAccount,
  squareFetch,
  createUnpaidInvoice,
  fetchImpl = global.fetch
}) {
  const checked = normalizeToken(token)
  if (!checked) throw httpError(404, 'Pick list not found')
  if (typeof resolveAccount !== 'function' || typeof squareFetch !== 'function' || typeof createUnpaidInvoice !== 'function') {
    throw httpError(500, 'Pick send is not configured')
  }
  const activeStore = store || requireStore(env)
  let record = await activeStore.get(checked)
  if (!record) throw httpError(404, 'Pick list not found')
  if (record.status === 'sent') return sentResult(record, true)

  assertNotifyTarget(env)
  const account = resolveAccount('wholesale')
  if (!account || account.account !== 'wholesale') {
    throw httpError(400, 'Inventory adjustments are limited to the wholesale Square account')
  }
  const locationId = WHOLESALE_PICK_LOCATION_ID

  let sentLines
  let occurredAt
  let claimedNow = false
  if (record.status === 'sending') {
    if (!Array.isArray(record.sentLines) || !record.occurredAt) {
      throw httpError(500, 'Pick list send is missing locked quantities')
    }
    sentLines = record.sentLines
    occurredAt = record.occurredAt
  } else if (record.status === 'open') {
    const parsed = parseSendBody(record, body)
    if (!parsed.ok) throw httpError(parsed.status, parsed.error)
    sentLines = parsed.value.lines
    occurredAt = now().toISOString()
    const claimed = await activeStore.claim(checked, { sentLines, occurredAt })
    if (!claimed) {
      record = await activeStore.get(checked)
      if (record && record.status === 'sent') return sentResult(record, true)
      if (record && record.status === 'sending' && Array.isArray(record.sentLines) && record.occurredAt) {
        sentLines = record.sentLines
        occurredAt = record.occurredAt
      } else {
        throw httpError(409, 'Pick list send is already in progress')
      }
    } else {
      claimedNow = true
      record = claimed
    }
  } else {
    throw httpError(409, 'Pick list send is already in progress')
  }

  const positive = sentLines.filter(line => Number(line.qtySent) > 0)
  if (positive.length === 0) throw httpError(400, 'Send at least one item')

  let facts
  try {
    facts = await readSellableFacts(squareFetch, account.token, sentLines)
  } catch (err) {
    if (claimedNow && typeof activeStore.release === 'function') await activeStore.release(checked)
    throw err
  }

  const idempotencyKey = pickIdempotencyKey(checked)
  await guardedSquareFetch(squareFetch, {
    token: account.token,
    path: INVENTORY_PATH,
    method: 'POST',
    body: buildInventoryDecreaseBody({
      idempotencyKey,
      locationId,
      lines: positive,
      occurredAt
    })
  })

  let invoice = { invoiceId: null, invoiceNumber: null, orderId: null, publicUrl: null }
  if (record.createInvoice) {
    const customerId = mauriceCustomerId(env)
    invoice = await createUnpaidInvoice({
      account: 'wholesale',
      customerId,
      lines: positive.map(line => ({
        catalogObjectId: line.sellableCatalogObjectId,
        quantity: line.qtySent
      })),
      title: `Maurice ${record.printDay || 'restock'}`,
      description: `Maurice wholesale pick ${record.pickDate || ''}. Unpaid, for the weekly check.`.trim(),
      dueDays: 0,
      idempotencyKey
    }, {
      squareFetch: args => guardedSquareFetch(squareFetch, args),
      resolveAccount: () => account,
      resolveLocationId: () => locationId,
      now: new Date(occurredAt)
    })
  }

  const summary = await notifyJordan({
    env,
    fetchImpl,
    summary: buildNotifySummary({ record, sentLines, facts })
  })

  const marked = await activeStore.markSent(checked, {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    publicUrl: invoice.publicUrl,
    notify: summary,
    sentAt: now().toISOString()
  })
  if (!marked || marked.status !== 'sent') throw httpError(500, 'Could not record the sent pick list')
  return sentResult(marked, false)
}

module.exports = {
  ALREADY_SENT_LABEL,
  COUNTING_ITEM_ERROR,
  DEFAULT_APP_BASE_URL,
  DEFAULT_MAURICE_CUSTOMER_ID,
  INVENTORY_PATH,
  WHOLESALE_PICK_LOCATION_ID,
  appBaseUrl,
  assertMauriceSquarePath,
  buildInventoryDecreaseBody,
  buildNotifySummary,
  createMauricePick,
  getMauricePick,
  isCountingItemCode,
  loadPickPage,
  mauriceCustomerId,
  parseCreateBody,
  parseSendBody,
  pickIdempotencyKey,
  sendMauricePick
}
