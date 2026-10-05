'use strict'

const { salesSessionToken, SALES_AUTH_COOKIE } = require('../lib/sales-auth')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function inStock(id, quantity, locationId, state = 'IN_STOCK') {
  return {
    catalog_object_id: id,
    state,
    location_id: locationId,
    quantity
  }
}

async function testQtySelection() {
  const { selectInStockQuantity, formatFridgeQty, isNegativeFridgeQty, FRIDGE_QTY_MISSING } = await import('../lib/gumbo-fridge.js')
  const chicken = 'KSKQ3QG5XO4BNP5DISSCNYGW'
  const counts = [
    inStock(chicken, '2', 'LOC', 'SOLD'),
    inStock(chicken, '-4.00000', 'LOC', 'IN_STOCK'),
    inStock(chicken, '9', 'OTHER', 'IN_STOCK'),
    inStock('OTHER_ID', '5', 'LOC', 'IN_STOCK'),
    { catalog_object_id: 'BLANK', state: 'IN_STOCK', location_id: 'LOC', quantity: '' }
  ]

  assert(selectInStockQuantity(counts, chicken, 'LOC') === '-4.00000', 'IN_STOCK wins over SOLD and other locations')
  assert(selectInStockQuantity(counts, 'MISSING', 'LOC') === null, 'missing variation is null')
  assert(selectInStockQuantity([], chicken, 'LOC') === null, 'empty counts are null')
  assert(selectInStockQuantity(counts, 'BLANK', 'LOC') === null, 'blank IN_STOCK quantity is null, not zero')
  assert(selectInStockQuantity([inStock(chicken, '0', 'LOC')], chicken, 'LOC') === '0', 'real zero stays zero')
  assert(selectInStockQuantity([inStock(chicken, '3', 'LOC', 'WASTE')], chicken) === null, 'non IN_STOCK is missing')
  assert(selectInStockQuantity([inStock(chicken, '9', 'OTHER')], chicken, 'LOC') === null, 'another location is not this fridge')
  assert(selectInStockQuantity([inStock(chicken, 8, 'LOC')], chicken, 'LOC') === '8', 'numeric quantity is kept')

  assert(formatFridgeQty(null) === FRIDGE_QTY_MISSING, 'null displays as an em dash')
  assert(formatFridgeQty('') === FRIDGE_QTY_MISSING, 'blank displays as an em dash')
  assert(formatFridgeQty('-4.00000') === '-4', 'negative Square quantity keeps its sign')
  assert(formatFridgeQty('0.00000') === '0', 'zero does not become an em dash')
  assert(formatFridgeQty('12.50000') === '12.5', 'fractional containers stay')
  assert(isNegativeFridgeQty('-4.00000'), 'negative flag')
  assert(!isNegativeFridgeQty('0'), 'zero is not negative')
  assert(!isNegativeFridgeQty(null), 'missing is not negative')
}

async function testCatalogScope() {
  const { FRIDGE_SIDES } = await import('../lib/gumbo-fridge.js')
  assert(FRIDGE_SIDES.length === 2, 'two fridge columns')
  const wholesale = FRIDGE_SIDES.find(side => side.id === 'wholesale')
  const maurice = FRIDGE_SIDES.find(side => side.id === 'maurice')
  assert(wholesale && maurice, 'wholesale and maurice sides')
  assert(wholesale.account === 'wholesale' && maurice.account === 'wholesale', 'both columns read the wholesale Square account')
  assert(wholesale.items.length === 5 && maurice.items.length === 5, 'five variations each')

  const wholesaleIds = wholesale.items.map(item => item.catalogObjectId)
  const mauriceIds = maurice.items.map(item => item.catalogObjectId)
  assert(wholesaleIds.join(',') === [
    'KSKQ3QG5XO4BNP5DISSCNYGW',
    'GOBEW6URKW5BHTZF36VPCEZC',
    'MXNS46SPRII4UBUGYO6EU6SO',
    '3AAPOGWL6P4D4G63QOWYNZRU',
    '6G4Y6H3OOUBOFGOYHKSTKSUN'
  ].join(','), 'wholesale cafe variation ids')
  assert(mauriceIds.join(',') === [
    'AOETTPKX4HDGAECC6JEYCMLQ',
    'TYC37BA4GITAY5ZXWPWVOK4T',
    'WJ3VTZOM5EIGQOAOG4I7IA4Q',
    'DCIJMUOYFK6T3ATTWEB7RN3U',
    '224MN7JX6PDKRHUNAVNEAOPY'
  ].join(','), 'maurice column uses wholesale Inventory variation ids')
  assert(new Set([...wholesaleIds, ...mauriceIds]).size === 10, 'cafe and inventory ids stay distinct')
  for (const side of FRIDGE_SIDES) {
    assert(side.items.map(item => item.label).join('|') === 'Chicken & Sausage|Seafood|Shrimp & Okra|Signature|Bisque', 'friendly labels')
  }
  assert(wholesale.source === 'Live Square', 'wholesale source copy')
  assert(maurice.source === 'Updated by the nightly order scan-in', 'maurice source copy')
  const fs = require('fs')
  const path = require('path')
  const retired = ['ott', 'er'].join('')
  for (const rel of ['lib/gumbo-fridge.js', 'lib/gumbo-fridge-display.js', 'pages/dashboard.js', 'pages/api/gumbo-fridge.js', 'README.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').toLowerCase()
    assert(!text.includes(retired), `${rel} does not name the retired sync`)
  }
}

function stubDeps(squareFetch, { wholesaleConfigured = true } = {}) {
  return {
    peekAccount(id) {
      assert(id === 'wholesale', 'fridge columns resolve the wholesale Square account')
      return {
        account: 'wholesale',
        label: 'wholesale',
        token: wholesaleConfigured ? 'tok' : null,
        locationId: wholesaleConfigured ? 'LOC_W' : null,
        configured: wholesaleConfigured
      }
    },
    resolveAccount(id) {
      assert(id === 'wholesale', 'resolveAccount stays on wholesale')
      return { account: 'wholesale', token: 'tok', locationId: 'LOC_W', configured: true }
    },
    resolveLocationId(_query, account) {
      return account.locationId
    },
    squareFetch
  }
}

async function testLoad() {
  const { loadGumboFridge, FRIDGE_SIDES } = await import('../lib/gumbo-fridge.js')
  const wholesaleIds = FRIDGE_SIDES[0].items.map(item => item.catalogObjectId)
  const mauriceIds = FRIDGE_SIDES[1].items.map(item => item.catalogObjectId)
  const calls = []

  const loaded = await loadGumboFridge(stubDeps(async (req) => {
    calls.push(req)
    const ids = req.body.catalog_object_ids
    assert(req.path === '/inventory/counts/batch-retrieve', 'batch retrieve path')
    assert(req.method === 'POST', 'batch retrieve method')
    assert(Array.isArray(req.body.location_ids) && req.body.location_ids.length === 1, 'one location')
    assert(req.body.states.length === 1 && req.body.states[0] === 'IN_STOCK', 'request IN_STOCK only')
    if (ids[0] === wholesaleIds[0]) {
      assert(ids.join(',') === wholesaleIds.join(','), 'wholesale request is only the five cafe ids')
      assert(req.body.location_ids[0] === 'LOC_W', 'wholesale location')
      if (!req.body.cursor) {
        return {
          counts: [
            inStock(wholesaleIds[0], '-3', 'LOC_W'),
            inStock(wholesaleIds[0], '4', 'LOC_W', 'SOLD')
          ],
          cursor: 'page-2'
        }
      }
      assert(req.body.cursor === 'page-2', 'follow cursor without widening the id list')
      assert(ids.join(',') === wholesaleIds.join(','), 'cursor page stays on the five ids')
      return { counts: [inStock(wholesaleIds[1], '6.00000', 'LOC_W')] }
    }
    assert(ids.join(',') === mauriceIds.join(','), 'maurice request is only the five inventory ids')
    assert(req.body.location_ids[0] === 'LOC_W', 'maurice inventory also uses wholesale location')
    return { counts: [] }
  }))

  const wholesale = loaded.sides.find(side => side.id === 'wholesale')
  const maurice = loaded.sides.find(side => side.id === 'maurice')
  assert(wholesale.configured && !wholesale.error, 'wholesale loaded')
  assert(wholesale.items[0].quantity === '-3', 'negative wholesale count is kept')
  assert(wholesale.items[1].quantity === '6.00000', 'second page count is kept')
  assert(wholesale.items[2].quantity === null, 'variation with no row is null')
  assert(maurice.configured && !maurice.error, 'maurice loaded with an empty count list')
  assert(maurice.items.every(item => item.quantity === null), 'no count row is null, not zero')
  assert(calls.length === 3, 'two cafe pages plus one inventory request')

  let fetched = false
  const missing = await loadGumboFridge(stubDeps(async () => {
    fetched = true
    return { counts: [] }
  }, { wholesaleConfigured: false }))
  assert(missing.sides.every(side => side.configured === false && side.error === null), 'missing wholesale token marks both columns not configured')
  assert(missing.sides.every(side => side.items.every(item => item.quantity === null)), 'unconfigured sides have no fake zeros')
  assert(!fetched, 'no Square fetch when wholesale is unconfigured')

  const broken = await loadGumboFridge(stubDeps(async (req) => {
    if (req.body.catalog_object_ids[0] === wholesaleIds[0]) {
      throw new Error('Bearer sq0at-SECRET Square down')
    }
    return { counts: [inStock(mauriceIds[3], '2', 'LOC_W')] }
  }))
  const failed = broken.sides.find(side => side.id === 'wholesale')
  const ok = broken.sides.find(side => side.id === 'maurice')
  assert(failed.configured === true && failed.error && !failed.error.includes('SECRET'), 'cafe column error is redacted')
  assert(ok.items.find(item => item.key === 'signature').quantity === '2', 'inventory column still returns when cafe fetch fails')
}

function captureRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
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

async function testRouteAuth() {
  const { gumboFridgeHandler } = await import('../pages/api/gumbo-fridge.js')
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    SALES_DASHBOARD_PIN: process.env.SALES_DASHBOARD_PIN,
    BRIDGE_API_KEY: process.env.BRIDGE_API_KEY
  }
  let loads = 0
  const load = async () => {
    loads += 1
    return { loadedAt: '2026-10-05T18:00:00.000Z', sides: [] }
  }

  try {
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '1'
    process.env.SALES_DASHBOARD_PIN = '2468'
    process.env.BRIDGE_API_KEY = 'bridge-secret'

    const denied = captureRes()
    await gumboFridgeHandler({
      method: 'GET',
      headers: { authorization: 'Bearer bridge-secret' },
      cookies: {}
    }, denied, load)
    assert(denied.statusCode === 401, 'bridge key is not accepted')
    assert(loads === 0, 'rejected request does not load counts')

    const wrongMethod = captureRes()
    await gumboFridgeHandler({ method: 'POST', headers: {}, cookies: {} }, wrongMethod, load)
    assert(wrongMethod.statusCode === 405, 'POST is rejected')
    assert(loads === 0, 'POST does not load counts')

    const token = salesSessionToken('2468')
    const allowed = captureRes()
    await gumboFridgeHandler({
      method: 'GET',
      headers: { authorization: 'Bearer bridge-secret', cookie: `${SALES_AUTH_COOKIE}=${token}` },
      cookies: { [SALES_AUTH_COOKIE]: token }
    }, allowed, load)
    assert(allowed.statusCode === 200, 'sales session cookie is accepted')
    assert(allowed.body.data.loadedAt === '2026-10-05T18:00:00.000Z', 'returns fridge payload')
    assert(loads === 1, 'authorized GET loads once')
    assert(allowed.headers['Cache-Control'] === 'no-store', 'no-store')
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main() {
  await testQtySelection()
  await testCatalogScope()
  await testLoad()
  await testRouteAuth()
  console.log('verify-gumbo-fridge: ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
