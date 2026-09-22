// Maurice restock pick tokens.
//
// This repo has no Vercel KV or Blob client. Batch rows already persist
// through Supabase REST with SUPABASE_SERVICE_KEY (see pages/api/get-batches.js).
// Pick tokens use that same key and a dedicated `pick_tokens` table.
// Apply supabase/pick_tokens.sql once. The anon key in lib/supabase.js is
// not used here — RLS has no policies, so only the service role can read
// or write the table.
//
// PICK_STORE=memory is a single-process fallback for local dev and tests.
// It is ignored when NODE_ENV=production or VERCEL=1.
// Next compiles each route as its own bundle, so a module-level Map is not
// shared. The rows live on globalThis so create, the phone page, and Send
// see the same token inside one Node process.

const STATUS_OPEN = 'open'
const MEMORY_KEY = Symbol.for('rachael.mauricePickMemoryStore')

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function clone(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function cloneRow(row) {
  return {
    token: row.token,
    status: row.status,
    lines: clone(row.lines) || [],
    printDay: row.printDay || null,
    pickDate: row.pickDate || null,
    estimatedTotal: row.estimatedTotal || null,
    createInvoice: row.createInvoice === true,
    note: row.note || null,
    sentLines: clone(row.sentLines) || null,
    occurredAt: row.occurredAt || null,
    invoiceId: row.invoiceId || null,
    invoiceNumber: row.invoiceNumber || null,
    orderId: row.orderId || null,
    publicUrl: row.publicUrl || null,
    notify: clone(row.notify) || null,
    createdAt: row.createdAt,
    sentAt: row.sentAt || null
  }
}

function createMemoryPickStore() {
  const rows = new Map()
  return {
    kind: 'memory',
    async insert(record) {
      if (rows.has(record.token)) throw httpError(409, 'Pick token already exists')
      const row = cloneRow(record)
      rows.set(record.token, row)
      return cloneRow(row)
    },
    async get(token) {
      const row = rows.get(token)
      return row ? cloneRow(row) : null
    },
    async claim(token, patch) {
      const row = rows.get(token)
      if (!row || row.status !== STATUS_OPEN) return null
      row.status = 'sending'
      row.sentLines = clone(patch.sentLines)
      row.occurredAt = patch.occurredAt
      return cloneRow(row)
    },
    async markSent(token, patch) {
      const row = rows.get(token)
      if (!row) return null
      if (row.status === 'sent') return cloneRow(row)
      if (row.status !== 'sending') return null
      row.status = 'sent'
      row.invoiceId = patch.invoiceId || null
      row.invoiceNumber = patch.invoiceNumber || null
      row.orderId = patch.orderId || null
      row.publicUrl = patch.publicUrl || null
      row.notify = clone(patch.notify) || null
      row.sentAt = patch.sentAt || null
      return cloneRow(row)
    },
    async release(token) {
      const row = rows.get(token)
      if (!row || row.status !== 'sending') return null
      row.status = 'open'
      row.sentLines = null
      row.occurredAt = null
      return cloneRow(row)
    }
  }
}

function normalizeSupabaseUrl(value) {
  let url = typeof value === 'string' ? value.trim() : ''
  url = url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
  return url
}

function toDb(record) {
  return {
    token: record.token,
    status: record.status,
    lines: record.lines,
    print_day: record.printDay || null,
    pick_date: record.pickDate || null,
    estimated_total: record.estimatedTotal || null,
    create_invoice: record.createInvoice === true,
    note: record.note || null,
    sent_lines: record.sentLines || null,
    occurred_at: record.occurredAt || null,
    invoice_id: record.invoiceId || null,
    invoice_number: record.invoiceNumber || null,
    order_id: record.orderId || null,
    public_url: record.publicUrl || null,
    notify: record.notify || null,
    created_at: record.createdAt,
    sent_at: record.sentAt || null
  }
}

function fromDb(row) {
  if (!row) return null
  return cloneRow({
    token: row.token,
    status: row.status,
    lines: row.lines,
    printDay: row.print_day,
    pickDate: row.pick_date,
    estimatedTotal: row.estimated_total,
    createInvoice: row.create_invoice === true,
    note: row.note,
    sentLines: row.sent_lines,
    occurredAt: row.occurred_at,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    orderId: row.order_id,
    publicUrl: row.public_url,
    notify: row.notify,
    createdAt: row.created_at,
    sentAt: row.sent_at
  })
}

function mapSupabaseError(status, text) {
  const body = String(text || '')
  if (/pick_tokens/i.test(body) && /does not exist|schema cache/i.test(body)) {
    return httpError(503, 'pick_tokens table is missing. Apply supabase/pick_tokens.sql')
  }
  if (status === 401 || status === 403) {
    return httpError(503, 'Pick store rejected the Supabase service key')
  }
  if (status === 409) return httpError(409, 'Pick token already exists')
  return httpError(503, 'Pick store request failed')
}

function createSupabasePickStore(env = process.env, fetchImpl = global.fetch) {
  const url = normalizeSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  const key = typeof env.SUPABASE_SERVICE_KEY === 'string' ? env.SUPABASE_SERVICE_KEY.trim() : ''
  if (!url || !key) return null

  async function rest({ method, query, body }) {
    const endpoint = new URL(`${url}/rest/v1/pick_tokens`)
    if (query) {
      for (const [name, value] of Object.entries(query)) {
        endpoint.searchParams.set(name, value)
      }
    }
    const res = await fetchImpl(endpoint, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    if (!res.ok) throw mapSupabaseError(res.status, text)
    if (!text) return []
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw httpError(503, 'Pick store request failed')
    }
    return Array.isArray(data) ? data : []
  }

  return {
    kind: 'supabase',
    async insert(record) {
      const rows = await rest({ method: 'POST', body: toDb(record) })
      if (!rows[0]) throw httpError(503, 'Pick store request failed')
      return fromDb(rows[0])
    },
    async get(token) {
      const rows = await rest({
        method: 'GET',
        query: { select: '*', token: `eq.${token}`, limit: '1' }
      })
      return fromDb(rows[0])
    },
    async claim(token, patch) {
      const rows = await rest({
        method: 'PATCH',
        query: { token: `eq.${token}`, status: 'eq.open' },
        body: {
          status: 'sending',
          sent_lines: patch.sentLines,
          occurred_at: patch.occurredAt
        }
      })
      return fromDb(rows[0])
    },
    async markSent(token, patch) {
      const rows = await rest({
        method: 'PATCH',
        query: { token: `eq.${token}`, status: 'eq.sending' },
        body: {
          status: 'sent',
          invoice_id: patch.invoiceId || null,
          invoice_number: patch.invoiceNumber || null,
          order_id: patch.orderId || null,
          public_url: patch.publicUrl || null,
          notify: patch.notify || null,
          sent_at: patch.sentAt || null
        }
      })
      if (rows[0]) return fromDb(rows[0])
      const current = await rest({
        method: 'GET',
        query: { select: '*', token: `eq.${token}`, limit: '1' }
      })
      const row = fromDb(current[0])
      if (row && row.status === 'sent') return row
      return null
    },
    async release(token) {
      const rows = await rest({
        method: 'PATCH',
        query: { token: `eq.${token}`, status: 'eq.sending' },
        body: { status: 'open', sent_lines: null, occurred_at: null }
      })
      return fromDb(rows[0])
    }
  }
}

function memoryAllowed(env) {
  if (String(env.PICK_STORE || '') !== 'memory') return false
  if (env.NODE_ENV === 'production') return false
  if (String(env.VERCEL || '') === '1') return false
  return true
}

function resolvePickStore(env = process.env, fetchImpl = global.fetch) {
  const supabase = createSupabasePickStore(env, fetchImpl)
  if (supabase) return supabase
  if (!memoryAllowed(env)) return null
  if (!globalThis[MEMORY_KEY]) globalThis[MEMORY_KEY] = createMemoryPickStore()
  return globalThis[MEMORY_KEY]
}

function resetDevMemoryStore() {
  delete globalThis[MEMORY_KEY]
}

module.exports = {
  createMemoryPickStore,
  createSupabasePickStore,
  resolvePickStore,
  resetDevMemoryStore,
  normalizeSupabaseUrl
}
