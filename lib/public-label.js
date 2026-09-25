// Crew-facing names. Speech nicknames stay off titles, pick lists, and signature invoices.

const HEBERTS_PUBLIC_NAME = "Hebert's Specialty Meats"

function asrHeberts() {
  return /\(\s*a\s+bears\s*\)|\ba\s+bears\b/gi
}

function stripAsrNickname(value) {
  let out = String(value ?? '').replace(asrHeberts(), ' ')
  out = out.replace(/\(\s*\)/g, ' ')
  out = out.replace(/\s+/g, ' ').trim()
  return out.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')
}

function publicAccountName(value) {
  const raw = String(value ?? '')
  const hadNickname = asrHeberts().test(raw)
  const out = stripAsrNickname(raw)
  if (!out && hadNickname) return HEBERTS_PUBLIC_NAME
  return out
}

module.exports = {
  HEBERTS_PUBLIC_NAME,
  publicAccountName,
  stripAsrNickname
}
