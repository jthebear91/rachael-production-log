# Wholesale Square order → Takeout pull + pick list

When a wholesale Square invoice is unpaid, or a house-account receipt is completed at the wholesale location, this app adds a **Todoist Takeout** task and stores a pick-list PDF (quantity and item name only).

It does **not** create tasks on the Package board. Package (`6cv69FHPW88HVjH8`) stays packaging and production work. Shopify → Takeout is a separate Zapier change; point that zap at the same Takeout project, priority p1, and the top of the board.

It does **not** print the Square invoice or house-account receipt, charge a card, or touch Maurice nightly pick QR, mint handoff, or inventory deduct.

Production host: `https://rachael-production-log.vercel.app`

Takeout project id: `6cv69FrQF2QcqVqw`

Wholesale location id: `L6D106R4VNA72`

## What gets created

Todoist task, priority **p1** (API priority `4`), inserted at the **top** of the leftmost Takeout column:

`PULL · {account} · {invoice number or order id}`

The description is the line list (qty and Square catalog name), a Square Dashboard link, and a `square-pull-key:` line. Prices and SKUs are not copied. A duplicate Square event for the same order or invoice updates nothing.

The pick-list PDF has the account, Chicago date, reference, and the same qty + name lines. It is not a signature invoice.

## Webhook

`POST /api/square/wholesale-pull/webhook`

Square signs the raw body. The route does not use `BRIDGE_API_KEY`. Register this notification URL exactly:

`https://rachael-production-log.vercel.app/api/square/wholesale-pull/webhook`

In the [Square Developer Dashboard](https://developer.squareup.com/apps), open the wholesale application → Webhooks → add a subscription:

1. Notification URL: the URL above.
2. Events:
   - `invoice.created`
   - `invoice.published`
   - `invoice.updated`
   - `payment.created`
   - `payment.updated`
   - `order.created`
   - `order.updated`
   - `order.fulfillment.updated`
3. Copy the signature key into Vercel as `SQUARE_WEBHOOK_SIGNATURE_KEY`.
4. Set `SQUARE_WEBHOOK_NOTIFICATION_URL` to that same URL. The signature is HMAC-SHA256 of `notificationUrl + rawBody`. If the URL string differs by a slash or host, every event is **403**.

A poller is not included. Square can push these events, and a second cron would re-scan the same orders. Missed sales are replayed by id (below).

### Which events become a pull

- Invoice status `UNPAID`, `SCHEDULED`, or `PARTIALLY_PAID` at the wholesale location. Draft, canceled, and paid invoices are ignored. The pull is meant to happen when the invoice is still unpaid.
- Completed payments and orders at the wholesale location whose tender is `EXTERNAL` or `OTHER` (Square house-account / custom tender), or whose tender name contains `house account`, `house acct`, or `on account`. Extra substrings: `WHOLESALE_PULL_TENDER_NAMES`.
- Card and cash sales are ignored unless `WHOLESALE_PULL_ALL_COMPLETED=1`.

Other locations are acknowledged and skipped. The wholesale token and location come from `SQUARE_WHOLESALE_TOKEN` / `SQUARE_WHOLESALE_LOCATION_ID`, then `SQUARE_TOKEN` / `SQUARE_LOCATION_ID`.

`WHOLESALE_PULL_ENABLED` must be `1` or the webhook returns 200 `{ "skipped": "disabled" }` after a valid signature and creates nothing. Missing signature key is **503** (fail closed). `WHOLESALE_PULL_DEV_BYPASS=1` skips the signature only when `NODE_ENV` is not `production`.

Missing `TODOIST_TOKEN` or `TODOIST_TAKEOUT_PROJECT_ID` on a real pull is **503** so Square retries. If that project id is the Package id, the app refuses.

## Idempotency and the PDF

Run [supabase/wholesale_pulls.sql](../supabase/wholesale_pulls.sql) in the Supabase SQL editor. The service role key writes the row. The browser anon key cannot read it.

The primary key is `order:{orderId}` when Square has an order, otherwise the invoice or payment id. A second webhook for the same order returns the existing Takeout task id.

The PDF is stored on that row. Without Supabase the Takeout task is still created and the response includes a warning; the Mac folder will not see a file until the table exists.

## Dry run (no print)

Hebert's Maurice practice sale:

- Order `gcEI0dtLc3OaueVCwjKKet9vxZRZY`
- Payment `968pb1sI3vrL7m7sM77fNWumZtNZY`

`POST /api/wholesale-pull/replay` requires `BRIDGE_API_KEY`. `apply` defaults to false: Square is read, the PDF is returned, Todoist is not written, nothing is printed.

```bash
node scripts/wholesale-pull-replay.cjs --heberts --out /tmp/heberts-pick-list.pdf
```

That uses the order id. The matching payment:

```bash
node scripts/wholesale-pull-replay.cjs --payment-id 968pb1sI3vrL7m7sM77fNWumZtNZY --out /tmp/heberts-pick-list.pdf
```

If the response is `{ "skipped": "not_house_account" }` (or another skip) and Jordan confirms this is the house-account receipt, add `--force` to preview anyway. `force` still requires the wholesale location and still does not charge a card.

Create the Takeout task only after the preview looks right, and only with the feature flag on:

```bash
node scripts/wholesale-pull-replay.cjs --heberts --apply
```

Confirm in Todoist: Takeout project, title `PULL · …`, priority p1, at the top of the board. CI does not run this script and does not print.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/wholesale-pull/replay" \
  -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"gcEI0dtLc3OaueVCwjKKet9vxZRZY","apply":false}'
```

## How the facility Mac gets the PDF

Vercel cannot see the office printer. The server stores the PDF. A Mac on the wholesale machine drops it in the same documents tree as the other wholesale sheets. This script does not install a LaunchAgent and does not call the Maurice mint handoff.

```bash
BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh --dry-run
BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh
```

Files land in `~/Documents/Wholesale Ordering/pull-sheets/`. Set `WHOLESALE_PULL_PRINTER` on that Mac only if CUPS should print after the file is saved. The queue name is not known yet; folder-only is the v1 default. Leave the variable unset until the queue is confirmed.

`GET /api/wholesale-pull/sheets` lists unprinted pulls. `GET /api/wholesale-pull/sheets?format=pdf&key=order:…` downloads one. `POST /api/wholesale-pull/sheets` with `{ "key": "order:…" }` marks it printed. All three require `BRIDGE_API_KEY`.

## Vercel env

| Variable | Required | Notes |
|---|---|---|
| `WHOLESALE_PULL_ENABLED` | Yes, to go live | `1` or the webhook no-ops |
| `TODOIST_TOKEN` | Yes | Same token the app already uses. Fail closed if unset. |
| `TODOIST_TAKEOUT_PROJECT_ID` | Yes | `6cv69FrQF2QcqVqw`. Not the Package id. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Yes | From the webhook subscription. Not the access token. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Yes | Exact subscription URL. |
| `SQUARE_WHOLESALE_TOKEN` | Yes | Falls back to `SQUARE_TOKEN`. Read scopes only. |
| `SQUARE_WHOLESALE_LOCATION_ID` | Yes | `L6D106R4VNA72`. Falls back to `SQUARE_LOCATION_ID`. |
| `SUPABASE_SERVICE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` | Yes, for PDF storage and idempotency | Run the SQL file first. |
| `BRIDGE_API_KEY` | Yes, for replay and the Mac download | Already used by the Square bridge. |
| `WHOLESALE_PULL_TENDER_NAMES` | No | Extra house-account tender substrings. |
| `WHOLESALE_PULL_ALL_COMPLETED` | No | `1` pulls every completed wholesale sale, including card. |
| `WHOLESALE_PULL_DEV_BYPASS` | No | Never set in production. |

## Blockers

1. **Square webhook subscription** is not created by this repo. Grogu adds the URL, the events above, and the signature key in Vercel.
2. **Token scopes** (read only). The wholesale token needs `INVOICES_READ`, `ORDERS_READ`, `PAYMENTS_READ`, `CUSTOMERS_READ`, and `ITEMS_READ`. It must not be used to charge cards. This feature never calls Payments create or `inventory.batchChange`.
3. **Supabase SQL** `supabase/wholesale_pulls.sql` has to be applied once or PDFs are not queued for the Mac.
4. **Feature flag** stays off until the three items above are done. Then set `WHOLESALE_PULL_ENABLED=1` and redeploy.
5. **Printer queue** is unconfirmed. v1 is folder-only under `~/Documents/Wholesale Ordering/pull-sheets/`. Do not install a LaunchAgent from this change.
6. **Hebert's practice print** waits on Jordan. Replay with `apply: false` first. `--apply` creates the Takeout task and still does not print.
7. **House-account shape.** If Hebert's receipt is a card tender rather than EXTERNAL/OTHER, the webhook skips it until `WHOLESALE_PULL_ALL_COMPLETED=1` or a replay with `--force`. Confirm on the dry run before turning the flag on.
