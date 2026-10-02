// Picks the short finished-case list for a Todoist batch name.
// Name scoring is the same overlap rule Daily Log has always used, after
// the tilt-skillet station and a counted batch ("1 bucket") are ignored.
// Those tokens are not part of the Square item. Counting them raised the
// overlap bar until "Potato Salad" (two words) no longer qualified.
//
// Pork Roast additionally offers leftover Brown Gravy, which is the
// base of that batch and is sometimes left over as its own finished item.
//
// Brown Gravy is not a new product. It is the existing wholesale Daily Log
// catalog row (GET /api/catalog):
//   name: Brown Gravy
//   variationId (stored as case_sku_id): 4JVU7IFKXD3C4FTQWMOOZPO5
//   category: Back Door Cooler (7DFHIZ6I2CXFJUQ5TGSR6I34)
// That catalog row has no separate SKU string, unit, or yield. The crew
// still types the quantity on the split, the same way as any other case.
// The extra is added only when this variation is still visible and still
// named Brown Gravy. White Gravy and Stew Gravy are different items and
// are never substituted.
//
// A tilt-skillet Potato Salad task is the finished item Potato Salad,
// variation FLM4PLTWH5T5EDE6E5AD5H6Q, when that row is still visible and
// still named Potato Salad. Mashed Potatoes, Twice Baked Potatoes, and
// the other potato sides are never substituted for it.
//
// A smothered-okra cook task (Todoist: "1 batch smothered okra TILT",
// which the Package list parses down to "smothered okra TILT", plus
// "sm okra" with or without TILT or a batch count) offers both finished
// sizes from the live wholesale Daily Log catalog:
//   Smothered Okra (2qt)  U5V6UET2C3ZFJSJGUIRY2PTC  Walk-in Freezer
//   Smothered Okra (6qt)  JBXVYZNZD7JDCFLKLEYIQR3P  Raw Goods (frozen)
// There is no catalog row named "Sm Okra (2qt)" or "Sm Okra (6qt)".
// The 6qt variation's only category is Raw Goods (frozen), which Daily
// Log hides, so a name match never sees it. The pin reads the full
// catalog passed into selectCaseMatches and still requires that exact
// variation id and that exact name. A renamed row, or a different id
// that happens to be called Smothered Okra (6qt), is not substituted.
// Shrimp and Okra is a different item and is never offered here.

const STOPWORDS = new Set(['of', 'and', 'the', 'a', 'an', 'with', 'for'])
const STATION_WORDS = new Set(['tilt', 'skillet'])

// Nicknames that share no words with the Square finish item. The key is the
// Todoist title after station tags and bucket counts are removed. The value
// is the exact catalog name (word-for-word), so "Chicken Breast (raw)" is
// not a hit for "Chicken Breast". "pass" is how the Package board is typed;
// "past" is the same task as the crew says it.
const FINISH_ALIASES = {
  'pass chicken': 'Chicken Breast',
  'past chicken': 'Chicken Breast'
}

const BROWN_GRAVY_VARIATION_ID = '4JVU7IFKXD3C4FTQWMOOZPO5'
const BROWN_GRAVY_NAME = 'Brown Gravy'
const POTATO_SALAD_VARIATION_ID = 'FLM4PLTWH5T5EDE6E5AD5H6Q'
const POTATO_SALAD_NAME = 'Potato Salad'
const SM_OKRA_2QT_VARIATION_ID = 'U5V6UET2C3ZFJSJGUIRY2PTC'
const SM_OKRA_2QT_NAME = 'Smothered Okra (2qt)'
const SM_OKRA_6QT_VARIATION_ID = 'JBXVYZNZD7JDCFLKLEYIQR3P'
const SM_OKRA_6QT_NAME = 'Smothered Okra (6qt)'

// Light plural stemming so "jalapenos" (Todoist) and "jalapeno" (Square)
// count as the same word — without this, singular/plural mismatches
// between how a batch is named in Todoist vs. Square silently hid the
// correct match.
function stem(w) {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function words(name) {
  return (name || '')
    // Strip accents (jalapeño → jalapeno) BEFORE dropping non-letters —
    // otherwise an accented character gets replaced with a space and
    // splits the word in two (jalapeño → "jalape" + "os"), silently
    // hiding the item from every match.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .map(stem)
}

// Batch quantity ("1 bucket", "4 buckets", "1-bucket") and the tilt-skillet
// station tag. Pack sizes that are part of the SKU — "(12)", "(6)", "(2qt)" —
// stay, and so does a container word with no count ("Meatballs (Bucket)").
function todoistMatchWords(name) {
  const stripped = String(name || '')
    .replace(/\*\*/g, ' ')
    .replace(/\b\d+\s*[-–—]?\s*buckets?\b/gi, ' ')
  return words(stripped).filter(w => !STATION_WORDS.has(w))
}

// Counts shared words, but requires a real amount of overlap before it
// counts as a match at all — a single common word like "base" or "corn"
// matching "Chicken Base" or "Corn Starch" isn't a real match, it's just
// noise. A 1-word item name (like "gumbo") needs that one word to match;
// anything longer needs at least half its words to match, and at least 2.
function scoreMatch(itemWords, catalogWords) {
  const catSet = new Set(catalogWords)
  let shared = 0
  itemWords.forEach(w => { if (catSet.has(w)) shared++ })
  const threshold = itemWords.length <= 1 ? 1 : Math.max(2, Math.ceil(itemWords.length / 2))
  return shared >= threshold ? shared : 0
}

function canonicalName(name) {
  return words(name).join(' ')
}

// Todoist Package tasks look like "Pork Roast" or "Pork Roast TILT"
// (the tilt-skillet board marks the pan the way "Crawfish Pies TILT" does).
function isPorkRoastTask(itemName) {
  return canonicalName(itemName).includes('pork roast')
}

// "smothered okra TILT", "1 batch smothered okra TILT", "sm okra", and
// "2 batches of sm okra" are the same cook. "Shrimp and Okra" is not:
// after stopwords drop, that title is "shrimp okra", which does not
// contain the token sequence "sm okra".
function isSmotheredOkraTask(itemName) {
  const name = canonicalName(itemName)
  if (name.includes('smothered okra')) return true
  return /(^| )sm okra( |$)/.test(name)
}

// "Potato Salad TILT - 1 bucket", "tilt-skillet Potato Salad", and
// "Potato Salad - Tilt Skillet" are the tilt skillet station, not a
// different potato side. A plain "Potato Salad" title (no station tag)
// stays on the normal name match.
function isPotatoSaladTiltTask(itemName) {
  const raw = String(itemName || '')
  const hasStation = /\btilt\b/i.test(raw) || /\bskillet\b/i.test(raw)
  if (!hasStation) return false
  return todoistMatchWords(itemName).join(' ') === canonicalName(POTATO_SALAD_NAME)
}

function visibleCatalogItems(items, categories, hiddenCategories) {
  const hiddenIds = new Set(
    (categories || [])
      .filter(c => (hiddenCategories || []).some(h => h.toLowerCase() === (c.name || '').toLowerCase()))
      .map(c => c.id)
  )
  return (items || []).filter(i => (i.categoryIds || []).some(id => !hiddenIds.has(id)))
}

function namedVariationChoice(catalogItems, variationId, expectedName) {
  const hits = (catalogItems || []).filter(i => i.variationId === variationId)
  if (hits.length !== 1) return null
  const hit = hits[0]
  if (canonicalName(hit.name) !== canonicalName(expectedName)) return null
  return { variationId: hit.variationId, name: hit.name }
}

function brownGravyChoice(visibleItems) {
  return namedVariationChoice(visibleItems, BROWN_GRAVY_VARIATION_ID, BROWN_GRAVY_NAME)
}

function smotheredOkraChoices(catalogItems) {
  return [
    [SM_OKRA_2QT_VARIATION_ID, SM_OKRA_2QT_NAME],
    [SM_OKRA_6QT_VARIATION_ID, SM_OKRA_6QT_NAME]
  ].map(([id, expected]) => namedVariationChoice(catalogItems, id, expected))
}

function appendChoice(matches, choice) {
  if (!choice || !choice.variationId) return matches
  if (matches.some(m => m.variationId === choice.variationId)) return matches
  return matches.concat([choice])
}

function potatoSaladChoice(visibleItems) {
  return namedVariationChoice(visibleItems, POTATO_SALAD_VARIATION_ID, POTATO_SALAD_NAME)
}

function aliasMatches(itemName, items) {
  const catalogName = FINISH_ALIASES[todoistMatchWords(itemName).join(' ')]
  if (!catalogName) return []
  const target = canonicalName(catalogName)
  return (items || [])
    .filter(i => canonicalName(i.name) === target)
    .map(i => ({ variationId: i.variationId, name: i.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function rankCaseMatches(itemName, visibleItems, limit = 8) {
  const itemWords = todoistMatchWords(itemName)
  const fuzzy = (visibleItems || [])
    .map(i => ({ variationId: i.variationId, name: i.name, score: scoreMatch(itemWords, words(i.name)) }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
    .map(({ variationId, name }) => ({ variationId, name }))

  const seen = new Set()
  const merged = []
  for (const match of [...aliasMatches(itemName, visibleItems), ...fuzzy]) {
    if (!match.variationId || seen.has(match.variationId)) continue
    seen.add(match.variationId)
    merged.push(match)
    if (merged.length >= limit) break
  }
  return merged
}

function selectCaseMatches(itemName, items, categories, hiddenCategories) {
  const visibleItems = visibleCatalogItems(items, categories, hiddenCategories)

  // The tilt-skillet potato salad task is this one finished variation.
  // Other potato sides stay off the list, and a single match is what the
  // Daily Log pre-selects.
  if (isPotatoSaladTiltTask(itemName)) {
    const potato = potatoSaladChoice(visibleItems)
    if (potato) return [potato]
  }

  let matches = rankCaseMatches(itemName, visibleItems)

  // Brown Gravy stays on the visible-catalog check: it lives in Back Door
  // Cooler, and a hidden-category gravy is not a finished output.
  if (isPorkRoastTask(itemName)) {
    matches = appendChoice(matches, brownGravyChoice(visibleItems))
  }

  // Both okra sizes are pinned from the full catalog. The 6qt variation
  // is filed only under Raw Goods (frozen), so the visible-item filter
  // would drop it and the cook task would keep offering 2qt alone.
  if (isSmotheredOkraTask(itemName)) {
    for (const choice of smotheredOkraChoices(items)) {
      matches = appendChoice(matches, choice)
    }
  }

  return matches
}

// When the fuzzy list is empty, a finish item saved from the last time this
// exact Todoist title was logged still belongs in the picker — if that
// variation is still a visible catalog item. A non-empty match list is left
// alone so a stale mapping cannot crowd out real name matches.
function withSavedMatch(matches, saved, visibleItems) {
  const list = Array.isArray(matches) ? matches.slice() : []
  if (!saved || !saved.variationId) return list
  if (list.some(m => m.variationId === saved.variationId)) return list
  if (list.length > 0) return list
  const found = (visibleItems || []).find(i => i.variationId === saved.variationId)
  if (!found) return list
  return [{ variationId: found.variationId, name: found.name }]
}

// Pre-select the saved finish item when it is one of the matches. When the
// picker has exactly one match and no saved choice (a nickname such as
// "Pass Chicken" → Chicken Breast, or the tilt-skillet Potato Salad
// variation, which has never been logged before), that single finish item
// is filled in so the cases field is ready.
function initialCaseSelection(matches, lastUsed) {
  const list = matches || []
  const saved = lastUsed && list.some(m => m.variationId === lastUsed.variationId) ? lastUsed : null
  const only = list.length === 1 ? list[0] : null
  const chosen = saved || only
  return {
    variationId: chosen ? chosen.variationId : '',
    name: chosen ? (chosen.name || '') : ''
  }
}

module.exports = {
  BROWN_GRAVY_VARIATION_ID,
  BROWN_GRAVY_NAME,
  POTATO_SALAD_VARIATION_ID,
  POTATO_SALAD_NAME,
  SM_OKRA_2QT_VARIATION_ID,
  SM_OKRA_2QT_NAME,
  SM_OKRA_6QT_VARIATION_ID,
  SM_OKRA_6QT_NAME,
  isPorkRoastTask,
  isSmotheredOkraTask,
  isPotatoSaladTiltTask,
  selectCaseMatches,
  scoreMatch,
  words,
  todoistMatchWords,
  withSavedMatch,
  initialCaseSelection,
  visibleCatalogItems
}
