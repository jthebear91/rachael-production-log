'use strict'

const fs = require('fs')
const path = require('path')
const {
  addCalendarDays,
  assertSquareWritePath,
  buildPublishInvoiceBody,
  buildUnpaidInvoiceBody,
  buildUnpaidOrderBody,
  chicagoISODate,
  parseInvoiceWriteRequest
} = require('../lib/invoice-write')
const {
  findAllowlistEntry,
  loadAllowlist,
  normalizePhone
} = require('../lib/wholesale-text-allowlist')
const { parseWholesaleText } = require('../lib/wholesale-text-parse')
const {
  evaluateTwilioAuth,
  twilioSignature,
  validateTwilioSignature
} = require('../lib/twilio-webhook')
const {
  UNAUTHORIZED_REPLY,
  decideInbound,
  handleWholesaleInbound
} = require('../lib/wholesale-text-inbound')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testAllowlist() {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'wholesale-text-allowlist.json'), 'utf8'))
  assert(Array.isArray(file) && file.length === 0, 'committed allowlist is empty')

  const loaded = loadAllowlist({})
  assert(loaded.ok && loaded.entries.length === 0, 'loader returns empty file')
  assert(findAllowlistEntry('+13375550100', loaded.entries) === null, 'empty allowlist misses')

  assert(normalizePhone('(337) 555-0100') === '+13375550100', '10-digit US')
  assert(normalizePhone('13375550100') === '+13375550100', '11-digit US')
  assert(normalizePhone('+1 337-555-0100') === '+13375550100', 'formatted E.164')
  assert(normalizePhone('+447911123456') === '+447911123456', 'non-US E.164')
  assert(normalizePhone('555') === null, 'short number rejected')

  const override = loadAllowlist({
    WHOLESALE_TEXT_ALLOWLIST_JSON: JSON.stringify([
      {
        phone: '(337) 555-0100',
        label: "Hebert's Broussard",
        squareCustomerId: 'CUST1',
        notifyPhones: ['3375550199']
      },
      { phone: 'not-a-phone', label: 'skip' }
    ])
  })
  assert(override.ok && override.entries.length === 1, 'override parses one good entry')
  const hit = findAllowlistEntry('+13375550100', override.entries)
  assert(hit && hit.label === "Hebert's Broussard" && hit.squareCustomerId === 'CUST1', 'lookup')
  assert(hit.notifyPhones[0] === '+13375550199', 'notify phone normalized')
  assert(!loadAllowlist({ WHOLESALE_TEXT_ALLOWLIST_JSON: '{' }).ok, 'bad override fails closed')
  assert(!loadAllowlist({ WHOLESALE_TEXT_ALLOWLIST_JSON: '{"phone":"+13375550100"}' }).ok, 'non-array fails closed')
}

function testParser() {
  const parsed = parseWholesaleText('2x stuffed shrimp\nnope\n3 x gumbo')
  assert(parsed.needs_review === true, 'v1 always needs review')
  assert(parsed.lines.length === 2, 'two qty lines')
  assert(parsed.lines[0].quantity === '2' && parsed.lines[0].name === 'stuffed shrimp', 'first line')
  assert(parsed.lines.every(line => line.catalogObjectId == null), 'no invented catalog ids')
  const empty = parseWholesaleText('hello')
  assert(empty.lines.length === 0 && empty.needs_review === true, 'unparsed body')
}

function testInvoiceRequest() {
  const now = new Date('2026-09-22T18:00:00.000Z')
  assert(chicagoISODate(now) === '2026-09-22', `chicago date ${chicagoISODate(now)}`)
  assert(addCalendarDays('2026-09-22', 2) === '2026-09-24', 'add days')
  const late = new Date('2026-09-22T04:30:00.000Z')
  assert(chicagoISODate(late) === '2026-09-21', 'chicago previous evening')

  const ok = parseInvoiceWriteRequest({
    customerId: 'CUST1',
    lines: [{ catalogObjectId: 'VAR1', quantity: '2' }],
    idempotencyKey: 'order-1',
    dueDays: 2
  }, now)
  assert(ok.ok && ok.value.account === 'wholesale', 'default wholesale')
  assert(ok.value.dueDate === '2026-09-24', `due ${ok.value.dueDate}`)

  const order = buildUnpaidOrderBody({ ...ok.value, locationId: 'LOC1' })
  assert(order.order.state === 'OPEN', 'open order')
  assert(!Object.prototype.hasOwnProperty.call(order.order, 'tenders'), 'no tenders')
  assert(order.order.line_items[0].catalog_object_id === 'VAR1', 'variation id')
  assert(order.order.line_items[0].quantity === '2', 'quantity')
  assert(!Object.prototype.hasOwnProperty.call(order.order.line_items[0], 'base_price_money'), 'no price')
  assert(order.order.pricing_options.auto_apply_discounts === false, 'no auto discounts')
  assert(order.order.pricing_options.auto_apply_taxes === false, 'no auto taxes')

  const invoice = buildUnpaidInvoiceBody({ ...ok.value, locationId: 'LOC1', orderId: 'ORD1' })
  assert(invoice.invoice.delivery_method === 'SHARE_MANUALLY', 'manual share')
  assert(invoice.invoice.payment_requests[0].automatic_payment_source === 'NONE', 'no auto charge')
  assert(invoice.invoice.store_payment_method_enabled === false, 'do not store cards')
  assert(!JSON.stringify(invoice).includes('card_id'), 'no card id')
  assert(!JSON.stringify(invoice).includes('source_id'), 'no source id')
  assert(invoice.idempotency_key === 'order-1:invoice', 'invoice idempotency')
  const publish = buildPublishInvoiceBody({ idempotencyKey: 'order-1', version: 0 })
  assert(publish.version === 0 && publish.idempotency_key === 'order-1:publish', 'publish body')

  const lafayette = parseInvoiceWriteRequest({
    account: 'lafayette',
    customerId: 'CUST1',
    lines: [{ catalogObjectId: 'VAR1', quantity: '1' }],
    idempotencyKey: 'k1'
  }, now)
  assert(!lafayette.ok && lafayette.status === 400, 'lafayette refused')
  const maurice = parseInvoiceWriteRequest({
    account: 'restaurant',
    customerId: 'CUST1',
    lines: [{ catalogObjectId: 'VAR1', quantity: '1' }],
    idempotencyKey: 'k1'
  }, now)
  assert(!maurice.ok, 'maurice alias refused')

  const payment = parseInvoiceWriteRequest({
    customerId: 'CUST1',
    source_id: 'cnon:card-nonce',
    lines: [{ catalogObjectId: 'VAR1', quantity: '1' }],
    idempotencyKey: 'k1'
  }, now)
  assert(!payment.ok && payment.error === 'Payment fields are not accepted', payment.error)
  const priced = parseInvoiceWriteRequest({
    customerId: 'CUST1',
    lines: [{ catalogObjectId: 'VAR1', quantity: '1', base_price_money: { amount: 100 } }],
    idempotencyKey: 'k1'
  }, now)
  assert(!priced.ok && priced.error === 'Payment fields are not accepted', priced.error)
  const missingKey = parseInvoiceWriteRequest({
    customerId: 'CUST1',
    lines: [{ catalogObjectId: 'VAR1', quantity: '1' }]
  }, now)
  assert(!missingKey.ok && missingKey.error === 'idempotencyKey is required', missingKey.error)

  assertSquareWritePath('/orders')
  assertSquareWritePath('/invoices/inv123/publish')
  assertSquareWritePath('/catalog/object/VAR1')
  let refused = false
  try {
    assertSquareWritePath('/payments')
  } catch (err) {
    refused = err.status === 500
  }
  assert(refused, 'payments path refused')
}

function testTwilioSignature() {
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
  const params = {
    To: '+18005551212',
    From: '+14158675310',
    Digits: '1234',
    Caller: '+14158675310',
    CallSid: 'CA1234567890ABCDE'
  }
  const signature = twilioSignature({ authToken: '12345', url, params })
  assert(signature === 'GvWf1cFY/Q7PnoempGyD5oXAezc=', signature)
  assert(validateTwilioSignature({ authToken: '12345', signature, url, params }), 'valid signature')
  assert(!validateTwilioSignature({ authToken: '12345', signature: `${signature}x`, url, params }), 'bad signature')
}

async function testInbound() {
  let invoiceCalls = 0
  const createInvoice = async () => {
    invoiceCalls += 1
    throw new Error('Square must not be called')
  }

  const unconfigured = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    params: { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' },
    env: { NODE_ENV: 'production' },
    createInvoice
  })
  assert(unconfigured.status === 503, 'production without Twilio is 503')
  assert(invoiceCalls === 0, 'no invoice on 503')

  const bypassIgnored = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    params: { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' },
    env: { NODE_ENV: 'production', WHOLESALE_TEXT_DEV_BYPASS: '1' },
    createInvoice
  })
  assert(bypassIgnored.status === 503, 'bypass does not work in production')

  const devClosed = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    params: { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' },
    env: { NODE_ENV: 'development' },
    createInvoice
  })
  assert(devClosed.status === 503, 'dev without bypass is 503')

  const unknown = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    params: { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' },
    env: { NODE_ENV: 'test', WHOLESALE_TEXT_DEV_BYPASS: '1' },
    createInvoice
  })
  assert(unknown.status === 200 && unknown.xml.includes(UNAUTHORIZED_REPLY), 'unknown number')
  assert(unknown.headers['X-Wholesale-Text-Dev-Bypass'] === '1', 'dev bypass marked')
  assert(invoiceCalls === 0, 'unknown number does not invoice')

  const known = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    params: { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' },
    env: {
      NODE_ENV: 'test',
      WHOLESALE_TEXT_DEV_BYPASS: '1',
      WHOLESALE_TEXT_ALLOWLIST_JSON: JSON.stringify([
        { phone: '+13375550100', label: "Hebert's Broussard", squareCustomerId: 'CUST1', notifyPhones: [] }
      ])
    },
    createInvoice
  })
  assert(known.status === 200, 'known number 200')
  assert(known.xml.includes('needs staff review'), known.xml)
  assert(known.xml.includes('No invoice was created'), 'review ack')
  assert(known.xml.includes('2x stuffed shrimp'), 'echoes parsed line')
  assert(invoiceCalls === 0, 'stub parser does not invoice')

  const token = '12345'
  const url = 'https://rachael-production-log.vercel.app/api/wholesale-text/twilio/inbound'
  const params = { From: '+19995550100', Body: 'hello', MessageSid: 'SM12345678' }
  const signature = twilioSignature({ authToken: token, url, params })
  const signed = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    signature,
    url,
    params,
    env: {
      NODE_ENV: 'production',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: token
    },
    createInvoice
  })
  assert(signed.status === 200 && signed.xml.includes(UNAUTHORIZED_REPLY), 'signed unknown number')
  assert(invoiceCalls === 0, 'signed unknown does not invoice')

  const badSig = evaluateTwilioAuth({
    env: { NODE_ENV: 'production', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: token, WHOLESALE_TEXT_DEV_BYPASS: '1' },
    signature: 'nope',
    url,
    params
  })
  assert(badSig.ok === false && badSig.status === 403, 'bad signature is 403 even if bypass flag set')

  const decision = decideInbound({
    entry: {
      phone: '+13375550100',
      label: "Hebert's Broussard",
      squareCustomerId: 'CUST1',
      notifyPhones: []
    },
    parsed: {
      needs_review: false,
      lines: [{ quantity: '2', name: 'stuffed shrimp', catalogObjectId: 'VAR1' }]
    },
    messageSid: 'SM12345678'
  })
  assert(decision.action === 'invoice', 'future parser can invoice')
  assert(decision.invoiceRequest.account === 'wholesale', 'wholesale account')
  assert(!JSON.stringify(decision.invoiceRequest).includes('source_id'), 'decision has no source')
  assert(!JSON.stringify(decision.invoiceRequest).includes('amount'), 'decision has no amount')

  const reviewLocked = decideInbound({
    entry: {
      phone: '+13375550100',
      label: "Hebert's Broussard",
      squareCustomerId: 'CUST1',
      notifyPhones: []
    },
    parsed: parseWholesaleText('2x stuffed shrimp'),
    messageSid: 'SM12345678'
  })
  assert(reviewLocked.action === 'review', 'v1 parse stays review')

  let notifyUrl = ''
  const notifyParams = { From: '+13375550100', Body: '2x stuffed shrimp', MessageSid: 'SM12345678' }
  const notifyUrlSigned = 'https://rachael-production-log.vercel.app/api/wholesale-text/twilio/inbound'
  const notifyToken = 'token'
  const notified = await handleWholesaleInbound({
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    signature: twilioSignature({ authToken: notifyToken, url: notifyUrlSigned, params: notifyParams }),
    url: notifyUrlSigned,
    params: notifyParams,
    env: {
      NODE_ENV: 'test',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: notifyToken,
      TWILIO_FROM_NUMBER: '+15550001111',
      WHOLESALE_TEXT_NOTIFY_PHONES: '+15550002222',
      WHOLESALE_TEXT_ALLOWLIST_JSON: JSON.stringify([
        { phone: '+13375550100', label: "Hebert's Broussard", squareCustomerId: 'CUST1', notifyPhones: [] }
      ])
    },
    createInvoice,
    fetchImpl: async (url) => {
      notifyUrl = url
      assert(!String(url).includes('squareup.com'), 'notify must not call Square')
      assert(!String(url).toLowerCase().includes('payment'), 'notify must not call payments')
      return { ok: true }
    }
  })
  assert(notified.status === 200, 'notify path still acks')
  assert(notifyUrl.includes('/Accounts/AC123/Messages.json'), notifyUrl)
  assert(invoiceCalls === 0, 'notify path does not invoice')
}

function testSourceShape() {
  const root = path.join(__dirname, '..')
  const payments = fs.readFileSync(path.join(root, 'pages/api/square/payments.js'), 'utf8')
  assert(payments.includes('withSalesSensitiveGet'), 'payments stay GET-gated')
  assert(!payments.includes('withBridgePost'), 'payments have no write wrapper')
  assert(!payments.includes('CreatePayment') && !payments.includes('CompletePayment'), 'payments route does not create payments')

  const createRoute = fs.readFileSync(path.join(root, 'pages/api/square/invoices/create.js'), 'utf8')
  assert(createRoute.includes('withBridgePost'), 'invoice create uses bridge POST auth')
  assert(createRoute.includes('createUnpaidInvoice'), 'invoice create handler')

  const writer = fs.readFileSync(path.join(root, 'lib/square-invoices.js'), 'utf8')
  assert(!writer.includes('CreatePayment(') && !writer.includes('CompletePayment('), 'writer does not call payment APIs')
  assert(!writer.includes("'/payments'") && !writer.includes('"/payments"'), 'writer does not call payments path')
  assert(writer.includes("resolve('wholesale')") || writer.includes('resolve("wholesale")'), 'writer forces wholesale')
}

async function main() {
  testAllowlist()
  testParser()
  testInvoiceRequest()
  testTwilioSignature()
  await testInbound()
  testSourceShape()
  console.log('verify-wholesale-text: ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
