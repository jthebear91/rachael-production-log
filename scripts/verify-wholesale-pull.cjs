'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { chicagoISODate } = require('../lib/chicago-time')
const { buildPickListPdf } = require('../lib/pick-list-pdf')
const { buildSignatureInvoicePdf } = require('../lib/signature-invoice-pdf')
const { HEBERTS_PUBLIC_NAME } = require('../lib/public-label')
const { orderKeyBefore } = require('../lib/todoist-order-key')
const { squareSignature } = require('../lib/square-webhook')
const { todoistSignature } = require('../lib/todoist-webhook')
const {
  PACKAGE_PROJECT_ID,
  PRACTICE_HEBERTS_MAURICE,
  TAKEOUT_API_PRIORITY,
  assertPullSquareRead,
  buildTaskTitle,
  formatQty,
  handlePullSheets,
  handleReplay,
  handleSquareWebhook,
  handleTodoistWebhook,
  createSupabasePullStore,
  EXCLUDED_CUSTOMER_IDS
} = require('../lib/wholesale-pull')
const { handleTodoistOAuth } = require('../lib/todoist-oauth')

const LOCATION = 'L6D106R4VNA72'
const TAKEOUT = '6cv69FrQF2QcqVqw'
const NOTIFICATION_URL = 'https://rachael-production-log.vercel.app/api/square/wholesale-pull/webhook'
const SIGNING_KEY = 'test-key'
const TODOIST_SECRET = 'todoist-whsec-test'

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
    TODOIST_WEBHOOK_SECRET: TODOIST_SECRET,
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
      return { customer: world.customer || { id: 'CUST_HEBERT', company_name: "Hebert's Maurice" } }
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
    },
    async findByTodoistTaskId(taskId) {
      return rows.find(existing => existing.todoist_task_id === String(taskId)) || null
    },
    async queueSignature(key, patch) {
      const row = rows.find(existing => existing.idempotency_key === key)
      if (!row) return null
      if (row.signature_status || row.signature_printed_at) return { duplicate: true, row }
      Object.assign(row, patch)
      return { duplicate: false, row }
    },
    async listSignaturePending() {
      return rows.filter(row => row.signature_status === 'ready')
    },
    async markSignaturePrinted(key, now) {
      const row = rows.find(existing => existing.idempotency_key === key)
      if (!row) return null
      if (row.signature_status === 'printed' || row.signature_printed_at) return row
      if (row.signature_status !== 'ready') return { notReady: true }
      row.signature_status = 'printed'
      row.signature_printed_at = now.toISOString()
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

async function postEvent(env, store, todoist, event, squareWorld, now = new Date('2026-09-24T17:00:00.000Z')) {
  const { raw, signature } = signed(event)
  return handleSquareWebhook({
    rawBody: raw,
    signature,
    notificationUrl: NOTIFICATION_URL,
    env,
    squareFetch: squareFetchFor(squareWorld),
    store,
    todoistFetch: todoist.fetch,
    now
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
  assert(body.due_date === '2026-09-24', `due ${body.due_date}`)
  assert(!body.due_datetime && !body.due, 'all-day due_date only')
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
  assert(todoist.created[0].due_date === '2026-09-24', 'duplicate did not replace the due date')

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
  assert(todoist.created[0].due_date === '2026-09-24', 'house account due is chicago today')
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
  assert(cardTodoist.created[0].due_date === '2026-09-24', 'all-completed due is chicago today')
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
  const replayNow = new Date('2026-09-25T04:30:00.000Z')
  const applied = await handleReplay({
    body: { paymentId: 'PAY_HEBERT', apply: true },
    env: baseEnv(),
    squareFetch: squareFetchFor(world()),
    store,
    todoistFetch: writer.fetch,
    now: replayNow
  })
  assert(applied.json.created === true && applied.json.priority === 'p1', JSON.stringify(applied.json))
  assert(writer.created[0].project_id === TAKEOUT, 'replay writes takeout')
  assert(writer.created[0].due_date === '2026-09-24', `replay due follows chicago not utc (${writer.created[0].due_date})`)
  assert(replayNow.toISOString().slice(0, 10) === '2026-09-25', 'fixture instant is the next utc date')

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

function chicagoWorld(orderId, invoiceId) {
  const squareWorld = world()
  squareWorld.invoice = { ...invoiceFixture(), id: invoiceId, order_id: orderId }
  squareWorld.order = orderFixture({ id: orderId })
  return squareWorld
}

async function testTakeoutDueFollowsChicagoMidnight() {
  assert(chicagoISODate(new Date('2026-09-25T04:59:00.000Z')) === '2026-09-24', 'cdt still previous day')
  assert(chicagoISODate(new Date('2026-09-25T05:00:00.000Z')) === '2026-09-25', 'cdt midnight is the new day')
  assert(chicagoISODate(new Date('2026-01-15T05:59:00.000Z')) === '2026-01-14', 'cst still previous day')
  assert(chicagoISODate(new Date('2026-01-15T06:00:00.000Z')) === '2026-01-15', 'cst midnight is the new day')

  const before = new Date('2026-09-25T04:59:00.000Z')
  const after = new Date('2026-09-25T05:00:00.000Z')
  const earlyStore = memoryStore()
  const earlyTodoist = todoistFake()
  const earlyEvent = {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:before-midnight' } } }
  }
  const early = await postEvent(
    baseEnv(),
    earlyStore,
    earlyTodoist,
    earlyEvent,
    chicagoWorld('ORDER_BEFORE', 'inv:before-midnight'),
    before
  )
  assert(early.json.created === true, JSON.stringify(early.json))
  assert(earlyTodoist.created[0].due_date === '2026-09-24', earlyTodoist.created[0].due_date)
  assert(!earlyTodoist.created[0].due_datetime, 'no due time before midnight')

  const again = await postEvent(
    baseEnv(),
    earlyStore,
    earlyTodoist,
    earlyEvent,
    chicagoWorld('ORDER_BEFORE', 'inv:before-midnight'),
    after
  )
  assert(again.json.duplicate === true && again.json.created === false, JSON.stringify(again.json))
  assert(earlyTodoist.created.length === 1, 'midnight duplicate did not create another task')
  assert(earlyTodoist.created[0].due_date === '2026-09-24', 'existing due was left alone')

  const lateTodoist = todoistFake()
  const lateWorld = chicagoWorld('ORDER_AFTER', 'inv:after-midnight')
  const lateCreated = await postEvent(
    baseEnv(),
    memoryStore(),
    lateTodoist,
    {
      type: 'invoice.published',
      data: { object: { invoice: { id: 'inv:after-midnight' } } }
    },
    lateWorld,
    after
  )
  assert(lateCreated.json.created === true, JSON.stringify(lateCreated.json))
  assert(lateTodoist.created[0].due_date === '2026-09-25', lateTodoist.created[0].due_date)

  const winterTodoist = todoistFake()
  const winter = await postEvent(
    baseEnv(),
    memoryStore(),
    winterTodoist,
    {
      type: 'invoice.published',
      data: { object: { invoice: { id: 'inv:winter' } } }
    },
    chicagoWorld('ORDER_WINTER', 'inv:winter'),
    new Date('2026-01-15T05:30:00.000Z')
  )
  assert(winter.json.created === true, JSON.stringify(winter.json))
  assert(winterTodoist.created[0].due_date === '2026-01-14', winterTodoist.created[0].due_date)
  assert(new Date('2026-01-15T05:30:00.000Z').toISOString().slice(0, 10) === '2026-01-15', 'utc date is the next day')
}

function signedTodoist(body, key = TODOIST_SECRET) {
  const raw = JSON.stringify(body)
  return {
    raw,
    signature: todoistSignature({ key, rawBody: raw })
  }
}

function completedEvent(taskId, extra = {}) {
  return {
    event_name: 'item:completed',
    event_data: {
      id: taskId,
      project_id: TAKEOUT,
      content: "PULL · Hebert's Maurice · 1042",
      description: '',
      ...extra
    }
  }
}

async function postComplete(env, store, event, squareWorld) {
  const { raw, signature } = signedTodoist(event)
  return handleTodoistWebhook({
    rawBody: raw,
    signature,
    env,
    store,
    squareFetch: squareWorld ? squareFetchFor(squareWorld) : undefined,
    now: new Date('2026-09-25T18:00:00.000Z')
  })
}

function testSignaturePdfShape() {
  const invoice = buildSignatureInvoicePdf({
    account: "Hebert's Specialty Meats (A Bears)",
    dateLabel: 'Sep 25, 2026',
    reference: '1042',
    documentKind: 'invoice',
    lines: [
      { qty: '2', name: 'Stuffed Shrimp (A Bears)', unitAmount: 1299, lineAmount: 2598, currency: 'USD' },
      { qty: '1', name: 'Seafood Gumbo (Quart)' }
    ],
    totals: {
      currency: 'USD',
      subtotal: 2598,
      tax: 200,
      discount: 50,
      total: 2748,
      documentKind: 'invoice'
    }
  }).toString('latin1')
  assert(invoice.startsWith('%PDF'), 'signature pdf header')
  assert(invoice.includes('INVOICE'), 'invoice banner')
  assert(invoice.includes('0.11 0.16 0.33 rg'), 'invoice banner color')
  assert(!invoice.includes('0.10 0.32 0.24'), 'not the pick-list green')
  assert(!invoice.includes('WHOLESALE'), 'signature pdf has no wholesale banner')
  assert(!invoice.includes('PICK LIST'), 'signature pdf is not a pick list')
  assert(invoice.includes(HEBERTS_PUBLIC_NAME), invoice)
  assert(invoice.includes('Stuffed Shrimp'), 'nickname stripped from the item, name kept')
  assert(!/a bears/i.test(invoice), 'speech nickname stays off the signature pdf')
  assert(invoice.includes('$12.99'), invoice)
  assert(invoice.includes('$25.98'), invoice)
  assert(invoice.includes('Tax') && invoice.includes('$2.00'), 'tax')
  assert(invoice.includes('Discount') && invoice.includes('-$0.50'), 'discount')
  assert(invoice.includes('Total') && invoice.includes('$27.48'), 'total')
  assert(invoice.includes('SIGNATURE'), 'signature line')
  assert(invoice.includes('Sign and date'), 'signature caption')
  assert(!invoice.includes('House account receipt'), 'invoice is not a house receipt')

  const receipt = buildSignatureInvoicePdf({
    account: HEBERTS_PUBLIC_NAME,
    dateLabel: 'Sep 25, 2026',
    reference: 'house account',
    documentKind: 'house_account',
    lines: [{ qty: '2', name: 'Stuffed Shrimp', unitAmount: 1299, lineAmount: 2598, currency: 'USD' }],
    totals: { currency: 'USD', subtotal: 2598, total: 2598, documentKind: 'house_account' }
  }).toString('latin1')
  assert(receipt.includes('SIGNATURE'), 'house account banner')
  assert(receipt.includes('House account receipt'), receipt)
  assert(receipt.includes('0.40 0.12 0.12 rg'), 'receipt banner color')
  assert(!receipt.includes('INVOICE'), 'house receipt is not labeled invoice')
  assert(!receipt.includes('WHOLESALE'), 'house receipt has no wholesale banner')
  assert(receipt.includes('$25.98'), 'house receipt is priced')
  assert(receipt.includes(HEBERTS_PUBLIC_NAME), 'house receipt account')
}

async function testCompleteQueuesSignatureInvoice() {
  const env = baseEnv()
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()
  const created = await postEvent(env, store, todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(created.json.created === true, JSON.stringify(created.json))
  const row = store.rows[0]
  assert(row.todoist_task_id === 'task-1', row.todoist_task_id)
  assert(row.totals && row.totals.priced === true, 'prices captured on the pull')
  assert(row.totals.documentKind === 'invoice', row.totals.documentKind)
  assert(row.totals.total === 2598, `total ${row.totals.total}`)
  assert(row.signature_status == null, 'create does not queue a signature')
  assert(!todoist.created[0].description.includes('1299'), 'task description still has no price')
  const pick = Buffer.from(row.pdf_base64, 'base64').toString('latin1')
  assert(pick.includes('WHOLESALE'), 'pick list banner unchanged')
  assert(!pick.includes('$') && !pick.includes('12.99'), 'pick list still has no prices')

  const callsAfterCreate = squareWorld.squareCalls
  const key = row.idempotency_key
  const before = await handlePullSheets({
    method: 'GET',
    query: { queue: 'signature' },
    env: {},
    store
  })
  assert(before.json.data.length === 0, 'nothing to print before complete')
  const earlyFile = await handlePullSheets({
    method: 'GET',
    query: { format: 'pdf', queue: 'signature', key },
    env: {},
    store
  })
  assert(earlyFile.status === 404, 'signature download is not the pick list')
  const tooSoon = await handlePullSheets({
    method: 'POST',
    body: { key, queue: 'signature' },
    env: {},
    store
  })
  assert(tooSoon.status === 409, `signature mark before queue ${tooSoon.status}`)

  const first = await postComplete(env, store, completedEvent('task-1'), squareWorld)
  assert(first.status === 200 && first.json.queued === true, JSON.stringify(first.json))
  assert(first.json.duplicate === false, 'first complete queues')
  assert(first.json.documentKind === 'invoice', first.json.documentKind)
  assert(squareWorld.squareCalls === callsAfterCreate, 'stored prices skip another Square read')
  assert(row.signature_status === 'ready', row.signature_status)
  assert(row.status === 'ready', 'pick list status stays ready')
  const signature = Buffer.from(row.signature_pdf_base64, 'base64').toString('latin1')
  assert(signature.includes('INVOICE') && signature.includes('$12.99') && signature.includes('SIGNATURE'), signature.slice(0, 500))
  assert(!signature.includes('WHOLESALE'), 'queued pdf is not the pick list')
  assert(!/a bears/i.test(signature), 'queued pdf has no speech nickname')

  const listed = await handlePullSheets({ method: 'GET', query: { queue: 'signature' }, env: {}, store })
  assert(listed.json.data.length === 1 && listed.json.data[0].queue === 'signature', JSON.stringify(listed.json))
  const file = await handlePullSheets({
    method: 'GET',
    query: { format: 'pdf', queue: 'signature', key },
    env: {},
    store
  })
  assert(file.filename.startsWith('SIGNATURE-'), file.filename)
  assert(file.pdf.toString('latin1').includes('INVOICE'), 'download is the signature invoice')
  assert(!file.pdf.toString('latin1').includes('WHOLESALE'), 'download is not the pick list')

  const marker = Buffer.from('%PDF-1.4\nmarker').toString('base64')
  row.signature_pdf_base64 = marker
  const again = await postComplete(env, store, completedEvent('task-1'), squareWorld)
  assert(again.json.duplicate === true && again.json.queued !== true, JSON.stringify(again.json))
  assert(row.signature_pdf_base64 === marker, 'second complete does not replace the pdf')
  assert(squareWorld.squareCalls === callsAfterCreate, 'second complete does not read Square')

  const marked = await handlePullSheets({
    method: 'POST',
    body: { key, queue: 'signature' },
    env: {},
    store,
    now: new Date('2026-09-25T19:00:00.000Z')
  })
  assert(marked.json.status === 'printed' && marked.json.queue === 'signature', JSON.stringify(marked.json))
  assert(row.signature_printed_at, 'printed marker')
  assert(row.status === 'ready', 'signature mark does not print the pick list')
  const after = await handlePullSheets({ method: 'GET', query: { queue: 'signature' }, env: {}, store })
  assert(after.json.data.length === 0, 'printed signature leaves the queue')
  const third = await postComplete(env, store, completedEvent('task-1'), squareWorld)
  assert(third.json.duplicate === true && third.json.signatureStatus === 'printed', JSON.stringify(third.json))
  assert(row.signature_pdf_base64 === marker, 'complete after print does not queue again')

  const picks = await handlePullSheets({ method: 'GET', query: {}, env: {}, store })
  assert(picks.json.data.length === 1, 'pick list is still waiting')
  const pickFile = await handlePullSheets({
    method: 'GET',
    query: { format: 'pdf', key },
    env: {},
    store
  })
  assert(pickFile.filename.startsWith('pick-list-'), pickFile.filename)
  assert(pickFile.pdf.toString('latin1').includes('WHOLESALE'), 'pick download unchanged')
}

async function testHouseAccountSignatureAndLegacyReread() {
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()
  squareWorld.order = orderFixture({ tenders: [{ type: 'OTHER', note: 'House account' }] })
  const created = await postEvent(baseEnv(), store, todoist, {
    type: 'order.updated',
    data: { object: { order: { id: 'ORDER_HEBERT' } } }
  }, squareWorld)
  assert(created.json.created === true, JSON.stringify(created.json))
  assert(store.rows[0].totals.documentKind === 'house_account', store.rows[0].totals.documentKind)
  const done = await postComplete(baseEnv(), store, completedEvent('task-1', {
    content: "PULL · Hebert's Maurice · house account"
  }), squareWorld)
  assert(done.json.queued === true && done.json.documentKind === 'house_account', JSON.stringify(done.json))
  const pdf = Buffer.from(store.rows[0].signature_pdf_base64, 'base64').toString('latin1')
  assert(pdf.includes('House account receipt') && pdf.includes('SIGNATURE'), pdf.slice(0, 400))
  assert(!pdf.includes('INVOICE') && !pdf.includes('WHOLESALE'), 'house receipt banner')
  assert(pdf.includes('$12.99'), 'house receipt uses the order price')

  const legacy = memoryStore()
  legacy.rows.push({
    idempotency_key: 'order:ORDER_HEBERT',
    order_id: 'ORDER_HEBERT',
    invoice_id: 'inv:hebert-1',
    invoice_number: '1042',
    account_name: "Hebert's Maurice",
    reference: '1042',
    pick_date: 'Sep 22, 2026',
    lines: [
      { qty: '2', name: 'Stuffed Shrimp' },
      { qty: '1', name: 'Seafood Gumbo (Quart)' }
    ],
    totals: null,
    status: 'printed',
    todoist_task_id: 'task-legacy',
    pdf_base64: Buffer.from('%PDF-1.4 pick').toString('base64'),
    signature_status: null,
    signature_printed_at: null
  })
  const legacyWorld = world()
  const fromSquare = await postComplete(baseEnv(), legacy, completedEvent('task-legacy'), legacyWorld)
  assert(fromSquare.json.queued === true && fromSquare.json.documentKind === 'invoice', JSON.stringify(fromSquare.json))
  assert(legacyWorld.squareCalls >= 2, `legacy re-read calls ${legacyWorld.squareCalls}`)
  const legacyPdf = Buffer.from(legacy.rows[0].signature_pdf_base64, 'base64').toString('latin1')
  assert(legacyPdf.includes('INVOICE') && legacyPdf.includes('$25.98'), 'legacy row priced from Square')
  assert(!legacyPdf.includes('WHOLESALE'), 'legacy signature is not a pick list')
  const calls = legacyWorld.squareCalls
  const second = await postComplete(baseEnv(), legacy, completedEvent('task-legacy'), legacyWorld)
  assert(second.json.duplicate === true, JSON.stringify(second.json))
  assert(legacyWorld.squareCalls === calls, 'second legacy complete does not read Square again')
}

async function testTodoistWebhookSkips() {
  const store = memoryStore()
  store.rows.push({
    idempotency_key: 'order:ORDER_HEBERT',
    todoist_task_id: 'task-1',
    status: 'ready',
    signature_status: null,
    lines: [{ qty: '1', name: 'Stuffed Shrimp' }],
    totals: { priced: true, total: 100, currency: 'USD', documentKind: 'invoice' },
    account_name: "Hebert's Maurice",
    reference: '1042'
  })

  const bad = await handleTodoistWebhook({
    rawBody: '{"event_name":"item:completed"}',
    signature: 'nope',
    env: baseEnv(),
    store
  })
  assert(bad.status === 403, `bad todoist sig ${bad.status}`)
  assert(store.rows[0].signature_status == null, 'bad signature queues nothing')

  const missing = await handleTodoistWebhook({
    rawBody: '{}',
    signature: '',
    env: baseEnv({ TODOIST_WEBHOOK_SECRET: '' }),
    store
  })
  assert(missing.status === 503, `missing secret ${missing.status}`)

  const prodBypass = await handleTodoistWebhook({
    rawBody: '{}',
    signature: '',
    env: baseEnv({ NODE_ENV: 'production', WHOLESALE_PULL_DEV_BYPASS: '1', TODOIST_WEBHOOK_SECRET: '' }),
    store
  })
  assert(prodBypass.status === 503, 'production bypass is ignored')

  const { raw, signature } = signedTodoist(completedEvent('task-1'))
  const disabled = await handleTodoistWebhook({
    rawBody: raw,
    signature,
    env: baseEnv({ WHOLESALE_PULL_ENABLED: '' }),
    store
  })
  assert(disabled.status === 200 && disabled.json.skipped === 'disabled', JSON.stringify(disabled.json))
  assert(store.rows[0].signature_status == null, 'disabled does not queue')

  const added = await postComplete(baseEnv(), store, {
    event_name: 'item:added',
    event_data: { id: 'task-1', project_id: TAKEOUT }
  })
  assert(added.json.ignored === true, JSON.stringify(added.json))
  assert(store.rows[0].signature_status == null, 'item:added does not queue')

  const packageEvent = await postComplete(baseEnv(), store, completedEvent('task-1', { project_id: PACKAGE_PROJECT_ID }))
  assert(packageEvent.json.skipped === 'not_takeout', JSON.stringify(packageEvent.json))

  const other = await postComplete(baseEnv(), store, completedEvent('task-other'))
  assert(other.json.skipped === 'not_pull', JSON.stringify(other.json))

  const race = await postComplete(baseEnv(), store, completedEvent('task-missing', {
    description: 'square-pull-key: order:NOT_YET'
  }))
  assert(race.status === 503, `unstored pull ${race.status}`)

  await expectThrow(() => handlePullSheets({
    method: 'GET',
    query: { queue: 'maurice' },
    env: {},
    store
  }), 400)
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
  const todoistHook = fs.readFileSync(path.join(root, 'pages/api/wholesale-pull/todoist-webhook.js'), 'utf8')
  assert(todoistHook.includes('bodyParser: false'), 'raw body for the todoist signature')
  assert(todoistHook.includes('x-todoist-hmac-sha256'), 'todoist hmac header')
  assert(!todoistHook.includes('authorizeBridge'), 'todoist signs the webhook itself')
  const sql = fs.readFileSync(path.join(root, 'supabase/wholesale_pulls.sql'), 'utf8')
  assert(sql.includes('signature_pdf_base64'), 'signature pdf column')
  assert(sql.includes('signature_printed_at'), 'signature printed marker')
  assert(sql.includes('wholesale_pulls_todoist_task_id_uidx'), 'task id index')
  const poll = fs.readFileSync(path.join(root, 'scripts/wholesale-pull-mac-poll.sh'), 'utf8')
  assert(poll.includes('SIGNATURE-'), 'signature filename prefix')
  assert(poll.includes('queue=signature'), 'signature queue')
  assert(poll.includes('Brother_HL_L3280CDW_series'), 'brother queue lock')
  assert(poll.includes('MFC-L5915DW is Maurice-only'), 'mfc refusal')
  assert(!poll.includes('MFC-L5915DW_series'), 'poll does not target the mfc queue')
  const docs = fs.readFileSync(path.join(root, 'docs/wholesale-pull.md'), 'utf8')
  assert(docs.includes('TODOIST_WEBHOOK_SECRET'), 'docs name the webhook secret')
  assert(docs.includes('no endpoint'), 'docs name the Square PDF limitation')
  assert(docs.includes('Brother_HL_L3280CDW_series'), 'docs lock the printer')
  assert(docs.includes('Jordan lock 2026-09-25'), 'docs cite the lock')
  const replay = fs.readFileSync(path.join(root, 'pages/api/wholesale-pull/replay.js'), 'utf8')
  assert(replay.includes('withBridgePost'), 'replay is bridge gated')
  assert(!replay.includes('WHOLESALE_PULL_POLL_KEY'), 'replay does not accept the poll key')
  const sheetsRoute = fs.readFileSync(path.join(root, 'pages/api/wholesale-pull/sheets.js'), 'utf8')
  assert(sheetsRoute.includes('authorizeWholesalePullPoll'), 'sheets accept the poll key')
  assert(!sheetsRoute.includes('authorizeBridge'), 'sheets are not bridge-only')
  const authSrc = fs.readFileSync(path.join(root, 'lib/bridge-auth.js'), 'utf8')
  const bridgeFn = authSrc.slice(authSrc.indexOf('export function authorizeBridge'), authSrc.indexOf('export function authorizePickMint'))
  const isBridgeFn = authSrc.slice(authSrc.indexOf('export function isBridgeAuthorized'), authSrc.indexOf('export function authorizeBridge'))
  assert(!bridgeFn.includes('WHOLESALE_PULL_POLL_KEY'), 'bridge auth ignores the poll key')
  assert(!isBridgeFn.includes('WHOLESALE_PULL_POLL_KEY'), 'sales bridge check ignores the poll key')
  const maurice = fs.readFileSync(path.join(root, 'pages/api/pick/maurice-restock/create.js'), 'utf8')
  assert(maurice.includes('authorizePickMint'), 'maurice mint route still mint-gated')
  assert(!maurice.includes('wholesale-pull'), 'maurice route does not import wholesale pull')
  const replayScript = fs.readFileSync(path.join(root, 'scripts/wholesale-pull-replay.cjs'), 'utf8')
  assert(replayScript.includes('gcEI0dtLc3OaueVCwjKKet9vxZRZY'), 'replay docs the practice order')
  assert(!replayScript.includes('lp ') && !replayScript.includes('lpr'), 'replay script does not print')
}

const LAFAYETTE = 'FY8QC4GPN38Q30MJY8QXSGNDFC'
const MAURICE_CAFE = 'TQ8JFGXMZGTY8JNKCY1TV72618'
const NUNUS_YV = 'GFSB4VQXTKPQ84TQCGBTRJMRWM'
const NUNUS_MAURICE = '59K0PJZG791Z0DG3GAFMX0SEPM'

async function testExcludedCustomerCreatesNothing() {
  assert(EXCLUDED_CUSTOMER_IDS[LAFAYETTE], 'lafayette is excluded by default')
  assert(EXCLUDED_CUSTOMER_IDS[MAURICE_CAFE] === "Rachael's Cafe Maurice", 'maurice cafe is excluded by default')
  const store = memoryStore()
  const todoist = todoistFake()
  const squareWorld = world()
  squareWorld.invoice = { ...invoiceFixture(), primary_recipient: { customer_id: LAFAYETTE } }
  squareWorld.order = orderFixture({ customer_id: LAFAYETTE })
  const res = await postEvent(baseEnv(), store, todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(res.json.skipped === 'excluded_customer', JSON.stringify(res.json))
  assert(todoist.created.length === 0, 'excluded customer creates no task')
  assert(store.rows.length === 0, 'excluded customer stores no pick pdf')

  const houseWorld = world()
  houseWorld.payment = { ...houseWorld.payment, customer_id: LAFAYETTE }
  const house = await postEvent(baseEnv(), memoryStore(), todoist, {
    type: 'payment.updated',
    data: { object: { payment: { id: 'PAY_HEBERT' } } }
  }, houseWorld)
  assert(house.json.skipped === 'excluded_customer', JSON.stringify(house.json))

  const envWorld = world()
  const viaEnv = await postEvent(baseEnv({ WHOLESALE_PULL_EXCLUDED_CUSTOMER_IDS: 'OTHER_ID, CUST_HEBERT' }), memoryStore(), todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, envWorld)
  assert(viaEnv.json.skipped === 'excluded_customer', 'env list extends exclusions')
  assert(todoist.created.length === 0, 'still nothing created')

  const orderWorld = world()
  orderWorld.order = orderFixture({
    customer_id: LAFAYETTE,
    tenders: [{ type: 'OTHER', note: 'House Account' }]
  })
  const orderRes = await postEvent(baseEnv(), memoryStore(), todoist, {
    type: 'order.updated',
    data: { object: { order: { id: 'ORDER_HEBERT' } } }
  }, orderWorld)
  assert(orderRes.json.skipped === 'excluded_customer', JSON.stringify(orderRes.json))
  assert(todoist.created.length === 0, 'excluded order creates no task')

  const mauriceWorld = world()
  mauriceWorld.invoice = { ...invoiceFixture(), primary_recipient: { customer_id: MAURICE_CAFE } }
  mauriceWorld.order = orderFixture({ customer_id: MAURICE_CAFE })
  const mauriceStore = memoryStore()
  const maurice = await postEvent(baseEnv(), mauriceStore, todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, mauriceWorld)
  assert(maurice.json.skipped === 'excluded_customer', JSON.stringify(maurice.json))
  assert(mauriceStore.rows.length === 0, 'maurice rollup stores no pick pdf')
  assert(todoist.created.length === 0, 'maurice rollup creates no takeout task')

  const overrideWorld = world()
  overrideWorld.invoice = { ...invoiceFixture(), primary_recipient: { customer_id: 'MAURICE_OVERRIDE' } }
  overrideWorld.order = orderFixture({ customer_id: 'MAURICE_OVERRIDE' })
  const override = await postEvent(baseEnv({ SQUARE_MAURICE_CUSTOMER_ID: 'MAURICE_OVERRIDE' }), memoryStore(), todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, overrideWorld)
  assert(override.json.skipped === 'excluded_customer', JSON.stringify(override.json))
  assert(todoist.created.length === 0, 'maurice customer override creates no task')
}

async function testCanonicalAccountNames() {
  const todoist = todoistFake()
  const squareWorld = world()
  squareWorld.invoice = { ...invoiceFixture(), invoice_number: '000227', primary_recipient: { customer_id: NUNUS_YV } }
  squareWorld.order = orderFixture({ customer_id: NUNUS_YV })
  const res = await postEvent(baseEnv(), memoryStore(), todoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, squareWorld)
  assert(res.json.created === true, JSON.stringify(res.json))
  assert(todoist.created[0].content === "PULL · Nunu's Youngsville · 000227", todoist.created[0].content)
  assert(!todoist.created[0].content.includes('$'), 'no dollars in canonical title')

  const envTodoist = todoistFake()
  const env = baseEnv({
    WHOLESALE_PULL_ACCOUNT_NAMES_JSON: JSON.stringify({ CUST_HEBERT: "Hebert's Specialty Meats (A Bears) $20" })
  })
  const heb = await postEvent(env, memoryStore(), envTodoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, world())
  assert(heb.json.created === true, JSON.stringify(heb.json))
  assert(envTodoist.created[0].content === "PULL · Hebert's Specialty Meats · 1042", envTodoist.created[0].content)
  assert(!/a bears/i.test(envTodoist.created[0].content), 'speech nickname stays off the title')
  assert(!envTodoist.created[0].content.includes('$'), 'mapped dollars stay off the title')

  const mauriceTodoist = todoistFake()
  const mauriceWorld = world()
  mauriceWorld.invoice = {
    ...invoiceFixture(),
    invoice_number: '000310',
    primary_recipient: { customer_id: 'CONTACT_ONLY' }
  }
  mauriceWorld.order = orderFixture({ customer_id: NUNUS_MAURICE })
  mauriceWorld.customer = { id: 'CONTACT_ONLY', company_name: 'Nunus' }
  const maurice = await postEvent(baseEnv(), memoryStore(), mauriceTodoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, mauriceWorld)
  assert(maurice.json.created === true, JSON.stringify(maurice.json))
  assert(mauriceTodoist.created[0].content === "PULL · Nunu's Maurice · 000310", mauriceTodoist.created[0].content)
  assert(!mauriceTodoist.created[0].content.includes('Nunus'), 'square spelling is not the title')
  assert(!mauriceTodoist.created[0].content.includes('$'), 'maurice title has no dollars')

  const hebertsTodoist = todoistFake()
  const hebertsWorld = world()
  hebertsWorld.invoice = { ...invoiceFixture(), primary_recipient: { customer_id: 'HEBERTS_SQUARE' } }
  hebertsWorld.order = orderFixture({ customer_id: 'HEBERTS_SQUARE' })
  hebertsWorld.customer = { id: 'HEBERTS_SQUARE', company_name: 'Heberts' }
  const plain = await postEvent(baseEnv(), memoryStore(), hebertsTodoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, hebertsWorld)
  assert(plain.json.created === true, JSON.stringify(plain.json))
  assert(hebertsTodoist.created[0].content === 'PULL · Heberts · 1042', hebertsTodoist.created[0].content)
  assert(!/a bears/i.test(hebertsTodoist.created[0].content), 'unmapped Heberts has no speech nickname')

  const badMapTodoist = todoistFake()
  const badMapWorld = world()
  badMapWorld.invoice = { ...invoiceFixture(), primary_recipient: { customer_id: NUNUS_YV } }
  badMapWorld.order = orderFixture({ customer_id: NUNUS_YV })
  badMapWorld.customer = { id: NUNUS_YV, company_name: 'Nunus Youngsville' }
  const badMap = await postEvent(baseEnv({
    WHOLESALE_PULL_ACCOUNT_NAMES_JSON: JSON.stringify({ [NUNUS_YV]: '(A Bears)', CUST_HEBERT: { name: 'nope' } })
  }), memoryStore(), badMapTodoist, {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }, badMapWorld)
  assert(badMap.json.created === true, JSON.stringify(badMap.json))
  assert(badMapTodoist.created[0].content === 'PULL · Nunus Youngsville · 1042', badMapTodoist.created[0].content)
  assert(!/a bears/i.test(badMapTodoist.created[0].content), 'nickname-only map is not a title')
  assert(!badMapTodoist.created[0].content.includes(HEBERTS_PUBLIC_NAME), 'nickname-only map is not rewritten to Heberts')
}

async function testSupabaseStoreFilters() {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    return { status: 200, ok: true, text: async () => '[{"idempotency_key":"order:ABC"}]' }
  }
  const store = createSupabasePullStore({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' }, fetchImpl)
  await store.update('order:ABC', { status: 'ready' })
  await store.get('order:ABC')
  await store.findByTodoistTaskId('6hfMWj4XJc897Rrw')
  await store.queueSignature('order:ABC', { signature_status: 'ready' })
  await store.markSignaturePrinted('order:ABC', new Date())
  await store.markPrinted('order:ABC', new Date())
  for (const call of calls) {
    const query = decodeURIComponent(new URL(call.url).search)
    assert(!/=eq\."/.test(query), `plain eq filter must not be quoted: ${query}`)
  }
  assert(decodeURIComponent(calls[0].url).includes('idempotency_key=eq.order:ABC'), calls[0].url)
  assert(decodeURIComponent(calls[2].url).includes('todoist_task_id=eq.6hfMWj4XJc897Rrw'), calls[2].url)
  calls.length = 0
  await store.find({ idempotencyKey: 'order:ABC', orderId: 'ABC' })
  assert(decodeURIComponent(calls[0].url).includes('idempotency_key.eq."order:ABC"'), 'or() list keeps quotes')
}

async function testCompleteFallsBackToPullKey() {
  const env = baseEnv()
  const store = memoryStore()
  await store.insert({
    idempotency_key: 'order:ORDER_HEBERT',
    order_id: 'ORDER_HEBERT',
    invoice_id: 'inv:hebert-1',
    account_name: "Nunu's Youngsville",
    reference: '000227',
    pick_date: 'Sep 28, 2026',
    lines: [{ qty: '2', name: 'Seafood Gumbo (6)', unitAmount: 10200, lineAmount: 20400, currency: 'USD' }],
    totals: { priced: true, total: 20400, subtotal: 20400, currency: 'USD', documentKind: 'invoice' },
    todoist_task_id: null,
    status: 'creating',
    signature_status: null,
    signature_printed_at: null
  })
  const res = await postComplete(env, store, completedEvent('task-lost', {
    description: 'square-pull-key: order:ORDER_HEBERT\nsquare-invoice-id: inv:hebert-1'
  }))
  assert(res.status === 200 && res.json.queued === true, JSON.stringify(res.json))
  assert(store.rows[0].todoist_task_id === 'task-lost', 'task id backfilled')
  const again = await postComplete(env, store, completedEvent('task-lost', {
    description: 'square-pull-key: order:ORDER_HEBERT'
  }))
  assert(again.json.duplicate === true, 'second complete does not requeue')
  const other = await postComplete(env, store, completedEvent('task-other', {
    description: 'square-pull-key: order:ORDER_HEBERT'
  }))
  assert(other.status === 503, 'a different task cannot claim a row that already has a task id')

  const dotted = memoryStore()
  await dotted.insert({
    idempotency_key: 'order:ORDER.DOT',
    order_id: 'ORDER.DOT',
    account_name: "Nunu's Maurice",
    reference: '000310',
    pick_date: 'Sep 28, 2026',
    lines: [{ qty: '1', name: 'Seafood Gumbo', unitAmount: 10200, lineAmount: 10200, currency: 'USD' }],
    totals: { priced: true, total: 10200, subtotal: 10200, currency: 'USD', documentKind: 'invoice' },
    todoist_task_id: null,
    status: 'creating',
    signature_status: null,
    signature_printed_at: null
  })
  const dottedRes = await postComplete(env, dotted, completedEvent('task-dot', {
    description: 'square-pull-key: order:ORDER.DOT'
  }))
  assert(dottedRes.status === 200 && dottedRes.json.queued === true, JSON.stringify(dottedRes.json))
  assert(dotted.rows[0].todoist_task_id === 'task-dot', 'dotted pull key still matches')
}

async function testStoreUpdateMissFailsClosed() {
  const store = memoryStore()
  const realUpdate = store.update.bind(store)
  let calls = 0
  store.update = async (key, patch) => {
    calls += 1
    if (calls === 1) return null
    return realUpdate(key, patch)
  }
  const todoist = todoistFake()
  const event = {
    type: 'invoice.published',
    data: { object: { invoice: { id: 'inv:hebert-1' } } }
  }
  await expectThrow(() => postEvent(baseEnv(), store, todoist, event, world()), 503)
  assert(store.rows.length === 1 && store.rows[0].status === 'creating', 'missed update leaves the creating row')
  assert(!store.rows[0].todoist_task_id && !store.rows[0].pdf_base64, 'missed update stores no task id and no pdf')
  assert(todoist.created.length === 1, 'the Takeout task was still created')
  const retry = await postEvent(baseEnv(), store, todoist, event, world())
  assert(retry.status === 200 && retry.json.duplicate === true && retry.json.pdfStored === true, JSON.stringify(retry.json))
  assert(store.rows[0].status === 'ready', 'retry stores the pick pdf')
  assert(store.rows[0].pdf_base64 && store.rows[0].todoist_task_id, 'retry fills task id and pdf')
  assert(todoist.created.length === 1, 'retry does not create a second task')
}

async function testTodoistOAuthFlow() {
  const env = { TODOIST_CLIENT_ID: 'cid123', TODOIST_WEBHOOK_SECRET: 'csecret' }
  const missing = await handleTodoistOAuth({ query: {}, env: {} })
  assert(missing.status === 503, 'oauth fails closed without client id')
  const start = await handleTodoistOAuth({ query: {}, env, randomState: 'st8', redirectUri: 'https://r.example/cb' })
  assert(start.status === 302, 'start redirects')
  assert(start.location.startsWith('https://app.todoist.com/oauth/authorize?client_id=cid123&scope=data%3Aread&state=st8'), start.location)
  assert(start.cookie.includes('st8') && start.cookie.includes('HttpOnly'), start.cookie)
  const bad = await handleTodoistOAuth({ query: { code: 'c', state: 'nope' }, cookieHeader: 'wp_todoist_oauth_state=st8', env })
  assert(bad.status === 400, 'state mismatch refused')
  let posted = null
  const ok = await handleTodoistOAuth({
    query: { code: 'c0de', state: 'st8' },
    cookieHeader: 'a=b; wp_todoist_oauth_state=st8',
    env,
    redirectUri: 'https://r.example/cb',
    fetchImpl: async (url, options) => {
      posted = { url, body: options.body }
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-should-not-leak' }) }
    }
  })
  assert(ok.status === 200, `exchange ok ${ok.status}`)
  assert(posted.url === 'https://api.todoist.com/oauth/access_token', posted.url)
  assert(posted.body.includes('client_secret=csecret') && posted.body.includes('code=c0de'), posted.body)
  assert(!ok.html.includes('tok-should-not-leak'), 'token never rendered')
  assert(!JSON.stringify(ok).includes('tok-should-not-leak'), 'token never leaves the handler')
  const leaked = await handleTodoistOAuth({
    query: { code: 'c0de', state: 'st8' },
    cookieHeader: 'wp_todoist_oauth_state=st8',
    env,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: `bad ${env.TODOIST_WEBHOOK_SECRET} tok-should-not-leak`, access_token: 'tok-should-not-leak' })
    })
  })
  assert(leaked.status === 502, 'failed exchange is an error')
  assert(!leaked.html.includes('csecret') && !leaked.html.includes('tok-should-not-leak'), leaked.html)
  assert(!JSON.stringify(leaked).includes('tok-should-not-leak'), 'failed exchange does not return the token')
  const denied = await handleTodoistOAuth({ query: { error: 'access_denied' }, env })
  assert(denied.status === 400 && denied.html.includes('access_denied'), 'known oauth errors stay visible')
}

function testPollerCopies() {
  const poll = fs.readFileSync(path.join(__dirname, 'wholesale-pull-mac-poll.sh'), 'utf8')
  assert(poll.includes('COPIES = {"pick": 1, "signature": 2}'), 'signature prints 2 copies, pick 1')
  assert(poll.includes('"lp", "-n", str(copies), "-d", printer'), 'lp passes copies')
  assert(poll.includes('WHOLESALE_PULL_DEST'), 'poller dest is overridable for launchd/TCC')
  assert(poll.includes('WHOLESALE_PULL_POLL_KEY_FILE'), 'poller reads the dedicated key from a file')
  assert(poll.includes('WHOLESALE_PULL_POLL_KEY="${BRIDGE_API_KEY:-}"'), 'poller falls back to the bridge key')
  assert(poll.includes('/Users/Shared/RachaelsWholesalePull/poll.key'), 'shared poll key path is outside Documents')
  assert(poll.includes('Library/Application Support/RachaelsWholesalePull/POLL_KEY'), 'application support poll key path')
  assert(poll.includes('Poll key file must be outside ~/Documents'), 'poller refuses a Documents key file')
  assert(poll.includes('Poll key file must be mode 600'), 'poller requires mode 600')
  assert(poll.includes('os.environ["WHOLESALE_PULL_POLL_KEY"]'), 'downloads use the poll key')
  const plist = fs.readFileSync(path.join(__dirname, 'com.rachaelsseafood.wholesale-pull-poll.plist'), 'utf8')
  assert(!plist.includes('/Documents/'), 'launch agent never touches ~/Documents')
  assert(!plist.includes('MFC'), 'launch agent never targets the mfc')
  assert(!plist.includes('<key>BRIDGE_API_KEY'), 'launch agent does not set the bridge key')
  assert(!plist.includes('BRIDGE_API_KEY_FILE'), 'launch agent does not read the bridge key file')
  assert(plist.includes('WHOLESALE_PULL_POLL_KEY_FILE'), 'launch agent points at the poll key file')
  assert(plist.includes('Brother_HL_L3280CDW_series'), 'launch agent printer is the Brother HL')
  assert(plist.includes('/Users/rachaelsseafood/Library/Application Support/RachaelsWholesalePull/POLL_KEY'), 'poll key lives outside Documents')
  assert(poll.includes('WHOLESALE_QUEUE = "Brother_HL_L3280CDW_series"'), 'poller queue constant')
  assert(!poll.includes('lp", "-d", "'), 'lp destination is the checked printer variable')
  const realUuid = '9670DC09-2362-51D4-8476-38D5001BD500'
  const registrationId = '1c85823c-2c30-4ffb-b905-0241b4daebfe'
  assert(poll.includes(realUuid), 'poller guard uses the wholesale IOPlatformUUID')
  assert(poll.includes('WHOLESALE_PULL_MAC_UUID'), 'poller honors the uuid override')
  assert(poll.split(registrationId).length === 2, 'registration id remains only as a note in the poller')
  assert(!poll.includes('No pending pick lists'), 'empty queue does not log')
  const guardAt = poll.indexOf('Nothing was printed or marked.')
  const curlAt = poll.indexOf('curl -fsS')
  assert(guardAt !== -1 && guardAt < curlAt, 'guard runs before the network poll')
  assert(plist.includes('<key>WHOLESALE_PULL_MAC_UUID</key>'), 'plist sets the uuid override')
  assert(plist.includes(realUuid), 'plist uuid is the wholesale IOPlatformUUID')
  assert(!plist.includes(registrationId), 'plist drops the registration id')
  for (const rel of ['README.md', '.env.example', 'docs/wholesale-pull.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    assert(!text.includes(registrationId), `${rel} still cites the registration id`)
    assert(text.includes(realUuid), `${rel} names the IOPlatformUUID`)
  }
}

function testWholesaleMacGuard() {
  const script = path.join(__dirname, 'wholesale-pull-mac-poll.sh')
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-mac-guard-'))
  const marker = path.join(bin, 'curl-called')
  const dest = path.join(bin, 'sheets')
  const realUuid = '9670DC09-2362-51D4-8476-38D5001BD500'
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' curl >> ${JSON.stringify(marker)}
printf '%s\\n' '{"data":[]}'
`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'id'), `#!/bin/sh
if [ "$1" = "-un" ]; then
  printf '%s\\n' "$WP_TEST_USER"
  exit 0
fi
exec /usr/bin/id "$@"
`, { mode: 0o755 })

  function writeIoreg(uuid) {
    const ioreg = path.join(bin, 'ioreg')
    if (uuid == null) {
      if (fs.existsSync(ioreg)) fs.unlinkSync(ioreg)
      return
    }
    fs.writeFileSync(ioreg, `#!/bin/sh
printf '%s\\n' '    "IOPlatformUUID" = "${uuid}"'
`, { mode: 0o755 })
  }

  function run({ uuid, user, uuidOverride, dry }) {
    writeIoreg(uuid)
    if (fs.existsSync(marker)) fs.unlinkSync(marker)
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOME: bin,
      WHOLESALE_PULL_POLL_KEY: 'test-poll-key',
      WHOLESALE_PULL_DEST: dest,
      WHOLESALE_PULL_PRINTER: 'Brother_HL_L3280CDW_series',
      WP_TEST_USER: user
    }
    delete env.WHOLESALE_PULL_MAC_UUID
    delete env.WHOLESALE_PULL_POLL_KEY_FILE
    delete env.BRIDGE_API_KEY
    delete env.BRIDGE_API_KEY_FILE
    if (uuidOverride !== undefined) env.WHOLESALE_PULL_MAC_UUID = uuidOverride
    const result = spawnSync('bash', dry ? [script, '--dry-run'] : [script], { env, encoding: 'utf8' })
    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      curled: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n').length : 0,
      error: result.error
    }
  }

  try {
    const wrong = run({ uuid: '1C85823C-2C30-4FFB-B905-0241B4DAEBFE', user: 'rachaelsseafood' })
    assert(wrong.status === 1, `registration id must fail, status ${wrong.status} ${wrong.stderr} ${wrong.error}`)
    assert(wrong.stderr.includes('Nothing was printed or marked.'), wrong.stderr)
    assert(wrong.stderr.includes(realUuid), wrong.stderr)
    assert(wrong.curled === 0, 'failed guard must not poll')
    assert(!fs.existsSync(dest), 'failed guard must not create the drop folder')

    const wrongUser = run({ uuid: realUuid, user: 'ubuntu' })
    assert(wrongUser.status === 1 && wrongUser.curled === 0, `wrong user status=${wrongUser.status} curled=${wrongUser.curled} ${wrongUser.stderr}`)
    assert(wrongUser.stderr.includes('Nothing was printed or marked.'), wrongUser.stderr)

    const noIoreg = run({ uuid: null, user: 'rachaelsseafood' })
    assert(noIoreg.status === 1 && noIoreg.curled === 0, `missing ioreg fails closed ${noIoreg.status} curled=${noIoreg.curled} ${noIoreg.stderr}`)

    const match = run({ uuid: realUuid, user: 'rachaelsseafood' })
    assert(match.status === 0, `matching mac empty queue status ${match.status} stderr=${match.stderr} stdout=${match.stdout} ${match.error}`)
    assert(match.stderr === '', `empty queue must not write stderr: ${match.stderr}`)
    assert(match.stdout === '', `empty queue must be quiet: ${match.stdout}`)
    assert(match.curled === 2, `matching mac polls both queues, curled=${match.curled}`)

    const folded = run({ uuid: realUuid.toLowerCase(), user: 'rachaelsseafood' })
    assert(folded.status === 0 && folded.stderr === '' && folded.stdout === '' && folded.curled === 2, `case-insensitive match ${folded.status} ${folded.stderr} curled=${folded.curled}`)

    const override = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
    const overridden = run({ uuid: override.toLowerCase(), user: 'rachaelsseafood', uuidOverride: override })
    assert(overridden.status === 0 && overridden.stderr === '' && overridden.curled === 2, `override match ${overridden.status} ${overridden.stderr} curled=${overridden.curled}`)

    const overrideMiss = run({ uuid: realUuid, user: 'rachaelsseafood', uuidOverride: override })
    assert(overrideMiss.status === 1 && overrideMiss.curled === 0, `override mismatch must not poll ${overrideMiss.status} curled=${overrideMiss.curled} ${overrideMiss.stderr}`)
    assert(overrideMiss.stderr.includes(override), overrideMiss.stderr)
    assert(overrideMiss.stderr.trim().split('\n').length === 1, `guard stderr should be one line: ${overrideMiss.stderr}`)

    const dry = run({ uuid: 'not-the-mac', user: 'someoneelse', dry: true })
    assert(dry.status === 0 && dry.curled === 2 && dry.stderr === '' && dry.stdout === '', `dry-run lists without printing ${dry.status} curled=${dry.curled} stderr=${dry.stderr} stdout=${dry.stdout}`)
  } finally {
    fs.rmSync(bin, { recursive: true, force: true })
  }
}

function captureRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    }
  }
}

async function testWholesalePullPollAuth() {
  const { authorizeBridge, authorizeWholesalePullPoll, isBridgeAuthorized } = await import('../lib/bridge-auth.js')
  const prevBridge = process.env.BRIDGE_API_KEY
  const prevPoll = process.env.WHOLESALE_PULL_POLL_KEY
  const bridge = 'bridge-key-test-value'
  const poll = 'poll-key-test-value'
  const bearer = key => ({ headers: { authorization: `Bearer ${key}` } })
  const alt = key => ({ headers: { 'x-bridge-key': key } })
  try {
    process.env.BRIDGE_API_KEY = bridge
    process.env.WHOLESALE_PULL_POLL_KEY = poll
    assert(authorizeWholesalePullPoll(bearer(poll), captureRes()) === true, 'poll key opens sheets')
    assert(authorizeWholesalePullPoll(bearer(bridge), captureRes()) === true, 'bridge key still opens sheets')
    assert(authorizeWholesalePullPoll(alt(poll), captureRes()) === true, 'poll key via x-bridge-key')
    const wrong = captureRes()
    assert(authorizeWholesalePullPoll(bearer('nope'), wrong) === false, 'wrong key rejected')
    assert(wrong.statusCode === 401, 'wrong poll key is 401')
    const bridgeRes = captureRes()
    assert(authorizeBridge(bearer(poll), bridgeRes) === false, 'poll key does not open the bridge')
    assert(bridgeRes.statusCode === 401, 'poll key on the bridge is 401')
    assert(isBridgeAuthorized(bearer(poll)) === false, 'poll key is not bridge-authorized')
    assert(isBridgeAuthorized(bearer(bridge)) === true, 'bridge key is still bridge-authorized')

    delete process.env.BRIDGE_API_KEY
    assert(authorizeWholesalePullPoll(bearer(poll), captureRes()) === true, 'poll key alone opens sheets')
    const noBridge = captureRes()
    assert(authorizeWholesalePullPoll(bearer(bridge), noBridge) === false, 'unset bridge key is not a sheets fallback')
    assert(noBridge.statusCode === 401, 'missing bridge fallback is 401')

    delete process.env.WHOLESALE_PULL_POLL_KEY
    process.env.BRIDGE_API_KEY = bridge
    assert(authorizeWholesalePullPoll(bearer(bridge), captureRes()) === true, 'bridge key alone opens sheets')
    const noPoll = captureRes()
    assert(authorizeWholesalePullPoll(bearer(poll), noPoll) === false, 'absent poll key is not accepted')
    assert(noPoll.statusCode === 401, 'absent poll key is 401')

    delete process.env.BRIDGE_API_KEY
    const missing = captureRes()
    assert(authorizeWholesalePullPoll(bearer(poll), missing) === false, 'unset keys fail closed')
    assert(missing.statusCode === 503 && missing.body.error === 'Wholesale pull poll is not configured', JSON.stringify(missing.body))
  } finally {
    if (prevBridge === undefined) delete process.env.BRIDGE_API_KEY
    else process.env.BRIDGE_API_KEY = prevBridge
    if (prevPoll === undefined) delete process.env.WHOLESALE_PULL_POLL_KEY
    else process.env.WHOLESALE_PULL_POLL_KEY = prevPoll
  }
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
  await testTakeoutDueFollowsChicagoMidnight()
  testSignaturePdfShape()
  await testCompleteQueuesSignatureInvoice()
  await testHouseAccountSignatureAndLegacyReread()
  await testTodoistWebhookSkips()
  testSourceShape()
  await testExcludedCustomerCreatesNothing()
  await testCanonicalAccountNames()
  await testSupabaseStoreFilters()
  await testCompleteFallsBackToPullKey()
  await testStoreUpdateMissFailsClosed()
  await testTodoistOAuthFlow()
  testPollerCopies()
  testWholesaleMacGuard()
  await testWholesalePullPollAuth()
  console.log('verify-wholesale-pull: ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
