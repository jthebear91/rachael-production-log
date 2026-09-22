'use strict'

const fs = require('fs')
const path = require('path')
const {
  createMemoryPickStore,
  createSupabasePickStore,
  normalizeSupabaseUrl,
  resetDevMemoryStore,
  resolvePickStore
} = require('../lib/pick-store')
const {
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
  sendMauricePick
} = require('../lib/maurice-pick')
const { loadPickSheet, renderPickSheet } = require('../lib/pick-sheet')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function assertRejects(fn, status, message) {
  try {
    await fn()
  } catch (err) {
    assert(err.status === status, `expected ${status} got ${err.status}: ${err.message}`)
    if (message) assert(err.message === message, err.message)
    return
  }
  throw new Error(`expected rejection ${status} ${message || ''}`)
}

function wholesaleAccount() {
  return { account: 'wholesale', token: 'wholesale-token', locationId: 'LOC_W', configured: true, label: 'Wholesale' }
}

function fakeSquare() {
  const calls = []
  let inventoryFailuresLeft = 0
  const squareFetch = async args => {
    calls.push(JSON.parse(JSON.stringify(args)))
    const requestPath = String(args.path || '')
    assertMauriceSquarePath(requestPath)
    if (requestPath === INVENTORY_PATH) {
      if (inventoryFailuresLeft > 0) {
        inventoryFailuresLeft -= 1
        const err = new Error('temporary')
        err.status = 502
        throw err
      }
      return { counts: [] }
    }
    if (requestPath.startsWith('/catalog/object/')) {
      const id = decodeURIComponent(requestPath.split('/').pop())
      return { object: { type: 'ITEM_VARIATION', id, is_deleted: false } }
    }
    if (requestPath === '/orders') return { order: { id: 'ORDER1', tenders: [] } }
    if (requestPath === '/invoices') return { invoice: { id: 'INV1', version: 3, status: 'DRAFT' } }
    if (requestPath.endsWith('/publish')) {
      return {
        invoice: {
          id: 'INV1',
          version: 4,
          status: 'UNPAID',
          invoice_number: '1042',
          public_url: 'https://example.test/invoice/1042'
        }
      }
    }
    throw new Error(`unexpected Square path ${requestPath}`)
  }
  return {
    calls,
    squareFetch,
    failInventoryOnce() {
      inventoryFailuresLeft = 1
    }
  }
}

function sendDeps(store, square, env = {}) {
  return {
    store,
    env,
    resolveAccount: () => wholesaleAccount(),
    resolveLocationId: () => 'LOC_W',
    squareFetch: square.squareFetch,
    now: () => new Date('2026-09-22T15:00:00.000Z')
  }
}

async function testValidation() {
  const bad = parseCreateBody({
    lines: [{ catalogObjectId: 'VAR1', orderedQty: 1, amount: 100 }]
  })
  assert(!bad.ok && bad.error === 'Payment fields are not accepted', bad.error)
  const dup = parseCreateBody({
    lines: [
      { catalogObjectId: 'VAR1', orderedQty: 1 },
      { catalogObjectId: 'VAR1', orderedQty: 2 }
    ]
  })
  assert(!dup.ok && dup.error === 'Duplicate catalogObjectId', dup.error)

  assert(mauriceCustomerId({}) === DEFAULT_MAURICE_CUSTOMER_ID, 'default Maurice customer')
  assert(mauriceCustomerId({ SQUARE_MAURICE_CUSTOMER_ID: 'CUST_MAURICE' }) === 'CUST_MAURICE', 'customer override')
  assert(appBaseUrl({ NODE_ENV: 'production', VERCEL: '1' }, { headers: { host: 'evil.example' } }) === DEFAULT_APP_BASE_URL, 'production origin')
  assert(appBaseUrl({ NODE_ENV: 'development' }, { headers: { host: 'localhost:3000' } }) === 'http://localhost:3000', 'dev origin')
  assert(appBaseUrl({ APP_BASE_URL: 'https://pick.example/' }) === 'https://pick.example', 'configured origin')

  assertMauriceSquarePath(INVENTORY_PATH)
  assertMauriceSquarePath('/catalog/object/VAR1')
  assertMauriceSquarePath('/orders')
  assertMauriceSquarePath('/invoices/INV1/publish')
  let refused = false
  try {
    assertMauriceSquarePath('/payments')
  } catch (err) {
    refused = err.status === 500
  }
  assert(refused, 'payments path refused')
  refused = false
  try {
    assertMauriceSquarePath('/orders/pay')
  } catch (err) {
    refused = err.status === 500
  }
  assert(refused, 'pay segment refused')

  const body = buildInventoryDecreaseBody({
    idempotencyKey: 'mp-token',
    locationId: 'LOC_W',
    occurredAt: '2026-09-22T15:00:00.000Z',
    lines: [{ catalogObjectId: 'VAR1', qty: '2' }]
  })
  assert(body.changes[0].adjustment.from_state === 'IN_STOCK', 'from stock')
  assert(body.changes[0].adjustment.to_state === 'SOLD', 'to sold')
  assert(body.changes[0].adjustment.quantity === '2', 'decrease qty')
  assert(!JSON.stringify(body).includes('total_price_money'), 'no price on adjustment')
  assert(!JSON.stringify(body).includes('source_id'), 'no source on adjustment')
}

async function testSupabaseStore() {
  assert(normalizeSupabaseUrl('https://abc.supabase.co/rest/v1/') === 'https://abc.supabase.co', 'url trim')
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    const method = options.method
    if (method === 'POST') {
      return { ok: true, status: 201, async text() { return JSON.stringify([JSON.parse(options.body)]) } }
    }
    if (method === 'PATCH' && String(url).includes('status=eq.open')) {
      const patch = JSON.parse(options.body)
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify([{
            token: 'a'.repeat(20),
            status: patch.status,
            lines: [{ catalogObjectId: 'VAR1', name: 'Shrimp', orderedQty: '2' }],
            note: null,
            sent_lines: patch.sent_lines,
            occurred_at: patch.occurred_at,
            invoice_id: null,
            invoice_number: null,
            order_id: null,
            public_url: null,
            created_at: '2026-09-22T15:00:00.000Z',
            sent_at: null
          }])
        }
      }
    }
    if (method === 'PATCH') return { ok: true, status: 200, async text() { return '[]' } }
    return { ok: true, status: 200, async text() { return '[]' } }
  }
  const store = createSupabasePickStore({
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/',
    SUPABASE_SERVICE_KEY: 'service-key'
  }, fetchImpl)
  assert(store.kind === 'supabase', 'supabase kind')
  const row = {
    token: 'a'.repeat(20),
    status: 'open',
    lines: [{ catalogObjectId: 'VAR1', name: 'Shrimp', orderedQty: '2' }],
    note: null,
    sentLines: null,
    occurredAt: null,
    invoiceId: null,
    invoiceNumber: null,
    orderId: null,
    publicUrl: null,
    createdAt: '2026-09-22T15:00:00.000Z',
    sentAt: null
  }
  await store.insert(row)
  assert(calls[0].url.includes('/rest/v1/pick_tokens'), calls[0].url)
  assert(calls[0].options.headers.Authorization === 'Bearer service-key', 'service key')
  assert(calls[0].options.headers.apikey === 'service-key', 'apikey header')
  const claimed = await store.claim(row.token, {
    sentLines: [{ catalogObjectId: 'VAR1', name: 'Shrimp', orderedQty: '2', qty: '1' }],
    occurredAt: '2026-09-22T15:00:00.000Z'
  })
  assert(claimed.status === 'sending' && claimed.sentLines[0].qty === '1', 'claim maps columns')
  assert(calls[1].url.includes('status=eq.open'), calls[1].url)

  const missing = createSupabasePickStore({
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-key'
  }, async () => ({
    ok: false,
    status: 404,
    async text() { return JSON.stringify({ message: 'relation "public.pick_tokens" does not exist' }) }
  }))
  await assertRejects(
    () => missing.insert(row),
    503,
    'pick_tokens table is missing. Apply supabase/pick_tokens.sql'
  )

  resetDevMemoryStore()
  assert(resolvePickStore({ PICK_STORE: 'memory', NODE_ENV: 'production' }) === null, 'no memory in production')
  assert(resolvePickStore({ PICK_STORE: 'memory', NODE_ENV: 'development', VERCEL: '1' }) === null, 'no memory on Vercel')
  const dev = resolvePickStore({ PICK_STORE: 'memory', NODE_ENV: 'development' })
  assert(dev && dev.kind === 'memory', 'dev memory')
  assert(resolvePickStore({ PICK_STORE: 'memory', NODE_ENV: 'development' }) === dev, 'memory singleton')
  const preferred = resolvePickStore({
    PICK_STORE: 'memory',
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_KEY: 'k'
  }, async () => ({ ok: true, status: 200, async text() { return '[]' } }))
  assert(preferred.kind === 'supabase', 'supabase wins over memory')
  resetDevMemoryStore()
}

async function testCreateSend(createUnpaidInvoice) {
  const store = createMemoryPickStore()
  const env = { APP_BASE_URL: 'https://pick.example', SQUARE_MAURICE_CUSTOMER_ID: '' }
  const created = await createMauricePick({
    env,
    store,
    body: {
      note: 'Tuesday pull',
      lines: [
        { catalogObjectId: 'VAR_A', name: 'Stuffed shrimp', orderedQty: 4 },
        { catalogObjectId: 'VAR_B', name: 'Gumbo', orderedQty: '2' },
        { catalogObjectId: 'VAR_C', name: '<script>alert(1)</script>', orderedQty: 5 }
      ]
    }
  })
  assert(created.pickUrl === `https://pick.example/pick/${created.token}`, created.pickUrl)
  assert(created.sheetUrl === `https://pick.example/api/pick/${created.token}/sheet`, created.sheetUrl)

  const square = fakeSquare()
  const originalFetch = global.fetch
  global.fetch = async () => { throw new Error('global fetch') }
  let result
  try {
    await assertRejects(
      () => sendMauricePick({
        ...sendDeps(store, square, env),
        createUnpaidInvoice,
        token: created.token,
        body: { lines: [{ catalogObjectId: 'VAR_A', qty: 99 }] }
      }),
      400,
      'Quantity cannot be higher than ordered'
    )
    assert(square.calls.length === 0, 'rejected qty does not call Square')
    assert((await getMauricePick(created.token, { store })).status === 'open', 'still open after bad qty')

    await assertRejects(
      () => sendMauricePick({
        ...sendDeps(store, square, env),
        createUnpaidInvoice,
        token: created.token,
        body: { source_id: 'cnon:card', lines: [{ catalogObjectId: 'VAR_A', qty: 1 }] }
      }),
      400,
      'Payment fields are not accepted'
    )
    assert((await getMauricePick(created.token, { store })).status === 'open', 'still open after payment field')

    const unconfigured = createMemoryPickStore()
    const pending = await createMauricePick({
      env,
      store: unconfigured,
      body: { lines: [{ catalogObjectId: 'VAR_A', orderedQty: 1 }] }
    })
    await assertRejects(
      () => sendMauricePick({
        ...sendDeps(unconfigured, square, env),
        createUnpaidInvoice,
        token: pending.token,
        resolveAccount: () => {
          const err = new Error('Wholesale Square account is not configured')
          err.status = 503
          throw err
        }
      }),
      503,
      'Wholesale Square account is not configured'
    )
    assert((await getMauricePick(pending.token, { store: unconfigured })).status === 'open', 'config error does not lock')

    result = await sendMauricePick({
      ...sendDeps(store, square, env),
      createUnpaidInvoice,
      token: created.token,
      body: {
        lines: [
          { catalogObjectId: 'VAR_A', qty: 1 },
          { catalogObjectId: 'VAR_C', qty: 0 }
        ]
      }
    })
  } finally {
    global.fetch = originalFetch
  }

  assert(result.alreadySent === false, 'first send')
  assert(result.status === 'sent', 'sent status')
  assert(result.invoiceId === 'INV1', 'invoice id')
  assert(result.invoiceNumber === '1042', 'invoice number')
  assert(result.lines.find(line => line.catalogObjectId === 'VAR_B').qty === '2', 'omitted line stays ordered')
  assert(result.lines.find(line => line.catalogObjectId === 'VAR_C').qty === '0', 'zero short is stored')

  const paths = square.calls.map(call => call.path)
  assert(!paths.some(item => item.toLowerCase().includes('payment')), `payment path in ${paths.join(',')}`)
  const inventoryAt = paths.indexOf(INVENTORY_PATH)
  const orderAt = paths.indexOf('/orders')
  assert(inventoryAt !== -1 && inventoryAt < orderAt, `inventory before invoice: ${paths.join(',')}`)
  const inventory = square.calls[inventoryAt].body
  assert(inventory.idempotency_key === `mp-${created.token}`, inventory.idempotency_key)
  assert(inventory.changes.length === 2, 'zero qty omitted from inventory')
  const qtyById = Object.fromEntries(inventory.changes.map(change => [change.adjustment.catalog_object_id, change.adjustment.quantity]))
  assert(qtyById.VAR_A === '1' && qtyById.VAR_B === '2', JSON.stringify(qtyById))
  assert(inventory.changes.every(change => change.adjustment.from_state === 'IN_STOCK' && change.adjustment.to_state === 'SOLD'), 'sold decrease')
  assert(inventory.changes.every(change => change.adjustment.location_id === 'LOC_W'), 'wholesale location')

  const order = square.calls.find(call => call.path === '/orders').body
  assert(order.idempotency_key === `mp-${created.token}`, 'order idempotency')
  assert(order.order.customer_id === DEFAULT_MAURICE_CUSTOMER_ID, 'default Maurice customer when env blank')
  assert(order.order.line_items.length === 2, 'zero qty omitted from order')
  assert(!Object.prototype.hasOwnProperty.call(order.order, 'tenders'), 'no tenders')
  const invoice = square.calls.find(call => call.path === '/invoices').body
  assert(invoice.invoice.delivery_method === 'SHARE_MANUALLY', 'manual share')
  assert(invoice.invoice.payment_requests[0].automatic_payment_source === 'NONE', 'no auto charge')
  assert(invoice.invoice.primary_recipient.customer_id === DEFAULT_MAURICE_CUSTOMER_ID, 'invoice customer')
  assert(invoice.invoice.description === 'Tuesday pull', 'note becomes description')

  const before = square.calls.length
  const again = await sendMauricePick({
    ...sendDeps(store, square, env),
    createUnpaidInvoice,
    token: created.token,
    body: { lines: [{ catalogObjectId: 'VAR_A', qty: 4 }] }
  })
  assert(again.alreadySent === true, 'second send')
  assert(again.invoiceId === 'INV1', 'same invoice')
  assert(square.calls.length === before, 'second send does not call Square')

  const page = await loadPickPage(created.token, { store })
  assert(page.alreadySent === true && page.invoiceNumber === '1042', 'phone props already sent')
  const html = await renderPickSheet({
    pick: await getMauricePick(created.token, { store }),
    pickUrl: created.pickUrl
  })
  assert(html.includes(ALREADY_SENT_LABEL), 'sheet says already sent')
  assert(html.includes(created.pickUrl), 'sheet includes pick url')
  assert(html.includes('<svg'), 'sheet includes qr')
  assert(html.includes('&lt;script&gt;'), 'sheet escapes name')
  assert(!html.includes('<script>alert'), 'sheet does not inject script')

  const defaultStore = createMemoryPickStore()
  const defaults = await createMauricePick({
    env,
    store: defaultStore,
    body: { lines: [{ catalogObjectId: 'VAR_A', name: 'Shrimp', orderedQty: 3 }] }
  })
  const defaultSquare = fakeSquare()
  const defaultSent = await sendMauricePick({
    ...sendDeps(defaultStore, defaultSquare, env),
    createUnpaidInvoice,
    token: defaults.token
  })
  assert(defaultSent.lines[0].qty === '3', 'omitted body sends the ordered quantity')
  assert(defaultSquare.calls.find(call => call.path === INVENTORY_PATH).body.changes[0].adjustment.quantity === '3', 'inventory uses ordered qty')

  const openStore = createMemoryPickStore()
  const open = await createMauricePick({
    env,
    store: openStore,
    body: { lines: [{ catalogObjectId: 'VAR_A', name: 'Stuffed shrimp', orderedQty: 4 }] }
  })
  const sheet = await loadPickSheet({ token: open.token, env, store: openStore })
  assert(sheet.includes('Stuffed shrimp') && sheet.includes('>4<'), 'open sheet lists ordered qty')
  assert(sheet.includes('<svg'), 'open sheet qr')
}

async function testLockedRetry(createUnpaidInvoice) {
  const store = createMemoryPickStore()
  const env = { APP_BASE_URL: 'https://pick.example' }
  const created = await createMauricePick({
    env,
    store,
    body: { lines: [{ catalogObjectId: 'VAR_A', name: 'Shrimp', orderedQty: 4 }] }
  })
  const square = fakeSquare()
  square.failInventoryOnce()
  await assertRejects(
    () => sendMauricePick({
      ...sendDeps(store, square, env),
      createUnpaidInvoice,
      token: created.token,
      body: { lines: [{ catalogObjectId: 'VAR_A', qty: 1 }] }
    }),
    502,
    'temporary'
  )
  assert((await getMauricePick(created.token, { store })).status === 'sending', 'locked after failure')
  const finished = await sendMauricePick({
    ...sendDeps(store, square, env),
    createUnpaidInvoice,
    token: created.token,
    body: { lines: [{ catalogObjectId: 'VAR_A', qty: 4 }] }
  })
  assert(finished.alreadySent === false, 'retry completes')
  assert(finished.lines[0].qty === '1', 'retry keeps the short')
  const adjustments = square.calls.filter(call => call.path === INVENTORY_PATH)
  assert(adjustments.length === 2, 'inventory retried')
  assert(adjustments[0].body.idempotency_key === adjustments[1].body.idempotency_key, 'same inventory key')
  assert(adjustments[0].body.changes[0].adjustment.quantity === '1', 'first qty locked')
  assert(adjustments[1].body.changes[0].adjustment.quantity === '1', 'retry qty locked')
  assert(adjustments[0].body.changes[0].adjustment.occurred_at === adjustments[1].body.changes[0].adjustment.occurred_at, 'same occurred_at')
  assert(square.calls.filter(call => call.path === '/orders').length === 1, 'one order')
}

function testSourceShape() {
  const root = path.join(__dirname, '..')
  const files = [
    'lib/maurice-pick.js',
    'lib/pick-store.js',
    'lib/pick-sheet.js',
    'pages/api/pick/maurice-restock/create.js',
    'pages/api/pick/[token]/send.js',
    'pages/api/pick/[token]/sheet.js',
    'pages/pick/[token].js'
  ]
  const banned = ['CreatePayment', 'CompletePayment', '/v2/payments', "'/payments'", '"/payments"', 'PayOrder']
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8')
    for (const needle of banned) {
      assert(!src.includes(needle), `${file} contains ${needle}`)
    }
  }
  const send = fs.readFileSync(path.join(root, 'pages/api/pick/[token]/send.js'), 'utf8')
  assert(send.includes('createUnpaidInvoice'), 'send uses unpaid invoice helper')
  assert(send.includes('squareFetch'), 'send uses shared Square client')
  assert(!send.includes('authorizeBridge'), 'phone send is not bridge-gated')
  const create = fs.readFileSync(path.join(root, 'pages/api/pick/maurice-restock/create.js'), 'utf8')
  assert(create.includes('authorizeBridge'), 'create uses bridge auth')
  assert(create.includes('createMauricePick'), 'create handler')
  const page = fs.readFileSync(path.join(root, 'pages/pick/[token].js'), 'utf8')
  assert(page.includes('Already sent'), 'phone says already sent')
  assert(page.includes('Send'), 'phone has Send')
  assert(page.includes('max={line.orderedQty}'), 'qty cannot be raised in the input')
  const sql = fs.readFileSync(path.join(root, 'supabase/pick_tokens.sql'), 'utf8')
  assert(sql.includes('pick_tokens') && sql.includes('enable row level security'), 'sql creates locked table')
}

async function main() {
  const { createUnpaidInvoice } = await import('../lib/square-invoices.js')
  await testValidation()
  await testSupabaseStore()
  await testCreateSend(createUnpaidInvoice)
  await testLockedRetry(createUnpaidInvoice)
  testSourceShape()
  console.log('verify-maurice-pick: ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
