# Wholesale Square order → Takeout pull + pick list

When a wholesale Square invoice is unpaid, or a house-account receipt is completed at the wholesale location, this app adds a **Todoist Takeout** task and stores a pick-list PDF (quantity and item name only).

It does **not** create tasks on the Package board. Package (`6cv69FHPW88HVjH8`) stays packaging and production work. Shopify → Takeout is a separate Zapier change; point that zap at the same Takeout project, priority p1, due date = America/Chicago today, and the top of the board.

The pick list is queued when the pull is created. A separate signature invoice is queued when that Takeout task is checked off. Square's own invoice PDF is not downloaded: the Invoices API has no endpoint for those bytes, and this app does not scrape the Square Dashboard. This app does not charge a card, and it does not touch Maurice nightly pick QR, mint handoff, or inventory deduct.

Production host: `https://rachael-production-log.vercel.app`

Takeout project id: `6cv69FrQF2QcqVqw`

Wholesale location id: `L6D106R4VNA72`

## What gets created

Todoist task, priority **p1** (API priority `4`), due date **today in America/Chicago**, inserted at the **top** of the leftmost Takeout column:

`PULL · {account} · {kind}`

House-account receipts use kind `house account`. Unpaid invoices use the invoice number. The title never includes `$`, other currency symbols, or a formatted amount such as `$2,568`. A total may stay in the Todoist description or in Square. The description is the line list (qty and Square catalog name), a Square Dashboard link, and a `square-pull-key:` line. Prices and SKUs are not copied onto the pick list.

The create body sets an all-day `due_date` of `YYYY-MM-DD` for the board day: calendar today in America/Chicago, with no due time. That is the crew today filter. Priority p1 and top placement alone leave the task off that filter. The date is not the UTC date. A duplicate Square event for the same order or invoice updates nothing, including an existing due date.

The Hebert's account on titles and pick-list account lines is Hebert's Specialty Meats (Heberts). A speech-only nickname is removed before either is written. Do not use that nickname in examples.

The pick-list PDF opens with a full-width **WHOLESALE** banner so it is not mistaken for a Maurice nightly restock sheet. Under that: account, Chicago date, reference, and the same qty + name lines. Prices stay off this sheet. The signature invoice is a different PDF, queued only after the Takeout task is completed.

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

The pick-list PDF is stored on that row, with line prices and order totals kept for the later signature sheet. Without Supabase the Takeout task is still created and the response includes a warning; the Mac folder will not see a file until the table exists.

## When the crew checks off the Takeout task

Jordan lock 2026-09-25: completing the Takeout pull task prints a **signature invoice**, not another pick list, on the wholesale Brother HL-L3280CDW.

`POST /api/wholesale-pull/todoist-webhook`

Todoist signs the raw body. The route does not use `BRIDGE_API_KEY`. In the Todoist app, add a webhook:

1. Callback URL: `https://rachael-production-log.vercel.app/api/wholesale-pull/todoist-webhook`
2. Event: `item:completed`
3. Copy the app client secret into Vercel as `TODOIST_WEBHOOK_SECRET`. That secret is not `TODOIST_TOKEN`.

The check is base64 HMAC-SHA256 of the raw body, header `X-Todoist-Hmac-SHA256`. A missing secret is **503**. A bad signature is **403**. `WHOLESALE_PULL_DEV_BYPASS=1` skips the signature only when `NODE_ENV` is not `production`.

`WHOLESALE_PULL_ENABLED` must be `1` or the webhook returns 200 `{ "skipped": "disabled" }` after a valid signature and queues nothing.

The handler keeps the event only when all of these are true:

- `event_name` is `item:completed`
- `project_id` is the Takeout project. Package and every other project are ignored.
- `wholesale_pulls.todoist_task_id` matches the completed task

It builds the signature PDF and sets `signature_status` to `ready` with `signature_pdf_base64`. The pick-list `status` is left alone. The Mac poll is what sets `signature_status` to `printed` and fills `signature_printed_at`.

The PDF is not the pick list. It has priced lines, tax and total when Square sent them, and a signature line. An unpaid invoice uses an **INVOICE** banner. A house-account sale with no Square invoice uses a **SIGNATURE** banner and the words "House account receipt", from the order and payment already stored on the row. Neither banner is **WHOLESALE**.

Hebert's on this PDF is Hebert's Specialty Meats. The speech nickname is removed before the account line or an item name is written.

A second `item:completed` for the same task does not queue another PDF. `signature_status` of `ready` or `printed`, or a set `signature_printed_at`, is the lock.

Rows created before prices were stored are read again with `GET` on the invoice, order, or payment so the sheet can still show amounts. That read does not charge a card and does not change inventory.

Re-run [supabase/wholesale_pulls.sql](../supabase/wholesale_pulls.sql) if the table already exists. The ALTER block adds `totals`, `signature_pdf_base64`, `signature_status`, `signature_printed_at`, and a unique index on `todoist_task_id`. It is safe to run again.

## Dry run (no print)

Hebert's Maurice practice sale:

- Order `gcEI0dtLc3OaueVCwjKKet9vxZRZY`
- Payment `968pb1sI3vrL7m7sM77fNWumZtNZY`

`POST /api/wholesale-pull/replay` requires `BRIDGE_API_KEY`. `apply` defaults to false: Square is read, the PDF is returned, Todoist is not written, nothing is printed.

```bash
node scripts/wholesale-pull-replay.cjs --heberts --out /tmp/heberts-pick-list.pdf
```

To preview this checkout's PDF (WHOLESALE banner, no production call, no Todoist write):

```bash
node scripts/wholesale-pull-replay.cjs --local --invoice-number 000225 --out /tmp/nunu-000225.pdf
node scripts/wholesale-pull-replay.cjs --local --heberts --out /tmp/heberts-pick-list.pdf
```

`--local` reads Square with `SQUARE_WHOLESALE_TOKEN`. It refuses `--apply`. A paid invoice or a non-house-account receipt returns a skip unless you add `--force` (still no charge, still wholesale location only).

That uses the order id. The matching payment:

```bash
node scripts/wholesale-pull-replay.cjs --payment-id 968pb1sI3vrL7m7sM77fNWumZtNZY --out /tmp/heberts-pick-list.pdf
```

If the response is `{ "skipped": "not_house_account" }` (or another skip) and Jordan confirms this is the house-account receipt, add `--force` to preview anyway. `force` still requires the wholesale location and still does not charge a card.

Create the Takeout task only after the preview looks right, and only with the feature flag on:

```bash
node scripts/wholesale-pull-replay.cjs --heberts --apply
```

Confirm in Todoist: Takeout project, title `PULL · …`, priority p1, due date = board day (America/Chicago today), at the top of the board. CI does not run this script and does not print.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/wholesale-pull/replay" \
  -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"gcEI0dtLc3OaueVCwjKKet9vxZRZY","apply":false}'
```

## How the facility Mac gets the PDF

The server stores both PDFs. Vercel cannot see the office printer.

A manual run from Terminal drops files in `~/Documents/Wholesale Ordering/pull-sheets/`. The LaunchAgent cannot read or write `~/Documents` (macOS privacy controls), so its state, logs, poll key, and PDFs live under `~/Library/Application Support/RachaelsWholesalePull/`. That folder is outside `~/Documents`.

The poller authenticates with `WHOLESALE_PULL_POLL_KEY`, not `BRIDGE_API_KEY`. The bridge secret is shared with other routes and cannot be read back, so it cannot be copied onto the Mac or rotated for this job. Write the poll key to a mode `600` file:

`~/Library/Application Support/RachaelsWholesalePull/POLL_KEY`

or `/Users/Shared/RachaelsWholesalePull/poll.key`

The LaunchAgent points `WHOLESALE_PULL_POLL_KEY_FILE` at the Application Support file. The script also accepts the Shared path. It refuses a key file under `~/Documents` and refuses a file that is not mode `600`. If `WHOLESALE_PULL_POLL_KEY` is unset, the script and the sheets routes fall back to `BRIDGE_API_KEY` when that variable is set. `POST /api/wholesale-pull/replay` stays on `BRIDGE_API_KEY` only.

Pick lists are `pick-list-*.pdf` and print **1** copy. Signature invoices are `SIGNATURE-*.pdf` and print **2** copies (`lp -n 2`). Both use only `Brother_HL_L3280CDW_series`.

Run the poll on the wholesale Mac: user `rachaelsseafood`, machineId `1c85823c-2c30-4ffb-b905-0241b4daebfe`. The Mac network name may show as `Trey-s-A25`. That is the network name only. Do not run this script on the Mac mini.

Default:

`WHOLESALE_PULL_PRINTER=Brother_HL_L3280CDW_series`

That queue is the Brother HL-L3280CDW. When CUPS is armed, it is the only wholesale target. Device URI: `dnssd://Brother%20HL-L3280CDW%20series._ipps._tcp.local./?uuid=e3248000-80ce-11db-8000-94ddf83ac040`

MFC-L5915DW is Maurice-only and must never be used for wholesale.

```bash
WHOLESALE_PULL_PRINTER=Brother_HL_L3280CDW_series
WHOLESALE_PULL_POLL_KEY=... bash scripts/wholesale-pull-mac-poll.sh
```

An empty `WHOLESALE_PULL_PRINTER` skips CUPS and still writes the PDF. The default sends the saved file to `Brother_HL_L3280CDW_series` only when the user and machine id match the wholesale Mac. Any other queue, including MFC-L5915DW, makes the script exit before `lp`. The script does not call the Maurice mint handoff.

Install the poll on the wholesale Mac with `scripts/com.rachaelsseafood.wholesale-pull-poll.plist` (see the comment in that file). It runs every 30 seconds as user `rachaelsseafood` and reads `WHOLESALE_PULL_POLL_KEY` from a mode `600` file outside `~/Documents`, not from the plist.

`GET /api/wholesale-pull/sheets` lists unprinted pick lists. `GET /api/wholesale-pull/sheets?format=pdf&key=order:…` downloads one. `POST /api/wholesale-pull/sheets` with `{ "key": "order:…" }` marks the pick list printed.

`GET /api/wholesale-pull/sheets?queue=signature` lists signature invoices waiting to print. `GET /api/wholesale-pull/sheets?format=pdf&queue=signature&key=order:…` downloads that PDF, not the pick list. `POST /api/wholesale-pull/sheets` with `{ "key": "order:…", "queue": "signature" }` marks the signature printed. These poll and ack routes accept `WHOLESALE_PULL_POLL_KEY`. They also accept `BRIDGE_API_KEY` when that variable is set. If neither secret is set, they return **503**. A wrong key is **401**. Send the key as `Authorization: Bearer …` or `x-bridge-key`.

## 2026-09-28 fixes (Jordan)

**Signature print never fired. Three separate breaks:**
1. **Supabase filter bug (code).** The store wrote `idempotency_key=eq."order:…"`. PostgREST only unwraps double quotes inside `or=(…)` / `in.(…)` (`pLogicSingleVal` / `pListElement`). A plain `eq.` value is free-form (`pSingleVal` keeps every character), so the quotes were compared literally, every PATCH/GET by key matched **zero rows**, and PostgREST still returned 200. Rows stayed `status=creating` with no `todoist_task_id` and no `pdf_base64`. The sheets queue stayed empty, and `findByTodoistTaskId` could never match a completed task. `eqFilter()` sends the value unquoted. `or=(…)` still quotes. If that update still matches nothing, the webhook returns **503** so Square retries; the retry finds the Takeout task already created and stores the PDF instead of creating a second task. The Todoist complete handler also falls back to `square-pull-key:` in the task when no row has the task id. Rows already stuck at `creating` need a replay while the Takeout task is still open. A task that was checked off before this fix will not get another `item:completed` until it is reopened and completed again.
2. **Todoist webhook never delivered.** The route got zero requests. Todoist only activates an app webhook for a user once that user finishes the app's OAuth flow, token exchange included, and that applies to the app creator too. New route `GET /api/wholesale-pull/todoist-oauth` runs the flow server-side (needs `TODOIST_CLIENT_ID`; client secret = `TODOIST_WEBHOOK_SECRET`). The token is not stored. Set the App Console OAuth redirect URL to `https://rachael-production-log.vercel.app/api/wholesale-pull/todoist-oauth`, then open that URL while logged into the Takeout Todoist account (wholesale@rachaelsseafood.com).
3. **Mac poller was never installed.** There was no LaunchAgent on the wholesale Mac, and a LaunchAgent can't write `~/Documents` (macOS TCC; that already broke the Maurice mint worker). `scripts/com.rachaelsseafood.wholesale-pull-poll.plist` runs the poll from `~/Library/Application Support/RachaelsWholesalePull/` with `WHOLESALE_PULL_DEST` and `WHOLESALE_PULL_POLL_KEY_FILE` (mode 600). `/Users/Shared/RachaelsWholesalePull/poll.key` is the other allowed key path. The poller does not use `BRIDGE_API_KEY`.

**Signature copies (Jordan 2026-09-28):** every SIGNATURE invoice prints **2 copies** (`lp -n 2 -d Brother_HL_L3280CDW_series`): one for the customer to sign and keep, one for us. Pick lists stay at 1 copy. The poller sets this in `COPIES`.

**Excluded house accounts:** `EXCLUDED_CUSTOMER_IDS` in `lib/wholesale-pull.js` (plus `WHOLESALE_PULL_EXCLUDED_CUSTOMER_IDS`). Matching is by Square customer id, never by name. Both of these create **no Takeout task and no pick PDF** (`skipped: excluded_customer`):

- Rachael's Cafe Lafayette (`FY8QC4GPN38Q30MJY8QXSGNDFC`) gets a recurring invoice on every Lafayette order.
- Rachael's Cafe Maurice (`TQ8JFGXMZGTY8JNKCY1TV72618`) is the Monday billing rollup from `POST /api/pick/maurice-restock/week-invoice`. Publishing that invoice is billing only. Maurice's physical pulls stay on the Maurice pick flow. If `SQUARE_MAURICE_CUSTOMER_ID` overrides that customer, the override id is excluded too.

**Canonical names:** `ACCOUNT_DISPLAY_NAMES` keyed by Square customer id (plus `WHOLESALE_PULL_ACCOUNT_NAMES_JSON`): `GFSB4VQXTKPQ84TQCGBTRJMRWM` → Nunu's Youngsville, `59K0PJZG791Z0DG3GAFMX0SEPM` → Nunu's Maurice. Heberts/Hebert's names stay as Square has them, and speech nicknames are still stripped. Titles never carry `$`.

## Vercel env

| Variable | Required | Notes |
|---|---|---|
| `WHOLESALE_PULL_ENABLED` | Yes, to go live | `1` or both webhooks no-op after the signature check |
| `TODOIST_TOKEN` | Yes | Same token the app already uses. Fail closed if unset. |
| `TODOIST_TAKEOUT_PROJECT_ID` | Yes | `6cv69FrQF2QcqVqw`. Not the Package id. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Yes | From the Square webhook subscription. Not the access token. |
| `TODOIST_WEBHOOK_SECRET` | Yes, to print on complete | Todoist app client secret. Header `X-Todoist-Hmac-SHA256`. Not `TODOIST_TOKEN`. Also the OAuth client secret for the one-time authorize route. The access token from that exchange is not stored. |
| `TODOIST_CLIENT_ID` | Yes, once, to activate webhooks | App Console client id. Not secret. `GET /api/wholesale-pull/todoist-oauth`. |
| `TODOIST_OAUTH_REDIRECT_URI` | No | Defaults to `https://rachael-production-log.vercel.app/api/wholesale-pull/todoist-oauth`. Must match the App Console redirect URL exactly. |
| `WHOLESALE_PULL_EXCLUDED_CUSTOMER_IDS` | No | Comma-separated Square customer ids added to the built-in exclusion list. Rachael's Cafe Lafayette and Rachael's Cafe Maurice are already excluded in code. `SQUARE_MAURICE_CUSTOMER_ID` is excluded when set. |
| `WHOLESALE_PULL_ACCOUNT_NAMES_JSON` | No | JSON object of Square customer id to crew-facing name, merged over Nunu's Youngsville and Nunu's Maurice. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Yes | Exact subscription URL. |
| `SQUARE_WHOLESALE_TOKEN` | Yes | Falls back to `SQUARE_TOKEN`. Read scopes only. |
| `SQUARE_WHOLESALE_LOCATION_ID` | Yes | `L6D106R4VNA72`. Falls back to `SQUARE_LOCATION_ID`. |
| `SUPABASE_SERVICE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` | Yes, for PDF storage and idempotency | Run the SQL file first. |
| `WHOLESALE_PULL_POLL_KEY` | Yes, for the Mac poller | New secret for `GET`/`POST /api/wholesale-pull/sheets` only. Write the same value to the Mac key file (mode 600). Not accepted by replay or other bridge routes. |
| `BRIDGE_API_KEY` | Yes, for replay and the rest of the bridge | Sheets fall back to this when it is set. Do not copy it onto the Mac. It cannot be read back. |
| `WHOLESALE_PULL_TENDER_NAMES` | No | Extra house-account tender substrings. |
| `WHOLESALE_PULL_ALL_COMPLETED` | No | `1` pulls every completed wholesale sale, including card. |
| `WHOLESALE_PULL_DEV_BYPASS` | No | Never set in production. |

## Blockers

1. **Square webhook subscription** is not created by this repo. Grogu adds the URL, the events above, and the signature key in Vercel.
2. **Token scopes** (read only). The wholesale token needs `INVOICES_READ`, `ORDERS_READ`, `PAYMENTS_READ`, `CUSTOMERS_READ`, and `ITEMS_READ`. It must not be used to charge cards. This feature never calls Payments create or `inventory.batchChange`.
3. **Supabase SQL** `supabase/wholesale_pulls.sql` has to be applied once or PDFs are not queued for the Mac.
4. **Feature flag** stays off until the three items above are done. Then set `WHOLESALE_PULL_ENABLED=1` and redeploy.
5. **CUPS LaunchAgent** is installed on the wholesale Mac from `scripts/com.rachaelsseafood.wholesale-pull-poll.plist`, not started by Vercel. User `rachaelsseafood`, machineId `1c85823c-2c30-4ffb-b905-0241b4daebfe`. The network name may be `Trey-s-A25`; that is not the printer. The only queue is `Brother_HL_L3280CDW_series` (Brother HL-L3280CDW). Signature invoices print 2 copies. Pick lists print 1. MFC-L5915DW is Maurice-only. The agent's files stay under `~/Library/Application Support/RachaelsWholesalePull/` because launchd cannot use `~/Documents`. Set `WHOLESALE_PULL_POLL_KEY` on Vercel and store that value in `POLL_KEY` (mode 600) or `/Users/Shared/RachaelsWholesalePull/poll.key`. Do not put `BRIDGE_API_KEY` on the Mac.
6. **Todoist webhook** is not created by this repo. Subscribe `item:completed` to the callback URL above, set `TODOIST_WEBHOOK_SECRET` and `TODOIST_CLIENT_ID`, set the App Console redirect URL, then open `GET /api/wholesale-pull/todoist-oauth` while logged into the Takeout account. Todoist does not deliver app webhooks for a user until that OAuth token exchange finishes. The token is not stored.
7. **Signature columns.** Re-run `supabase/wholesale_pulls.sql` so `signature_status` and `todoist_task_id` exist. Without that, a completed task cannot be queued for the Mac.
8. **Hebert's practice task** waits on Jordan. Replay with `apply: false` first. `--apply` creates the Takeout task. The signature PDF is queued only after that task is checked off, and only the Mac poll sends it to the printer.
9. **House-account shape.** If Hebert's receipt is a card tender rather than EXTERNAL/OTHER, the Square webhook skips it until `WHOLESALE_PULL_ALL_COMPLETED=1` or a replay with `--force`. Confirm on the dry run before turning the flag on. A pull that has no Square invoice still gets a house-account receipt for signature when its Takeout task is completed.
