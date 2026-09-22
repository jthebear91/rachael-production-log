// v1 stub parser. Recognizes lines like "2x stuffed shrimp" but never
// resolves Square catalog variation IDs, so needs_review stays true and
// no invoice is created.

const LINE_RE = /^(\d+(?:\.\d{1,5})?)\s*x\s+(\S(?:.*\S)?)\s*$/i

function normalizeQuantity(raw) {
  if (!/^\d+(\.\d{1,5})?$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null
  return raw
}

function parseWholesaleText(body) {
  const lines = []
  for (const raw of String(body || '').split(/\r?\n/)) {
    const match = raw.trim().match(LINE_RE)
    if (!match) continue
    const quantity = normalizeQuantity(match[1])
    const name = match[2].trim().slice(0, 80)
    if (!quantity || !name) continue
    lines.push({ quantity, name, catalogObjectId: null })
  }
  return {
    lines,
    needs_review: true
  }
}

module.exports = {
  parseWholesaleText
}
