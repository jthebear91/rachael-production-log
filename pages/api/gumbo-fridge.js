// Cafe fridge refresh for the open sales dashboard.
// Sales session cookie only. BRIDGE_API_KEY does not authorize this route.

import { isSalesAuthenticated, salesUnauthorizedMessage } from '../../lib/sales-auth.js'
import { loadGumboFridge } from '../../lib/gumbo-fridge.js'
import { sanitizeErrorMessage } from '../../lib/square-client.js'

export async function gumboFridgeHandler(req, res, load = loadGumboFridge) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isSalesAuthenticated(req)) {
    return res.status(401).json({ error: salesUnauthorizedMessage() })
  }
  try {
    const fridge = await load()
    return res.status(200).json({ data: fridge })
  } catch (err) {
    return res.status(500).json({
      error: sanitizeErrorMessage(err?.message || 'Could not load fridge counts')
    })
  }
}

export default function handler(req, res) {
  return gumboFridgeHandler(req, res)
}
