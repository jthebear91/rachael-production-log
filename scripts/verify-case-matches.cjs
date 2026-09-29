'use strict'

const { selectCaseMatches } = require('../lib/case-matches')

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

testPorkRoastOffersBrownGravy()
testOtherTasksUnchanged()
testDoesNotInventGravy()
testNoDuplicateWhenAlreadyMatched()
console.log('verify-case-matches: ok')
