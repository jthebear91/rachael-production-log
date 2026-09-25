'use strict'

const fs = require('fs')
const path = require('path')
const { buildPickListPdf } = require('../lib/pick-list-pdf')
const { HEBERTS_PUBLIC_NAME } = require('../lib/public-label')
const { orderKeyBefore } = require('../lib/todoist-order-key')
const { squareSignature } = require('../lib/square-webhook')
const {
  PACKAGE_PROJECT_ID,
  PRACTICE_HEBERTS_MAURICE,
  TAKEOUT_API_PRIORITY,
  assertPullSquareRead,
  buildTaskTitle,
  formatQty,
  handlePullSheets,
  handleReplay,
  handleSquareWebhook
} = require('../lib/wholesale-pull')

const LOCATION = 'L6D106R4VNA72'
const TAKEOUT = '6cv69FrQF2QcqVqw'
const NOTIFICATION_URL = 'https://rachael-production-log.vercel.app/api/square/wholesale-pull/webhook'
const SIGNING_KEY = 'test-key'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function baseEnv(extra = {}) {
  return {
    NODE_ENV: 'test',
    WHOLESALE_PULL_ENABLED: '1',
    SQUARE_WEBHOOK_SIGNATURE_KEY: SIGNING_KEY,
    SQUARE_WEBHOOK_NOTIFICATION_URL: NOTIFICATION_URL,
    SQUARE_WHOLESALE_TOKEN: 'test-token',
    SQUARE_WHOLESALE_LOCATION_ID: LOCATION,
    TODOIST_TOKEN: 'todoist-test',
    TODOIST_TAKEOUT_PROJECT_ID: TAKEOUT,
    ...extra
  }
}

function invoiceFixture() {
  return {
    id: 'inv:hebert-1',
    status: 'UNPAID',
    location_id: LOCATION,
    invoice_number: '1042',
    order_id: 'ORDER_HEBERT',
    created_at: '2026-09-23T03:30:00.000Z',
    primary_recipient: { customer_id: 'CUST_HEBERT' }
  }
}

function orderFixture(extra = {}) {
  return {
    id: 'ORDER_HEBERT',
    location_id: LOCATION,
    state: 'COMPLETED',
    customer_id: 'CUST_HEBERT',
    created_at: '2026-09-23T03:30:00.000Z',
    line_items: [
      {
        name: 'Stuffed Shrimp',
        quantity: '2',
        catalog_object_id: 'VAR_SHRIMP',
        base_price_money: { amount: 1299, currency: 'USD' },
        sku: 'SKU-NO'
      },
      {
        name: 'Seafood Gumbo',
        variation_name: 'Quart',
        quantity: '1.000',
        catalog_object_id: 'VAR_GUMBO'
      }
    ],
    ...extra
  }
}

function squareFetchFor(world) {
  return async ({ method, path: squarePath }) => {
    world.squareCalls += 1
    assert(method === 'GET', `square method ${method}`)
    assert(!String(squarePath).includes('batch'), squarePath)
    if (squarePath.startsWith('/invoices/')) return { invoice: world.invoice }
    if (squarePath.startsWith('/orders/ORDER_CARD')) return { order: world.cardOrder }
    if (squarePath.startsWith('/orders/')) return { order: world.order }
    if (squarePath.startsWith('/payments/PAY_CARD')) return { payment: world.cardPayment }
    if (squarePath.startsWith('/payments/')) return { payment: world.payment }
    if (squarePath.startsWith('/customers/')) {
      return { customer: { id: 'CUST_HEBERT', company_name: "Hebert's Maurice" } }
    }
    if (squarePath.includes('VAR_NONAME')) {
      return {
        object: {
          type: 'ITEM_VARIATION',
          item_variation_data: { name: 'Regular', sku: 'SKU-SECRET', item_id: 'ITEM_NONAME' }
        }
      }
    }
    if (squarePath.includes('ITEM_NONAME')) {
      return { object: { type: 'ITEM', item_data: { sku: 'SKU-SECRET' } } }
    }
    throw new Error(`unexpected square path ${squarePath}`)
  }
}

function memoryStore() {
  const rows = []
  return {
    rows,
    async find(pull) {
      return rows.find(row =>
        row.idempotency_key === pull.idempotencyKey
        || (pull.orderId && row.order_id === pull.orderId)
        || (pull.invoiceId && row.invoice_id === pull.invoiceId)
        || (pull.paymentId && row.payment_id === pull.paymentId)
      ) || null
    },
    async insert(row) {
      if (rows.some(existing => existing.idempotency_key === row.idempotency_key || (row.order_id && existing.order_id === row.order_id))) {
        return { conflict: true }
      }
      const copy = { ...row, lines: row.lines }
      rows.push(copy)
      return { conflict: false, row: copy }
    },
    async update(key, patch) {
      const row = rows.find(existing => existing.idempotency_key === key)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
    async get(key) {
      return rows.find(existing => existing.idempotency_key === key) || null
    },
    async listPending() {
      return rows.filter(row => row.status === 'ready' && row.todoist_task_id)
    },
    async markPrinted(key, now) {
      const row = rows.find(existing => existing.idempotency_key === key)
      if (!row) return null
      if (row.status === 'printed') return row
      if (row.status !== 'ready') return { notReady: true }
      row.status = 'printed'
      row.printed_at = now.toISOString()
      return row
    }
  }
}

function todoistFake() {
  const tasks = [{
    id: 'existing-top',
    content: 'older task',
    description: '',
    section_id: 'sec-left',
    order_key: 'a1',
    child_order: 4,
    project_id: TAKEOUT
  }, {
    id: 'existing-right',
    content: 'right column',
    description: '',
    section_id: 'sec-right',
    order_key: 'a0',
    child_order: 1,
    project_id: TAKEOUT
  }]
  const created = []
  return {
    tasks,
    created,
    async fetch(url, options = {}) {
      const target = String(url)
      if (options.method === 'POST') {
        const body = JSON.parse(options.body)
        created.push(body)
        const task = {
          id: `task-${created.length}`,
          project_id: body.project_id,
          content: body.content,
          description: body.description,
          section_id: body.section_id || null,
          order_key: body.order_key || null,
          child_order: body.child_order
        }
        tasks.push(task)
        return { ok: true, status: 200, text: async () => JSON.stringify(task) }
      }
      if (target.includes('/sections')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            results: [
              { id: 'sec-right', order_key: 'a2' },
              { id: 'sec-left', order_key: 'a0' }
            ]
          })
        }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: tasks }) }
    }
  }
}

function world() {
  return {
    squareCalls: 0,
    invoice: invoiceFixture(),
    order: orderFixture(),
    payment: {
      id: 'PAY_HEBERT',
      status: 'COMPLETED',
      location_id: LOCATION,
      source_type: 'EXTERNAL',
      order_id: 'ORDER_HEBERT',
      customer_id: 'CUST_HEBERT',
      external_details: { type: 'OTHER', source: 'House Account' },
      created_at: '2026-09-23T03:30:00.000Z'
    },
    cardPayment: {
      id: 'PAY_CARD',
      status: 'COMPLETED',
      source_type: 'CARD',
      location_id: LOCATION,
      order_id: 'ORDER_CARD',
      created_at: '2026-09-23T03:30:00.000Z'
    },
    cardOrder: orderFixture({
      id: 'ORDER_CARD',
      tenders: [{ type: 'CARD' }]
    })
  }
}

function signed(body, key = SIGNING_KEY) {
  const raw = JSON.stringify(body)
  return {
    raw,
    signature: squareSignature({ key, notificationUrl: NOTIFICATION_URL, rawBody: raw })
  }
}

async function postEvent(env, store, todoist, event, squareWorld) {
  const { raw, signature } = signed(event)
  return handleSquareWebhook({
    rawBody: raw,
    signature,
    notificationUrl: NOTIFICATION_URL,
    env,
    squareFetch: squareFetchFor(squareWorld),
    store,
    todoistFetch: todoist.fetch,
    now: new Date('2026-09-24T17:00:00.000Z')
  })
}

function testOrderKeys() {
  assert(orderKeyBefore(null) === 'a0', 'empty column')
  assert(orderKeyBefore('a0') === 'Zz' && 'Zz' < 'a0', 'before a0')
  assert(orderKeyBefore('a1') === 'a0' && 'a0' < 'a1', 'before a1')
  assert(orderKeyBefore('a0V') < 'a0V', 'before fraction')
  assert(formatQty('1.000') === '1', 'trim qty')
  assert(formatQty('0') === null, 'drop zero')
  assert(PRACTICE_HEBERTS_MAURICE.orderId === 'gcEI0dtLc3OaueVCwjKKet9vxZRZY', 'heberts order')
  assert(PRACTICE_HEBERTS_MAURICE.paymentId === '968pb1sI3vrL7m7sM77fNWumZtNZY', 'heberts payment')
  assert(PACKAGE_PROJECT_ID === '6cv69FHPW88HVjH8', 'package id stays forbidden')
  assert(TAKEOUT_API_PRIORITY === 4, 'p1 is api priority 4')
}

function testTakeoutTitlesOmitMoney() {
  assert(
    buildTaskTitle({ account: 'Heberts Maurice', kind: 'house account $2,568' }) === 'PULL · Heberts Maurice · house account',
    'strips $2,568 from the kind'
  )
  assert(
    buildTaskTitle({ account: 'Heberts Maurice $2,568.00', reference: 'house account' }) === 'PULL · Heberts Maurice · house account',
    'strips money from the account'
  )
  assert(
    buildTaskTitle({ account: "Hebert's Maurice", kind: '1042' }) === "PULL · Hebert's Maurice · 1042",
    'invoice number stays'
  )
  assert(
    buildTaskTitle({ account: 'Heberts Maurice', kind: '$2,568' }) === 'PULL · Heberts Maurice · order',
    'money-only kind falls back'
  )
  assert(
    buildTaskTitle({ account: 'Cafe', kind: 'USD 2,568' }) === 'PULL · Cafe · order',
    'currency code amount is omitted'
  )
  assert(
    buildTaskTitle({ account: 'Cafe', kind: '€12.50' }) === 'PULL · Cafe · order',
    'euro amount is omitted'
  )
  const samples = [
    buildTaskTitle({ account: 'Heberts Maurice', kind: 'house account $2,568' }),
    buildTaskTitle({ account: 'Heberts Maurice', kind: 'house account 2,568' }),
    buildTaskTitle({ account: "Hebert's $10 Maurice", kind: 'invoice' })
  ]
  for (const title of samples) {
    assert(!/[$€£¥₩₹₱]/.test(title), title)
    assert(!/\d{1,3}(?:,\d{3})+/.test(title), title)
    assert(title.startsWith('PULL · '), title)
  }
  assert(
    buildTaskTitle({ account: HEBERTS_PUBLIC_NAME, kind: 'house account' }) === `PULL · ${HEBERTS_PUBLIC_NAME} · house account`,
    'Hebert public name stays on the title'
  )
  const hebertPdf = buildPickListPdf({
    account: HEBERTS_PUBLIC_NAME,
    dateLabel: 'Sep 24, 2026',
    reference: 'house account',
    lines: [{ qty: '1', name: 'Stuffed Shrimp' }]
  }).toString('latin1')
  assert(hebertPdf.includes(HEBERTS_PUBLIC_NAME), 'pdf account line uses the public name')
  assert(hebertPdf.includes('WHOLESALE'), 'pdf still has the wholesale banner')
}

function testSquareGuard() {
  assertPullSquareRead('GET', '/payments/PAY1')
  assertPullSquareRead('GET', '/orders/ORDER1')
  for (const [method, target] of [
    ['POST', '/payments'],
    ['GET', '/payments'],
    ['GET', '/inventory/changes'],
    ['GET', '/orders/batch-retrieve'],
    ['POST', '/invoices/inv/publish']
  ]) {
    let refused = false
    try {
      assertPullSquareRead(method, target)
    } catch (err) {
      refused = err.status === 500
    }
    assert(refused, `${method} ${target} should be refused`)
  }
}

async function testUnpaidInvoiceCreatesTakeoutTask() {
  const env = baseEnv()
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()
  const first = await postEvent(env, store, todoist, {
    type: 'invoice.published',
    data: { id: 'inv:hebert-1', object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(first.status === 200 && first.json.created === true, JSON.stringify(first.json))
  assert(first.json.priority === 'p1', 'ui priority')
  assert(first.json.projectId === TAKEOUT, first.json.projectId)
  assert(first.json.duplicate === false, 'first is not a duplicate')
  assert(todoist.created.length === 1, 'one task')
  const body = todoist.created[0]
  assert(body.project_id === TAKEOUT, 'takeout project')
  assert(body.project_id !== PACKAGE_PROJECT_ID, 'not package')
  assert(body.priority === 4, `priority ${body.priority}`)
  assert(body.section_id === 'sec-left', body.section_id)
  assert(body.order_key === 'a0' && body.order_key < 'a1', body.order_key)
  assert(body.child_order === 0, `child_order ${body.child_order}`)
  assert(body.content === "PULL · Hebert's Maurice · 1042", body.content)
  assert(!/[$€£¥₩₹₱]/.test(body.content), 'invoice title has no currency symbol')
  assert(body.description.includes('2  Stuffed Shrimp'), 'shrimp line')
  assert(body.description.includes('1  Seafood Gumbo (Quart)'), body.description)
  assert(body.description.includes('square-pull-key: order:ORDER_HEBERT'), 'idempotency key')
  assert(body.description.includes('square-invoice-id: inv:hebert-1'), 'invoice id')
  assert(!body.description.includes('1299'), 'no price')
  assert(!body.description.includes('SKU-NO'), 'no sku')
  assert(!body.content.includes(PACKAGE_PROJECT_ID), 'title is not package')
  const pdf = Buffer.from(store.rows[0].pdf_base64, 'base64').toString('utf8')
  assert(pdf.startsWith('%PDF'), 'pdf header')
  assert(pdf.includes('WHOLESALE'), 'wholesale banner')
  assert(pdf.includes('0 748 612 44 re f'), 'banner spans the page')
  assert(pdf.indexOf('WHOLESALE') < pdf.indexOf('PICK LIST'), 'banner is above the title')
  assert(pdf.includes('Stuffed Shrimp') && pdf.includes('Hebert'), pdf.slice(0, 400))
  assert(pdf.includes('Sep 22, 2026'), 'chicago date')
  assert(!pdf.includes('1299') && !pdf.includes('SKU-NO'), 'pdf has no price or sku')
  assert(store.rows[0].status === 'ready', store.rows[0].status)

  const again = await postEvent(env, store, todoist, {
    type: 'invoice.updated',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(again.json.duplicate === true && again.json.created === false, JSON.stringify(again.json))
  assert(todoist.created.length === 1, 'duplicate webhook did not create a second task')

  const payment = await postEvent(env, store, todoist, {
    type: 'payment.updated',
    data: { object: { payment: { id: 'PAY_HEBERT' } } }
  }, squareWorld)
  assert(payment.json.duplicate === true, JSON.stringify(payment.json))
  assert(todoist.created.length === 1, 'payment event reused the order key')
}

async function testSkipsAndFailClosed() {
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()

  const badSig = await handleSquareWebhook({
    rawBody: '{"type":"invoice.published"}',
    signature: 'nope',
    notificationUrl: NOTIFICATION_URL,
    env: baseEnv(),
    squareFetch: squareFetchFor(squareWorld),
    store,
    todoistFetch: todoist.fetch
  })
  assert(badSig.status === 403, `bad sig ${badSig.status}`)
  assert(squareWorld.squareCalls === 0, 'bad signature does not call square')

  const disabled = await handleSquareWebhook({
    ...signed({ type: 'invoice.published', data: { id: 'inv:hebert-1' } }),
    rawBody: signed({ type: 'invoice.published', data: { id: 'inv:hebert-1' } }).raw,
    signature: signed({ type: 'invoice.published', data: { id: 'inv:hebert-1' } }).signature,
    notificationUrl: NOTIFICATION_URL,
    env: baseEnv({ WHOLESALE_PULL_ENABLED: '' }),
    squareFetch: squareFetchFor(squareWorld),
    store,
    todoistFetch: todoist.fetch
  })
  assert(disabled.status === 200 && disabled.json.skipped === 'disabled', JSON.stringify(disabled.json))
  assert(squareWorld.squareCalls === 0, 'disabled does not call square')

  const prodBypass = await handleSquareWebhook({
    rawBody: '{}',
    signature: '',
    notificationUrl: NOTIFICATION_URL,
    env: baseEnv({ NODE_ENV: 'production', WHOLESALE_PULL_DEV_BYPASS: '1', SQUARE_WEBHOOK_SIGNATURE_KEY: '' }),
    squareFetch: squareFetchFor(squareWorld),
    store,
    todoistFetch: todoist.fetch
  })
  assert(prodBypass.status === 503, 'production bypass is ignored')

  squareWorld.invoice = { ...invoiceFixture(), status: 'DRAFT' }
  const draft = await postEvent(baseEnv(), store, todoist, {
    type: 'invoice.created',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(draft.json.skipped === 'draft', draft.json.skipped)
  assert(todoist.created.length === 0, 'draft creates nothing')

  squareWorld.invoice = { ...invoiceFixture(), status: 'PAID' }
  const paid = await postEvent(baseEnv(), store, todoist, {
    type: 'invoice.updated',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(paid.json.skipped === 'invoice_status', paid.json.skipped)

  squareWorld.invoice = { ...invoiceFixture(), location_id: 'OTHER_LOC' }
  squareWorld.order = orderFixture({ location_id: 'OTHER_LOC' })
  const wrongLoc = await postEvent(baseEnv(), store, todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(wrongLoc.json.skipped === 'location', wrongLoc.json.skipped)

  const card = await postEvent(baseEnv(), store, todoist, {
    type: 'payment.updated',
    data: { object: { payment: { id: 'PAY_CARD' } } }
  }, squareWorld)
  assert(card.json.skipped === 'not_house_account', card.json.skipped)
  assert(todoist.created.length === 0, 'card sale creates nothing')
}

async function expectThrow(run, status) {
  try {
    await run()
  } catch (err) {
    assert(err.status === status, `status ${err.status} ${err.message}`)
    return
  }
  throw new Error(`expected throw ${status}`)
}

async function testFailClosedThrows() {
  const todoist = todoistFake()
  await expectThrow(() => postEvent(baseEnv({ TODOIST_TOKEN: '' }), memoryStore(), todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, world()), 503)
  assert(todoist.created.length === 0, 'no task without token')

  const packageTodoist = todoistFake()
  await expectThrow(() => postEvent(baseEnv({ TODOIST_TAKEOUT_PROJECT_ID: PACKAGE_PROJECT_ID }), memoryStore(), packageTodoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, world()), 503)
  assert(packageTodoist.created.length === 0, 'package project refused')

  await expectThrow(() => postEvent(baseEnv({ TODOIST_TAKEOUT_PROJECT_ID: '' }), memoryStore(), todoistFake(), {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, world()), 503)
}

async function testHouseAccountOrderAndAllCompleted() {
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()
  squareWorld.order = orderFixture({ tenders: [{ type: 'OTHER', note: 'House account' }] })
  const created = await postEvent(baseEnv(), store, todoist, {
    type: 'order.updated',
    data: { object: { order: { id: 'ORDER_HEBERT' } } }
  }, squareWorld)
  assert(created.json.created === true, JSON.stringify(created.json))
  assert(todoist.created[0].priority === 4, 'house account is p1')
  assert(todoist.created[0].content === "PULL · Hebert's Maurice · house account", todoist.created[0].content)
  assert(!todoist.created[0].content.includes('$'), 'house account title has no dollars')

  const cardStore = memoryStore()
  const cardTodoist = todoistFake()
  const cardWorld = world()
  const card = await postEvent(baseEnv({ WHOLESALE_PULL_ALL_COMPLETED: '1' }), cardStore, cardTodoist, {
    type: 'payment.updated',
    data: { object: { payment: { id: 'PAY_CARD' } } }
  }, cardWorld)
  assert(card.json.created === true, JSON.stringify(card.json))
  assert(cardTodoist.created[0].project_id === TAKEOUT, 'all-completed still uses takeout')
}

async function testCreatingLockAndMissingName() {
  const now = new Date('2026-09-24T17:00:00.000Z')
  const store = memoryStore()
  store.rows.push({
    idempotency_key: 'order:ORDER_HEBERT',
    order_id: 'ORDER_HEBERT',
    invoice_id: 'inv:hebert-1',
    status: 'creating',
    todoist_task_id: null,
    created_at: new Date(now.getTime() - 10 * 1000).toISOString()
  })
  const todoist = todoistFake()
  await expectThrow(() => handleSquareWebhook({
    ...(() => {
      const signedEvent = signed({
        type: 'invoice.published',
        data: { object: { invoice: { id: 'inv:hebert-1' } } }
      })
      return { rawBody: signedEvent.raw, signature: signedEvent.signature }
    })(),
    notificationUrl: NOTIFICATION_URL,
    env: baseEnv(),
    squareFetch: squareFetchFor(world()),
    store,
    todoistFetch: todoist.fetch,
    now
  }), 503)
  assert(todoist.created.length === 0, 'in-progress pull does not create a second task')

  const unnamed = world()
  unnamed.order = orderFixture({
    line_items: [{ quantity: '1', catalog_object_id: 'VAR_NONAME', base_price_money: { amount: 500 }, sku: 'SKU-SECRET' }]
  })
  const skipped = await postEvent(baseEnv(), memoryStore(), todoistFake(), {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, unnamed)
  assert(skipped.json.skipped === 'no_lines', skipped.json.skipped)
}

async function testReplayAndSheets() {
  const squareWorld = world()
  const todoist = todoistFake()
  const preview = await handleReplay({
    body: { orderId: PRACTICE_HEBERTS_MAURICE.orderId, apply: false },
    env: baseEnv(),
    squareFetch: async (args) => {
      squareWorld.order = orderFixture({
        id: PRACTICE_HEBERTS_MAURICE.orderId,
        tenders: [{ type: 'OTHER', note: 'House account' }]
      })
      squareWorld.squareCalls += 1
      if (args.path.startsWith('/orders/')) return { order: squareWorld.order }
      if (args.path.startsWith('/customers/')) return { customer: { company_name: "Hebert's Maurice" } }
      throw new Error(args.path)
    },
    store: memoryStore(),
    todoistFetch: todoist.fetch
  })
  assert(preview.status === 200 && preview.json.apply === false, JSON.stringify(preview.json))
  assert(preview.json.priority === 'p1', 'preview priority')
  assert(preview.json.projectId === TAKEOUT, 'preview project')
  assert(preview.json.title.startsWith('PULL · '), preview.json.title)
  assert(todoist.created.length === 0, 'dry run does not create a task')
  const pdf = Buffer.from(preview.json.pdfBase64, 'base64')
  assert(pdf.slice(0, 4).toString() === '%PDF', 'preview pdf')
  assert(!preview.json.description.includes('1299'), 'preview has no price')

  const disabledWorld = world()
  disabledWorld.order = orderFixture({ tenders: [{ type: 'OTHER', note: 'House account' }] })
  const disabledApply = await handleReplay({
    body: { orderId: 'ORDER_HEBERT', apply: true },
    env: baseEnv({ WHOLESALE_PULL_ENABLED: '' }),
    squareFetch: squareFetchFor(disabledWorld),
    store: memoryStore(),
    todoistFetch: todoist.fetch
  })
  assert(disabledApply.status === 403, `apply while disabled ${disabledApply.status}`)

  const store = memoryStore()
  const writer = todoistFake()
  const applied = await handleReplay({
    body: { paymentId: 'PAY_HEBERT', apply: true },
    env: baseEnv(),
    squareFetch: squareFetchFor(world()),
    store,
    todoistFetch: writer.fetch
  })
  assert(applied.json.created === true && applied.json.priority === 'p1', JSON.stringify(applied.json))
  assert(writer.created[0].project_id === TAKEOUT, 'replay writes takeout')

  const sheets = await handlePullSheets({ method: 'GET', query: {}, env: {}, store })
  assert(sheets.json.data.length === 1, 'one pending pdf')
  const file = await handlePullSheets({
    method: 'GET',
    query: { format: 'pdf', key: sheets.json.data[0].key },
    env: {},
    store
  })
  assert(file.pdf.slice(0, 4).toString() === '%PDF', 'download pdf')
  const marked = await handlePullSheets({
    method: 'POST',
    body: { key: sheets.json.data[0].key },
    env: {},
    store,
    now: new Date('2026-09-24T18:00:00.000Z')
  })
  assert(marked.json.status === 'printed', JSON.stringify(marked.json))
  const after = await handlePullSheets({ method: 'GET', query: {}, env: {}, store })
  assert(after.json.data.length === 0, 'printed pull leaves the queue')

  const forced = await handleReplay({
    body: { invoiceId: 'inv:hebert-1', apply: false, force: true },
    env: baseEnv(),
    squareFetch: squareFetchFor({
      ...world(),
      invoice: { ...invoiceFixture(), status: 'PAID' },
      squareCalls: 0
    }),
    store: memoryStore(),
    todoistFetch: todoistFake().fetch
  })
  assert(forced.json.apply === false && forced.json.lines.length === 2, JSON.stringify(forced.json))
}

function testSourceShape() {
  const root = path.join(__dirname, '..')
  const pull = fs.readFileSync(path.join(root, 'lib/wholesale-pull.js'), 'utf8')
  assert(pull.includes('TODOIST_TAKEOUT_PROJECT_ID'), 'takeout env')
  assert(pull.includes('Wholesale pull cannot create Package tasks'), 'package guard')
  assert(!pull.includes('maurice-restock') && !pull.includes('mint_handoff'), 'maurice paths untouched')
  const webhook = fs.readFileSync(path.join(root, 'pages/api/square/wholesale-pull/webhook.js'), 'utf8')
  assert(webhook.includes('bodyParser: false'), 'raw body for the signature')
  assert(!webhook.includes('authorizeBridge'), 'square signs the webhook itself')
  const replay = fs.readFileSync(path.join(root, 'pages/api/wholesale-pull/replay.js'), 'utf8')
  assert(replay.includes('withBridgePost'), 'replay is bridge gated')
  const maurice = fs.readFileSync(path.join(root, 'pages/api/pick/maurice-restock/create.js'), 'utf8')
  assert(maurice.includes('authorizePickMint'), 'maurice mint route still mint-gated')
  assert(!maurice.includes('wholesale-pull'), 'maurice route does not import wholesale pull')
  const replayScript = fs.readFileSync(path.join(root, 'scripts/wholesale-pull-replay.cjs'), 'utf8')
  assert(replayScript.includes('gcEI0dtLc3OaueVCwjKKet9vxZRZY'), 'replay docs the practice order')
  assert(!replayScript.includes('lp ') && !replayScript.includes('lpr'), 'replay script does not print')
}

async function main() {
  testOrderKeys()
  testTakeoutTitlesOmitMoney()
  testSquareGuard()
  await testUnpaidInvoiceCreatesTakeoutTask()
  await testSkipsAndFailClosed()
  await testFailClosedThrows()
  await testHouseAccountOrderAndAllCompleted()
  await testCreatingLockAndMissingName()
  await testReplayAndSheets()
  testSourceShape()
  console.log('verify-wholesale-pull: ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
