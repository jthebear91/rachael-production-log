// Morning check-in from the wholesale Mac.
//
// POST /api/mac-heartbeat inserts one row into public.wholesale_mac_heartbeat.
// The table already exists. Apply supabase/wholesale_mac_heartbeat.sql only
// on a database that does not have it yet. Writes use SUPABASE_SERVICE_KEY
// the same way pick_tokens and wholesale_pulls do: PostgREST with the
// service role, which bypasses RLS. The anon client in lib/supabase.js is
// not used here.
//
// Do not log MAC_HEARTBEAT_SECRET, the bearer token, or the service key.

import crypto from 'crypto'

const NOTE_MAX = 500
const TEXT_MAX = 500
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

const FIELDS = [
  'check_date',
  'mac_reported_at',
  'hostname',
  'pick_list_found',
  'pick_list_filename',
  'pick_list_mtime',
  'pick_list_has_qr',
  'note'
]

const ALLOWED = new Set(FIELDS)

function safeEqual(a, b) {
  // Hash both sides first so timingSafeEqual always compares equal-length digests.
  const left = crypto.createHash('sha256').update(typeof a === 'string' ? a : '', 'utf8').digest()
  const right = crypto.createHash('sha256').update(typeof b === 'string' ? b : '', 'utf8').digest()
  return crypto.timingSafeEqual(left, right)
}

function configuredSecret(env) {
  const raw = env && env.MAC_HEARTBEAT_SECRET
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

function bearerToken(req) {
  const headers = req && req.headers ? req.headers : {}
  const headerAuth = headers.authorization != null ? headers.authorization : headers.Authorization
  const auth = Array.isArray(headerAuth) ? headerAuth[0] : headerAuth
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return ''
  return auth.slice('Bearer '.length).trim()
}

function invalid(error) {
  return { ok: false, error }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function coerceBody(body) {
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (!trimmed) return invalid('Request body must be a JSON object')
    try {
      return { ok: true, value: JSON.parse(trimmed) }
    } catch {
      return invalid('Request body must be a JSON object')
    }
  }
  if (!isPlainObject(body)) return invalid('Request body must be a JSON object')
  return { ok: true, value: body }
}

function isCalendarDate(value) {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false
  return Number.isFinite(Date.parse(value))
}

function hasControlChar(value, allowNewlines) {
  const pattern = allowNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/
  return pattern.test(value)
}

function readOptionalString(value, name, max, allowNewlines = false) {
  if (value == null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return invalid(`${name} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > max) return invalid(`${name} must be at most ${max} characters`)
  if (hasControlChar(trimmed, allowNewlines)) return invalid(`${name} contains invalid characters`)
  return { ok: true, value: trimmed }
}

function readOptionalTimestamp(value, name) {
  if (value == null || value === '') return { ok: true, value: null }
  if (!isIsoTimestamp(value)) return invalid(`${name} must be an ISO-8601 timestamp`)
  return { ok: true, value: value }
}

function readOptionalBoolean(value, name) {
  if (value == null || value === '') return { ok: true, value: null }
  if (typeof value !== 'boolean') return invalid(`${name} must be a boolean`)
  return { ok: true, value: value }
}

export function parseHeartbeatBody(body) {
  const coerced = coerceBody(body)
  if (!coerced.ok) return coerced
  const input = coerced.value
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) return invalid(`Unexpected field: ${key}`)
  }
  if (!isCalendarDate(input.check_date)) return invalid('check_date must be YYYY-MM-DD')
  if (typeof input.pick_list_found !== 'boolean') return invalid('pick_list_found must be a boolean')

  const macReportedAt = readOptionalTimestamp(input.mac_reported_at, 'mac_reported_at')
  if (!macReportedAt.ok) return macReportedAt
  const hostname = readOptionalString(input.hostname, 'hostname', TEXT_MAX)
  if (!hostname.ok) return hostname
  const filename = readOptionalString(input.pick_list_filename, 'pick_list_filename', TEXT_MAX)
  if (!filename.ok) return filename
  const mtime = readOptionalTimestamp(input.pick_list_mtime, 'pick_list_mtime')
  if (!mtime.ok) return mtime
  const hasQr = readOptionalBoolean(input.pick_list_has_qr, 'pick_list_has_qr')
  if (!hasQr.ok) return hasQr
  const note = readOptionalString(input.note, 'note', NOTE_MAX, true)
  if (!note.ok) return note

  return {
    ok: true,
    row: {
      check_date: input.check_date,
      mac_reported_at: macReportedAt.value,
      hostname: hostname.value,
      pick_list_found: input.pick_list_found,
      pick_list_filename: filename.value,
      pick_list_mtime: mtime.value,
      pick_list_has_qr: hasQr.value,
      note: note.value
    }
  }
}

function normalizeSupabaseUrl(value) {
  let url = typeof value === 'string' ? value.trim() : ''
  url = url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  return url
}

function storeError(publicMessage) {
  const err = new Error(publicMessage)
  err.status = 503
  err.publicMessage = publicMessage
  return err
}

function normalizeId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const n = Number(value)
    if (Number.isSafeInteger(n) && n > 0) return n
  }
  return null
}

export async function insertHeartbeat(row, env = process.env, fetchImpl = globalThis.fetch) {
  const url = normalizeSupabaseUrl(env && env.NEXT_PUBLIC_SUPABASE_URL)
  const key = typeof (env && env.SUPABASE_SERVICE_KEY) === 'string' ? env.SUPABASE_SERVICE_KEY.trim() : ''
  if (!url || !key) throw storeError('Heartbeat store is not configured')

  let res
  try {
    res = await fetchImpl(`${url}/rest/v1/wholesale_mac_heartbeat`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    })
  } catch {
    throw storeError('Heartbeat was not recorded')
  }

  const text = await res.text()
  if (!res.ok) throw storeError('Heartbeat was not recorded')
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw storeError('Heartbeat was not recorded')
  }
  const id = normalizeId(Array.isArray(data) && data[0] ? data[0].id : null)
  if (id == null) throw storeError('Heartbeat was not recorded')
  return id
}

function jsonError(res, status, error) {
  return res.status(status).json({ error })
}

export async function macHeartbeatHandler(req, res, deps = {}) {
  const env = deps.env || process.env
  const insert = deps.insert || (row => insertHeartbeat(row, env, deps.fetch))
  res.setHeader('Cache-Control', 'no-store')
  if (!req || req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return jsonError(res, 405, 'Method not allowed')
  }

  const secret = configuredSecret(env)
  if (!secret) return jsonError(res, 503, 'Heartbeat is not configured')
  if (!safeEqual(bearerToken(req), secret)) return jsonError(res, 401, 'Unauthorized')

  const parsed = parseHeartbeatBody(req.body)
  if (!parsed.ok) return jsonError(res, 400, parsed.error)

  try {
    const id = await insert(parsed.row)
    if (!Number.isSafeInteger(id) || id < 1) return jsonError(res, 503, 'Heartbeat was not recorded')
    return res.status(200).json({ ok: true, id })
  } catch (err) {
    const message = err && err.publicMessage === 'Heartbeat store is not configured'
      ? 'Heartbeat store is not configured'
      : 'Heartbeat was not recorded'
    return jsonError(res, 503, message)
  }
}

export { NOTE_MAX, TEXT_MAX }
