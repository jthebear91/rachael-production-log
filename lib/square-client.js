// Shared Square HTTP client for the production-log app and the /api/square/*
// bridge. GET routes are read-only. Unpaid invoice writes live in
// lib/square-invoices.js and must not call Payments.
//
// Square-Version stays 2024-02-22. CreateOrder, CreateInvoice, and
// PublishInvoice already exist in that version, so invoice writes do not
// bump the header.
//
// Account selection (query `account=`):
//   wholesale  (default) → SQUARE_WHOLESALE_TOKEN + SQUARE_WHOLESALE_LOCATION_ID
//                          fallback: SQUARE_TOKEN + SQUARE_LOCATION_ID
//   lafayette            → SQUARE_LAFAYETTE_TOKEN + SQUARE_LAFAYETTE_LOCATION_ID
//   maurice              → SQUARE_MAURICE_TOKEN + SQUARE_MAURICE_LOCATION_ID
//                          fallback: SQUARE_RESTAURANT_TOKEN + SQUARE_RESTAURANT_LOCATION_ID
//   restaurant           → deprecated alias for maurice
//
// Keep Square-Version in lockstep with pages/api/push-inventory.js.

import {
  ACCOUNT_IDS,
  ACCOUNT_META,
  accountPresence,
  canonicalAccountId,
  peekAccountFromEnv
} from './square-accounts'

export { ACCOUNT_IDS, ACCOUNT_META, accountPresence }

// 2024-02-22 includes Orders + Invoices create/publish. Do not bump for invoice writes.
export const SQUARE_VERSION = '2024-02-22'
export const SQUARE_BASE_URL = 'https://connect.squareup.com/v2'

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function sanitizeErrorMessage(message) {
  return String(message || 'Request failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sq0[a-z]{2}-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/EAAA[A-Za-z0-9]+/g, '[redacted]')
}

export function peekAccount(accountParam, env = process.env) {
  const account = canonicalAccountId(accountParam)
  if (!ACCOUNT_META[account]) {
    throw httpError(400, 'account must be wholesale, lafayette, or maurice')
  }
  return peekAccountFromEnv(account, env)
}

export function resolveAccount(accountParam) {
  const peeked = peekAccount(accountParam)
  if (!peeked.token) {
    const name = peeked.account.charAt(0).toUpperCase() + peeked.account.slice(1)
    throw httpError(503, `${name} Square account is not configured`)
  }
  return peeked
}

export function squareHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Square-Version': SQUARE_VERSION,
    'Content-Type': 'application/json'
  }
}

function squareErrorMessage(data, status) {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null
  const detail = first?.detail || first?.code
  return sanitizeErrorMessage(detail || `Square request failed (${status})`)
}

function mapSquareStatus(status) {
  if (status === 401 || status === 403) return 502
  if (status >= 400 && status < 500) return status
  return 502
}

export async function squareFetch({
  token,
  account,
  path,
  method = 'GET',
  query,
  body
}) {
  const resolvedToken = token || resolveAccount(account).token
  if (!resolvedToken) {
    throw httpError(503, 'Square account is not configured')
  }

  const url = new URL(path.startsWith('http') ? path : `${SQUARE_BASE_URL}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  const res = await fetch(url, {
    method,
    headers: squareHeaders(resolvedToken),
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const text = await res.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (!res.ok) {
        throw httpError(mapSquareStatus(res.status), `Square request failed (${res.status})`)
      }
      throw httpError(502, 'Square returned a non-JSON response')
    }
  }

  if (!res.ok) {
    throw httpError(mapSquareStatus(res.status), squareErrorMessage(data, res.status))
  }
  return data
}

export function parseLimit(value, { fallback = 100, max = 100 } = {}) {
  if (value == null || value === '') return fallback
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n < 1) {
    throw httpError(400, 'limit must be a positive integer')
  }
  return Math.min(n, max)
}

export function parseIsoTimestamp(value, name) {
  if (value == null || value === '') return null
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) {
    throw httpError(400, `${name} must be an ISO-8601 timestamp`)
  }
  return d.toISOString()
}

export function resolveTimeRange(query, { fallbackDays = 7 } = {}) {
  const begin = parseIsoTimestamp(query.begin, 'begin')
  const end = parseIsoTimestamp(query.end, 'end')
  const now = new Date()
  const resolvedEnd = end || now.toISOString()
  const resolvedBegin = begin || new Date(new Date(resolvedEnd).getTime() - fallbackDays * 24 * 60 * 60 * 1000).toISOString()
  if (new Date(resolvedBegin).getTime() > new Date(resolvedEnd).getTime()) {
    throw httpError(400, 'begin must be before end')
  }
  return { begin: resolvedBegin, end: resolvedEnd }
}

export function resolveLocationId(queryLocationId, account) {
  const fromQuery = queryLocationId == null || queryLocationId === ''
    ? null
    : String(queryLocationId)
  const locationId = fromQuery || account.locationId
  if (!locationId) {
    throw httpError(400, `No locationId for ${account.account} account`)
  }
  return locationId
}

export function jsonData(res, data, cursor) {
  const payload = { data }
  if (cursor) payload.cursor = cursor
  res.status(200).json(payload)
}

export function money(m) {
  if (!m || m.amount == null) return null
  return { amount: m.amount, currency: m.currency || 'USD' }
}
