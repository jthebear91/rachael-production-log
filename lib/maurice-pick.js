// Maurice → Wholesale restock pick list.
// Create is bridge-authenticated. The phone page, sheet, and send route
// trust the unguessable token. Send decreases wholesale stock, then books
// an unpaid wholesale invoice to the Maurice customer. It never calls Payments.

const crypto = require('crypto')
const { findPaymentKey } = require('./invoice-write')
const { resolvePickStore } = require('./pick-store')

const DEFAULT_MAURICE_CUSTOMER_ID = 'TQ8JFGXMZGTY8JNKCY1TV72618'
const DEFAULT_APP_BASE_URL = 'https://rachael-production-log.vercel.app'
const ALREADY_SENT_LABEL = 'Already sent'
const MAX_LINES = 50
const INVENTORY_PATH = '/inventory/changes/batch-create'

const ALLOWED_CREATE = new Set(['lines', 'note'])
const ALLOWED_CREATE_LINE = new Set(['catalogObjectId', 'name', 'orderedQty'])
const ALLOWED_SEND = new Set(['lines'])
const ALLOWED_SEND_LINE = new Set(['catalogObjectId', 'qty'])

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
    sheetUrl: `${base}/api/pick/${token}/sheet`
  }
}

function parseCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'JSON object required')
  if (findPaymentKey(body)) return fail(400, 'Payment fields are not accepted')
  const extra = unexpectedKey(body, ALLOWED_CREATE)
  if (extra) return fail(400, `Unexpected field: ${extra}`)
  const note = optionalText(body.note, 'note', 500)
  if (!note.ok) return note
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) {
    return fail(400, 'lines must include a catalog variation id and ordered quantity')
  }
  const lines = []
  const seen = new Set()
  for (const line of body.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return fail(400, 'lines must include a catalog variation id and ordered quantity')
    }
    const lineExtra = unexpectedKey(line, ALLOWED_CREATE_LINE)
    if (lineExtra) return fail(400, `Unexpected field: ${lineExtra}`)
    const id = catalogId(line.catalogObjectId)
    const orderedQty = normalizeQty(line.orderedQty, { allowZero: false })
    if (!id || !orderedQty) {
      return fail(400, 'lines must include a catalog variation id and ordered quantity')
    }
    if (seen.has(id)) return fail(400, 'Duplicate catalogObjectId')
    seen.add(id)
    const name = optionalText(line.name, 'name', 200)
    if (!name.ok) return name
    lines.push({ catalogObjectId: id, name: name.value, orderedQty })
  }
  return { ok: true, value: { lines, note: note.value } }
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
      const id = catalogId(line.catalogObjectId)
      if (!id || !record.lines.some(item => item.catalogObjectId === id)) {
        return fail(400, 'Unknown catalogObjectId')
      }
      if (overrides.has(id)) return fail(400, 'Duplicate catalogObjectId')
      const qty = normalizeQty(line.qty, { allowZero: true })
      if (qty == null) return fail(400, 'Quantity must be a number from 0 up to the ordered quantity')
      const ordered = record.lines.find(item => item.catalogObjectId === id)
      if (Number(qty) > Number(ordered.orderedQty)) {
        return fail(400, 'Quantity cannot be higher than ordered')
      }
      overrides.set(id, qty)
    }
  }

  const lines = record.lines.map(line => ({
    catalogObjectId: line.catalogObjectId,
    name: line.name,
    orderedQty: line.orderedQty,
    qty: overrides.has(line.catalogObjectId) ? overrides.get(line.catalogObjectId) : line.orderedQty
  }))
  if (!lines.some(line => Number(line.qty) > 0)) return fail(400, 'Send at least one item')
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
        catalog_object_id: line.catalogObjectId,
        location_id: locationId,
        quantity: line.qty,
        from_state: 'IN_STOCK',
        to_state: 'SOLD',
        occurred_at: occurredAt,
        reference_id: idempotencyKey
      }
    }))
  }
}

function sentResult(record, alreadySent) {
  return {
    alreadySent,
    token: record.token,
    status: 'sent',
    invoiceId: record.invoiceId || null,
    invoiceNumber: record.invoiceNumber || null,
    orderId: record.orderId || null,
    publicUrl: record.publicUrl || null,
    lines: (record.sentLines || []).map(line => ({
      catalogObjectId: line.catalogObjectId,
      name: line.name || null,
      orderedQty: line.orderedQty,
      qty: line.qty
    }))
  }
}

async function createMauricePick({ body, req, env = process.env, store, now = () => new Date() }) {
  const parsed = parseCreateBody(body)
  if (!parsed.ok) throw httpError(parsed.status, parsed.error)
  const activeStore = store || requireStore(env)
  const base = appBaseUrl(env, req)
  const recordBase = {
    status: 'open',
    lines: parsed.value.lines,
    note: parsed.value.note,
    sentLines: null,
    occurredAt: null,
    invoiceId: null,
    invoiceNumber: null,
    orderId: null,
    publicUrl: null,
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
    note: record.note || '',
    alreadySent: sent,
    locked,
    invoiceNumber: record.invoiceNumber || '',
    lines: source.map(line => ({
      catalogObjectId: line.catalogObjectId,
      name: line.name || line.catalogObjectId,
      orderedQty: line.orderedQty,
      qty: line.qty || line.orderedQty
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
  resolveLocationId,
  squareFetch,
  createUnpaidInvoice
}) {
  const checked = normalizeToken(token)
  if (!checked) throw httpError(404, 'Pick list not found')
  if (typeof resolveAccount !== 'function' || typeof resolveLocationId !== 'function' || typeof squareFetch !== 'function' || typeof createUnpaidInvoice !== 'function') {
    throw httpError(500, 'Pick send is not configured')
  }
  const activeStore = store || requireStore(env)
  let record = await activeStore.get(checked)
  if (!record) throw httpError(404, 'Pick list not found')
  if (record.status === 'sent') return sentResult(record, true)

  const account = resolveAccount('wholesale')
  if (!account || account.account !== 'wholesale') {
    throw httpError(400, 'Invoice writes are limited to the wholesale Square account')
  }
  const locationId = resolveLocationId(null, account)
  const customerId = mauriceCustomerId(env)

  let sentLines
  let occurredAt
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
    }
  } else {
    throw httpError(409, 'Pick list send is already in progress')
  }

  const positive = sentLines.filter(line => Number(line.qty) > 0)
  if (positive.length === 0) throw httpError(400, 'Send at least one item')

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

  const invoice = await createUnpaidInvoice({
    account: 'wholesale',
    customerId,
    lines: positive.map(line => ({
      catalogObjectId: line.catalogObjectId,
      quantity: line.qty
    })),
    title: 'Maurice restock',
    description: record.note || 'Maurice wholesale pick. Unpaid, for the weekly check.',
    dueDays: 0,
    idempotencyKey
  }, {
    squareFetch: args => guardedSquareFetch(squareFetch, args),
    resolveAccount: () => account,
    resolveLocationId: () => locationId,
    now: new Date(occurredAt)
  })

  const marked = await activeStore.markSent(checked, {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    publicUrl: invoice.publicUrl,
    sentAt: now().toISOString()
  })
  if (!marked || marked.status !== 'sent') throw httpError(500, 'Could not record the sent pick list')
  return sentResult(marked, false)
}

module.exports = {
  ALREADY_SENT_LABEL,
  DEFAULT_APP_BASE_URL,
  DEFAULT_MAURICE_CUSTOMER_ID,
  INVENTORY_PATH,
  appBaseUrl,
  assertMauriceSquarePath,
  buildInventoryDecreaseBody,
  createMauricePick,
  getMauricePick,
  loadPickPage,
  mauriceCustomerId,
  parseCreateBody,
  parseSendBody,
  pickIdempotencyKey,
  sendMauricePick
}
