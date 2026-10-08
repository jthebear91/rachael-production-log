// Wholesale Mac morning heartbeat. POST only.
// Auth and the Supabase insert live in lib/mac-heartbeat.js.

import { macHeartbeatHandler } from '../../lib/mac-heartbeat.js'

export { macHeartbeatHandler }

export default function handler(req, res) {
  return macHeartbeatHandler(req, res)
}
