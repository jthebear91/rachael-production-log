# Maurice nightly pick QR

Production host: `https://rachael-production-log.vercel.app`

Claude already builds the Maurice pick around 2am CT, Monday–Saturday. This app does **not** replace that job. It defers the inventory deduction until after the physical pull.

## Go-live: Claude prompt change required — YES

Today the Claude prompt does this, in order:

1. Read docs and on-hand counts for **INV001–INV056** at wholesale location `L6D106R4VNA72`.
2. Run `nightly_pick_list.py` and make the PDF.
3. Price the lines into `order_totals_log.md`.
4. **Step 7:** `inventory.batchChange` adjustment `IN_STOCK` → `SOLD` for the sellable pick quantities. **This is the deduction this QR defers.**
5. Notify and save the PDF under Mac `Documents/Wholesale Ordering/`.

This app **does not deduct when it mints a token.** Mint only stores `PRINT_DAY`, the date, the sellable lines, and `estimatedTotal`, then returns URLs.

**Send does not deduct by default either.** Live `inventory.batchChange` is off until both gates below are open. A Send in the default dry-run still marks the pick sent, logs the adjustment it would have made, and appends priced lines to the week log. It does not call `inventory.batchChange`.

**Daily Send never creates a Square invoice.** The unpaid invoice is a separate Monday morning rollup of the prior Mon–Sat live sends.

**Do not open the live gate while Claude still runs step 7.** That job and a live Send would deduct the same wholesale stock twice.

Hard never for this job: `payments.create`, Lafayette merge, adjusting INV001–INV056, and Twilio. `orders.create` stays out of the 2am prompt and out of daily Send. The only `orders.create` in this feature is the backing order for the Monday unpaid invoice. Lafayette's Monday house-account auto-invoice is a different job and this route does not call it.

## Exact Claude prompt edit (replace step 7)

Paste this in place of the current step 7 in the Maurice nightly pick list prompt. Steps 1–6 and 8–10 stay as they are.

```
Step 7 — do not deduct inventory. Mint the pick QR instead.

Do not call inventory.batchChange. Do not call orders.create. Do not call payments.create. Do not adjust INV001–INV056. Those counting items stay on the on-hand read only.

After the sellable lines and estimatedTotal exist, mint a pick token.
Use PICK_MINT_API_KEY only. Do not call Send, week-invoice, inventory, or any other /api/square route with this key.

POST https://rachael-production-log.vercel.app/api/pick/maurice-restock/create
Authorization: Bearer <PICK_MINT_API_KEY>
Content-Type: application/json

{
  "PRINT_DAY": "<PRINT_DAY>",
  "date": "<YYYY-MM-DD America/Chicago>",
  "estimatedTotal": "<dollars, for example 48.00>",
  "lines": [
    {
      "sellableCatalogObjectId": "<wholesale catalog item variation id>",
      "name": "<item name>",
      "qtyOrdered": <positive number>
    }
  ]
}

Use the response fields token, pickUrl, sheetUrl, and qrUrl.
Embed qrUrl on the PDF. qrUrl is an SVG of the QR code, and the QR encodes pickUrl.
Do not also deduct inventory in this job. Do not create a Square invoice in this job.
The phone Send records the physical pull and does not create an invoice.
The Monday unpaid invoice is a separate call, documented below, not part of this 2am prompt.
Then continue with notify and save the PDF under Documents/Wholesale Ordering/.
```

## How to flip dry-run to live, after that prompt is edited

Confirm one night's 2am job no longer calls `inventory.batchChange`. Then, on the Vercel production environment:

1. Set `MAURICE_PICK_SEND_DRY_RUN=0`
2. Set `MAURICE_PICK_LIVE_DEDUCT=1`
3. Redeploy

Both are required. Either one left at the default keeps Send in dry-run. `MAURICE_PICK_SEND_DRY_RUN=1` forces dry-run even if live deduct is `1`.

After the redeploy, Send calls `inventory.batchChange` for the final quantities only, at location `L6D106R4VNA72`, `IN_STOCK` → `SOLD`. To turn live deduct back off, set `MAURICE_PICK_SEND_DRY_RUN=1` (or remove `MAURICE_PICK_LIVE_DEDUCT`) and redeploy. Picks already marked sent are not deducted again.

## What Send does

1. Catalog-read each sellable variation (SKU and price). If the id, name, or SKU is INV001–INV056, Send stops and does not adjust inventory. This happens in dry-run and in live mode.
2. Build the `inventory.batchChange` body for the positive final quantities at `L6D106R4VNA72` (`IN_STOCK` → `SOLD`). Lines shorted to 0 are omitted. Idempotency key `mp-<token>` and `occurred_at` are fixed on the first Send.
3. **Dry-run (default).** Do not call Square inventory. Log `maurice_pick_inventory_dry_run` with that body.
4. **Live**, only when `MAURICE_PICK_SEND_DRY_RUN=0` and `MAURICE_PICK_LIVE_DEDUCT=1`. `POST /v2/inventory/changes/batch-create` on the wholesale token with that same body, then log `maurice_pick_inventory_live`.
5. Append priced lines to the week log (`priced_lines` on the pick row, plus a `maurice_pick_week_log` log line). This is the same role as `order_totals_log`: final quantities and catalog prices, including shorts at qty 0. Dry-run sends are logged too and marked `dryRun: true`.
6. Notify Jordan with the final total, short deltas, and `dryRun`. There is **no Square invoice** on this call. A payload `createInvoice` field is ignored. `MAURICE_PICK_CREATE_INVOICE` is ignored. If `JORDAN_NOTIFY_WEBHOOK` is an http(s) URL, Send also POSTs that JSON. Twilio hosts are refused. A second Send is **Already sent** and does not deduct, append another log, or notify again.

## Monday unpaid rollup

`POST /api/pick/maurice-restock/week-invoice` with `BRIDGE_API_KEY`. Call it Monday morning. It is not part of the 2am prompt and it does not run Lafayette's house-account invoice.

With an empty body, the window is the prior **Monday through Saturday** in America/Chicago. On Monday Sep 28 that is Sep 21–Sep 26. A later run the same week still uses that prior week, so the new Monday's pick is not included. Pass `{ "weekStart": "2026-09-21" }` to target a specific Monday; the end date is that Monday plus five days.

The route sums **live** sent picks in that window (`notify.inventoryAdjusted === true`) by `sellableCatalogObjectId`. Dry-run sends are counted as `dryRunSkipped` and are not invoiced. It then creates **one** unpaid invoice on the wholesale account for customer Rachael's Cafe Maurice, `TQ8JFGXMZGTY8JNKCY1TV72618` unless `SQUARE_MAURICE_CUSTOMER_ID` is set. `SHARE_MANUALLY`, `automatic_payment_source: NONE`. Square prices the catalog variations. This app does not call Payments. Jordan can cancel, pay, or take a partial later in Square.

A second call for the same week returns `alreadyInvoiced: true` and does not create another invoice. If the week has no live sends, the response is `invoiced: false` and Square is not called.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/pick/maurice-restock/week-invoice" \
  -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Square-Version stays **`2024-02-22`**.

## Storage

Supabase, using `SUPABASE_SERVICE_KEY` (the same server key as Batch Tracker). No Vercel KV or Blob client in this repo. The anon key is not used.

- `public.pick_tokens` holds each night's pick. After Send, `priced_lines` is the week-log row: variation id, name, qty ordered, qty sent, unit price cents, and line total cents.
- `public.pick_week_invoices` holds one Monday rollup per week, keyed by the Monday date, so the invoice cannot be created twice.

Apply [`supabase/pick_tokens.sql`](../supabase/pick_tokens.sql) once. If an older `pick_tokens` table was already created, run that file again; the new columns are `add column if not exists`, and `pick_week_invoices` is created if missing.

Missing Supabase config → **503**. `PICK_STORE=memory` is a single-process local fallback and is ignored when `NODE_ENV=production` or `VERCEL=1`.

## Mint-only key (`PICK_MINT_API_KEY`)

Set `PICK_MINT_API_KEY` on **Vercel Production**. It must be a different secret from `BRIDGE_API_KEY`. Claude's nightly job uses this key only to POST the mint route and embed `qrUrl` on the PDF. Never use it for Send, inventory, invoices, or other bridge calls.

**Route that accepts it**

- `POST /api/pick/maurice-restock/create` — `Authorization: Bearer <PICK_MINT_API_KEY>` or `Authorization: Bearer <BRIDGE_API_KEY>` (the `x-bridge-key` header works the same way). Either key. This route stores the pick and returns `qrUrl`. It does not adjust Square inventory.

**Routes that reject it**

- `POST /api/pick/[token]/send` does not read API keys. The pick token is the capability for the phone. `PICK_MINT_API_KEY` is not a credential, and presenting it does not arm live deduct. Live deduct stays off until `MAURICE_PICK_SEND_DRY_RUN=0` and `MAURICE_PICK_LIVE_DEDUCT=1`.
- `POST /api/pick/maurice-restock/week-invoice` accepts only `BRIDGE_API_KEY`.
- `GET /api/square/inventory`, `POST /api/square/invoices/create`, and the rest of `/api/square/*` accept only `BRIDGE_API_KEY` (sales routes also accept the sales PIN cookie). With `BRIDGE_API_KEY` set, a mint key is **401**. If `BRIDGE_API_KEY` is unset, those routes stay **503**.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/pick/maurice-restock/create" \
  -H "Authorization: Bearer $PICK_MINT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"PRINT_DAY":"Tue","date":"2026-09-22","estimatedTotal":"48.00","lines":[{"sellableCatalogObjectId":"VARIATION_ID","name":"Stuffed shrimp","qtyOrdered":4}]}'
```

## `POST /api/pick/maurice-restock/create`

Auth: `PICK_MINT_API_KEY` or `BRIDGE_API_KEY` (`Authorization: Bearer …` or `x-bridge-key`). If neither secret is set → **503**. Wrong key → **401**. `BRIDGE_API_KEY` alone still authorizes this route.

This is the call Claude makes after step 6, instead of step 7. It does not call Square.

```json
{
  "PRINT_DAY": "Tue",
  "date": "2026-09-22",
  "estimatedTotal": "48.00",
  "lines": [
    {
      "sellableCatalogObjectId": "VARIATION_ID",
      "name": "Stuffed shrimp",
      "qtyOrdered": 4
    }
  ]
}
```

`sellableCatalogObjectId` is a wholesale catalog **item variation** id. `name` is required. `qtyOrdered` is a positive number. `estimatedTotal` is dollars. A `createInvoice` field is accepted and ignored. Daily Send does not invoice. INV001–INV056 are rejected.

Success:

```json
{
  "token": "…",
  "pickUrl": "https://rachael-production-log.vercel.app/pick/…",
  "sheetUrl": "https://rachael-production-log.vercel.app/api/pick/…/sheet",
  "qrUrl": "https://rachael-production-log.vercel.app/api/pick/…/qr"
}
```

`qrUrl` is an SVG image of the QR. The QR encodes `pickUrl`. Claude can embed `qrUrl` on the PDF.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/pick/maurice-restock/create" \
  -H "Authorization: Bearer $PICK_MINT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"PRINT_DAY":"Tue","date":"2026-09-22","estimatedTotal":"48.00","lines":[{"sellableCatalogObjectId":"VARIATION_ID","name":"Stuffed shrimp","qtyOrdered":4}]}'
```

`Authorization: Bearer $BRIDGE_API_KEY` on this same POST still works. Do not send `$PICK_MINT_API_KEY` to Send, `week-invoice`, or `/api/square/*`.

## Sheet, QR image, and phone

`GET /api/pick/[token]/qr` — `image/svg+xml` for the PDF. No bridge key. The token is the secret.

`GET /api/pick/[token]/sheet` — printable HTML with the same QR, `PRINT_DAY`, date, estimated total, and ordered quantities. While dry-run is on, the page says Send records the pull and does not change wholesale inventory. When live deduct is enabled, it says inventory is not changed until Send.

`GET /pick/[token]` — phone. Inputs default to `qtyOrdered` and `max` is that ordered quantity. One tap Send if the pull was full. Lower only the short lines. Then Send.

`POST /api/pick/[token]/send` — body optional.

```json
{ "lines": [{ "sellableCatalogObjectId": "VARIATION_ID", "qty": 3 }] }
```

Omitted lines stay at `qtyOrdered`. Quantity cannot be raised. At least one line must be above 0.

Success and the idempotent replay are both **200**:

```json
{
  "alreadySent": false,
  "status": "sent",
  "printDay": "Tue",
  "date": "2026-09-22",
  "estimatedTotal": "48.00",
  "finalTotal": "36.00",
  "shorts": [
    {
      "sellableCatalogObjectId": "VARIATION_ID",
      "name": "Stuffed shrimp",
      "qtyOrdered": "4",
      "qtySent": "3",
      "delta": "1"
    }
  ],
  "dryRun": true,
  "inventoryAdjusted": false,
  "invoiceId": null,
  "lines": []
}
```

`finalTotal` is the sum of sent quantity times the catalog variation price. It is null if a sent line has no Square price. `dryRun` is true until both live gates are open. `alreadySent` is true on the second call. The phone shows **Already sent**, the final total, the short deltas, and, in dry-run, that wholesale inventory was not changed.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `BRIDGE_API_KEY` | Yes, for create and the Monday rollup | Same secret as `/api/square/*`. Still accepted on create. The phone Send route is not bridge-gated. |
| `PICK_MINT_API_KEY` | For Claude's mint call | Set on Vercel Production. Different value from `BRIDGE_API_KEY`. Authorizes only `POST /api/pick/maurice-restock/create`. Send, inventory, invoices, and other `/api/square/*` routes reject it. |
| `SQUARE_WHOLESALE_TOKEN` | Yes, for send and Monday | Wholesale token. Fallback `SQUARE_TOKEN`. Dry-run still catalog-reads, so `ITEMS_READ` is required. Add `INVENTORY_WRITE` before flipping live. Monday rollup needs `INVOICES_WRITE`, `ORDERS_WRITE`, and `CUSTOMERS_READ`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes, in production | Supabase project URL. |
| `SUPABASE_SERVICE_KEY` | Yes, in production | Service role key. Server-only. |
| `APP_BASE_URL` | No | Origin baked into the QR. Production default `https://rachael-production-log.vercel.app`. |
| `SQUARE_MAURICE_CUSTOMER_ID` | No | Maurice as a **customer on the wholesale account** (Rachael's Cafe Maurice). Default `TQ8JFGXMZGTY8JNKCY1TV72618`. Used only by the Monday rollup. |
| `MAURICE_PICK_SEND_DRY_RUN` | No | Default **on** when unset. Send logs the adjustment and does not call `inventory.batchChange`. Set to `0` only as half of the live flip. `1` forces dry-run even if live deduct is on. Dry-run sends are stored on the week log and skipped by the Monday invoice. |
| `MAURICE_PICK_LIVE_DEDUCT` | No | Default **off**. Set to `1` together with `MAURICE_PICK_SEND_DRY_RUN=0` to deduct final quantities at `L6D106R4VNA72`. Either flag alone stays dry-run. |
| `JORDAN_NOTIFY_WEBHOOK` | No | http(s) URL that receives the final total, shorts, and `dryRun`. Not Twilio. |

The adjustment location is **not** taken from `SQUARE_WHOLESALE_LOCATION_ID`. Send always uses `L6D106R4VNA72`.

`PAYMENTS_WRITE` is not used.

## Blockers

1. **Claude prompt, then the live flags.** Step 7 must stop deducting before `MAURICE_PICK_SEND_DRY_RUN=0` and `MAURICE_PICK_LIVE_DEDUCT=1`. Until both are set, Send cannot double-deduct with the old step 7, because Send does not call `batchChange`. The 2am job itself still can.
2. **`pick_tokens` table** and `SUPABASE_SERVICE_KEY`.
3. **Wholesale token** with `ITEMS_READ` for Send. Add `INVENTORY_WRITE` before the live flip. The Monday invoice also needs `INVOICES_WRITE`, `ORDERS_WRITE`, and `CUSTOMERS_READ`.
4. **Counting items.** INV001–INV056 stay on the 2am count. They are rejected here even if a sellable id's SKU is one of those codes.
5. **Jordan notify.** With no webhook, the summary is still in the Send response, the server log, and the phone's Already sent screen.
6. **`APP_BASE_URL`** if the public host is not the production default, so the PDF QR points at the right origin.
