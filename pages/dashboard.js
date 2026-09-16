import { formatUsdFromCents } from '../lib/chicago-time'
import { loadDashboardSales } from '../lib/square-sales'

function MoneyValue({ period }) {
  if (!period) {
    return (
      <div style={{ ...s.cardValue, fontFamily: 'Inter, sans-serif', fontSize: 28, color: 'var(--muted)' }}>—</div>
    )
  }
  return <div style={s.cardValue}>{formatUsdFromCents(period.amount, period.currency)}</div>
}

function countCell(period) {
  if (!period) return ''
  const n = period.paymentCount || 0
  return `${n} payment${n === 1 ? '' : 's'}`
}

function moneyCell(period) {
  if (!period) return '—'
  return formatUsdFromCents(period.amount, period.currency)
}

function asOfLabel(iso, timeZone) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export default function Dashboard({ payload }) {
  const { accounts = [], combined = {}, timezone, weekStartsOn, asOf } = payload || {}

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.h1}>Sales Dashboard</div>
          <div style={s.hsub}>Rachael&apos;s Seafood · Lafayette · Maurice</div>
        </div>
        <div style={s.hright}>
          <span style={s.hdate}>
            {timezone} · {asOfLabel(asOf, timezone)}
          </span>
          <a href="/" style={s.tabBtn}>Production Log</a>
        </div>
      </header>

      <main style={s.main}>
        <p style={s.note}>
          Read-only totals from completed Square payments (including tips, minus refunds).
          Today / week-to-date / month-to-date use {timezone} midnight.
          Week-to-date starts {weekStartsOn === 'monday' ? 'Monday' : weekStartsOn}.
        </p>

        <section style={s.combined}>
          <div style={s.combinedLabel}>Combined</div>
          <div style={s.cards}>
            <div style={s.card}>
              <div style={s.cardLabel}>Today</div>
              <MoneyValue period={combined.today} />
              <div style={s.cardMeta}>{countCell(combined.today)}</div>
            </div>
            <div style={s.card}>
              <div style={s.cardLabel}>Week to date</div>
              <MoneyValue period={combined.wtd} />
              <div style={s.cardMeta}>{countCell(combined.wtd)}</div>
            </div>
            <div style={s.card}>
              <div style={s.cardLabel}>Month to date</div>
              <MoneyValue period={combined.mtd} />
              <div style={s.cardMeta}>{countCell(combined.mtd)}</div>
            </div>
          </div>
        </section>

        <section style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Location</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Today</th>
                <th style={{ ...s.th, textAlign: 'right' }}>WTD</th>
                <th style={{ ...s.th, textAlign: 'right' }}>MTD</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((row, i) => (
                <tr key={row.account} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                  <td style={s.td}>
                    <div style={s.locName}>{row.label}</div>
                    <div style={s.locId}>{row.account}</div>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.configured && !row.error ? moneyCell(row.today) : '—'}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.configured && !row.error ? moneyCell(row.wtd) : '—'}
                  </td>
                  <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.configured && !row.error ? moneyCell(row.mtd) : '—'}
                  </td>
                  <td style={s.td}>
                    {!row.configured && <span style={s.badgeMuted}>Not configured</span>}
                    {row.configured && row.error && <span style={s.badgeErr}>{row.error}</span>}
                    {row.configured && !row.error && row.truncated && (
                      <span style={s.badgeWarn}>Partial (payment page cap)</span>
                    )}
                    {row.configured && !row.error && !row.truncated && (
                      <span style={s.badgeOk}>OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}

export async function getServerSideProps({ res }) {
  res.setHeader('Cache-Control', 'no-store')
  const payload = await loadDashboardSales()
  return { props: { payload } }
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
  hright: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  hdate: { fontSize: 12, color: '#aaa' },
  tabBtn: {
    background: '#fff', border: '1px solid #fff', borderRadius: 6,
    color: '#1c1c1c', fontSize: 13, fontWeight: 600, padding: '7px 16px',
    textDecoration: 'none', minHeight: 38, display: 'inline-flex', alignItems: 'center'
  },
  main: { padding: '24px', maxWidth: 980, width: '100%', margin: '0 auto' },
  note: { fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 22 },
  combined: { marginBottom: 24 },
  combinedLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase',
    color: '#888', marginBottom: 10
  },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  card: {
    background: '#fff', border: '1.5px solid var(--border)', borderRadius: 10,
    padding: '16px 18px'
  },
  cardLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: '#888'
  },
  cardValue: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: 1,
    color: 'var(--green)', marginTop: 6
  },
  cardMeta: { fontSize: 12, color: '#888', marginTop: 4 },
  tableWrap: {
    background: '#fff', borderRadius: 10, overflow: 'auto',
    border: '1px solid var(--border)'
  },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 640 },
  th: {
    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    letterSpacing: 1.2, textTransform: 'uppercase', color: '#888',
    borderBottom: '2px solid var(--border)'
  },
  td: { padding: '14px 16px', fontSize: 14, borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
  locName: { fontWeight: 700 },
  locId: { fontSize: 11, color: '#888', marginTop: 2 },
  badgeMuted: {
    display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#555',
    background: '#eee', borderRadius: 999, padding: '4px 10px'
  },
  badgeOk: {
    display: 'inline-block', fontSize: 12, fontWeight: 600, color: 'var(--green)',
    background: 'var(--green-dim)', borderRadius: 999, padding: '4px 10px'
  },
  badgeErr: {
    display: 'inline-block', fontSize: 12, fontWeight: 600, color: 'var(--red)',
    background: 'var(--red-dim)', borderRadius: 8, padding: '4px 10px',
    maxWidth: 280, lineHeight: 1.4
  },
  badgeWarn: {
    display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#8a5a00',
    background: '#fff4d6', borderRadius: 999, padding: '4px 10px'
  }
}
