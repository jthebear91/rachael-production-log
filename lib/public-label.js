// Crew-facing names. Speech nicknames stay off titles and pick-list account lines.

const HEBERTS_PUBLIC_NAME = "Hebert's Specialty Meats"

function asrHeberts() {
  return /\(\s*a\s+bears\s*\)|\ba\s+bears\b/gi
}

function publicAccountName(value) {
  const raw = String(value ?? '')
  const hadNickname = asrHeberts().test(raw)
  let out = raw.replace(asrHeberts(), ' ')
  out = out.replace(/\(\s*\)/g, ' ')
  out = out.replace(/\s+/g, ' ').trim()
  out = out.replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, '')
  if (!out && hadNickname) return HEBERTS_PUBLIC_NAME
  return out
}

module.exports = {
  HEBERTS_PUBLIC_NAME,
  publicAccountName
}
