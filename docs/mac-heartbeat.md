# Wholesale Mac morning heartbeat

Production host: `https://rachael-production-log.vercel.app`

A LaunchAgent on the wholesale Mac (installed on the Mac, not in this repo) runs at 4:30 AM America/Chicago, Monday–Saturday. It looks in `Documents/Wholesale Ordering/` for today's `[YYYY-MM-DD] <Day> Pick List` PDF (`... QR.pdf`, or the plain name without `QR`) and POSTs one report here.

This route only records that report. It does not build the pick list, mint a token, or read the row back. Another job reads `public.wholesale_mac_heartbeat` at 4:45 AM America/Chicago and alerts Jordan when there is no row for today or `pick_list_found` is false.

The table already exists on Supabase project `sbsqnzqswodxanbddoks` (rachael-production). `supabase/wholesale_mac_heartbeat.sql` is the schema record. Do not create the table again.

## Env

| Variable | Required | Role |
|---|---|---|
| `MAC_HEARTBEAT_SECRET` | Yes | `Authorization: Bearer` value. If it is unset or blank, every POST returns 503 and nothing is inserted. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Already used by the other server writes. |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key. Already used for `wholesale_pulls` and `pick_tokens`. Server-only. |

Set `MAC_HEARTBEAT_SECRET` on the Vercel **Production** environment. The route reads it at runtime. A deployment must include both this route and the variable. Do not log the secret, and do not reuse `BRIDGE_API_KEY` or `WHOLESALE_PULL_POLL_KEY`.

## Request

`POST /api/mac-heartbeat`

`Authorization: Bearer <MAC_HEARTBEAT_SECRET>`

`Content-Type: application/json`

```json
{
  "check_date": "2026-10-08",
  "mac_reported_at": "2026-10-08T09:30:00.000Z",
  "hostname": "wholesale-mac",
  "pick_list_found": true,
  "pick_list_filename": "2026-10-08 Thursday Pick List QR.pdf",
  "pick_list_mtime": "2026-10-08T07:15:00-05:00",
  "pick_list_has_qr": true,
  "note": "optional, 500 characters max"
}
```

`check_date` is the Mac's America/Chicago calendar date, `YYYY-MM-DD`. The server stores that date. It does not replace it with the server clock.

`pick_list_found` is a JSON boolean. `true` and `false` are both stored.

Optional fields may be omitted, `null`, or `""`. Timestamps must include a timezone (`Z` or `±hh:mm`). `note`, `hostname`, and `pick_list_filename` are trimmed and rejected above 500 characters. `note` may contain newlines. Other control characters are rejected, as are control characters in `hostname` and `pick_list_filename`. Unknown fields are rejected.

Each call inserts one new row. `check_date` is not unique.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/mac-heartbeat" \
  -H "Authorization: Bearer $MAC_HEARTBEAT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"check_date":"2026-10-08","mac_reported_at":"2026-10-08T09:30:00.000Z","hostname":"wholesale-mac","pick_list_found":true,"pick_list_filename":"2026-10-08 Thursday Pick List QR.pdf","pick_list_mtime":"2026-10-08T07:15:00-05:00","pick_list_has_qr":true}'
```

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ "ok": true, "id": 1 }` | Row inserted. `id` is the new bigint. |
| 400 | `{ "error": "..." }` | Body failed validation. |
| 401 | `{ "error": "Unauthorized" }` | Missing or wrong bearer token. |
| 405 | `{ "error": "Method not allowed" }` | Anything other than POST. `Allow: POST`. |
| 503 | `{ "error": "Heartbeat is not configured" }` | `MAC_HEARTBEAT_SECRET` is unset. The body is not accepted. |
| 503 | `{ "error": "Heartbeat store is not configured" }` | Supabase URL or service key is missing. |
| 503 | `{ "error": "Heartbeat was not recorded" }` | The insert failed. |

There is no GET route.
