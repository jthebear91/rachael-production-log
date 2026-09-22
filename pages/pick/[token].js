import { useState } from 'react'
import Head from 'next/head'

const EMPTY = {
  missing: false,
  misconfigured: false,
  error: '',
  token: '',
  status: '',
  note: '',
  alreadySent: false,
  locked: false,
  invoiceNumber: '',
  lines: []
}

export default function PickPage(props) {
  return (
    <>
      <Head>
        <title>Maurice restock</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      {props.misconfigured ? (
        <main style={s.page}>
          <h1 style={s.h1}>Pick list unavailable</h1>
          <p>The pick list store is not configured.</p>
        </main>
      ) : props.missing ? (
        <main style={s.page}>
          <h1 style={s.h1}>Pick list not found</h1>
          <p>This code is not a Maurice restock list.</p>
        </main>
      ) : props.error ? (
        <main style={s.page}>
          <h1 style={s.h1}>Pick list unavailable</h1>
          <p>{props.error}</p>
        </main>
      ) : (
        <PickForm {...props} />
      )}
    </>
  )
}

function PickForm({ token, note, alreadySent, locked, invoiceNumber, lines }) {
  const [qtys, setQtys] = useState(() => {
    const initial = {}
    for (const line of lines) initial[line.catalogObjectId] = line.qty
    return initial
  })
  const [done, setDone] = useState(alreadySent ? { invoiceNumber, lines } : null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting || done) return
    const payloadLines = []
    for (const line of lines) {
      const raw = String(qtys[line.catalogObjectId] ?? '').trim()
      if (!/^\d+(\.\d{1,5})?$/.test(raw)) {
        setError('Enter a quantity from 0 up to the ordered amount.')
        return
      }
      const n = Number(raw)
      if (n < 0 || n > Number(line.orderedQty)) {
        setError('Quantity cannot be higher than ordered.')
        return
      }
      payloadLines.push({ catalogObjectId: line.catalogObjectId, qty: String(n) })
    }
    if (!payloadLines.some(line => Number(line.qty) > 0)) {
      setError('Send at least one item.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/pick/${encodeURIComponent(token)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: payloadLines })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Could not send')
        setSubmitting(false)
        return
      }
      setDone({
        invoiceNumber: data.invoiceNumber || invoiceNumber || '',
        lines: Array.isArray(data.lines) && data.lines.length ? data.lines : lines
      })
    } catch {
      setError('Could not send')
      setSubmitting(false)
    }
  }

  if (done) {
    const sentLines = done.lines || []
    return (
      <main style={s.page}>
        <p style={s.kicker}>Wholesale → Maurice</p>
        <h1 style={s.h1}>Already sent</h1>
        {done.invoiceNumber ? <p style={s.note}>Invoice {done.invoiceNumber}</p> : null}
        <ul style={s.list}>
          {sentLines.map(line => (
            <li key={line.catalogObjectId} style={s.sentRow}>
              <span>{line.name || line.catalogObjectId}</span>
              <span>{line.qty || line.orderedQty} of {line.orderedQty}</span>
            </li>
          ))}
        </ul>
      </main>
    )
  }

  return (
    <form style={s.page} onSubmit={onSubmit}>
      <p style={s.kicker}>Wholesale → Maurice</p>
      <h1 style={s.h1}>Maurice restock</h1>
      <p style={s.note}>
        {locked
          ? 'This send already started. Quantities are locked. Tap Send to finish.'
          : 'Leave each number alone unless the pull was short. You can only lower it.'}
      </p>
      {note ? <p style={s.note}>{note}</p> : null}
      <ul style={s.list}>
        {lines.map(line => (
          <li key={line.catalogObjectId} style={s.row}>
            <label htmlFor={`qty-${line.catalogObjectId}`} style={s.label}>{line.name}</label>
            <div style={s.ordered}>Ordered {line.orderedQty}</div>
            <input
              id={`qty-${line.catalogObjectId}`}
              name={line.catalogObjectId}
              type="number"
              inputMode="decimal"
              min="0"
              max={line.orderedQty}
              step="any"
              value={qtys[line.catalogObjectId]}
              disabled={locked || submitting}
              onChange={event => {
                setQtys(current => ({ ...current, [line.catalogObjectId]: event.target.value }))
              }}
              style={s.input}
            />
          </li>
        ))}
      </ul>
      <div style={s.footer}>
        {error ? <div role="alert" style={s.error}>{error}</div> : null}
        <button type="submit" style={s.send} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}

export async function getServerSideProps({ params, res }) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  const { loadPickPage } = require('../../lib/maurice-pick')
  try {
    const props = await loadPickPage(params.token)
    return { props }
  } catch (err) {
    const status = Number.isInteger(err && err.status) ? err.status : 500
    res.statusCode = status
    if (status === 503) return { props: { ...EMPTY, misconfigured: true } }
    if (status === 404) return { props: { ...EMPTY, missing: true } }
    return { props: { ...EMPTY, error: 'Could not load pick list' } }
  }
}

const s = {
  page: { maxWidth: 560, margin: '0 auto', padding: '20px 16px 120px', minHeight: '100vh' },
  kicker: { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#666', marginBottom: 6 },
  h1: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 42, letterSpacing: 1.5, fontWeight: 400, lineHeight: 1 },
  note: { marginTop: 12, color: '#333', fontSize: 16, lineHeight: 1.4 },
  list: { listStyle: 'none', marginTop: 20 },
  row: { padding: '16px 0', borderTop: '1px solid #e0ddd8' },
  sentRow: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '14px 0', borderTop: '1px solid #e0ddd8', fontSize: 18 },
  label: { display: 'block', fontSize: 20, fontWeight: 650 },
  ordered: { color: '#666', fontSize: 14, margin: '4px 0 10px' },
  input: {
    width: '100%',
    fontSize: 32,
    fontWeight: 700,
    textAlign: 'center',
    padding: '12px 14px',
    borderRadius: 12,
    border: '2px solid #1a6b3a',
    background: '#fff'
  },
  footer: {
    position: 'sticky',
    bottom: 0,
    margin: '0 -16px',
    padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
    background: '#f5f4f1',
    borderTop: '1px solid #e0ddd8'
  },
  error: { color: '#c0392b', fontWeight: 600, marginBottom: 8 },
  send: {
    width: '100%',
    minHeight: 68,
    fontSize: 24,
    fontWeight: 700,
    border: 'none',
    borderRadius: 14,
    background: '#1a6b3a',
    color: '#fff',
    touchAction: 'manipulation'
  }
}
