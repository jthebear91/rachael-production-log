// Day Doc label dates. The crew leaves this page open, so nothing here may
// capture new Date() at module load. Callers pass the clock at the moment
// of render or print. Browsers in the kitchen are America/Chicago, and the
// local calendar is the one that should print — not the UTC date.

const MAX_PREVIEW = 4

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MENU = [
  {
    id: 'refrigerated', label: 'Refrigerated', icon: '🔴',
    items: [
      'Chicken & Sausage (Cafe)',
      'Crawfish Bisque (Cafe)',
      'Rachael\'s Signature (Cafe)',
      'Seafood Gumbo (Cafe)',
      'Shrimp and Okra (Cafe)',
      'Soup Base',
      'Baked Sweet Potato',
      'Mashed Potatoes',
      'Onion Blend',
      'White Gravy',
      'Twice Baked Potato',
      'Potato Salad',
      'Stew Gravy'
    ]
  },
  {
    id: 'platelunch', label: 'Plate Lunches', icon: '🍽️',
    items: [
      'Shrimp Stew',
      'Meatball Stew',
      'Steak & Sausage',
      'Pork Roast',
      'Catfish Courtbouillon'
    ]
  },
  {
    id: 'frozen', label: 'Walk-in Freezer', icon: '🔵',
    items: [
      'Beef & Veggie (Cafe)',
      'Brown Gravy',
      'Cabbage',
      'Crab Etouffee',
      'Etouffee Base',
      'Grilled Onions',
      'Mushrooms',
      'Seafood Jambalaya (Cafe)',
      'Smothered Okra (2qt)',
      'Smothered Okra (6qt)'
    ]
  },
  {
    id: 'internal', label: 'Internal / Bulk', icon: '⚙️',
    items: [
      'Roux',
      'Crawfish Pie Base'
    ]
  }
]

const ABBREV = {
  'Chicken & Sausage (Cafe)': 'C/S',
  'Seafood Gumbo (Cafe)': 'SFG',
  'Crawfish Bisque (Cafe)': 'CFB',
  'Shrimp and Okra (Cafe)': 'S/O',
  'Rachael\'s Signature (Cafe)': 'RSG',
  'Beef & Veggie (Cafe)': 'B+V',
  'Twice Baked Potato': 'TBP',
  'Potato Salad': 'P/S',
  'Mashed Potatoes': 'MP',
  'Baked Sweet Potato': 'BSP',
  'White Gravy': 'WG',
  'Etouffee Base': 'ETT Base',
  'Grilled Onions': 'G Onions',
  'Seafood Jambalaya (Cafe)': 'S Jamb',
  'Smothered Okra (2qt)': 'S Okra',
  'Brown Gravy': 'BG',
  'Crab Etouffee': 'Crab Ett',
  'Steak & Sausage': 'S & S',
  'Meatball Stew': 'Mball Stew',
  'Catfish Courtbouillon': 'Fish Coub'
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatInputDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatInputTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function addDaysToISO(iso, days, now = new Date()) {
  const base = iso ? new Date(iso + 'T12:00:00') : new Date(now.getTime())
  base.setDate(base.getDate() + days)
  return formatInputDate(base)
}

function fmtDate(str) {
  if (!str) return '—'
  const [y, m, d] = str.split('-')
  return `${+m}/${+d}/${y.slice(2)}`
}

function fmtTime(str) {
  if (!str) return ''
  let [h, m] = str.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

function dayOfWeek(dateStr, now = new Date()) {
  if (!dateStr) return WEEKDAYS[now.getDay()]
  return WEEKDAYS[new Date(dateStr + 'T12:00:00').getDay()]
}

function msUntilLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return next.getTime() - now.getTime()
}

function currentInstant(tick, dateFactory = () => new Date()) {
  void tick
  return dateFactory()
}

function clockRefreshOnEvent(eventName, visibilityState) {
  if (eventName === 'focus') return true
  if (eventName === 'visibilitychange') return visibilityState === 'visible'
  return false
}

function resolveLabelClock(now, overrides = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('resolveLabelClock requires the clock at the moment of use')
  }
  const madeDate = overrides.madeDate == null ? formatInputDate(now) : overrides.madeDate
  const madeTime = overrides.madeTime == null ? formatInputTime(now) : overrides.madeTime
  let expDate = ''
  if (overrides.exp && overrides.exp.kind === 'date') {
    expDate = overrides.exp.value || ''
  } else if (overrides.exp && overrides.exp.kind === 'offset') {
    expDate = addDaysToISO(madeDate, overrides.exp.days, now)
  }
  return {
    madeDate,
    madeTime,
    expDate,
    madeLabel: fmtDate(madeDate),
    madeTimeLabel: fmtTime(madeTime),
    day: dayOfWeek(madeDate, now)
  }
}

function printNameFor(item) {
  if (!item) return '—'
  return ABBREV[item] || item
}

function labelsForUse({ item, qty, now, overrides }) {
  const clock = resolveLabelClock(now, overrides || {})
  const total = qty
  const printName = printNameFor(item)
  const labels = []
  for (let i = 1; i <= total; i++) {
    labels.push({
      day: clock.day,
      printName,
      made: clock.madeLabel,
      counter: total > 1 ? `${i} / ${total}` : ''
    })
  }
  return { clock, labels }
}

module.exports = {
  MAX_PREVIEW,
  MENU,
  ABBREV,
  formatInputDate,
  formatInputTime,
  addDaysToISO,
  fmtDate,
  fmtTime,
  dayOfWeek,
  msUntilLocalMidnight,
  currentInstant,
  clockRefreshOnEvent,
  resolveLabelClock,
  printNameFor,
  labelsForUse
}
