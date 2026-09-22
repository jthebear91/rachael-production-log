# Rachael's Production Log

Daily production logging app for Rachael's Wholesale LLC.

## Environment Variables (set in Vercel)

| Variable | Description |
|---|---|
| `SQUARE_WHOLESALE_TOKEN` | Square access token for wholesale (Rachael's Seafood). Falls back to `SQUARE_TOKEN` if unset. |
| `SQUARE_WHOLESALE_LOCATION_ID` | Square location for wholesale. Falls back to `SQUARE_LOCATION_ID` if unset. |
| `SQUARE_TOKEN` | Legacy wholesale token (Daily Log + default `account=wholesale`) |
| `SQUARE_LOCATION_ID` | Legacy wholesale location ID |
| `SQUARE_LAFAYETTE_TOKEN` | Square access token for Lafayette cafe (`account=lafayette`) |
| `SQUARE_LAFAYETTE_LOCATION_ID` | Square location for Lafayette cafe |
| `SQUARE_MAURICE_TOKEN` | Square access token for Maurice cafe (`account=maurice`) |
| `SQUARE_MAURICE_LOCATION_ID` | Square location for Maurice cafe |
| `SQUARE_RESTAURANT_TOKEN` | Legacy Maurice token (`account=restaurant` alias). Used if `SQUARE_MAURICE_TOKEN` is unset. |
| `SQUARE_RESTAURANT_LOCATION_ID` | Legacy Maurice location. Used if `SQUARE_MAURICE_LOCATION_ID` is unset. |
| `BRIDGE_API_KEY` | Shared secret for `/api/square/*` (GET reads and `POST /api/square/invoices/create`) and `POST /api/pick/maurice-restock/create`. Routes fail closed (503) if unset. |
| `SALES_DASHBOARD_PIN` | Shared PIN for the sales dashboard (`/dashboard`) and sales-sensitive APIs (`/api/square/sales`, `/payments`, `/orders`). **Do not PIN the whole app** — Daily Log stays public. Unset in local development allows sales access. Unset in production (`VERCEL=1` or `NODE_ENV=production`) blocks sales and shows “PIN not configured” on `/sales-login`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Publishable Key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key for Batch Tracker writes and Maurice pick tokens. Server-only. |
| `APP_BASE_URL` | Public origin encoded in Maurice restock QR codes. Defaults to `https://rachael-production-log.vercel.app` in production. |
| `SQUARE_MAURICE_CUSTOMER_ID` | Maurice's customer id on the **wholesale** Square account. Optional. Used by the restock pick Send. |
| `TODOIST_TOKEN` | Todoist API Token |
| `TODOIST_COOK_PROJECT_ID` | Todoist Cook Board Project ID (optional) |
| `TWILIO_ACCOUNT_SID` | Twilio account for the wholesale text webhook. Webhook returns 503 if this and `TWILIO_AUTH_TOKEN` are unset (except a non-production dev bypass). |
| `TWILIO_AUTH_TOKEN` | Twilio auth token used to validate `X-Twilio-Signature`. |
| `TWILIO_FROM_NUMBER` | Outbound crew SMS from-number. Leave unset until the Google Voice port finishes. |
| `WHOLESALE_TEXT_DEV_BYPASS` | Set to `1` only outside production to accept the Twilio webhook without a signature. |
| `WHOLESALE_TEXT_ALLOWLIST_JSON` | Optional JSON array that overrides `data/wholesale-text-allowlist.json`. |
| `WHOLESALE_TEXT_NOTIFY_PHONES` | Optional comma-separated crew phones for outbound SMS. |

Do not commit secrets. Set these in Vercel project settings only. See `.env.example` for the full list.

The Daily Log at `/` stays open. Only Sales (`/dashboard` and APIs that return revenue totals) requires the PIN.

## Features
- Load Square catalog by category
- Log daily production and push to Square inventory
- Sync completed cook tasks from Todoist
- Track batch yields over time in Supabase
- Read-only Square bridge for assistants (`GET /api/square/*`) — see [docs/square-bridge.md](docs/square-bridge.md)
- Unpaid wholesale invoices from text (`POST /api/square/invoices/create` and the Twilio inbound stub) — see [docs/wholesale-text-orders.md](docs/wholesale-text-orders.md)
- Maurice restock pick QR (print sheet, phone Send, wholesale inventory decrease, unpaid invoice) — see [docs/maurice-restock-pick-qr.md](docs/maurice-restock-pick-qr.md)
- Sales dashboard at `/dashboard` (today / WTD / MTD per location, America/Chicago). Gated by `SALES_DASHBOARD_PIN`; Daily Log is not.
