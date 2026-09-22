const QRCode = require('qrcode')
const { ALREADY_SENT_LABEL, appBaseUrl, getMauricePick } = require('./maurice-pick')

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function chicagoStamp(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

async function qrSvg(text) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 420,
    color: { dark: '#1c1c1c', light: '#ffffff' }
  })
  return String(svg).replace(/<\?xml[^>]*>/, '').trim()
}

function renderPickMessagePage(message) {
  const text = escapeHtml(message || 'Pick list not found')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${text}</title>
</head>
<body style="font-family: Inter, sans-serif; margin: 24px;">
  <p>${text}</p>
</body>
</html>`
}

async function renderPickSheet({ pick, pickUrl }) {
  const svg = await qrSvg(pickUrl)
  const banner = pick.status === 'sent'
    ? ALREADY_SENT_LABEL
    : pick.status === 'sending'
      ? 'Send did not finish. Scan the code and tap Send again.'
      : ''
  const rows = (pick.lines || []).map(line => {
    const name = escapeHtml(line.name || line.sellableCatalogObjectId)
    const ordered = escapeHtml(line.qtyOrdered)
    return `<tr><td class="name">${name}</td><td class="qty">${ordered}</td></tr>`
  }).join('')
  const when = [pick.printDay, pick.pickDate].filter(Boolean).join(' · ')
  const estimate = pick.estimatedTotal ? `<p class="note">Estimated total $${escapeHtml(pick.estimatedTotal)}. Inventory is not changed until Send.</p>` : '<p class="note">Inventory is not changed until Send.</p>'
  const bannerHtml = banner ? `<p class="banner">${escapeHtml(banner)}</p>` : ''
  const stamped = pick.createdAt ? escapeHtml(chicagoStamp(pick.createdAt)) : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>Maurice restock pick list</title>
  <style>
    body { font-family: Inter, sans-serif; color: #1c1c1c; margin: 0; background: #fff; }
    main { max-width: 720px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 32px; letter-spacing: 0.04em; margin: 0 0 8px; }
    .sub { color: #555; margin: 0 0 16px; }
    .banner { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
    .qr { width: min(92vw, 420px); margin: 8px 0 12px; }
    .qr svg { width: 100%; height: auto; display: block; }
    .url { word-break: break-all; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #e0ddd8; vertical-align: baseline; }
    th { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #666; }
    .name { font-size: 22px; font-weight: 650; }
    .qty { font-size: 28px; font-weight: 700; text-align: right; width: 4.5em; }
    .note { font-size: 16px; }
    button { margin-top: 20px; font: inherit; font-weight: 700; padding: 12px 18px; border-radius: 10px; border: 1px solid #1c1c1c; background: #1c1c1c; color: #fff; }
    @media print {
      .no-print { display: none !important; }
      main { padding: 0; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Maurice restock</h1>
    <p class="sub">Wholesale pick list${when ? ` · ${escapeHtml(when)}` : ''}${stamped ? ` · ${stamped}` : ''}</p>
    ${bannerHtml}
    ${estimate}
    <div class="qr" role="img" aria-label="QR code for the Maurice restock pick list">${svg}</div>
    <p class="url"><a href="${escapeHtml(pickUrl)}">${escapeHtml(pickUrl)}</a></p>
    <p>After the pull, scan the code. Leave full lines alone. Lower only the shorts, then Send. Send is the inventory deduction.</p>
    <table>
      <thead><tr><th>Item</th><th>Ordered</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="no-print" type="button" onclick="window.print()">Print</button>
  </main>
</body>
</html>`
}

async function loadPickSheet({ token, req, env = process.env, store } = {}) {
  const pick = await getMauricePick(token, { env, store })
  if (!pick) {
    const err = new Error('Pick list not found')
    err.status = 404
    throw err
  }
  const pickUrl = `${appBaseUrl(env, req)}/pick/${pick.token}`
  const html = await renderPickSheet({ pick, pickUrl })
  return html
}

async function loadPickQr({ token, req, env = process.env, store } = {}) {
  const pick = await getMauricePick(token, { env, store })
  if (!pick) {
    const err = new Error('Pick list not found')
    err.status = 404
    throw err
  }
  return qrSvg(`${appBaseUrl(env, req)}/pick/${pick.token}`)
}

module.exports = {
  escapeHtml,
  loadPickQr,
  loadPickSheet,
  qrSvg,
  renderPickMessagePage,
  renderPickSheet
}
