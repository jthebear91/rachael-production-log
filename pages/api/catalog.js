// Fetches the Square catalog for the Daily Log screen's category+item list.
// The actual fetch/parse logic lives in lib/square-catalog.js so that
// /api/case-matches (used to match a Todoist batch to a finished-case SKU)
// can reuse the exact same item list without duplicating this code.
import { fetchCatalog } from '../../lib/square-catalog'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const { categories, items } = await fetchCatalog()
    res.status(200).json({ categories, items })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
