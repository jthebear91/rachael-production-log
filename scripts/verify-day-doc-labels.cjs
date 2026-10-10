'use strict'

const fs = require('fs')
const path = require('path')
const {
  MENU,
  ABBREV,
  formatInputDate,
  fmtDate,
  fmtTime,
  dayOfWeek,
  msUntilLocalMidnight,
  currentInstant,
  clockRefreshOnEvent,
  resolveLabelClock,
  labelsForUse,
  addDaysToISO
} = require('../lib/day-doc-labels')
const { DAY_DOC_CSS } = require('../lib/day-doc-labels-css')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function at(y, m, d, h, min, s, ms) {
  return new Date(y, m - 1, d, h, min, s || 0, ms || 0)
}

function testMenuAndAbbreviations() {
  assert(MENU.length === 4, 'four categories')
  const refrigerated = MENU.find(cat => cat.id === 'refrigerated')
  const plates = MENU.find(cat => cat.id === 'platelunch')
  const freezer = MENU.find(cat => cat.id === 'frozen')
  const internal = MENU.find(cat => cat.id === 'internal')
  assert(refrigerated.items.length === 13, 'refrigerated items')
  assert(plates.items.length === 5, 'plate lunch items')
  assert(freezer.items.length === 10, 'freezer items')
  assert(internal.items.join('|') === 'Roux|Crawfish Pie Base', 'internal items')
  assert(ABBREV['Chicken & Sausage (Cafe)'] === 'C/S', 'chicken abbrev')
  assert(ABBREV["Rachael's Signature (Cafe)"] === 'RSG', 'signature abbrev')
  assert(ABBREV['Smothered Okra (6qt)'] == null, '6qt okra prints its full name')
  assert(fmtDate('2026-01-05') === '1/5/26', 'made date drops leading zeros')
  assert(fmtTime('00:05') === '12:05 AM', 'midnight hour')
  assert(fmtTime('23:30') === '11:30 PM', 'evening hour')
  assert(fmtTime('12:00') === '12:00 PM', 'noon')
  assert(dayOfWeek('2026-10-11', at(2026, 10, 10, 23, 30)) === 'Sun', 'noon parse keeps the local weekday')
  assert(addDaysToISO('2026-10-31', 1) === '2026-11-01', 'offset crosses the month')
}

function testClockAcrossMidnight() {
  const load = at(2026, 10, 10, 23, 30, 0)
  const afterMidnight = at(2026, 10, 11, 0, 5, 0)
  assert(formatInputDate(load) === '2026-10-10', 'local calendar day before midnight')
  assert(formatInputDate(afterMidnight) === '2026-10-11', 'local calendar day after midnight')
  if (load.getTimezoneOffset() !== 0) {
    assert(
      formatInputDate(load) !== load.toISOString().slice(0, 10),
      'a local evening must not print the UTC date'
    )
  }

  assert(msUntilLocalMidnight(load) === 30 * 60 * 1000, '30 minutes until local midnight')
  const fireAt = new Date(load.getTime() + msUntilLocalMidnight(load))
  assert(formatInputDate(fireAt) === '2026-10-11', 'midnight timer lands on the next local day')
  assert(fireAt.getHours() === 0 && fireAt.getMinutes() === 0 && fireAt.getSeconds() === 0, 'timer fires at 00:00:00 local')
  assert(msUntilLocalMidnight(fireAt) === 24 * 60 * 60 * 1000, 'exactly midnight waits a full local day')

  const session = { item: 'Chicken & Sausage (Cafe)', qty: 2, overrides: {} }
  const atLoad = labelsForUse({ ...session, now: currentInstant(0, () => load) })
  const atPrint = labelsForUse({ ...session, now: currentInstant(1, () => afterMidnight) })
  assert(atLoad.labels[0].made === '10/10/26', 'render before midnight prints Saturday')
  assert(atLoad.labels[0].day === 'Sat', 'weekday follows the made date')
  assert(atLoad.clock.madeTime === '23:30', 'time is read from the clock passed in')
  assert(atPrint.labels[0].made === '10/11/26', 'print after midnight is Sunday’s date')
  assert(atPrint.labels[0].day === 'Sun', 'weekday rolls with the date')
  assert(atPrint.labels[0].printName === 'C/S', 'printed name stays abbreviated')
  assert(atPrint.labels[0].counter === '1 / 2' && atPrint.labels[1].counter === '2 / 2', 'counters')
  assert(atPrint.clock.madeTime === '00:05', 'print time is the moment of use')
  assert(atLoad.labels[0].made !== atPrint.labels[0].made, 'page-load snapshot is not reused')

  const expBefore = resolveLabelClock(load, { exp: { kind: 'offset', days: 1 } })
  const expAfter = resolveLabelClock(afterMidnight, { exp: { kind: 'offset', days: 1 } })
  assert(expBefore.expDate === '2026-10-11', '+1 day before midnight')
  assert(expAfter.expDate === '2026-10-12', '+1 day follows the new made date')

  const pinned = labelsForUse({
    item: 'Roux',
    qty: 1,
    now: afterMidnight,
    overrides: { madeDate: '2026-10-10', exp: { kind: 'offset', days: 3 } }
  })
  assert(pinned.labels[0].made === '10/10/26', 'a typed made date stays put')
  assert(pinned.labels[0].day === 'Sat', 'weekday follows the typed date')
  assert(pinned.labels[0].printName === 'Roux', 'unabbreviated name')
  assert(pinned.clock.madeTime === '00:05', 'time still follows the clock')
  assert(pinned.clock.expDate === '2026-10-13', 'offset is applied to the typed made date')

  const absolute = resolveLabelClock(afterMidnight, { exp: { kind: 'date', value: '2026-12-01' } })
  assert(absolute.madeDate === '2026-10-11', 'made date still rolls')
  assert(absolute.expDate === '2026-12-01', 'a typed expiration stays put')
}

function testRefreshEvents() {
  const load = at(2026, 10, 10, 21, 15, 0)
  const later = at(2026, 10, 11, 6, 0, 0)
  assert(clockRefreshOnEvent('visibilitychange', 'hidden') === false, 'hiding the tab does not refresh')
  assert(clockRefreshOnEvent('visibilitychange', 'visible') === true, 'showing the tab refreshes')
  assert(clockRefreshOnEvent('focus', 'hidden') === true, 'focus refreshes')
  assert(clockRefreshOnEvent('click', 'visible') === false, 'unrelated events do not refresh')

  let renderedAt = load
  const events = [
    { type: 'visibilitychange', visibilityState: 'hidden', at: later },
    { type: 'print', at: later }
  ]
  let printedAt = null
  for (const event of events) {
    if (event.type === 'print') printedAt = event.at
    else if (clockRefreshOnEvent(event.type, event.visibilityState)) renderedAt = event.at
  }
  const hidden = labelsForUse({ item: 'Soup Base', qty: 1, now: renderedAt, overrides: {} })
  const printed = labelsForUse({ item: 'Soup Base', qty: 1, now: printedAt, overrides: {} })
  assert(hidden.labels[0].made === '10/10/26', 'a hidden tab keeps the last render')
  assert(printed.labels[0].made === '10/11/26', 'print recomputes even without a visibility refresh')

  assert(clockRefreshOnEvent('visibilitychange', 'visible'), 'return to the tab')
  const shown = labelsForUse({ item: 'Soup Base', qty: 1, now: later, overrides: {} })
  assert(shown.labels[0].day === 'Sun' && shown.labels[0].made === '10/11/26', 'visible refresh uses the new local day')
}

function testPageIsOpenAndPrintHidesNav() {
  const root = path.join(__dirname, '..')
  const labels = fs.readFileSync(path.join(root, 'pages/labels.js'), 'utf8')
  const index = fs.readFileSync(path.join(root, 'pages/index.js'), 'utf8')
  const dashboard = fs.readFileSync(path.join(root, 'pages/dashboard.js'), 'utf8')
  const login = fs.readFileSync(path.join(root, 'pages/sales-login.js'), 'utf8')
  const component = fs.readFileSync(path.join(root, 'components/DayDocLabels.js'), 'utf8')

  assert(!labels.includes('sales-auth'), 'labels page does not use the sales PIN')
  assert(!labels.includes('getServerSideProps'), 'labels page is not PIN-gated')
  assert(index.includes('href="/labels"'), 'production log links to Day Doc Labels')
  assert(index.includes('Day Doc Labels'), 'tab label')
  assert(!dashboard.includes('/labels') && !dashboard.includes('Day Doc Labels'), 'sales dashboard is unchanged')
  assert(!login.includes('/labels') && !login.includes('Day Doc Labels'), 'sales login is unchanged')
  assert(component.includes('labelsForUse'), 'print builds labels through the clock helper')
  assert(component.includes('new Date()'), 'print reads the clock at click time')
  assert(component.includes('visibilitychange') && component.includes('focus'), 'listeners re-render the page')
  assert(component.includes('msUntilLocalMidnight'), 'midnight timer is armed from local midnight')

  assert(DAY_DOC_CSS.includes('size: 0.9in 0.9in'), 'label page size')
  assert(DAY_DOC_CSS.includes('width: 0.9in'), 'printed label width')
  assert(DAY_DOC_CSS.includes('height: 0.9in'), 'printed label height')
  assert(DAY_DOC_CSS.includes('.day-doc .label-day      { font-size: 18px; letter-spacing: 0.5px; }'), 'printed day size')
  assert(DAY_DOC_CSS.includes('display: none !important'), 'chrome hidden in print')
  assert(DAY_DOC_CSS.includes('.day-doc header'), 'site header is in the print hide list')
  assert(DAY_DOC_CSS.includes('.day-doc .site-tabs'), 'site tabs are in the print hide list')
}

function main() {
  testMenuAndAbbreviations()
  testClockAcrossMidnight()
  testRefreshEvents()
  testPageIsOpenAndPrintHidesNav()
  console.log('verify-day-doc-labels: ok')
}

main()
