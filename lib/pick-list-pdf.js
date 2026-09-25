// Plain-text pick list PDF (qty + item name). No prices, no SKUs, no signature block.
// Standard Helvetica only, so this does not add a PDF dependency.

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

function layoutPages({ account, dateLabel, reference, lines }) {
  const source = Array.isArray(lines) && lines.length
    ? lines
    : [{ qty: '', name: 'No named lines' }]
  const pages = []
  let commands = []
  let y = 720

  function newPage(continued) {
    if (commands.length) pages.push(commands)
    commands = []
    // Full-width bar. Maurice nightly restock sheets do not use this header.
    commands.push('0.10 0.32 0.24 rg\n')
    commands.push('0 748 612 44 re f\n')
    commands.push('1 1 1 rg\n')
    text('F2', 26, 54, 762, 'WHOLESALE')
    commands.push('0 0 0 rg\n')
    y = 720
    text('F2', 18, 54, y, continued ? 'PICK LIST (continued)' : 'PICK LIST')
    y -= 28
    text('F2', 12, 54, y, toPdfText(account || 'Wholesale account'))
    y -= 18
    text('F1', 11, 54, y, `Date  ${toPdfText(dateLabel || '')}`)
    y -= 16
    text('F1', 11, 54, y, `Ref  ${toPdfText(reference || '')}`)
    y -= 24
    text('F2', 11, 54, y, 'Qty')
    text('F2', 11, 120, y, 'Item')
    y -= 8
    commands.push(`54 ${y} m 558 ${y} l S\n`)
    y -= 18
  }

  function text(font, size, x, yPos, value) {
    commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${yPos} Tm (${pdfEscape(value)}) Tj ET\n`)
  }

  function ensure(linesNeeded) {
    if (y - linesNeeded * 16 < 72) newPage(true)
  }

  const footer = 'BT /F1 9 Tf 1 0 0 1 54 40 Tm (Pick list. Quantity and item name only.) Tj ET\n'
  newPage(false)
  for (const line of source) {
    const qty = toPdfText(line.qty)
    const nameLines = wrapWords(line.name, 62)
    ensure(nameLines.length)
    text('F2', 12, 54, y, qty)
    text('F1', 12, 120, y, nameLines[0])
    y -= 16
    for (const extra of nameLines.slice(1)) {
      ensure(1)
      text('F1', 12, 120, y, extra)
      y -= 16
    }
  }

  if (commands.length) pages.push(commands)
  for (const page of pages) page.push(footer)
  return pages.filter(page => page.length)
}

function buildPickListPdf({ account, dateLabel, reference, lines } = {}) {
  const pages = layoutPages({ account, dateLabel, reference, lines })
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
  buildPickListPdf,
  toPdfText
}
