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
| `BRIDGE_API_KEY` | Shared secret for `/api/square/*` (GET reads and `POST /api/square/invoices/create`), `POST /api/pick/maurice-restock/week-invoice`, and `POST /api/pick/maurice-restock/create`. Routes fail closed (503) if unset. |
| `PICK_MINT_API_KEY` | Mint-only secret for `POST /api/pick/maurice-restock/create` (`Authorization: Bearer`). Set this on Vercel Production for Claude's nightly pick. It does not authorize Send, inventory, invoices, or other bridge routes. Use a different value from `BRIDGE_API_KEY`. |
| `SALES_DASHBOARD_PIN` | Shared PIN for the sales dashboard (`/dashboard`) and sales-sensitive APIs (`/api/square/sales`, `/payments`, `/orders`). **Do not PIN the whole app** — Daily Log stays public. Unset in local development allows sales access. Unset in production (`VERCEL=1` or `NODE_ENV=production`) blocks sales and shows “PIN not configured” on `/sales-login`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Publishable Key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key for Batch Tracker writes and Maurice pick tokens. Server-only. |
| `APP_BASE_URL` | Public origin encoded in Maurice pick QR codes. Defaults to `https://rachael-production-log.vercel.app` in production. |
| `SQUARE_MAURICE_CUSTOMER_ID` | Maurice's customer id on the **wholesale** Square account. Optional. Used by the Monday unpaid rollup. Default `TQ8JFGXMZGTY8JNKCY1TV72618`. |
| `MAURICE_PICK_SEND_DRY_RUN` | Default on (unset counts as on). Send records the pull, appends the week log, and logs the intended `IN_STOCK` → `SOLD` adjustment. It does not call `inventory.batchChange` and it does not create an invoice. Set to `0` only together with `MAURICE_PICK_LIVE_DEDUCT=1`, after the Claude step 7 edit. |
| `MAURICE_PICK_LIVE_DEDUCT` | Default off. Set to `1` with `MAURICE_PICK_SEND_DRY_RUN=0` to deduct final quantities at wholesale location `L6D106R4VNA72`. |
| `JORDAN_NOTIFY_WEBHOOK` | Optional URL for the post-pull total and shorts. Not Twilio. |
| `TODOIST_TOKEN` | Todoist API Token |
| `TODOIST_COOK_PROJECT_ID` | Todoist Cook Board Project ID (optional) |
| `TODOIST_TAKEOUT_PROJECT_ID` | Todoist Takeout project for wholesale pull tasks (`6cv69FrQF2QcqVqw`). Required for the Square pull webhook. Do not set this to the Package project. |
| `WHOLESALE_PULL_ENABLED` | Set to `1` to create Takeout tasks from the Square webhook and to queue a signature invoice when that task is checked off. Unset skips both webhooks after the signature check. |
| `TODOIST_WEBHOOK_SECRET` | Todoist app client secret for `POST /api/wholesale-pull/todoist-webhook` (`item:completed`). Not the API token. Webhook returns 503 if unset (except a non-production dev bypass). |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square webhook signature key. Webhook returns 503 if unset (except a non-production dev bypass). |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Exact webhook URL registered in Square. Defaults to the request URL when unset. |
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
- Maurice nightly pick QR (daily Send is inventory plus a week log, dry-run until both live flags are set; Monday rolls the prior Mon–Sat into one unpaid wholesale invoice) — see [docs/maurice-restock-pick-qr.md](docs/maurice-restock-pick-qr.md)
- Wholesale Square invoices and house-account receipts → Todoist **Takeout** pull task (p1, due today in America/Chicago, top of the board) and a qty/name pick-list PDF with a WHOLESALE banner. Checking off that task queues a separate signature invoice PDF (prices, total, signature line). The wholesale Mac (user `rachaelsseafood`, machineId `1c85823c-2c30-4ffb-b905-0241b4daebfe`) drops both files in `~/Documents/Wholesale Ordering/pull-sheets/` and prints them only on `Brother_HL_L3280CDW_series`. See [docs/wholesale-pull.md](docs/wholesale-pull.md)
- Sales dashboard at `/dashboard` (today / WTD / MTD per location, America/Chicago). Gated by `SALES_DASHBOARD_PIN`; Daily Log is not.
