// America/Chicago calendar windows used by the sales dashboard and
// GET /api/square/sales. Week-to-date starts Monday 00:00 Chicago time.

const SALES_TIMEZONE = 'America/Chicago'

const WEEKDAY_TO_MONDAY_OFFSET = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
}

function formatToParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  const map = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  }
}

function tzOffsetMs(date, timeZone) {
  const parts = formatToParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return asUtc - date.getTime()
}

function zonedLocalToUtc(year, month, day, hour, minute, second, timeZone = SALES_TIMEZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const once = new Date(utcGuess - tzOffsetMs(new Date(utcGuess), timeZone))
  return new Date(utcGuess - tzOffsetMs(once, timeZone))
}

function addCalendarDays(year, month, day, delta) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate()
  }
}

function getChicagoSalesWindows(now = new Date()) {
  const parts = formatToParts(now, SALES_TIMEZONE)
  const todayStart = zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, 0)
  const mondayOffset = WEEKDAY_TO_MONDAY_OFFSET[parts.weekday]
  const monday = addCalendarDays(parts.year, parts.month, parts.day, -mondayOffset)
  const weekStart = zonedLocalToUtc(monday.year, monday.month, monday.day, 0, 0, 0)
  const monthStart = zonedLocalToUtc(parts.year, parts.month, 1, 0, 0, 0)
  const end = now.toISOString()

  return {
    timezone: SALES_TIMEZONE,
    asOf: end,
    weekStartsOn: 'monday',
    today: { begin: todayStart.toISOString(), end },
    wtd: { begin: weekStart.toISOString(), end },
    mtd: { begin: monthStart.toISOString(), end }
  }
}

function formatUsdFromCents(amount, currency = 'USD') {
  const n = (Number(amount) || 0) / 100
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n)
}

function isoFromParts(parts) {
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

// The last completed Maurice pick week: Monday through Saturday, America/Chicago.
// On Monday morning this is the week that just ended, not the new Monday.
function priorMonSat(now = new Date()) {
  const parts = formatToParts(now, SALES_TIMEZONE)
  const offset = WEEKDAY_TO_MONDAY_OFFSET[parts.weekday]
  const thisMonday = addCalendarDays(parts.year, parts.month, parts.day, -offset)
  const priorMonday = addCalendarDays(thisMonday.year, thisMonday.month, thisMonday.day, -7)
  const priorSaturday = addCalendarDays(priorMonday.year, priorMonday.month, priorMonday.day, 5)
  return {
    timezone: SALES_TIMEZONE,
    weekStart: isoFromParts(priorMonday),
    weekEnd: isoFromParts(priorSaturday)
  }
}

module.exports = {
  SALES_TIMEZONE,
  zonedLocalToUtc,
  getChicagoSalesWindows,
  formatUsdFromCents,
  priorMonSat
}
