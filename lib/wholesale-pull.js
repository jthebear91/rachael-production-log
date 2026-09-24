// Wholesale Square sale → Todoist Takeout pull task + pick-list PDF.
//
// Takeout project only. Package (6cv69FHPW88HVjH8) is packaging/production work
// and must not receive these tasks. Priority is API 4, which Todoist shows as p1.
// order_key / child_order place the new task at the top of the leftmost column.
//
// Triggers: unpaid wholesale invoices, and completed house-account receipts
// (EXTERNAL source or OTHER tender) at the wholesale location. Card and cash
// sales are ignored unless WHOLESALE_PULL_ALL_COMPLETED=1.
//
// Reads Square invoices, orders, payments, customers, and catalog names.
// Never creates a Square payment and never adjusts inventory.
// A poller is not used: Square webhooks are available, and replay-by-id covers
// a missed sale (including the Hebert's Maurice practice order).

const { peekAccountFromEnv } = require('./square-accounts')
const { buildPickListPdf } = require('./pick-list-pdf')
const { evaluateSquareWebhookAuth } = require('./square-webhook')
const { orderKeyBefore, integerPart } = require('./todoist-order-key')

const PACKAGE_PROJECT_ID = '6cv69FHPW88HVjH8'
const TAKEOUT_API_PRIORITY = 4
const TAKEOUT_UI_PRIORITY = 'p1'
const CREATING_LOCK_MS = 2 * 60 * 1000
const TODOIST_API = 'https://api.todoist.com/api/v1'

const PRACTICE_HEBERTS_MAURICE = {
  label: "Hebert's Maurice",
  orderId: 'gcEI0dtLc3OaueVCwjKKet9vxZRZY',
  paymentId: '968pb1sI3vrL7m7sM77fNWumZtNZY'
}

const PULL_EVENT_TYPES = new Set([
  'invoice.created',
  'invoice.updated',
  'invoice.published',
  'payment.created',
  'payment.updated',
  'order.created',
  'order.updated',
  'order.fulfillment.updated'
])

const INVOICE_PULL_STATUSES = new Set(['UNPAID', 'SCHEDULED', 'PARTIALLY_PAID'])
const HOUSE_TENDER_MARKERS = ['house account', 'house acct', 'on account']

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function scrub(message) {
  return String(message || 'Request failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sq0[a-z]{2}-[A-Za-z0-9_-]+/g, '[redacted]')
}

function text(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed || null
}

function pullEnabled(env) {
  return String(env.WHOLESALE_PULL_ENABLED || '').trim() === '1'
}

function allCompleted(env) {
  return String(env.WHOLESALE_PULL_ALL_COMPLETED || '').trim() === '1'
}

function todoistToken(env) {
  return text(env.TODOIST_TOKEN)
}

function takeoutProjectId(env) {
  return text(env.TODOIST_TAKEOUT_PROJECT_ID)
}

function assertTakeoutConfigured(env) {
  const token = todoistToken(env)
  const projectId = takeoutProjectId(env)
  if (!token || !projectId) {
    throw httpError(503, 'Wholesale pull Todoist is not configured')
  }
  if (projectId === PACKAGE_PROJECT_ID) {
    throw httpError(503, 'Wholesale pull cannot create Package tasks. Set TODOIST_TAKEOUT_PROJECT_ID to the Takeout project.')
  }
  return { token, projectId }
}

function cleanSquareId(value) {
  if (value == null || value === '') return null
  const id = String(value).trim()
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(id)) return null
  return id
}

function requireKey(value) {
  const key = String(value || '').trim()
  if (!/^(order|invoice|payment):[A-Za-z0-9_.:-]{1,200}$/.test(key)) {
    throw httpError(400, 'Invalid pick list key')
  }
  return key
}

function assertPullSquareRead(method, path) {
  const verb = String(method || 'GET').toUpperCase()
  const target = String(path || '')
  if (verb !== 'GET') throw httpError(500, 'Wholesale pull only reads Square')
  if (target.includes('..') || target.includes('?')) throw httpError(500, 'Wholesale pull only reads Square')
  const denied = ['inven' + 'tory', 'batch', 'comp' + 'lete', 'ref' + 'und']
  if (denied.some(part => target.toLowerCase().includes(part))) {
    throw httpError(500, 'Wholesale pull cannot charge or adjust stock')
  }
  const allowed = [
    /^\/invoices\/[^/]+$/,
    /^\/payments\/[^/]+$/,
    /^\/orders\/[^/]+$/,
    /^\/customers\/[^/]+$/,
    /^\/catalog\/object\/[^/]+$/
  ]
  if (!allowed.some(re => re.test(target))) throw httpError(500, 'Wholesale pull only reads Square')
}

async function readSquare(squareFetch, token, path) {
  assertPullSquareRead('GET', path)
  if (typeof squareFetch !== 'function') throw httpError(500, 'Square client is not configured')
  return squareFetch({ token, path, method: 'GET' })
}

function formatQty(quantity) {
  if (quantity == null) return null
  const raw = String(quantity).trim()
  if (!raw) return null
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const trimmed = raw.includes('.')
    ? raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/^0+(?=\d)/, '')
    : raw.replace(/^0+(?=\d)/, '')
  if (!trimmed || trimmed === '0') return null
  return trimmed
}

function lineDisplayName(item) {
  const name = text(item && item.name)
  const variation = text(item && item.variation_name)
  const usefulVariation = variation && !/^(regular|default)$/i.test(variation) ? variation : null
  if (name && usefulVariation && !name.toLowerCase().includes(usefulVariation.toLowerCase())) {
    return `${name} (${usefulVariation})`
  }
  return name || usefulVariation
}

async function catalogName(squareFetch, token, catalogObjectId) {
  const id = cleanSquareId(catalogObjectId)
  if (!id) return null
  const data = await readSquare(squareFetch, token, `/catalog/object/${encodeURIComponent(id)}`)
  const object = data && data.object
  if (!object || object.is_deleted) return null
  if (object.type === 'ITEM') return text(object.item_data && object.item_data.name)
  if (object.type !== 'ITEM_VARIATION') return null
  const variation = text(object.item_variation_data && object.item_variation_data.name)
  const itemId = cleanSquareId(object.item_variation_data && object.item_variation_data.item_id)
  let itemName = null
  if (itemId) {
    const parent = await readSquare(squareFetch, token, `/catalog/object/${encodeURIComponent(itemId)}`)
    itemName = text(parent && parent.object && parent.object.item_data && parent.object.item_data.name)
  }
  const usefulVariation = variation && !/^(regular|default)$/i.test(variation) ? variation : null
  if (itemName && usefulVariation) return `${itemName} (${usefulVariation})`
  return itemName || usefulVariation
}

async function resolveLines(order, squareFetch, token) {
  const lines = []
  let omitted = 0
  for (const item of (order && order.line_items) || []) {
    let name = lineDisplayName(item)
    if (!name && item && item.catalog_object_id) {
      name = await catalogName(squareFetch, token, item.catalog_object_id)
    }
    const qty = formatQty(item && item.quantity)
    if (!name || !qty) {
      omitted += 1
      continue
    }
    lines.push({ qty, name })
  }
  return { lines, omitted }
}

function chicagoDateLabel(iso) {
  const date = new Date(iso || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium'
  }).format(date)
}

function personName(record) {
  if (!record) return null
  return text([record.given_name, record.family_name].filter(Boolean).join(' '))
}

function accountLabel(customer, invoice) {
  const recipient = invoice && invoice.primary_recipient
  return text(customer && customer.company_name)
    || text(recipient && recipient.company_name)
    || personName(customer)
    || personName(recipient)
    || 'Wholesale account'
}

function referenceLabel({ invoice, order, payment }) {
  return text(invoice && invoice.invoice_number)
    || text(order && order.id)
    || text(invoice && invoice.id)
    || text(payment && payment.id)
    || 'order'
}

function pullIdempotencyKey({ invoice, order, payment }) {
  const orderId = cleanSquareId((order && order.id) || (invoice && invoice.order_id) || (payment && payment.order_id))
  if (orderId) return `order:${orderId}`
  const invoiceId = cleanSquareId(invoice && invoice.id)
  if (invoiceId) return `invoice:${invoiceId}`
  const paymentId = cleanSquareId(payment && payment.id)
  if (paymentId) return `payment:${paymentId}`
  return null
}

function dashboardLinks({ invoice, order, payment }) {
  const links = []
  const invoiceId = cleanSquareId(invoice && invoice.id)
  const orderId = cleanSquareId((order && order.id) || (payment && payment.order_id))
  const paymentId = cleanSquareId(payment && payment.id)
  if (invoiceId) links.push(`https://app.squareup.com/dashboard/invoices/${invoiceId}`)
  if (orderId) links.push(`https://app.squareup.com/dashboard/orders/overview/${orderId}`)
  if (paymentId) links.push(`https://app.squareup.com/dashboard/sales/transactions/${paymentId}`)
  return links
}

// Titles are crew-facing. Money stays off the title (description and Square may keep totals).
function stripCurrency(value) {
  const amount = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{2})?'
  const symbol = '(?:US\\$|CA\\$|A\\$|NZ\\$|[$€£¥₩₹₱])'
  const code = '(?:USD|CAD|AUD|EUR|GBP|JPY|MXN|dollars?|cents?)'
  let out = String(value ?? '')
  const patterns = [
    new RegExp(`${symbol}\\s*${amount}`, 'gi'),
    new RegExp(`\\b${code}\\s*${amount}\\b`, 'gi'),
    new RegExp(`\\b${amount}\\s*${code}\\b`, 'gi'),
    /\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/g,
    /[$€£¥₩₹₱]/g
  ]
  for (const pattern of patterns) out = out.replace(pattern, ' ')
  out = out.replace(/\s+/g, ' ').trim()
  return out.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')
}

function titleKind({ invoice, payment, order, env }) {
  if (invoice) return stripCurrency(text(invoice.invoice_number) || '') || 'invoice'
  if (isHouseAccount({ payment, order, env })) return 'house account'
  return 'order'
}

function buildTaskTitle({ account, reference, kind }) {
  const safeAccount = stripCurrency(account) || 'Wholesale account'
  const safeKind = stripCurrency(kind != null ? kind : reference) || 'order'
  let title = `PULL · ${safeAccount} · ${safeKind}`
  title = title.replace(/[$€£¥₩₹₱]/g, '')
  title = title.replace(/\s+·/g, ' ·').replace(/·\s+/g, '· ').replace(/\s+/g, ' ').trim()
  return title.length > 500 ? `${title.slice(0, 497)}...` : title
}

function buildTaskDescription({ lines, omitted, links, idempotencyKey, invoiceId, orderId, paymentId }) {
  const chunks = [(lines || []).map(line => `${line.qty}  ${line.name}`).join('\n')]
  if (omitted) chunks.push(`${omitted} line(s) omitted because Square did not provide a catalog name.`)
  if (links && links.length) chunks.push(links.join('\n'))
  const keys = [`square-pull-key: ${idempotencyKey}`]
  if (invoiceId) keys.push(`square-invoice-id: ${invoiceId}`)
  if (orderId) keys.push(`square-order-id: ${orderId}`)
  if (paymentId) keys.push(`square-payment-id: ${paymentId}`)
  chunks.push(keys.join('\n'))
  let body = chunks.filter(Boolean).join('\n\n')
  if (body.length > 15000) body = `${body.slice(0, 14900)}\n\n(truncated)`
  return body
}

function locationOk({ invoice, order, payment, locationId }) {
  const expected = text(locationId)
  if (!expected) return false
  const ids = [invoice && invoice.location_id, order && order.location_id, payment && payment.location_id]
    .map(text)
    .filter(Boolean)
  if (!ids.length) return false
  return ids.every(id => id === expected)
}

function extraTenderMarkers(env) {
  return String((env && env.WHOLESALE_PULL_TENDER_NAMES) || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
}

function isHouseAccount({ payment, order, env }) {
  if (payment && String(payment.source_type || '').toUpperCase() === 'EXTERNAL') return true
  const tenders = (order && order.tenders) || []
  if (tenders.some(tender => String(tender.type || '').toUpperCase() === 'OTHER')) return true
  const parts = []
  const external = payment && payment.external_details
  if (external) parts.push(external.type, external.source, external.source_id)
  for (const tender of tenders) parts.push(tender.type, tender.note, tender.name)
  const blob = parts.filter(Boolean).join(' ').toLowerCase()
  return HOUSE_TENDER_MARKERS.concat(extraTenderMarkers(env)).some(marker => blob.includes(marker))
}

function triggersSale({ payment, order, env, force }) {
  if (force || allCompleted(env)) return true
  return isHouseAccount({ payment, order, env })
}

async function loadCustomer(squareFetch, token, customerId) {
  const id = cleanSquareId(customerId)
  if (!id) return null
  try {
    const data = await readSquare(squareFetch, token, `/customers/${encodeURIComponent(id)}`)
    return (data && data.customer) || data
  } catch (err) {
    if (err && err.status === 404) return null
    throw err
  }
}

async function finishPull({ invoice, order, payment, customer, squareFetch, token, env }) {
  const { lines, omitted } = await resolveLines(order, squareFetch, token)
  if (!lines.length) return { skipped: 'no_lines' }
  const invoiceId = cleanSquareId(invoice && invoice.id)
  const orderId = cleanSquareId((order && order.id) || (invoice && invoice.order_id) || (payment && payment.order_id))
  const paymentId = cleanSquareId(payment && payment.id)
  const idempotencyKey = pullIdempotencyKey({ invoice, order, payment })
  if (!idempotencyKey) return { skipped: 'missing_id' }
  const account = accountLabel(customer, invoice)
  const reference = referenceLabel({ invoice, order, payment })
  const links = dashboardLinks({ invoice, order, payment })
  const when = (order && order.created_at) || (invoice && invoice.created_at) || (payment && payment.created_at)
  const dateLabel = chicagoDateLabel(when)
  const title = buildTaskTitle({ account, kind: titleKind({ invoice, payment, order, env }) })
  const description = buildTaskDescription({
    lines,
    omitted,
    links,
    idempotencyKey,
    invoiceId,
    orderId,
    paymentId
  })
  const pdf = buildPickListPdf({ account, dateLabel, reference, lines })
  return {
    pull: {
      idempotencyKey,
      invoiceId,
      orderId,
      paymentId,
      invoiceNumber: text(invoice && invoice.invoice_number),
      account,
      reference,
      lines,
      omitted,
      links,
      dateLabel,
      title,
      description,
      pdfBase64: pdf.toString('base64')
    }
  }
}

async function resolveInvoice({ invoice, env, account, squareFetch, force }) {
  if (!invoice || !cleanSquareId(invoice.id)) return { skipped: 'missing_id' }
  const status = String(invoice.status || '').toUpperCase()
  if (!force && !INVOICE_PULL_STATUSES.has(status)) {
    return { skipped: status === 'DRAFT' ? 'draft' : 'invoice_status' }
  }
  let order = null
  const orderId = cleanSquareId(invoice.order_id)
  if (orderId) {
    const data = await readSquare(squareFetch, account.token, `/orders/${encodeURIComponent(orderId)}`)
    order = (data && data.order) || data
  }
  if (!locationOk({ invoice, order, locationId: account.locationId })) return { skipped: 'location' }
  const customerId = (invoice.primary_recipient && invoice.primary_recipient.customer_id) || (order && order.customer_id)
  const customer = await loadCustomer(squareFetch, account.token, customerId)
  return finishPull({ invoice, order, payment: null, customer, squareFetch, token: account.token, env })
}

async function resolvePayment({ payment, env, account, squareFetch, force }) {
  if (!payment || !cleanSquareId(payment.id)) return { skipped: 'missing_id' }
  if (!force && payment.status !== 'COMPLETED') return { skipped: 'not_completed' }
  const orderId = cleanSquareId(payment.order_id)
  if (!orderId) return { skipped: 'no_order' }
  const data = await readSquare(squareFetch, account.token, `/orders/${encodeURIComponent(orderId)}`)
  const order = (data && data.order) || data
  if (!locationOk({ payment, order, locationId: account.locationId })) return { skipped: 'location' }
  if (!force && (!order || order.state !== 'COMPLETED')) return { skipped: 'order_not_completed' }
  if (!triggersSale({ payment, order, env, force })) return { skipped: 'not_house_account' }
  const customer = await loadCustomer(squareFetch, account.token, payment.customer_id || (order && order.customer_id))
  return finishPull({ invoice: null, order, payment, customer, squareFetch, token: account.token, env })
}

async function resolveOrder({ order, env, account, squareFetch, force }) {
  if (!order || !cleanSquareId(order.id)) return { skipped: 'missing_id' }
  if (!locationOk({ order, locationId: account.locationId })) return { skipped: 'location' }
  if (!force && order.state !== 'COMPLETED') return { skipped: 'not_completed' }
  if (!triggersSale({ payment: null, order, env, force })) return { skipped: 'not_house_account' }
  const customer = await loadCustomer(squareFetch, account.token, order.customer_id)
  return finishPull({ invoice: null, order, payment: null, customer, squareFetch, token: account.token, env })
}

async function resolvePull({ pointer, env, account, squareFetch, force }) {
  if (!pointer || !pointer.id) return { skipped: 'missing_id' }
  if (pointer.kind === 'invoice') {
    const data = await readSquare(squareFetch, account.token, `/invoices/${encodeURIComponent(pointer.id)}`)
    return resolveInvoice({ invoice: (data && data.invoice) || data, env, account, squareFetch, force })
  }
  if (pointer.kind === 'payment') {
    const data = await readSquare(squareFetch, account.token, `/payments/${encodeURIComponent(pointer.id)}`)
    return resolvePayment({ payment: (data && data.payment) || data, env, account, squareFetch, force })
  }
  if (pointer.kind === 'order') {
    const data = await readSquare(squareFetch, account.token, `/orders/${encodeURIComponent(pointer.id)}`)
    return resolveOrder({ order: (data && data.order) || data, env, account, squareFetch, force })
  }
  return { skipped: 'ignored' }
}

function entityPointer(type, event) {
  const data = event && event.data
  const object = data && data.object
  let raw = null
  if (type.startsWith('invoice.')) {
    raw = (object && object.invoice && object.invoice.id) || (object && object.id) || (data && data.id)
    const id = cleanSquareId(raw)
    return id ? { kind: 'invoice', id } : null
  }
  if (type.startsWith('payment.')) {
    raw = (object && object.payment && object.payment.id) || (object && object.id) || (data && data.id)
    const id = cleanSquareId(raw)
    return id ? { kind: 'payment', id } : null
  }
  if (type.startsWith('order.')) {
    raw = (object && object.order && object.order.id) || (object && object.id) || (data && data.id)
    const id = cleanSquareId(raw)
    return id ? { kind: 'order', id } : null
  }
  return null
}

function taskMatches(task, pull) {
  const body = `${task.content || ''}\n${task.description || ''}`
  if (pull.idempotencyKey && body.includes(`square-pull-key: ${pull.idempotencyKey}`)) return true
  if (pull.invoiceId && body.includes(`square-invoice-id: ${pull.invoiceId}`)) return true
  if (pull.orderId && body.includes(`square-order-id: ${pull.orderId}`)) return true
  if (pull.paymentId && body.includes(`square-payment-id: ${pull.paymentId}`)) return true
  return false
}

function usableOrderKey(value) {
  if (!value || typeof value !== 'string') return null
  try {
    integerPart(value)
    return value
  } catch {
    return null
  }
}

function leftmostSection(sections) {
  if (!sections.length) return null
  const withKeys = sections.filter(section => usableOrderKey(section.order_key))
  if (withKeys.length) {
    withKeys.sort((a, b) => (a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0))
    return withKeys[0]
  }
  const ranked = sections.map(section => ({
    section,
    order: Number(section.section_order != null ? section.section_order : section.child_order != null ? section.child_order : section.order)
  }))
  ranked.sort((a, b) => (Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER))
  return ranked[0].section
}

async function todoistJson(fetchImpl, url, options) {
  const res = await fetchImpl(url, options)
  const raw = typeof res.text === 'function' ? await res.text() : ''
  let data = null
  if (raw) {
    try { data = JSON.parse(raw) } catch { data = null }
  }
  return { res, data, raw }
}

function pageItems(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.results)) return data.results
  if (data && Array.isArray(data.tasks)) return data.tasks
  if (data && Array.isArray(data.sections)) return data.sections
  return []
}

async function listTodoistCollection(fetchImpl, token, path, query) {
  const items = []
  let cursor = null
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${TODOIST_API}${path}`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null && value !== '') url.searchParams.set(key, String(value))
    }
    url.searchParams.set('limit', '200')
    if (cursor) url.searchParams.set('cursor', cursor)
    const { res, data } = await todoistJson(fetchImpl, url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status === 404 && path === '/sections') return []
    if (!res.ok) throw httpError(502, 'Todoist did not list Takeout tasks')
    items.push(...pageItems(data))
    cursor = data && (data.next_cursor || data.nextCursor)
    if (!cursor) break
  }
  return items
}

function placementFor(tasks, section) {
  const column = tasks.filter(task => {
    if (task.parent_id) return false
    if (section) return task.section_id === section.id
    return !task.section_id
  })
  const keys = column.map(task => usableOrderKey(task.order_key)).filter(Boolean).sort()
  const minKey = keys[0] || null
  let orderKey = null
  let placementWarning = null
  try {
    orderKey = orderKeyBefore(minKey)
  } catch (err) {
    if (err.code !== 'ORDER_KEY_FLOOR' && err.code !== 'ORDER_KEY') throw err
    placementWarning = 'Takeout order key was already at the top of the key space. child_order was set instead.'
  }
  const orders = tasks
    .filter(task => !task.parent_id)
    .map(task => Number(task.child_order != null ? task.child_order : task.order))
    .filter(Number.isFinite)
  const childOrder = orders.length ? Math.min(...orders) - 1 : 1
  return {
    sectionId: section ? section.id : null,
    orderKey,
    childOrder,
    placementWarning
  }
}

async function scanTakeout({ fetchImpl, token, projectId, pull }) {
  const sections = await listTodoistCollection(fetchImpl, token, '/sections', { project_id: projectId })
  const section = leftmostSection(sections)
  const tasks = await listTodoistCollection(fetchImpl, token, '/tasks', { project_id: projectId })
  const match = tasks.find(task => taskMatches(task, pull)) || null
  return { match, placement: placementFor(tasks, section), tasks }
}

async function createTodoistTask({ fetchImpl, token, projectId, pull, placement }) {
  const body = {
    content: pull.title,
    description: pull.description,
    project_id: projectId,
    priority: TAKEOUT_API_PRIORITY
  }
  if (placement.sectionId) body.section_id = placement.sectionId
  if (placement.orderKey) body.order_key = placement.orderKey
  if (Number.isInteger(placement.childOrder)) body.child_order = placement.childOrder
  const { res, data } = await todoistJson(fetchImpl, `${TODOIST_API}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw httpError(502, 'Todoist did not create the Takeout task')
  const task = (data && data.task) || data
  if (!task || !task.id) throw httpError(502, 'Todoist did not return a task id')
  if (task.project_id && task.project_id !== projectId) {
    throw httpError(502, 'Todoist created the task outside Takeout')
  }
  return { task, body }
}

function creatingRow(pull, now) {
  return {
    idempotency_key: pull.idempotencyKey,
    invoice_id: pull.invoiceId,
    order_id: pull.orderId,
    payment_id: pull.paymentId,
    invoice_number: pull.invoiceNumber,
    account_name: pull.account,
    reference: pull.reference,
    pick_date: pull.dateLabel,
    lines: pull.lines,
    square_links: pull.links,
    todoist_task_id: null,
    pdf_base64: null,
    status: 'creating',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    printed_at: null
  }
}

function readyPatch(pull, taskId, now, status) {
  return {
    todoist_task_id: String(taskId),
    pdf_base64: pull.pdfBase64,
    status: status || 'ready',
    lines: pull.lines,
    account_name: pull.account,
    reference: pull.reference,
    pick_date: pull.dateLabel,
    invoice_number: pull.invoiceNumber,
    square_links: pull.links,
    updated_at: now.toISOString()
  }
}

function isMissingPullTable(err) {
  const message = String((err && err.message) || '')
  return /wholesale_pulls/i.test(message) && /(PGRST205|42P01|schema cache|does not exist)/i.test(message)
}

async function openStore(store, pull) {
  if (!store) {
    return {
      store: null,
      existing: null,
      warning: 'Pick list PDF was not stored (Supabase is not configured).'
    }
  }
  try {
    const existing = await store.find(pull)
    return { store, existing, warning: null }
  } catch (err) {
    if (isMissingPullTable(err)) {
      return {
        store: null,
        existing: null,
        warning: 'Pick list PDF was not stored. Run supabase/wholesale_pulls.sql.'
      }
    }
    throw err
  }
}

async function rememberTask(store, existing, pull, taskId, now) {
  const patch = readyPatch(pull, taskId, now, existing && existing.status === 'printed' ? 'printed' : 'ready')
  if (existing) {
    await store.update(existing.idempotency_key, patch)
    return
  }
  await store.insert({ ...creatingRow(pull, now), ...patch })
}

function resultPayload(base) {
  const payload = {
    ok: true,
    created: Boolean(base.created),
    duplicate: Boolean(base.duplicate),
    todoistTaskId: base.todoistTaskId || null,
    idempotencyKey: base.idempotencyKey,
    projectId: base.projectId,
    priority: TAKEOUT_UI_PRIORITY,
    pdfStored: Boolean(base.pdfStored)
  }
  if (base.warning) payload.warning = base.warning
  return payload
}

async function commitPull({ pull, env, store, todoistFetch, now = new Date() }) {
  const { token, projectId } = assertTakeoutConfigured(env)
  const fetchImpl = todoistFetch || globalThis.fetch.bind(globalThis)
  const opened = await openStore(store, pull)
  if (opened.existing && opened.existing.todoist_task_id) {
    return resultPayload({
      duplicate: true,
      todoistTaskId: String(opened.existing.todoist_task_id),
      idempotencyKey: pull.idempotencyKey,
      projectId,
      pdfStored: Boolean(opened.existing.pdf_base64),
      warning: opened.warning
    })
  }
  const scan = await scanTakeout({ fetchImpl, token, projectId, pull })
  if (scan.match) {
    if (opened.store) await rememberTask(opened.store, opened.existing, pull, scan.match.id, now)
    return resultPayload({
      duplicate: true,
      todoistTaskId: String(scan.match.id),
      idempotencyKey: pull.idempotencyKey,
      projectId,
      pdfStored: Boolean(opened.store),
      warning: opened.warning
    })
  }
  if (opened.existing && opened.existing.status === 'creating' && !opened.existing.todoist_task_id) {
    const createdAt = new Date(opened.existing.created_at).getTime()
    const age = now.getTime() - createdAt
    if (Number.isFinite(age) && age >= 0 && age < CREATING_LOCK_MS) {
      throw httpError(503, 'Pull already in progress')
    }
  }
  if (opened.store && !opened.existing) {
    const inserted = await opened.store.insert(creatingRow(pull, now))
    if (inserted && inserted.conflict) throw httpError(503, 'Pull already in progress')
  }
  const created = await createTodoistTask({
    fetchImpl,
    token,
    projectId,
    pull,
    placement: scan.placement
  })
  let pdfStored = false
  if (opened.store) {
    await opened.store.update(pull.idempotencyKey, readyPatch(pull, created.task.id, now))
    pdfStored = true
  }
  const warning = [opened.warning, scan.placement.placementWarning].filter(Boolean).join(' ') || null
  return resultPayload({
    created: true,
    todoistTaskId: String(created.task.id),
    idempotencyKey: pull.idempotencyKey,
    projectId,
    pdfStored,
    warning
  })
}

function wholesaleAccount(env) {
  const account = peekAccountFromEnv('wholesale', env)
  if (!account.token || !account.locationId) {
    throw httpError(503, 'Wholesale Square account is not configured')
  }
  return account
}

function chooseStore(options, env) {
  if (Object.prototype.hasOwnProperty.call(options, 'store')) return options.store
  return createSupabasePullStore(env)
}

async function handleSquareWebhook(options) {
  const env = options.env || {}
  const auth = evaluateSquareWebhookAuth({
    env,
    signature: options.signature,
    notificationUrl: options.notificationUrl,
    rawBody: options.rawBody
  })
  if (!auth.ok) return { status: auth.status, json: { error: auth.error }, headers: auth.headers }
  if (!pullEnabled(env)) {
    return { status: 200, json: { ok: true, skipped: 'disabled' }, headers: auth.headers }
  }
  let event
  try {
    const raw = Buffer.isBuffer(options.rawBody) ? options.rawBody.toString('utf8') : String(options.rawBody || '')
    event = JSON.parse(raw)
  } catch {
    return { status: 400, json: { error: 'Invalid JSON' }, headers: auth.headers }
  }
  const type = String(event.type || '').toLowerCase()
  if (!PULL_EVENT_TYPES.has(type)) {
    return { status: 200, json: { ok: true, ignored: true }, headers: auth.headers }
  }
  const account = wholesaleAccount(env)
  const pointer = entityPointer(type, event)
  if (!pointer) return { status: 200, json: { ok: true, skipped: 'missing_id' }, headers: auth.headers }
  const decision = await resolvePull({
    pointer,
    env,
    account,
    squareFetch: options.squareFetch,
    force: false
  })
  if (decision.skipped) {
    return { status: 200, json: { ok: true, skipped: decision.skipped }, headers: auth.headers }
  }
  const committed = await commitPull({
    pull: decision.pull,
    env,
    store: chooseStore(options, env),
    todoistFetch: options.todoistFetch,
    now: options.now || new Date()
  })
  return { status: 200, json: committed, headers: auth.headers }
}

const REPLAY_KEYS = new Set(['invoiceId', 'orderId', 'paymentId', 'apply', 'force'])

async function handleReplay(options) {
  const env = options.env || {}
  const body = options.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, json: { error: 'JSON body is required' } }
  }
  for (const key of Object.keys(body)) {
    if (!REPLAY_KEYS.has(key)) return { status: 400, json: { error: 'Unsupported field' } }
  }
  if (body.apply != null && typeof body.apply !== 'boolean') {
    return { status: 400, json: { error: 'apply must be a boolean' } }
  }
  if (body.force != null && typeof body.force !== 'boolean') {
    return { status: 400, json: { error: 'force must be a boolean' } }
  }
  const invoiceId = body.invoiceId == null || body.invoiceId === '' ? null : cleanSquareId(body.invoiceId)
  const orderId = body.orderId == null || body.orderId === '' ? null : cleanSquareId(body.orderId)
  const paymentId = body.paymentId == null || body.paymentId === '' ? null : cleanSquareId(body.paymentId)
  if ((body.invoiceId && !invoiceId) || (body.orderId && !orderId) || (body.paymentId && !paymentId)) {
    return { status: 400, json: { error: 'Invalid Square id' } }
  }
  const count = [invoiceId, orderId, paymentId].filter(Boolean).length
  if (count !== 1) return { status: 400, json: { error: 'Provide one of invoiceId, orderId, or paymentId' } }
  const account = wholesaleAccount(env)
  const pointer = invoiceId
    ? { kind: 'invoice', id: invoiceId }
    : orderId
      ? { kind: 'order', id: orderId }
      : { kind: 'payment', id: paymentId }
  const decision = await resolvePull({
    pointer,
    env,
    account,
    squareFetch: options.squareFetch,
    force: body.force === true
  })
  if (decision.skipped) {
    return { status: 200, json: { ok: true, apply: false, skipped: decision.skipped, priority: TAKEOUT_UI_PRIORITY } }
  }
  const preview = {
    ok: true,
    apply: false,
    created: false,
    title: decision.pull.title,
    description: decision.pull.description,
    lines: decision.pull.lines,
    account: decision.pull.account,
    reference: decision.pull.reference,
    date: decision.pull.dateLabel,
    idempotencyKey: decision.pull.idempotencyKey,
    projectId: takeoutProjectId(env),
    priority: TAKEOUT_UI_PRIORITY,
    pdfBase64: decision.pull.pdfBase64
  }
  if (body.apply !== true) return { status: 200, json: preview }
  if (!pullEnabled(env)) return { status: 403, json: { error: 'Wholesale pull is disabled' } }
  const committed = await commitPull({
    pull: decision.pull,
    env,
    store: chooseStore(options, env),
    todoistFetch: options.todoistFetch,
    now: options.now || new Date()
  })
  return { status: 200, json: { ...committed, apply: true } }
}

function pdfBufferFromRow(row) {
  if (!row) return null
  if (row.pdf_base64) {
    const buf = Buffer.from(row.pdf_base64, 'base64')
    if (buf.length >= 4 && buf.slice(0, 4).toString() === '%PDF') return buf
  }
  if (!Array.isArray(row.lines) || !row.lines.length) return null
  return buildPickListPdf({
    account: row.account_name,
    dateLabel: row.pick_date,
    reference: row.reference,
    lines: row.lines
  })
}

function pdfFilename(row) {
  const raw = `${row.account_name || 'pull'}-${row.reference || row.idempotency_key || 'list'}`
  const safe = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  return `pick-list-${safe || 'wholesale'}.pdf`
}

function publicPending(row) {
  return {
    key: row.idempotency_key,
    account: row.account_name,
    reference: row.reference,
    date: row.pick_date,
    todoistTaskId: row.todoist_task_id,
    createdAt: row.created_at,
    invoiceId: row.invoice_id,
    orderId: row.order_id,
    paymentId: row.payment_id
  }
}

async function handlePullSheets(options) {
  const env = options.env || {}
  const store = chooseStore(options, env)
  if (!store) throw httpError(503, 'Wholesale pull storage is not configured')
  const method = options.method
  const query = options.query || {}
  if (method === 'GET' && String(query.format || '') === 'pdf') {
    const key = requireKey(query.key)
    const row = await store.get(key)
    if (!row) return { status: 404, json: { error: 'Pick list not found' } }
    const pdf = pdfBufferFromRow(row)
    if (!pdf) return { status: 404, json: { error: 'Pick list PDF is not available' } }
    return { status: 200, pdf, filename: pdfFilename(row) }
  }
  if (method === 'GET') {
    const rows = await store.listPending()
    return { status: 200, json: { data: (rows || []).map(publicPending) } }
  }
  if (method === 'POST') {
    const key = requireKey(options.body && options.body.key)
    const marked = await store.markPrinted(key, options.now || new Date())
    if (marked && marked.notReady) return { status: 409, json: { error: 'Pick list is not ready' } }
    if (!marked) return { status: 404, json: { error: 'Pick list not found' } }
    return { status: 200, json: { ok: true, key, status: 'printed' } }
  }
  return { status: 405, json: { error: 'Method not allowed' }, allow: 'GET, POST' }
}

function supabaseConfig(env) {
  let url = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  const key = String(env.SUPABASE_SERVICE_KEY || '').trim()
  if (!url || !key) return null
  return { url, key }
}

function quoteFilter(value) {
  return `"${String(value).replace(/"/g, '')}"`
}

function createSupabasePullStore(env, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const sb = supabaseConfig(env || {})
  if (!sb) return null

  async function request(path, options = {}) {
    const res = await fetchImpl(`${sb.url}${path}`, {
      ...options,
      headers: {
        apikey: sb.key,
        Authorization: `Bearer ${sb.key}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    })
    const raw = await res.text()
    if (res.status === 409) {
      const err = httpError(409, scrub(raw || 'Conflict'))
      err.code = 409
      throw err
    }
    if (!res.ok) throw httpError(502, scrub(raw || `Supabase ${res.status}`))
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  return {
    async find(pull) {
      const parts = []
      if (pull.idempotencyKey) parts.push(`idempotency_key.eq.${quoteFilter(pull.idempotencyKey)}`)
      if (pull.orderId) parts.push(`order_id.eq.${quoteFilter(pull.orderId)}`)
      if (pull.invoiceId) parts.push(`invoice_id.eq.${quoteFilter(pull.invoiceId)}`)
      if (pull.paymentId) parts.push(`payment_id.eq.${quoteFilter(pull.paymentId)}`)
      if (!parts.length) return null
      const params = new URLSearchParams()
      params.set('or', `(${parts.join(',')})`)
      params.set('limit', '1')
      const rows = await request(`/rest/v1/wholesale_pulls?${params}`)
      return Array.isArray(rows) && rows[0] ? rows[0] : null
    },
    async insert(row) {
      try {
        const rows = await request('/rest/v1/wholesale_pulls', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        })
        return { conflict: false, row: Array.isArray(rows) ? rows[0] : row }
      } catch (err) {
        if (err && err.status === 409) return { conflict: true }
        throw err
      }
    },
    async update(key, patch) {
      const params = new URLSearchParams()
      params.set('idempotency_key', `eq.${quoteFilter(key)}`)
      const rows = await request(`/rest/v1/wholesale_pulls?${params}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      })
      return Array.isArray(rows) ? rows[0] : null
    },
    async get(key) {
      const params = new URLSearchParams()
      params.set('idempotency_key', `eq.${quoteFilter(key)}`)
      params.set('limit', '1')
      const rows = await request(`/rest/v1/wholesale_pulls?${params}`)
      return Array.isArray(rows) && rows[0] ? rows[0] : null
    },
    async listPending() {
      const params = new URLSearchParams()
      params.set('status', 'eq.ready')
      params.set('todoist_task_id', 'not.is.null')
      params.set('order', 'created_at.asc')
      params.set('select', 'idempotency_key,account_name,reference,pick_date,todoist_task_id,created_at,invoice_id,order_id,payment_id')
      const rows = await request(`/rest/v1/wholesale_pulls?${params}`)
      return Array.isArray(rows) ? rows : []
    },
    async markPrinted(key, now) {
      const params = new URLSearchParams()
      params.set('idempotency_key', `eq.${quoteFilter(key)}`)
      params.set('status', 'eq.ready')
      const rows = await request(`/rest/v1/wholesale_pulls?${params}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'printed',
          printed_at: now.toISOString(),
          updated_at: now.toISOString()
        })
      })
      if (Array.isArray(rows) && rows[0]) return rows[0]
      const current = await this.get(key)
      if (!current) return null
      if (current.status === 'printed') return current
      return { notReady: true }
    }
  }
}

module.exports = {
  PACKAGE_PROJECT_ID,
  PRACTICE_HEBERTS_MAURICE,
  TAKEOUT_API_PRIORITY,
  TAKEOUT_UI_PRIORITY,
  assertPullSquareRead,
  buildTaskDescription,
  buildTaskTitle,
  stripCurrency,
  cleanSquareId,
  createSupabasePullStore,
  formatQty,
  handlePullSheets,
  handleReplay,
  handleSquareWebhook,
  isHouseAccount,
  pullIdempotencyKey,
  scrub
}
