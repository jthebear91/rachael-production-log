// Match a Todoist Package-board title to finished Square case items.
//
// Crew titles append the station and the batch quantity to the product
// name: "Potato Salad TILT - 1 bucket", "potato salad 1 bucket TILT".
// Those tokens are not part of the Square item. Counting them raised the
// overlap bar until "Potato Salad" (two words) no longer qualified, the
// picker showed no finish item, and a previously saved mapping was ignored
// because it is only pre-selected when it is also in the match list.

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

function aliasMatches(itemName, items) {
  const catalogName = FINISH_ALIASES[todoistMatchWords(itemName).join(' ')]
  if (!catalogName) return []
  const target = words(catalogName).join(' ')
  return (items || [])
    .filter(i => words(i.name).join(' ') === target)
    .map(i => ({ variationId: i.variationId, name: i.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

function rankCaseMatches(itemName, items, limit = 8) {
  const itemWords = todoistMatchWords(itemName)
  const fuzzy = (items || [])
    .map(i => ({ variationId: i.variationId, name: i.name, score: scoreMatch(itemWords, words(i.name)) }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)))
    .map(({ variationId, name }) => ({ variationId, name }))

  const seen = new Set()
  const merged = []
  for (const match of [...aliasMatches(itemName, items), ...fuzzy]) {
    if (!match.variationId || seen.has(match.variationId)) continue
    seen.add(match.variationId)
    merged.push(match)
    if (merged.length >= limit) break
  }
  return merged
}

// When the fuzzy list is empty, a finish item saved from the last time this
// exact Todoist title was logged still belongs in the picker — if that
// variation is still a visible catalog item. A non-empty fuzzy list is left
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
// "Pass Chicken" → Chicken Breast, which has never been logged before),
// that single finish item is filled in so the cases field is ready.
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
  words,
  todoistMatchWords,
  scoreMatch,
  aliasMatches,
  rankCaseMatches,
  withSavedMatch,
  initialCaseSelection
}
