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
    pricedLines: clone(row.pricedLines) || null,
    notify: clone(row.notify) || null,
    createdAt: row.createdAt,
    sentAt: row.sentAt || null
  }
}

function createMemoryPickStore() {
  const rows = new Map()
  const weeks = new Map()
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
      row.pricedLines = clone(patch.pricedLines) || null
      row.notify = clone(patch.notify) || null
      row.sentAt = patch.sentAt || null
      return cloneRow(row)
    },
    async listSentByPickDate(fromDate, toDate) {
      const found = []
      for (const row of rows.values()) {
        if (row.status !== 'sent' || !row.pickDate) continue
        if (row.pickDate >= fromDate && row.pickDate <= toDate) found.push(cloneRow(row))
      }
      found.sort((a, b) => String(a.pickDate).localeCompare(String(b.pickDate)))
      return found
    },
    async getWeekInvoice(weekStart) {
      const row = weeks.get(weekStart)
      return row ? clone(row) : null
    },
    async insertWeekInvoice(record) {
      if (weeks.has(record.weekStart)) return null
      const row = clone(record)
      weeks.set(record.weekStart, row)
      return clone(row)
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
    priced_lines: record.pricedLines || null,
    notify: record.notify || null,
    created_at: record.createdAt,
    sent_at: record.sentAt || null
  }
}

function weekToDb(record) {
  return {
    week_start: record.weekStart,
    week_end: record.weekEnd,
    invoice_id: record.invoiceId || null,
    invoice_number: record.invoiceNumber || null,
    order_id: record.orderId || null,
    public_url: record.publicUrl || null,
    customer_id: record.customerId || null,
    lines: record.lines || [],
    logged_total: record.loggedTotal || null,
    pick_count: record.pickCount || 0,
    dry_run_skipped: record.dryRunSkipped || 0,
    created_at: record.createdAt
  }
}

function weekFromDb(row) {
  if (!row) return null
  return {
    weekStart: row.week_start,
    weekEnd: row.week_end,
    invoiceId: row.invoice_id || null,
    invoiceNumber: row.invoice_number || null,
    orderId: row.order_id || null,
    publicUrl: row.public_url || null,
    customerId: row.customer_id || null,
    lines: clone(row.lines) || [],
    loggedTotal: row.logged_total || null,
    pickCount: row.pick_count || 0,
    dryRunSkipped: row.dry_run_skipped || 0,
    createdAt: row.created_at
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
    pricedLines: row.priced_lines,
    notify: row.notify,
    createdAt: row.created_at,
    sentAt: row.sent_at
  })
}

function mapSupabaseError(status, text) {
  const body = String(text || '')
  if (/pick_week_invoices/i.test(body) && /does not exist|schema cache/i.test(body)) {
    return httpError(503, 'pick_week_invoices table is missing. Apply supabase/pick_tokens.sql')
  }
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

  async function rest(table, { method, query, body }) {
    const endpoint = new URL(`${url}/rest/v1/${table}`)
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
      const rows = await rest('pick_tokens', { method: 'POST', body: toDb(record) })
      if (!rows[0]) throw httpError(503, 'Pick store request failed')
      return fromDb(rows[0])
    },
    async get(token) {
      const rows = await rest('pick_tokens', {
        method: 'GET',
        query: { select: '*', token: `eq.${token}`, limit: '1' }
      })
      return fromDb(rows[0])
    },
    async claim(token, patch) {
      const rows = await rest('pick_tokens', {
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
      const rows = await rest('pick_tokens', {
        method: 'PATCH',
        query: { token: `eq.${token}`, status: 'eq.sending' },
        body: {
          status: 'sent',
          invoice_id: null,
          invoice_number: null,
          order_id: null,
          public_url: null,
          priced_lines: patch.pricedLines || null,
          notify: patch.notify || null,
          sent_at: patch.sentAt || null
        }
      })
      if (rows[0]) return fromDb(rows[0])
      const current = await rest('pick_tokens', {
        method: 'GET',
        query: { select: '*', token: `eq.${token}`, limit: '1' }
      })
      const row = fromDb(current[0])
      if (row && row.status === 'sent') return row
      return null
    },
    async release(token) {
      const rows = await rest('pick_tokens', {
        method: 'PATCH',
        query: { token: `eq.${token}`, status: 'eq.sending' },
        body: { status: 'open', sent_lines: null, occurred_at: null }
      })
      return fromDb(rows[0])
    },
    async listSentByPickDate(fromDate, toDate) {
      const rows = await rest('pick_tokens', {
        method: 'GET',
        query: {
          select: '*',
          status: 'eq.sent',
          and: `(pick_date.gte.${fromDate},pick_date.lte.${toDate})`,
          order: 'pick_date.asc',
          limit: '200'
        }
      })
      return rows.map(fromDb).filter(Boolean)
    },
    async getWeekInvoice(weekStart) {
      const rows = await rest('pick_week_invoices', {
        method: 'GET',
        query: { select: '*', week_start: `eq.${weekStart}`, limit: '1' }
      })
      return weekFromDb(rows[0])
    },
    async insertWeekInvoice(record) {
      try {
        const rows = await rest('pick_week_invoices', { method: 'POST', body: weekToDb(record) })
        return weekFromDb(rows[0])
      } catch (err) {
        if (err.status === 409) return null
        throw err
      }
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
