// Signature invoice PDF built from Square order/invoice amounts already on the pull.
// Square's Invoices API does not return official invoice PDF bytes. This is not
// the pick list: prices, tax, and total stay on this sheet, and the banner is
// INVOICE or SIGNATURE. The pick list keeps the WHOLESALE banner and qty + name.

const { publicAccountName, stripAsrNickname } = require('./public-label')

function toPdfText(value) {
  const mapped = String(value ?? '')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014|\u00B7/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2026/g, '...')
  let out = ''
  for (const ch of mapped) {
    const code = ch.codePointAt(0)
    out += code >= 32 && code <= 126 ? ch : '?'
  }
  return out
}

function pdfEscape(value) {
  return toPdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapWords(value, width) {
  const text = toPdfText(value).trim()
  if (!text) return ['']
  const words = text.split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function formatMoney(cents, currency) {
  if (!Number.isInteger(cents)) return ''
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = String(abs % 100).padStart(2, '0')
  if (currency && currency !== 'USD') return `${sign}${currency} ${dollars}.${frac}`
  return `${sign}$${dollars}.${frac}`
}

function resolveKind(documentKind, totals) {
  const raw = documentKind || (totals && totals.documentKind) || 'invoice'
  return raw === 'house_account' ? 'house_account' : 'invoice'
}

function summaryRows(totals) {
  const source = totals && typeof totals === 'object' ? totals : {}
  const currency = source.currency || 'USD'
  const rows = []
  const tax = source.tax
  const discount = source.discount
  const tip = source.tip
  const service = source.service
  const extras = [tax, discount, tip, service].some(amount => Number.isInteger(amount) && amount !== 0)
  if (extras && Number.isInteger(source.subtotal)) rows.push(['Subtotal', formatMoney(source.subtotal, currency)])
  if (Number.isInteger(tax) && tax !== 0) rows.push(['Tax', formatMoney(tax, currency)])
  if (Number.isInteger(discount) && discount !== 0) rows.push(['Discount', formatMoney(-Math.abs(discount), currency)])
  if (Number.isInteger(tip) && tip !== 0) rows.push(['Tip', formatMoney(tip, currency)])
  if (Number.isInteger(service) && service !== 0) rows.push(['Service', formatMoney(service, currency)])
  if (Number.isInteger(source.total)) rows.push(['Total', formatMoney(source.total, currency)])
  return rows
}

function layoutPages({ account, dateLabel, reference, lines, totals, documentKind }) {
  const kind = resolveKind(documentKind, totals)
  const banner = kind === 'house_account' ? 'SIGNATURE' : 'INVOICE'
  const bannerColor = kind === 'house_account' ? '0.40 0.12 0.12' : '0.11 0.16 0.33'
  const currency = (totals && totals.currency) || 'USD'
  const source = Array.isArray(lines) && lines.length
    ? lines
    : [{ qty: '', name: 'No named lines' }]
  const accountLine = toPdfText(publicAccountName(account) || 'Wholesale account')
  const dateLine = toPdfText(stripAsrNickname(dateLabel || ''))
  const refLine = toPdfText(stripAsrNickname(reference || ''))
  const pages = []
  let commands = []
  let y = 720

  function text(font, size, x, yPos, value) {
    commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${yPos} Tm (${pdfEscape(value)}) Tj ET\n`)
  }

  function newPage(continued) {
    if (commands.length) pages.push(commands)
    commands = []
    commands.push(`${bannerColor} rg\n`)
    commands.push('0 748 612 44 re f\n')
    commands.push('1 1 1 rg\n')
    text('F2', 26, 54, 762, banner)
    commands.push('0 0 0 rg\n')
    y = 720
    if (!continued && kind === 'house_account') {
      text('F2', 14, 54, y, 'House account receipt')
      y -= 22
    } else if (!continued) {
      text('F2', 14, 54, y, 'For signature')
      y -= 22
    } else {
      text('F2', 14, 54, y, 'Continued')
      y -= 22
    }
    text('F2', 12, 54, y, accountLine)
    y -= 18
    text('F1', 11, 54, y, `Date  ${dateLine}`)
    y -= 16
    text('F1', 11, 54, y, `Ref  ${refLine}`)
    y -= 24
    text('F2', 11, 54, y, 'Qty')
    text('F2', 11, 100, y, 'Item')
    text('F2', 11, 390, y, 'Price')
    text('F2', 11, 490, y, 'Amount')
    y -= 8
    commands.push(`54 ${y} m 558 ${y} l S\n`)
    y -= 18
  }

  function ensure(linesNeeded) {
    if (y - linesNeeded * 16 < 72) newPage(true)
  }

  const footer = 'BT /F1 9 Tf 1 0 0 1 54 36 Tm (Signature copy from the Square order. Not a Square Dashboard PDF.) Tj ET\n'
  newPage(false)
  for (const line of source) {
    const qty = stripAsrNickname(line.qty)
    const nameLines = wrapWords(stripAsrNickname(line.name), 40)
    ensure(nameLines.length)
    const unit = formatMoney(line.unitAmount, line.currency || currency)
    const amount = formatMoney(line.lineAmount, line.currency || currency)
    text('F2', 11, 54, y, qty)
    text('F1', 11, 100, y, nameLines[0])
    if (unit) text('F1', 11, 390, y, unit)
    if (amount) text('F1', 11, 490, y, amount)
    y -= 16
    for (const extra of nameLines.slice(1)) {
      ensure(1)
      text('F1', 11, 100, y, extra)
      y -= 16
    }
  }

  const totalsRows = summaryRows(totals)
  if (totalsRows.length) {
    ensure(totalsRows.length + 1)
    y -= 6
    commands.push(`360 ${y + 12} m 558 ${y + 12} l S\n`)
    for (const [label, value] of totalsRows) {
      text(label === 'Total' ? 'F2' : 'F1', 12, 360, y, label)
      text('F2', 12, 470, y, value)
      y -= 18
    }
  }

  if (y < 150) newPage(true)
  y -= 28
  text('F2', 16, 54, y, 'SIGNATURE')
  y -= 26
  commands.push('0 0 0 RG\n1.2 w\n')
  commands.push(`54 ${y} m 340 ${y} l S\n`)
  y -= 16
  text('F1', 9, 54, y, 'Sign and date')

  if (commands.length) pages.push(commands)
  for (const page of pages) page.push(footer)
  return pages.filter(page => page.length)
}

function buildSignatureInvoicePdf({ account, dateLabel, reference, lines, totals, documentKind } = {}) {
  const pages = layoutPages({ account, dateLabel, reference, lines, totals, documentKind })
  const objects = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')

  const kids = []
  for (const commands of pages) {
    const stream = commands.join('')
    const contentId = objects.length + 2
    const pageId = objects.length + 1
    kids.push(`${pageId} 0 R`)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`)
  }
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

module.exports = {
  buildSignatureInvoicePdf,
  formatMoney
}
