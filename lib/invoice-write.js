// Pure request checks and Square payloads for unpaid wholesale invoices.
// Amounts are never sent — Square prices catalog variations on the order.
// This module does not call Square and does not call Payments.

const { canonicalAccountId } = require('./square-accounts')
const { SALES_TIMEZONE } = require('./chicago-time')

const ALLOWED_ROOT = new Set([
  'account',
  'customerId',
  'locationId',
  'title',
  'description',
  'lines',
  'dueDays',
  'idempotencyKey'
])

const ALLOWED_LINE = new Set(['catalogObjectId', 'quantity'])

const PAYMENT_KEY = /^(source_?id|nonce|card_?nonce|card_?id|card_?details|card|verification_?token|cvv|cvc|exp_?month|exp_?year|pan|credit_?card|payment_?token|automatic_?payment_?source|tenders?|payments?|create_?payment|complete_?payment|amount|amount_?money|base_?price_?money|price|price_?money)$/i

const DEFAULT_DUE_DAYS = 0
const MAX_DUE_DAYS = 365
const MAX_LINES = 50

function fail(status, error) {
  return { ok: false, status, error }
}

function findPaymentKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findPaymentKey(item)
      if (hit) return hit
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  for (const key of Object.keys(value)) {
    if (PAYMENT_KEY.test(key)) return key
    const hit = findPaymentKey(value[key])
    if (hit) return hit
  }
  return null
}

function unexpectedKey(obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return key
  }
  return null
}

function normalizeQuantity(value) {
  const raw = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : ''
  if (!/^\d+(\.\d{1,5})?$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null
  return raw
}

function chicagoISODate(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SALES_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function addCalendarDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day + days))
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function optionalText(value, name, max) {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'string') return fail(400, `${name} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > max) return fail(400, `${name} is too long`)
  return { ok: true, value: trimmed }
}

function parseInvoiceWriteRequest(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'JSON object required')
  }
  if (findPaymentKey(body)) {
    return fail(400, 'Payment fields are not accepted')
  }
  const extra = unexpectedKey(body, ALLOWED_ROOT)
  if (extra) return fail(400, `Unexpected field: ${extra}`)

  const account = canonicalAccountId(body.account)
  if (account !== 'wholesale') {
    return fail(400, 'Invoice writes are limited to the wholesale Square account')
  }

  if (typeof body.customerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.customerId.trim())) {
    return fail(400, 'customerId must be a Square customer id')
  }

  let locationId = null
  if (body.locationId != null) {
    if (typeof body.locationId !== 'string' || !body.locationId.trim()) {
      return fail(400, 'locationId must be a string')
    }
    locationId = body.locationId.trim()
    if (locationId.length > 64) return fail(400, 'locationId is too long')
  }

  const title = optionalText(body.title, 'title', 255)
  if (!title.ok) return title
  const description = optionalText(body.description, 'description', 2000)
  if (!description.ok) return description

  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAX_LINES) {
    return fail(400, 'lines must include a catalog variation id and quantity')
  }
  const lines = []
  for (const line of body.lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return fail(400, 'lines must include a catalog variation id and quantity')
    }
    const lineExtra = unexpectedKey(line, ALLOWED_LINE)
    if (lineExtra) return fail(400, `Unexpected field: ${lineExtra}`)
    if (typeof line.catalogObjectId !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(line.catalogObjectId.trim())) {
      return fail(400, 'lines must include a catalog variation id and quantity')
    }
    const quantity = normalizeQuantity(line.quantity)
    if (!quantity) return fail(400, 'lines must include a catalog variation id and quantity')
    lines.push({ catalogObjectId: line.catalogObjectId.trim(), quantity })
  }

  let dueDays = DEFAULT_DUE_DAYS
  if (body.dueDays != null) {
    if (typeof body.dueDays !== 'number' || !Number.isInteger(body.dueDays) || body.dueDays < 0 || body.dueDays > MAX_DUE_DAYS) {
      return fail(400, 'dueDays must be an integer from 0 to 365')
    }
    dueDays = body.dueDays
  }

  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey)) {
    return fail(400, 'idempotencyKey is required')
  }

  const dueDate = addCalendarDays(chicagoISODate(now), dueDays)
  return {
    ok: true,
    value: {
      account,
      customerId: body.customerId.trim(),
      locationId,
      title: title.value,
      description: description.value,
      lines,
      dueDays,
      dueDate,
      idempotencyKey: body.idempotencyKey
    }
  }
}

function assertSquareWritePath(path) {
  const pathname = String(path || '').split('?')[0]
  const segments = pathname.split('/').filter(Boolean).map(segment => {
    try {
      return decodeURIComponent(segment).toLowerCase()
    } catch {
      return segment.toLowerCase()
    }
  })
  const head = segments[0]
  const allowed = head === 'orders' || head === 'invoices' || head === 'catalog'
  const blocked = segments.some(segment => segment === 'payments' || segment === 'payment' || segment === 'pay')
  if (!allowed || blocked) {
    const err = new Error('Refusing Square payment endpoint')
    err.status = 500
    throw err
  }
}

function buildUnpaidOrderBody({ idempotencyKey, locationId, customerId, lines }) {
  return {
    idempotency_key: idempotencyKey,
    order: {
      location_id: locationId,
      customer_id: customerId,
      state: 'OPEN',
      line_items: lines.map(line => ({
        catalog_object_id: line.catalogObjectId,
        quantity: line.quantity
      })),
      // Square rejects invoice orders when pricing rules auto-apply.
      // Prices still come from the catalog variation; we do not send amounts.
      pricing_options: {
        auto_apply_discounts: false,
        auto_apply_taxes: false
      }
    }
  }
}

function buildUnpaidInvoiceBody({
  idempotencyKey,
  locationId,
  customerId,
  orderId,
  dueDate,
  title,
  description
}) {
  const invoice = {
    location_id: locationId,
    order_id: orderId,
    primary_recipient: { customer_id: customerId },
    delivery_method: 'SHARE_MANUALLY',
    payment_requests: [
      {
        request_type: 'BALANCE',
        due_date: dueDate,
        automatic_payment_source: 'NONE',
        tipping_enabled: false
      }
    ],
    // Square requires at least one accepted method to publish. Card is enabled
    // only so the hosted page can exist. automatic_payment_source NONE means
    // we do not charge a card on file, and this app never calls Payments.
    accepted_payment_methods: {
      card: true,
      square_gift_card: false,
      bank_account: false,
      buy_now_pay_later: false,
      cash_app_pay: false
    },
    store_payment_method_enabled: false
  }
  if (title) invoice.title = title
  if (description) invoice.description = description
  return {
    idempotency_key: `${idempotencyKey}:invoice`,
    invoice
  }
}

function buildPublishInvoiceBody({ idempotencyKey, version }) {
  return {
    version,
    idempotency_key: `${idempotencyKey}:publish`
  }
}

module.exports = {
  DEFAULT_DUE_DAYS,
  parseInvoiceWriteRequest,
  assertSquareWritePath,
  buildUnpaidOrderBody,
  buildUnpaidInvoiceBody,
  buildPublishInvoiceBody,
  chicagoISODate,
  addCalendarDays
}
