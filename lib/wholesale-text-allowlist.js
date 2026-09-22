// Phone → Square customer allowlist for wholesale text orders.
// The committed file starts empty. R2D2 / Jordan fill Hebert's Broussard,
// Nunu's (two numbers), and Premier. WHOLESALE_TEXT_ALLOWLIST_JSON replaces
// the file when set (JSON array, no redeploy).

const fileAllowlist = require('../data/wholesale-text-allowlist.json')

function normalizePhone(input) {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const phone = normalizePhone(raw.phone)
  if (!phone) return null
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const squareCustomerId = typeof raw.squareCustomerId === 'string' ? raw.squareCustomerId.trim() : ''
  const notifyPhones = Array.isArray(raw.notifyPhones)
    ? raw.notifyPhones.map(normalizePhone).filter(Boolean)
    : []
  return { phone, label, squareCustomerId, notifyPhones }
}

function normalizeEntries(list) {
  const seen = new Set()
  const entries = []
  for (const raw of list) {
    const entry = normalizeEntry(raw)
    if (!entry || seen.has(entry.phone)) continue
    seen.add(entry.phone)
    entries.push(entry)
  }
  return entries
}

function loadAllowlist(env = process.env, fileEntries = fileAllowlist) {
  const override = env.WHOLESALE_TEXT_ALLOWLIST_JSON
  try {
    if (typeof override === 'string' && override.trim()) {
      const parsed = JSON.parse(override)
      if (!Array.isArray(parsed)) {
        return { ok: false, error: 'Wholesale text allowlist is not configured' }
      }
      return { ok: true, entries: normalizeEntries(parsed) }
    }
    if (!Array.isArray(fileEntries)) {
      return { ok: false, error: 'Wholesale text allowlist is not configured' }
    }
    return { ok: true, entries: normalizeEntries(fileEntries) }
  } catch {
    return { ok: false, error: 'Wholesale text allowlist is not configured' }
  }
}

function findAllowlistEntry(phone, entries) {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  return entries.find(entry => entry.phone === normalized) || null
}

function parseNotifyPhoneList(value) {
  return String(value || '')
    .split(',')
    .map(part => normalizePhone(part.trim()))
    .filter(Boolean)
}

module.exports = {
  normalizePhone,
  normalizeEntry,
  loadAllowlist,
  findAllowlistEntry,
  parseNotifyPhoneList
}
