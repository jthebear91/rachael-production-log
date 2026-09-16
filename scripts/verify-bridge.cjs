'use strict'

const { getChicagoSalesWindows } = require('../lib/chicago-time')
const {
  accountPresence,
  canonicalAccountId,
  peekAccountFromEnv
} = require('../lib/square-accounts')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testChicagoWindows() {
  const sep = getChicagoSalesWindows(new Date('2026-09-16T07:47:00.000Z'))
  assert(sep.timezone === 'America/Chicago', 'timezone')
  assert(sep.weekStartsOn === 'monday', 'week start')
  assert(sep.today.begin === '2026-09-16T05:00:00.000Z', `today begin ${sep.today.begin}`)
  assert(sep.wtd.begin === '2026-09-14T05:00:00.000Z', `wtd begin ${sep.wtd.begin}`)
  assert(sep.mtd.begin === '2026-09-01T05:00:00.000Z', `mtd begin ${sep.mtd.begin}`)

  const jan = getChicagoSalesWindows(new Date('2026-01-15T12:00:00.000Z'))
  assert(jan.today.begin === '2026-01-15T06:00:00.000Z', `jan today ${jan.today.begin}`)
  assert(jan.wtd.begin === '2026-01-12T06:00:00.000Z', `jan wtd ${jan.wtd.begin}`)
  assert(jan.mtd.begin === '2026-01-01T06:00:00.000Z', `jan mtd ${jan.mtd.begin}`)

  const april = getChicagoSalesWindows(new Date('2026-04-02T12:00:00.000Z'))
  assert(april.today.begin === '2026-04-02T05:00:00.000Z', `apr today ${april.today.begin}`)
  assert(april.wtd.begin === '2026-03-30T05:00:00.000Z', `apr wtd ${april.wtd.begin}`)
  assert(april.mtd.begin === '2026-04-01T05:00:00.000Z', `apr mtd ${april.mtd.begin}`)
}

function testAccounts() {
  assert(canonicalAccountId() === 'wholesale', 'default wholesale')
  assert(canonicalAccountId('') === 'wholesale', 'empty wholesale')
  assert(canonicalAccountId('restaurant') === 'maurice', 'restaurant alias')
  assert(canonicalAccountId('MAURICE') === 'maurice', 'case')

  const legacy = {
    SQUARE_TOKEN: 'tok-w',
    SQUARE_LOCATION_ID: 'loc-w',
    SQUARE_RESTAURANT_TOKEN: 'tok-r',
    SQUARE_RESTAURANT_LOCATION_ID: 'loc-r'
  }
  const wholesale = peekAccountFromEnv('wholesale', legacy)
  assert(wholesale.token === 'tok-w' && wholesale.locationId === 'loc-w' && wholesale.configured, 'legacy wholesale')
  const maurice = peekAccountFromEnv('maurice', legacy)
  assert(maurice.token === 'tok-r' && maurice.locationId === 'loc-r' && maurice.configured, 'legacy restaurant→maurice')
  const lafayette = peekAccountFromEnv('lafayette', legacy)
  assert(!lafayette.configured && !lafayette.token, 'lafayette unset')

  const named = {
    SQUARE_WHOLESALE_TOKEN: 'new-w',
    SQUARE_WHOLESALE_LOCATION_ID: 'new-loc-w',
    SQUARE_TOKEN: 'old-w',
    SQUARE_LOCATION_ID: 'old-loc-w',
    SQUARE_MAURICE_TOKEN: 'new-m',
    SQUARE_MAURICE_LOCATION_ID: 'new-loc-m',
    SQUARE_RESTAURANT_TOKEN: 'old-m',
    SQUARE_RESTAURANT_LOCATION_ID: 'old-loc-m',
    SQUARE_LAFAYETTE_TOKEN: 'tok-l',
    SQUARE_LAFAYETTE_LOCATION_ID: 'loc-l'
  }
  assert(peekAccountFromEnv('wholesale', named).token === 'new-w', 'wholesale prefers new env')
  assert(peekAccountFromEnv('maurice', named).token === 'new-m', 'maurice prefers new env')
  assert(peekAccountFromEnv('lafayette', named).configured, 'lafayette pair')

  const presence = accountPresence(named)
  assert(presence.wholesale && presence.lafayette && presence.maurice && presence.restaurant, 'presence all')

  const tokenOnly = { SQUARE_TOKEN: 'tok-w' }
  assert(!peekAccountFromEnv('wholesale', tokenOnly).configured, 'pair requires location')
  assert(peekAccountFromEnv('wholesale', tokenOnly).token === 'tok-w', 'token still visible')
}

testChicagoWindows()
testAccounts()
console.log('verify-bridge: ok')
