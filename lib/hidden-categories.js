// Categories hidden from the Daily Log screen's Category row (still exist
// in Square, just not shown here) — and also excluded from the "Which Case
// Is This?" matches, since a raw/location category item isn't a finished
// product you'd package a batch into. Shared between pages/index.js (the
// category row) and pages/api/case-matches.js (the case picker) so they
// always agree on what's hidden. Edit this list to change what's hidden
// (name match is case-insensitive).
export const HIDDEN_CATEGORIES = [
  'Dry Goods',
  'Cajun Market Meats Products',
  'Battered Freezer',
  'Raw Goods (frozen)',
  'Raw Goods (Refrigerated)',
  'Uncategorized',
  'Vegetables',
  'Order Bot'
]
