// Named Square merchants for the bridge and sales dashboard.
// Invoice writes accept wholesale only (lib/invoice-write.js).
//
// Canonical query values: wholesale | lafayette | maurice (default wholesale).
// `restaurant` is a deprecated alias for maurice so existing agents keep working.
//
// Env lookup is first-hit. New names win; legacy aliases are fallbacks only.

const ACCOUNT_IDS = ['wholesale', 'lafayette', 'maurice']

const ACCOUNT_META = {
  wholesale: {
    id: 'wholesale',
    label: "Rachael's Seafood",
    tokenEnv: ['SQUARE_WHOLESALE_TOKEN', 'SQUARE_TOKEN'],
    locationEnv: ['SQUARE_WHOLESALE_LOCATION_ID', 'SQUARE_LOCATION_ID']
  },
  lafayette: {
    id: 'lafayette',
    label: 'Lafayette cafe',
    tokenEnv: ['SQUARE_LAFAYETTE_TOKEN'],
    locationEnv: ['SQUARE_LAFAYETTE_LOCATION_ID']
  },
  maurice: {
    id: 'maurice',
    label: 'Maurice cafe',
    tokenEnv: ['SQUARE_MAURICE_TOKEN', 'SQUARE_RESTAURANT_TOKEN'],
    locationEnv: ['SQUARE_MAURICE_LOCATION_ID', 'SQUARE_RESTAURANT_LOCATION_ID']
  }
}

const ACCOUNT_ALIASES = {
  restaurant: 'maurice'
}

function canonicalAccountId(accountParam) {
  const raw = String(accountParam || 'wholesale').toLowerCase().trim()
  return ACCOUNT_ALIASES[raw] || raw
}

function isKnownAccount(accountParam) {
  return Boolean(ACCOUNT_META[canonicalAccountId(accountParam)])
}

function firstEnv(names, env) {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function peekAccountFromEnv(accountId, env = process.env) {
  const meta = ACCOUNT_META[accountId]
  if (!meta) {
    return {
      account: accountId,
      label: accountId,
      token: null,
      locationId: null,
      configured: false
    }
  }
  const token = firstEnv(meta.tokenEnv, env)
  const locationId = firstEnv(meta.locationEnv, env)
  return {
    account: meta.id,
    label: meta.label,
    token,
    locationId,
    configured: Boolean(token && locationId)
  }
}

function accountPresence(env = process.env) {
  const wholesale = peekAccountFromEnv('wholesale', env).configured
  const lafayette = peekAccountFromEnv('lafayette', env).configured
  const maurice = peekAccountFromEnv('maurice', env).configured
  return {
    wholesale,
    lafayette,
    maurice,
    // Deprecated alias: same pair as maurice (SQUARE_MAURICE_* or SQUARE_RESTAURANT_*).
    restaurant: maurice
  }
}

module.exports = {
  ACCOUNT_IDS,
  ACCOUNT_META,
  canonicalAccountId,
  isKnownAccount,
  peekAccountFromEnv,
  accountPresence
}
