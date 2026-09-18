import { useState } from 'react'
import Head from 'next/head'
import {
  isPinConfigured,
  isSalesAuthenticated,
  productionPinMissing
} from '../lib/sales-auth'

export default function SalesLogin({ pinConfigured, pinMissingInProduction }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(
    pinMissingInProduction ? 'PIN not configured' : ''
  )
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    if (pinMissingInProduction || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/sales-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error || 'Could not sign in')
        setSubmitting(false)
        return
      }
      window.location.assign('/dashboard')
    } catch {
      setError('Could not sign in')
      setSubmitting(false)
    }
  }

  return (
    <div style={s.page}>
      <Head>
        <title>Sales Login · Rachael&apos;s Seafood</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <header style={s.header}>
        <div>
          <div style={s.h1}>Sales Dashboard</div>
          <div style={s.hsub}>Rachael&apos;s Seafood · PIN required</div>
        </div>
        <a href="/" style={s.tabBtn}>Production Log</a>
      </header>

      <main style={s.main}>
        <form style={s.card} onSubmit={onSubmit}>
          <div style={s.cardLabel}>Sign in to Sales</div>
          <p style={s.note}>
            Daily production log stays open. Only sales totals are gated.
          </p>

          {pinMissingInProduction ? (
            <div style={s.blocked} role="alert">
              PIN not configured. Set <code>SALES_DASHBOARD_PIN</code> in Vercel
              to enable the sales dashboard.
            </div>
          ) : (
            <>
              <label htmlFor="sales-pin" style={s.label}>Shared PIN</label>
              <input
                id="sales-pin"
                name="pin"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value)}
                disabled={submitting || !pinConfigured}
                style={s.input}
                placeholder={pinConfigured ? 'Enter PIN' : 'Not required in local development'}
              />
              {error ? <div style={s.error} role="alert">{error}</div> : null}
              <button type="submit" style={s.submit} disabled={submitting}>
                {submitting ? 'Signing in…' : 'Continue'}
              </button>
            </>
          )}
        </form>
      </main>
    </div>
  )
}

export async function getServerSideProps({ req, res }) {
  res.setHeader('Cache-Control', 'no-store')
  if (isSalesAuthenticated(req)) {
    return { redirect: { destination: '/dashboard', permanent: false } }
  }
  return {
    props: {
      pinConfigured: isPinConfigured(),
      pinMissingInProduction: productionPinMissing()
    }
  }
}

const s = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    background: '#1c1c1c', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '13px 24px', flexShrink: 0, gap: 16, flexWrap: 'wrap'
  },
  h1: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 2.5 },
  hsub: { fontSize: 10, color: '#999', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 1 },
  tabBtn: {
    background: '#fff', border: '1px solid #fff', borderRadius: 6,
    color: '#1c1c1c', fontSize: 13, fontWeight: 600, padding: '7px 16px',
    textDecoration: 'none', minHeight: 38, display: 'inline-flex', alignItems: 'center'
  },
  main: {
    padding: '32px 20px',
    maxWidth: 440,
    width: '100%',
    margin: '0 auto',
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start'
  },
  card: {
    background: '#fff',
    border: '1.5px solid var(--border)',
    borderRadius: 10,
    padding: '22px 20px',
    width: '100%'
  },
  cardLabel: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    letterSpacing: 1.5,
    marginBottom: 8
  },
  note: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 18 },
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#888',
    marginBottom: 8
  },
  input: {
    width: '100%',
    fontSize: 16,
    padding: '14px 14px',
    border: '1.5px solid var(--border)',
    borderRadius: 8,
    minHeight: 48,
    letterSpacing: 2,
    outline: 'none',
    background: '#fff',
    color: 'var(--text)'
  },
  error: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--red)',
    background: 'var(--red-dim)',
    borderRadius: 8,
    padding: '10px 12px'
  },
  blocked: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--red)',
    background: 'var(--red-dim)',
    borderRadius: 8,
    padding: '12px 14px',
    lineHeight: 1.5
  },
  submit: {
    marginTop: 16,
    background: 'var(--green)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 22,
    letterSpacing: 2,
    padding: '14px 16px',
    width: '100%',
    minHeight: 52
  }
}
