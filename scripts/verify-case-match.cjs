'use strict'

const {
  initialCaseSelection,
  rankCaseMatches,
  todoistMatchWords,
  withSavedMatch
} = require('../lib/case-match')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Names taken from the wholesale Square catalog. Variation ids here are
// fixtures for the matcher — the live picker still uses whatever id Square
// returns for that name. No product-master row is invented.
const ITEMS = [
  { variationId: 'var-potato-salad', name: 'Potato Salad' },
  { variationId: 'var-mashed', name: 'Mashed Potatoes' },
  { variationId: 'var-twice', name: 'Twice Baked Potatoes' },
  { variationId: 'var-twice-reg', name: 'Twice Baked Potatoes (regular)' },
  { variationId: 'var-sweet', name: 'Baked Sweet Potato' },
  { variationId: 'var-peeled', name: 'Peeled Potatoes' },
  { variationId: 'var-shrimp-pot', name: 'Shrimp Potatoes' },
  { variationId: 'var-russet', name: 'Russet Potatoes (case)' },
  { variationId: 'var-meatballs', name: 'Meatballs (Bucket)' },
  { variationId: 'var-meatball-stew', name: 'Meatball Stew (6)' },
  { variationId: 'var-okra-2', name: 'Smothered Okra (2qt)' },
  { variationId: 'var-okra-6', name: 'Smothered Okra (6qt)' },
  { variationId: 'var-gumbo-cafe', name: 'Seafood Gumbo (Cafe)' },
  { variationId: 'var-gumbo-6', name: 'Seafood Gumbo (6)' },
  { variationId: 'var-jambalaya-cafe', name: 'Seafood Jambalaya (Cafe)' },
  { variationId: 'var-crab-corn', name: 'Crab and Corn Soup (6)' },
  { variationId: 'var-soup-base', name: 'Soup Base' },
  { variationId: 'var-au-base', name: 'Au gratin base' },
  { variationId: 'var-crab-au', name: 'Crabmeat Au gratin (12)' },
  { variationId: 'var-shrimp-12', name: 'Stuffed Shrimp (12)' },
  { variationId: 'var-shrimp-heb', name: 'Stuffed Shrimp (12) HEBERTS' },
  { variationId: 'var-jalapeno', name: 'Stuffed Jalapeno (12)' },
  { variationId: 'var-chicken-breast', name: 'Chicken Breast' },
  { variationId: 'var-chicken-raw', name: 'Chicken Breast (raw)' },
  { variationId: 'var-chicken-gumbo', name: 'Chicken and Sausage Gumbo (6)' },
  { variationId: 'var-chicken-cafe', name: 'Chicken and Sausage (Cafe)' },
  { variationId: 'var-cfs', name: 'CFS' }
]

function namesFor(title) {
  return rankCaseMatches(title, ITEMS).map(m => m.name)
}

function testPotatoSaladTitles() {
  const titles = [
    'Potato Salad TILT - 1 bucket',
    'potato salad 1 bucket TILT',
    'potato salad 1 bucket',
    'potato salad 1 BUCKETS',
    'Potato Salad - 2 buckets',
    'Potato Salad TILT',
    'Potato Salad'
  ]
  for (const title of titles) {
    const names = namesFor(title)
    assert(names[0] === 'Potato Salad', `${title} top match was ${names[0]}`)
    assert(!names.includes('Mashed Potatoes'), `${title} matched mashed potatoes`)
    assert(!names.includes('Twice Baked Potatoes'), `${title} matched twice baked`)
    assert(!names.includes('Baked Sweet Potato'), `${title} matched sweet potato`)
    assert(!names.includes('Peeled Potatoes'), `${title} matched peeled potatoes`)
    assert(!names.includes('Shrimp Potatoes'), `${title} matched shrimp potatoes`)
    assert(!names.includes('Meatballs (Bucket)'), `${title} matched meatballs`)
  }
}

function testNoiseDoesNotCollapseOtherSkus() {
  const mashed = namesFor('Mashed Potatoes TILT - 4 buckets')
  assert(mashed[0] === 'Mashed Potatoes', `mashed top ${mashed[0]}`)
  assert(!mashed.includes('Potato Salad'), 'mashed matched potato salad')

  const twice = namesFor('Twice Baked Potatoes TILT - 1 bucket')
  assert(twice[0] === 'Twice Baked Potatoes', `twice top ${twice[0]}`)
  assert(twice.includes('Twice Baked Potatoes (regular)'), 'twice regular still offered')
  assert(!twice.includes('Potato Salad'), 'twice baked matched potato salad')

  const okra = namesFor('Smothered Okra (2qt)')
  assert(okra[0] === 'Smothered Okra (2qt)', `okra top ${okra[0]}`)
  assert(okra[1] === 'Smothered Okra (6qt)', '6qt still a lower match')

  const gumbo = namesFor('Seafood Gumbo (cafe) TILT')
  assert(gumbo[0] === 'Seafood Gumbo (Cafe)', `gumbo top ${gumbo[0]}`)

  const meatballs = namesFor('Meatballs (Bucket)')
  assert(meatballs.length === 1 && meatballs[0] === 'Meatballs (Bucket)', `meatballs ${meatballs}`)

  const jalapenos = namesFor('stuffed jalapenos')
  assert(jalapenos[0] === 'Stuffed Jalapeno (12)', `jalapeno top ${jalapenos[0]}`)

  const heberts = namesFor('Shrimp (12) Heberts')
  assert(heberts[0] === 'Stuffed Shrimp (12) HEBERTS', `heberts top ${heberts[0]}`)

  assert(!todoistMatchWords('Potato Salad TILT - 1 bucket').includes('tilt'), 'tilt stripped')
  assert(!todoistMatchWords('Potato Salad TILT - 1 bucket').includes('bucket'), 'bucket count stripped')
  assert(todoistMatchWords('Meatballs (Bucket)').includes('bucket'), 'container bucket kept')
  assert(todoistMatchWords('Smothered Okra (2qt)').includes('2qt'), 'pack size kept')
}

function testSavedFinishItemPopulates() {
  const saved = { variationId: 'var-potato-salad', name: 'Potato Salad' }
  const ranked = rankCaseMatches('Potato Salad TILT - 1 bucket', ITEMS)
  const matches = withSavedMatch(ranked, saved, ITEMS)
  const selected = initialCaseSelection(matches, saved)
  assert(selected.variationId === 'var-potato-salad', 'saved potato salad is pre-selected')
  assert(selected.name === 'Potato Salad', 'saved name is the finish item')

  // Fuzzy miss (no catalog rows) still surfaces a visible saved finish item.
  const onlySaved = withSavedMatch([], saved, ITEMS)
  assert(onlySaved.length === 1 && onlySaved[0].variationId === 'var-potato-salad', 'empty fuzzy list keeps saved item')
  const populated = initialCaseSelection(onlySaved, saved)
  assert(populated.variationId === 'var-potato-salad', 'saved-only list populates the picker')

  // A saved variation that is not in the visible catalog must not be offered.
  const hidden = withSavedMatch([], { variationId: 'var-gone', name: 'Potato Salad' }, ITEMS)
  assert(hidden.length === 0, 'hidden saved variation stays out')
  assert(initialCaseSelection([], saved).variationId === '', 'client does not invent a selection the API omitted')

  // A non-empty fuzzy list is not rewritten just because a different mapping exists.
  const kept = withSavedMatch(ranked, { variationId: 'var-mashed', name: 'Mashed Potatoes' }, ITEMS)
  assert(kept.length === ranked.length && kept[0].name === 'Potato Salad', 'fuzzy hits are kept')
  const sole = initialCaseSelection(kept, { variationId: 'var-mashed', name: 'Mashed Potatoes' })
  assert(sole.variationId === 'var-potato-salad', 'the one real match is pre-selected')
  assert(sole.name === 'Potato Salad', 'stale mapping name is not used')
}

function testPastChickenAlias() {
  const titles = [
    'past chicken',
    'Past Chicken',
    'PAST CHICKEN',
    'pass chicken',
    'Pass Chicken',
    'past chicken TILT',
    'past chicken TILT - 1 bucket',
    'Pass Chicken - 2 buckets',
    'pass chicken 1 BUCKETS',
    '1 bucket of past chicken'
  ]
  const chickenNames = [
    'Chicken Breast (raw)',
    'Chicken and Sausage Gumbo (6)',
    'Chicken and Sausage (Cafe)',
    'CFS'
  ]
  for (const title of titles) {
    const names = namesFor(title)
    assert(names.length === 1 && names[0] === 'Chicken Breast', `${title} matched ${names.join(', ')}`)
    for (const other of chickenNames) {
      assert(!names.includes(other), `${title} also matched ${other}`)
    }
    const selected = initialCaseSelection(rankCaseMatches(title, ITEMS), null)
    assert(selected.variationId === 'var-chicken-breast', `${title} did not pre-select Chicken Breast`)
    assert(selected.name === 'Chicken Breast', `${title} pre-select name ${selected.name}`)
  }

  assert(!namesFor('Pass CFS').includes('Chicken Breast'), 'Pass CFS is not chicken breast')
  assert(!namesFor('chicken salad').includes('Chicken Breast'), 'chicken salad is not an alias')
  assert(!namesFor('Chicken and Sausage Gumbo (6)').includes('Chicken Breast'), 'gumbo title stays off chicken breast')
  const gumbo = namesFor('Chicken and Sausage Gumbo (6)')
  assert(gumbo[0] === 'Chicken and Sausage Gumbo (6)', `gumbo top ${gumbo[0]}`)
}

testPotatoSaladTitles()
testNoiseDoesNotCollapseOtherSkus()
testSavedFinishItemPopulates()
testPastChickenAlias()
console.log('case-match ok')
