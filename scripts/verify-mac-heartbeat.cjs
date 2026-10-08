'use strict'

const fs = require('fs')
const path = require('path')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
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

function post(body, headers = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', ...headers },
    body
  }
}

const validBody = {
  check_date: '2026-10-08',
  mac_reported_at: '2026-10-08T09:30:00.000Z',
  hostname: 'wholesale-mac',
  pick_list_found: true,
  pick_list_filename: '2026-10-08 Thursday Pick List QR.pdf',
  pick_list_mtime: '2026-10-08T07:15:00-05:00',
  pick_list_has_qr: true,
  note: 'found the QR file'
}

function envWith(extra = {}) {
  return {
    MAC_HEARTBEAT_SECRET: 'test-secret',
    NEXT_PUBLIC_SUPABASE_URL: 'https://sbsqnzqswodxanbddoks.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-role-key',
    ...extra
  }
}

async function testAuthAndMethod() {
  const { macHeartbeatHandler } = await import('../lib/mac-heartbeat.js')
  const route = await import('../pages/api/mac-heartbeat.js')
  assert(route.macHeartbeatHandler === macHeartbeatHandler, 'route re-exports the handler')
  assert(typeof route.default === 'function', 'route default export is a function')

  let inserts = 0
  const insert = async () => {
    inserts += 1
    return 1
  }
  const secret = 'test-secret'

  const logs = []
  const originals = {}
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[name] = console[name]
    console[name] = (...args) => logs.push(args.map(String).join(' '))
  }

  try {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const res = captureRes()
      await route.default({
        method,
        headers: { authorization: `Bearer ${secret}` },
        body: validBody
      }, res)
      assert(res.statusCode === 405, `${method} is 405`)
      assert(res.headers.Allow === 'POST', `${method} sets Allow: POST`)
      assert(res.body.error === 'Method not allowed', `${method} error body`)
      assert(res.headers['Cache-Control'] === 'no-store', `${method} is no-store`)
    }
    assert(inserts === 0, 'non-POST does not insert')

    const unconfigured = captureRes()
    await macHeartbeatHandler(post(validBody), unconfigured, {
      env: envWith({ MAC_HEARTBEAT_SECRET: '   ' }),
      insert
    })
    assert(unconfigured.statusCode === 503, 'blank secret is 503')
    assert(unconfigured.body.error === 'Heartbeat is not configured', 'blank secret message')

    const missingSecret = captureRes()
    await macHeartbeatHandler(post(validBody), missingSecret, {
      env: envWith({ MAC_HEARTBEAT_SECRET: undefined }),
      insert
    })
    assert(missingSecret.statusCode === 503, 'missing secret is 503')
    assert(inserts === 0, 'unconfigured secret does not insert')

    const noHeader = captureRes()
    await macHeartbeatHandler({ method: 'POST', headers: {}, body: validBody }, noHeader, {
      env: envWith(),
      insert
    })
    assert(noHeader.statusCode === 401, 'missing Authorization is 401')
    assert(noHeader.body.error === 'Unauthorized', 'missing header message')

    const wrong = captureRes()
    await macHeartbeatHandler(post(validBody, { authorization: 'Bearer test-secre' }), wrong, {
      env: envWith(),
      insert
    })
    assert(wrong.statusCode === 401, 'short wrong secret is 401')

    const prefix = captureRes()
    await macHeartbeatHandler(post(validBody, { authorization: 'Bearer test-secret-extra' }), prefix, {
      env: envWith(),
      insert
    })
    assert(prefix.statusCode === 401, 'longer wrong secret is 401')

    const otherHeader = captureRes()
    await macHeartbeatHandler({
      method: 'POST',
      headers: { 'x-bridge-key': secret },
      body: validBody
    }, otherHeader, { env: envWith(), insert })
    assert(otherHeader.statusCode === 401, 'x-bridge-key is not accepted')

    const basic = captureRes()
    await macHeartbeatHandler(post(validBody, { authorization: `Basic ${secret}` }), basic, {
      env: envWith(),
      insert
    })
    assert(basic.statusCode === 401, 'non-Bearer scheme is 401')

    const headerList = captureRes()
    await macHeartbeatHandler({
      method: 'POST',
      headers: { authorization: [`Bearer ${secret}`, 'Bearer other'] },
      body: validBody
    }, headerList, { env: envWith(), insert })
    assert(headerList.statusCode === 200, 'first Authorization header value is used')
    assert(headerList.body.id === 1, 'array header still inserts')

    assert(inserts === 1, 'only the accepted call inserted')
    const dumped = JSON.stringify(logs)
    assert(!dumped.includes(secret), 'logs do not contain the secret')
    assert(!dumped.includes('service-role-key'), 'logs do not contain the service key')
  } finally {
    for (const [name, fn] of Object.entries(originals)) console[name] = fn
  }
}

async function testValidation() {
  const { macHeartbeatHandler, NOTE_MAX } = await import('../lib/mac-heartbeat.js')
  const secret = 'test-secret'
  let inserted = null
  const insert = async row => {
    inserted = row
    return 7
  }
  const deps = { env: envWith(), insert }

  async function expectStatus(body, status, label, headers) {
    inserted = null
    const res = captureRes()
    await macHeartbeatHandler(post(body, headers), res, deps)
    assert(res.statusCode === status, `${label} -> ${res.statusCode}, expected ${status} (${JSON.stringify(res.body)})`)
    if (status !== 200) assert(inserted == null, `${label} does not insert`)
    return res
  }

  const ok = await expectStatus(validBody, 200, 'valid body')
  assert(ok.body.ok === true && ok.body.id === 7, '200 returns ok and id')
  assert(Object.keys(ok.body).join(',') === 'ok,id', 'success body has only ok and id')
  assert(inserted.pick_list_found === true, 'stores pick_list_found true')
  assert(inserted.check_date === '2026-10-08', 'stores the Mac date unchanged')
  assert(inserted.pick_list_mtime === '2026-10-08T07:15:00-05:00', 'stores the offset timestamp')
  assert(inserted.note === 'found the QR file', 'stores the note')

  const minimal = await expectStatus({ check_date: '2026-02-28', pick_list_found: false }, 200, 'required fields only')
  assert(minimal.body.id === 7, 'minimal body still returns an id')
  assert(inserted.pick_list_found === false, 'false is stored')
  assert(inserted.hostname == null && inserted.note == null, 'omitted optionals are null')
  assert(inserted.pick_list_filename == null && inserted.pick_list_has_qr == null, 'omitted file fields are null')
  assert(inserted.mac_reported_at == null && inserted.pick_list_mtime == null, 'omitted timestamps are null')

  await expectStatus({ ...validBody, note: '', hostname: null, pick_list_has_qr: null }, 200, 'empty optionals')
  assert(inserted.note == null && inserted.hostname == null && inserted.pick_list_has_qr == null, 'empty optionals store null')

  const jsonText = await expectStatus(JSON.stringify({ check_date: '2024-02-29', pick_list_found: true }), 200, 'JSON string body')
  assert(jsonText.body.ok === true, 'parsed string body is accepted')
  assert(inserted.check_date === '2024-02-29', 'leap day is a real date')

  await expectStatus(undefined, 400, 'missing body')
  await expectStatus(null, 400, 'null body')
  await expectStatus('not-json', 400, 'invalid JSON string')
  await expectStatus([], 400, 'array body')
  await expectStatus({ pick_list_found: true }, 400, 'missing check_date')
  await expectStatus({ check_date: '2026-02-31', pick_list_found: true }, 400, 'impossible date')
  await expectStatus({ check_date: '10/08/2026', pick_list_found: true }, 400, 'slashed date')
  await expectStatus({ check_date: '2026-10-08T00:00:00Z', pick_list_found: true }, 400, 'date-time is not a date')
  await expectStatus({ check_date: '2026-10-08', pick_list_found: 'true' }, 400, 'string boolean')
  await expectStatus({ check_date: '2026-10-08' }, 400, 'missing pick_list_found')
  await expectStatus({ ...validBody, mac_reported_at: '2026-10-08 09:30:00' }, 400, 'timestamp without timezone')
  await expectStatus({ ...validBody, pick_list_mtime: 'yesterday' }, 400, 'bad mtime')
  await expectStatus({ ...validBody, pick_list_has_qr: 'yes' }, 400, 'string has_qr')
  await expectStatus({ ...validBody, hostname: 12 }, 400, 'numeric hostname')
  await expectStatus({ ...validBody, extra: true }, 400, 'unknown field')
  await expectStatus({ ...validBody, note: 'a'.repeat(NOTE_MAX + 1) }, 400, 'note over 500')
  await expectStatus({ ...validBody, hostname: 'mac\nname' }, 400, 'hostname newline')

  const multiline = await expectStatus({ ...validBody, note: 'line\nline' }, 200, 'note may contain a newline')
  assert(multiline.body.ok === true && inserted.note === 'line\nline', 'newline note is stored')

  const secretNote = await expectStatus({
    ...validBody,
    note: `${secret}${'n'.repeat(NOTE_MAX)}`
  }, 400, 'note over 500 containing the secret')
  assert(!JSON.stringify(secretNote.body).includes(secret), '400 body does not echo the secret')

  const exactly = await expectStatus({ ...validBody, note: 'b'.repeat(NOTE_MAX) }, 200, 'note at 500')
  assert(exactly.body.ok === true, '500-character note is accepted')

  const leaked = captureRes()
  await macHeartbeatHandler(post(validBody), leaked, {
    env: envWith(),
    insert: async () => {
      throw new Error(`Bearer ${secret} SUPABASE failed`)
    }
  })
  assert(leaked.statusCode === 503, 'insert throw is 503')
  assert(leaked.body.error === 'Heartbeat was not recorded', 'insert failure message is fixed')
  assert(!JSON.stringify(leaked.body).includes(secret), '503 body does not include the secret')

  const badId = captureRes()
  await macHeartbeatHandler(post(validBody), badId, {
    env: envWith(),
    insert: async () => 0
  })
  assert(badId.statusCode === 503, 'non-positive id is 503')
}

async function testInsert() {
  const { insertHeartbeat, macHeartbeatHandler } = await import('../lib/mac-heartbeat.js')
  const row = {
    check_date: '2026-10-08',
    mac_reported_at: null,
    hostname: 'wholesale-mac',
    pick_list_found: false,
    pick_list_filename: null,
    pick_list_mtime: null,
    pick_list_has_qr: false,
    note: null
  }

  let called = null
  const id = await insertHeartbeat(row, envWith({
    NEXT_PUBLIC_SUPABASE_URL: 'https://sbsqnzqswodxanbddoks.supabase.co/rest/v1/'
  }), async (url, options) => {
    called = { url, options }
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify([{ id: '42' }])
      }
    }
  })
  assert(id === 42, 'numeric string id is returned as a number')
  assert(called.url === 'https://sbsqnzqswodxanbddoks.supabase.co/rest/v1/wholesale_mac_heartbeat', 'rest url is normalized')
  assert(called.options.method === 'POST', 'insert is POST')
  assert(called.options.headers.apikey === 'service-role-key', 'service role apikey')
  assert(called.options.headers.Authorization === 'Bearer service-role-key', 'service role bearer')
  assert(called.options.headers.Prefer === 'return=representation', 'asks for the new row')
  assert(JSON.parse(called.options.body).pick_list_found === false, 'posts the row')
  assert(!Object.prototype.hasOwnProperty.call(JSON.parse(called.options.body), 'id'), 'does not send id')

  let failed = false
  try {
    await insertHeartbeat(row, envWith({ SUPABASE_SERVICE_KEY: '  ' }), async () => {
      failed = true
      return { ok: true, status: 201, async text() { return '[{"id":1}]' } }
    })
  } catch (err) {
    assert(err.publicMessage === 'Heartbeat store is not configured', 'missing service key message')
    assert(err.status === 503, 'missing service key status')
  }
  assert(!failed, 'missing service key does not fetch')

  try {
    await insertHeartbeat(row, envWith(), async () => ({
      ok: false,
      status: 401,
      async text() { return '{"message":"Invalid API key service-role-key"}' }
    }))
    throw new Error('expected insert failure')
  } catch (err) {
    assert(err.publicMessage === 'Heartbeat was not recorded', 'supabase error is generic')
    assert(!String(err.message).includes('service-role-key'), 'thrown message does not include the service key')
  }

  const res = captureRes()
  await macHeartbeatHandler(post({ check_date: '2026-10-08', pick_list_found: true }), res, {
    env: envWith({ NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' })
  })
  assert(res.statusCode === 503, 'handler maps a missing store to 503')
  assert(res.body.error === 'Heartbeat store is not configured', 'handler store message')
  assert(!JSON.stringify(res.body).includes('service-role-key'), 'handler store error has no key')
}

function testSource() {
  const src = fs.readFileSync(path.join(__dirname, '../lib/mac-heartbeat.js'), 'utf8')
  const route = fs.readFileSync(path.join(__dirname, '../pages/api/mac-heartbeat.js'), 'utf8')
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/wholesale_mac_heartbeat.sql'), 'utf8')
  assert(src.includes('crypto.timingSafeEqual'), 'compare uses timingSafeEqual')
  assert(!/console\./.test(src), 'heartbeat lib does not log')
  assert(!/console\./.test(route), 'heartbeat route does not log')
  assert(src.includes('MAC_HEARTBEAT_SECRET'), 'secret env var is read')
  assert(sql.includes('wholesale_mac_heartbeat'), 'schema names the table')
  assert(sql.includes('enable row level security'), 'schema enables RLS')
  assert(!route.includes('wholesale-pull') && !route.includes('maurice'), 'route stays off the other features')
}

async function main() {
  await testAuthAndMethod()
  await testValidation()
  await testInsert()
  testSource()
  console.log('verify-mac-heartbeat: ok')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
