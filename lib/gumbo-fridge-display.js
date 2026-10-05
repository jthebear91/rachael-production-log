// Display helpers for the cafe fridge strip. No Square client imports,
// so the dashboard page can use these without shipping the loader.

export const FRIDGE_REFRESH_MS = 5 * 60 * 1000
export const FRIDGE_QTY_MISSING = '—'

export function formatFridgeQty(quantity) {
  if (quantity == null) return FRIDGE_QTY_MISSING
  const raw = String(quantity).trim()
  if (!raw) return FRIDGE_QTY_MISSING
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return raw
  const sign = match[1]
  const whole = String(Number(match[2]))
  const frac = (match[3] || '').replace(/0+$/, '')
  if (sign === '-' && whole === '0' && !frac) return '0'
  if (!frac) return `${sign}${whole}`
  return `${sign}${whole}.${frac}`
}

export function isNegativeFridgeQty(quantity) {
  if (quantity == null || String(quantity).trim() === '') return false
  const n = Number(String(quantity).trim())
  return Number.isFinite(n) && n < 0
}
