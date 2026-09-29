'use strict'

const {
  selectCaseMatches,
  initialCaseSelection,
  todoistMatchWords,
  withSavedMatch,
  visibleCatalogItems,
  POTATO_SALAD_VARIATION_ID
} = require('../lib/case-matches')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Same names the Daily Log hides. Back Door Cooler is not in this list,
// which is why Brown Gravy is eligible as a finished item.
const HIDDEN = [
  'Dry Goods',
  'Cajun Market Meats Products',
  'Battered Freezer',
  'Raw Goods (frozen)',
  'Raw Goods (Refrigerated)',
  'Uncategorized',
  'Vegetables',
  'Order Bot'
]

const categories = [
  { id: 'back', name: 'Back Door Cooler' },
  { id: 'plate', name: 'Plate Lunches' },
  { id: 'box', name: '12 Count Box' },
  { id: 'six', name: '6 count (quarts)' },
  { id: 'gumbo', name: 'Gumbo Cooler' },
  { id: 'freezer', name: 'Wholesale Freezer' },
  { id: 'dry', name: 'Dry Goods' },
  { id: 'veg', name: 'Vegetables' },
  { id: 'walkin', name: 'Walk-in Freezer' }
]

// Ids and names copied from the live wholesale Daily Log catalog.
const items = [
  { variationId: '4JVU7IFKXD3C4FTQWMOOZPO5', name: 'Brown Gravy', categoryIds: ['back'] },
  { variationId: 'DGS6GG5R6FC6BOFIUXHHUNVM', name: 'White Gravy', categoryIds: ['back'] },
  { variationId: 'UZOWF7OATSDQAMYICYC5GLMH', name: 'Stew Gravy', categoryIds: ['plate'] },
  { variationId: 'EPRQMYBVQNQXE3DUMDRGPMRI', name: 'Pork Roast Lunch', categoryIds: ['plate'] },
  { variationId: 'HKNKKSEADIGCHQ5EUL7PSX4E', name: 'Crawfish Pies (12)', categoryIds: ['box', 'freezer'] },
  { variationId: 'AKXIO5AHKFM4JIWWCIU7PWHX', name: 'Stuffed Jalapeno (12)', categoryIds: ['box'] },
  { variationId: '5XJQ4I5AAGWNCGFM4ZCUJE5M', name: 'Seafood Gumbo (6)', categoryIds: ['six', 'freezer'] },
  { variationId: 'GOBEW6URKW5BHTZF36VPCEZC', name: 'Seafood Gumbo (Cafe)', categoryIds: ['gumbo'] },
  { variationId: 'X3FKQUK3TYZGT4RTZRSMXR2G', name: 'Chicken Base', categoryIds: ['dry'] },
  { variationId: 'VTY66WPMGXFHOFR7BZO7RE2V', name: 'Oven Roasted Beets', categoryIds: ['veg'] },
  { variationId: 'SJ2SW4XYNX35H2OKELXH7Z3S', name: 'Crab Etouffee', categoryIds: ['walkin'] }
]

function ids(itemName) {
  return selectCaseMatches(itemName, items, categories, HIDDEN).map(m => m.variationId)
}

function testPorkRoastOffersBrownGravy() {
  for (const name of ['Pork Roast', 'Pork Roast TILT', 'Pork Roast Lunch', 'tilt-skillet Pork Roast']) {
    const matches = selectCaseMatches(name, items, categories, HIDDEN)
    assert(matches.length === 2, `${name} should offer two outputs, got ${matches.map(m => m.name).join(', ')}`)
    assert(matches[0].name === 'Pork Roast Lunch', `${name} keeps Pork Roast Lunch first`)
    assert(matches[0].variationId === 'EPRQMYBVQNQXE3DUMDRGPMRI', `${name} pork roast lunch id`)
    assert(matches[1].name === 'Brown Gravy', `${name} second choice is the catalog name`)
    assert(matches[1].variationId === '4JVU7IFKXD3C4FTQWMOOZPO5', `${name} brown gravy variation`)
    assert(!matches.some(m => m.name === 'White Gravy' || m.name === 'Stew Gravy'), `${name} does not pick other gravies`)
  }
}

function testOtherTasksUnchanged() {
  const pies = selectCaseMatches('Crawfish Pies TILT', items, categories, HIDDEN)
  assert(pies.length === 1 && pies[0].name === 'Crawfish Pies (12)', 'crawfish pies tilt')
  assert(!pies.some(m => m.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5'), 'pies do not get brown gravy')

  const jalapenos = selectCaseMatches('stuffed jalapenos', items, categories, HIDDEN)
  assert(jalapenos.length === 1 && jalapenos[0].name === 'Stuffed Jalapeno (12)', 'jalapeno plural stem')

  const accented = selectCaseMatches('stuffed jalapeños', items, categories, HIDDEN)
  assert(accented.length === 1 && accented[0].variationId === 'AKXIO5AHKFM4JIWWCIU7PWHX', 'accented jalapeño still matches')

  const gumbo = ids('Seafood Gumbo')
  assert(gumbo.includes('5XJQ4I5AAGWNCGFM4ZCUJE5M'), 'seafood gumbo case')
  assert(gumbo.includes('GOBEW6URKW5BHTZF36VPCEZC'), 'seafood gumbo cafe')
  assert(!gumbo.includes('4JVU7IFKXD3C4FTQWMOOZPO5'), 'gumbo does not get brown gravy')

  const etouffee = ids('Crab Etouffee')
  assert(etouffee.length === 1 && etouffee[0] === 'SJ2SW4XYNX35H2OKELXH7Z3S', 'crab etouffee only')

  const base = ids('Soup Base')
  assert(base.length === 0, 'one shared word is not a match')
  assert(!ids('Pork').includes('4JVU7IFKXD3C4FTQWMOOZPO5'), 'pork alone is not pork roast')
  assert(!ids('Roast Beef').includes('4JVU7IFKXD3C4FTQWMOOZPO5'), 'roast beef is not pork roast')
}

function testDoesNotInventGravy() {
  const renamed = items.map(i => i.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5' ? { ...i, name: 'White Gravy' } : i)
  const matches = selectCaseMatches('Pork Roast', renamed, categories, HIDDEN)
  assert(matches.length === 1 && matches[0].name === 'Pork Roast Lunch', 'renamed variation is not offered as brown gravy')

  const missing = items.filter(i => i.variationId !== '4JVU7IFKXD3C4FTQWMOOZPO5')
  missing.push({ variationId: 'SOME_OTHER_BROWN_GRAVY', name: 'Brown Gravy', categoryIds: ['back'] })
  const fallback = selectCaseMatches('Pork Roast TILT', missing, categories, HIDDEN)
  assert(!fallback.some(m => m.name === 'Brown Gravy'), 'a different brown gravy variation is not a substitute')
  assert(fallback.some(m => m.name === 'Pork Roast Lunch'), 'pork roast lunch still matches')

  const hiddenGravy = items.map(i => i.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5' ? { ...i, categoryIds: ['dry'] } : i)
  const hidden = selectCaseMatches('Pork Roast', hiddenGravy, categories, HIDDEN)
  assert(!hidden.some(m => m.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5'), 'hidden-category brown gravy stays hidden')
}

function testNoDuplicateWhenAlreadyMatched() {
  const matches = selectCaseMatches('Pork Roast Brown Gravy', items, categories, HIDDEN)
  const gravy = matches.filter(m => m.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5')
  assert(gravy.length === 1, 'brown gravy is listed once')
  assert(matches.some(m => m.name === 'Pork Roast Lunch'), 'pork roast lunch still offered')
}

// Potato Salad and the potato sides live in visible cooler categories.
// Chicken Breast (raw) is also visible here on purpose: the pass/past
// chicken alias has to pick the exact name, not "win" because raw is hidden.
const FINISH_ITEMS = items.concat([
  { variationId: POTATO_SALAD_VARIATION_ID, name: 'Potato Salad', categoryIds: ['walkin'] },
  { variationId: 'var-mashed', name: 'Mashed Potatoes', categoryIds: ['walkin'] },
  { variationId: 'var-twice', name: 'Twice Baked Potatoes', categoryIds: ['walkin'] },
  { variationId: 'var-twice-reg', name: 'Twice Baked Potatoes (regular)', categoryIds: ['walkin'] },
  { variationId: 'var-sweet', name: 'Baked Sweet Potato', categoryIds: ['walkin'] },
  { variationId: 'var-peeled', name: 'Peeled Potatoes', categoryIds: ['walkin'] },
  { variationId: 'var-shrimp-pot', name: 'Shrimp Potatoes', categoryIds: ['walkin'] },
  { variationId: 'var-russet', name: 'Russet Potatoes (case)', categoryIds: ['walkin'] },
  { variationId: 'var-meatballs', name: 'Meatballs (Bucket)', categoryIds: ['walkin'] },
  { variationId: 'var-meatball-stew', name: 'Meatball Stew (6)', categoryIds: ['six'] },
  { variationId: 'var-okra-2', name: 'Smothered Okra (2qt)', categoryIds: ['six'] },
  { variationId: 'var-okra-6', name: 'Smothered Okra (6qt)', categoryIds: ['six'] },
  { variationId: 'var-shrimp-12', name: 'Stuffed Shrimp (12)', categoryIds: ['box'] },
  { variationId: 'var-shrimp-heb', name: 'Stuffed Shrimp (12) HEBERTS', categoryIds: ['box'] },
  { variationId: 'var-chicken-breast', name: 'Chicken Breast', categoryIds: ['walkin'] },
  { variationId: 'var-chicken-raw', name: 'Chicken Breast (raw)', categoryIds: ['walkin'] },
  { variationId: 'var-chicken-gumbo', name: 'Chicken and Sausage Gumbo (6)', categoryIds: ['six'] },
  { variationId: 'var-chicken-cafe', name: 'Chicken and Sausage (Cafe)', categoryIds: ['gumbo'] },
  { variationId: 'var-cfs', name: 'CFS', categoryIds: ['walkin'] }
])

const POTATO_DISTRACTORS = [
  'Mashed Potatoes',
  'Twice Baked Potatoes',
  'Twice Baked Potatoes (regular)',
  'Baked Sweet Potato',
  'Peeled Potatoes',
  'Shrimp Potatoes',
  'Russet Potatoes (case)',
  'Meatballs (Bucket)'
]

function namesFor(title, catalog = FINISH_ITEMS) {
  return selectCaseMatches(title, catalog, categories, HIDDEN).map(m => m.name)
}

function testPotatoSaladTiltUsesRealVariation() {
  const titles = [
    'Potato Salad TILT - 1 bucket',
    'potato salad 1 bucket TILT',
    'tilt-skillet Potato Salad',
    'Potato Salad - Tilt Skillet',
    'Potato Salad TILT',
    'POTATO SALAD tilt - 1 BUCKETS'
  ]
  for (const title of titles) {
    const matches = selectCaseMatches(title, FINISH_ITEMS, categories, HIDDEN)
    assert(matches.length === 1, `${title} should be only Potato Salad, got ${matches.map(m => m.name).join(', ')}`)
    assert(matches[0].name === 'Potato Salad', `${title} name ${matches[0] && matches[0].name}`)
    assert(matches[0].variationId === 'FLM4PLTWH5T5EDE6E5AD5H6Q', `${title} variation ${matches[0] && matches[0].variationId}`)
    assert(matches[0].variationId === POTATO_SALAD_VARIATION_ID, `${title} constant id`)
    for (const other of POTATO_DISTRACTORS) {
      assert(!matches.some(m => m.name === other), `${title} mapped to ${other}`)
    }
    const selected = initialCaseSelection(matches, null)
    assert(selected.variationId === 'FLM4PLTWH5T5EDE6E5AD5H6Q', `${title} was not pre-selected`)
    assert(selected.name === 'Potato Salad', `${title} pre-select name ${selected.name}`)
  }

  // Same titles with no station tag still land on Potato Salad by name,
  // and still stay off the other potato sides.
  for (const title of ['potato salad 1 bucket', 'potato salad 1 BUCKETS', 'Potato Salad - 2 buckets', 'Potato Salad']) {
    const names = namesFor(title)
    assert(names[0] === 'Potato Salad', `${title} top match was ${names[0]}`)
    assert(names.includes('Potato Salad'), `${title} missing Potato Salad`)
    const matches = selectCaseMatches(title, FINISH_ITEMS, categories, HIDDEN)
    assert(matches.some(m => m.variationId === 'FLM4PLTWH5T5EDE6E5AD5H6Q'), `${title} missed the real variation`)
    for (const other of POTATO_DISTRACTORS) {
      assert(!names.includes(other), `${title} matched ${other}`)
    }
  }
}

function testPotatoSaladDoesNotInventVariation() {
  const renamed = FINISH_ITEMS.map(i => i.variationId === POTATO_SALAD_VARIATION_ID ? { ...i, name: 'Mashed Potatoes' } : i)
  const renamedMatches = selectCaseMatches('Potato Salad TILT - 1 bucket', renamed, categories, HIDDEN)
  assert(!renamedMatches.some(m => m.variationId === POTATO_SALAD_VARIATION_ID), 'renamed variation is not offered as Potato Salad')
  assert(!renamedMatches.some(m => m.name === 'Twice Baked Potatoes'), 'renamed catalog does not fall through to twice baked')

  const missing = FINISH_ITEMS.filter(i => i.variationId !== POTATO_SALAD_VARIATION_ID)
  missing.push({ variationId: 'SOME_OTHER_POTATO_SALAD', name: 'Potato Salad', categoryIds: ['walkin'] })
  const fallback = selectCaseMatches('tilt-skillet Potato Salad', missing, categories, HIDDEN)
  assert(!fallback.some(m => m.variationId === POTATO_SALAD_VARIATION_ID), 'a missing variation id is not invented')
  assert(fallback.some(m => m.name === 'Potato Salad' && m.variationId === 'SOME_OTHER_POTATO_SALAD'), 'name match still offers the visible Potato Salad')
  assert(!fallback.some(m => m.name === 'Mashed Potatoes' || m.name === 'Twice Baked Potatoes'), 'fallback stays off other potato sides')

  const hiddenSalad = FINISH_ITEMS.map(i => i.variationId === POTATO_SALAD_VARIATION_ID ? { ...i, categoryIds: ['dry'] } : i)
  const hidden = selectCaseMatches('Potato Salad - Tilt Skillet', hiddenSalad, categories, HIDDEN)
  assert(!hidden.some(m => m.variationId === POTATO_SALAD_VARIATION_ID), 'hidden-category Potato Salad stays hidden')
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

function testPorkRoastStillOfferedBesidePotatoSalad() {
  for (const name of ['Pork Roast', 'Pork Roast TILT', 'Pork Roast Lunch', 'tilt-skillet Pork Roast']) {
    const matches = selectCaseMatches(name, FINISH_ITEMS, categories, HIDDEN)
    assert(matches[0].name === 'Pork Roast Lunch', `${name} keeps Pork Roast Lunch first among potato sides`)
    assert(matches[0].variationId === 'EPRQMYBVQNQXE3DUMDRGPMRI', `${name} pork roast lunch id`)
    assert(matches.some(m => m.variationId === '4JVU7IFKXD3C4FTQWMOOZPO5' && m.name === 'Brown Gravy'), `${name} still offers Brown Gravy`)
    assert(!matches.some(m => m.variationId === POTATO_SALAD_VARIATION_ID), `${name} is not Potato Salad`)
    const selected = initialCaseSelection(matches, null)
    assert(selected.variationId === '', `${name} has two outputs and is not auto-picked`)
  }
}

function testSavedFinishItemPopulates() {
  const saved = { variationId: POTATO_SALAD_VARIATION_ID, name: 'Potato Salad' }
  const visible = visibleCatalogItems(FINISH_ITEMS, categories, HIDDEN)
  const ranked = selectCaseMatches('Potato Salad TILT - 1 bucket', FINISH_ITEMS, categories, HIDDEN)
  const matches = withSavedMatch(ranked, saved, visible)
  const selected = initialCaseSelection(matches, saved)
  assert(selected.variationId === POTATO_SALAD_VARIATION_ID, 'saved potato salad is pre-selected')
  assert(selected.name === 'Potato Salad', 'saved name is the finish item')

  const onlySaved = withSavedMatch([], saved, visible)
  assert(onlySaved.length === 1 && onlySaved[0].variationId === POTATO_SALAD_VARIATION_ID, 'empty fuzzy list keeps saved item')
  const populated = initialCaseSelection(onlySaved, saved)
  assert(populated.variationId === POTATO_SALAD_VARIATION_ID, 'saved-only list populates the picker')

  const hiddenSaved = withSavedMatch([], { variationId: 'var-gone', name: 'Potato Salad' }, visible)
  assert(hiddenSaved.length === 0, 'hidden saved variation stays out')
  assert(initialCaseSelection([], saved).variationId === '', 'client does not invent a selection the API omitted')

  const kept = withSavedMatch(ranked, { variationId: 'var-mashed', name: 'Mashed Potatoes' }, visible)
  assert(kept.length === ranked.length && kept[0].name === 'Potato Salad', 'fuzzy hits are kept')
  const sole = initialCaseSelection(kept, { variationId: 'var-mashed', name: 'Mashed Potatoes' })
  assert(sole.variationId === POTATO_SALAD_VARIATION_ID, 'the one real match is pre-selected')
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
    const matches = selectCaseMatches(title, FINISH_ITEMS, categories, HIDDEN)
    const names = matches.map(m => m.name)
    assert(names.length === 1 && names[0] === 'Chicken Breast', `${title} matched ${names.join(', ')}`)
    assert(matches[0].variationId === 'var-chicken-breast', `${title} variation ${matches[0] && matches[0].variationId}`)
    for (const other of chickenNames) {
      assert(!names.includes(other), `${title} also matched ${other}`)
    }
    const selected = initialCaseSelection(matches, null)
    assert(selected.variationId === 'var-chicken-breast', `${title} did not pre-select Chicken Breast`)
    assert(selected.name === 'Chicken Breast', `${title} pre-select name ${selected.name}`)
  }

  assert(!namesFor('Pass CFS').includes('Chicken Breast'), 'Pass CFS is not chicken breast')
  assert(!namesFor('chicken salad').includes('Chicken Breast'), 'chicken salad is not an alias')
  assert(!namesFor('Chicken and Sausage Gumbo (6)').includes('Chicken Breast'), 'gumbo title stays off chicken breast')
  const gumbo = namesFor('Chicken and Sausage Gumbo (6)')
  assert(gumbo[0] === 'Chicken and Sausage Gumbo (6)', `gumbo top ${gumbo[0]}`)
}

testPorkRoastOffersBrownGravy()
testOtherTasksUnchanged()
testDoesNotInventGravy()
testNoDuplicateWhenAlreadyMatched()
testPotatoSaladTiltUsesRealVariation()
testPotatoSaladDoesNotInventVariation()
testNoiseDoesNotCollapseOtherSkus()
testPorkRoastStillOfferedBesidePotatoSalad()
testSavedFinishItemPopulates()
testPastChickenAlias()
console.log('verify-case-matches: ok')
