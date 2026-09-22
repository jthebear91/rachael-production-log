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

**Send does not deduct by default either.** Live `inventory.batchChange` is off until both gates below are open. A Send in the default dry-run still marks the pick sent, logs the adjustment it would have made, and can still book the optional unpaid invoice. It does not call `inventory.batchChange`.

**Do not open the live gate while Claude still runs step 7.** That job and a live Send would deduct the same wholesale stock twice.

Hard never for this job: `payments.create`, Lafayette merge, adjusting INV001–INV056, and Twilio. `orders.create` stays out of the 2am prompt. The app calls it only when an unpaid invoice is explicitly turned on, and only as the invoice's backing order (see below). The invoice switch is separate from the inventory gate.

## Exact Claude prompt edit (replace step 7)

Paste this in place of the current step 7 in the Maurice nightly pick list prompt. Steps 1–6 and 8–10 stay as they are.

```
Step 7 — do not deduct inventory. Mint the pick QR instead.

Do not call inventory.batchChange. Do not call orders.create. Do not call payments.create. Do not adjust INV001–INV056. Those counting items stay on the on-hand read only.

After the sellable lines and estimatedTotal exist, mint a pick token:

POST https://rachael-production-log.vercel.app/api/pick/maurice-restock/create
Authorization: Bearer <BRIDGE_API_KEY>
Content-Type: application/json

{
  "PRINT_DAY": "<PRINT_DAY>",
  "date": "<YYYY-MM-DD America/Chicago>",
  "estimatedTotal": "<dollars, for example 48.00>",
  "createInvoice": false,
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
Do not also deduct inventory in this job. The phone Send is what records the physical pull.
Leave createInvoice false. The unpaid Maurice invoice is a separate app switch.
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
3. **Dry-run (default).** Do not call Square inventory. Log `maurice_pick_inventory_dry_run` with that body. Mark the pick sent.
4. **Live**, only when `MAURICE_PICK_SEND_DRY_RUN=0` and `MAURICE_PICK_LIVE_DEDUCT=1`. `POST /v2/inventory/changes/batch-create` on the wholesale token with that same body, then log `maurice_pick_inventory_live`.
5. Optional unpaid invoice, only when `createInvoice` is true on the payload or `MAURICE_PICK_CREATE_INVOICE=1`. This switch is **not** tied to the inventory gate. A dry-run Send can still book the invoice. That path is the existing `createUnpaidInvoice` helper: `SHARE_MANUALLY`, `automatic_payment_source: NONE`, customer `TQ8JFGXMZGTY8JNKCY1TV72618` unless `SQUARE_MAURICE_CUSTOMER_ID` is set. Square requires a backing order for an invoice, so this is the only `orders.create`. It does not take a payment. Default is **off**, so a normal Send does not call Orders or Invoices.
6. Notify with the final total, short deltas, and `dryRun`. The Send JSON always includes them. A structured log line `maurice_pick_notify` is written. If `JORDAN_NOTIFY_WEBHOOK` is an http(s) URL, Send also POSTs that JSON. Twilio hosts are refused. A second Send is **Already sent** and does not deduct, log another adjustment, or notify again.

Square-Version stays **`2024-02-22`**.

## Storage

Supabase table `public.pick_tokens`, using `SUPABASE_SERVICE_KEY` (the same server key as Batch Tracker). No Vercel KV or Blob client in this repo. The anon key is not used.

Apply [`supabase/pick_tokens.sql`](../supabase/pick_tokens.sql) once. If an older `pick_tokens` table was already created, run that file again; the new columns are `add column if not exists`.

Missing Supabase config → **503**. `PICK_STORE=memory` is a single-process local fallback and is ignored when `NODE_ENV=production` or `VERCEL=1`.

## `POST /api/pick/maurice-restock/create`

Auth: `BRIDGE_API_KEY` (`Authorization: Bearer …` or `x-bridge-key`). Missing key → **503**. Wrong key → **401**.

This is the call Claude makes after step 6, instead of step 7. It does not call Square.

```json
{
  "PRINT_DAY": "Tue",
  "date": "2026-09-22",
  "estimatedTotal": "48.00",
  "createInvoice": false,
  "lines": [
    {
      "sellableCatalogObjectId": "VARIATION_ID",
      "name": "Stuffed shrimp",
      "qtyOrdered": 4
    }
  ]
}
```

`sellableCatalogObjectId` is a wholesale catalog **item variation** id. `name` is required. `qtyOrdered` is a positive number. `estimatedTotal` is dollars. `createInvoice` is optional; omit it or send `false` to skip the invoice. INV001–INV056 are rejected.

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
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"PRINT_DAY":"Tue","date":"2026-09-22","estimatedTotal":"48.00","lines":[{"sellableCatalogObjectId":"VARIATION_ID","name":"Stuffed shrimp","qtyOrdered":4}]}'
```

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
| `BRIDGE_API_KEY` | Yes, for create | Same secret as `/api/square/*`. |
| `SQUARE_WHOLESALE_TOKEN` | Yes, for send | Wholesale token. Fallback `SQUARE_TOKEN`. Dry-run still catalog-reads, so `ITEMS_READ` is required. Add `INVENTORY_WRITE` before flipping live. Add `INVOICES_WRITE`, `ORDERS_WRITE`, and `CUSTOMERS_READ` only if invoices are turned on. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes, in production | Supabase project URL. |
| `SUPABASE_SERVICE_KEY` | Yes, in production | Service role key. Server-only. |
| `APP_BASE_URL` | No | Origin baked into the QR. Production default `https://rachael-production-log.vercel.app`. |
| `SQUARE_MAURICE_CUSTOMER_ID` | No | Maurice as a **customer on the wholesale account** (Rachaels Cafe Maurice). Default `TQ8JFGXMZGTY8JNKCY1TV72618`. |
| `MAURICE_PICK_SEND_DRY_RUN` | No | Default **on** when unset. Send logs the adjustment and does not call `inventory.batchChange`. Set to `0` only as half of the live flip. `1` forces dry-run even if live deduct is on. |
| `MAURICE_PICK_LIVE_DEDUCT` | No | Default **off**. Set to `1` together with `MAURICE_PICK_SEND_DRY_RUN=0` to deduct final quantities at `L6D106R4VNA72`. Either flag alone stays dry-run. |
| `MAURICE_PICK_CREATE_INVOICE` | No | Set to `1` to book the unpaid invoice on every Send. Default off. A payload `createInvoice: true` turns it on for that night only. Separate from the inventory gate, so a dry-run Send can still invoice. |
| `JORDAN_NOTIFY_WEBHOOK` | No | http(s) URL that receives the final total, shorts, and `dryRun`. Not Twilio. |

The adjustment location is **not** taken from `SQUARE_WHOLESALE_LOCATION_ID`. Send always uses `L6D106R4VNA72`.

`PAYMENTS_WRITE` is not used.

## Blockers

1. **Claude prompt, then the live flags.** Step 7 must stop deducting before `MAURICE_PICK_SEND_DRY_RUN=0` and `MAURICE_PICK_LIVE_DEDUCT=1`. Until both are set, Send cannot double-deduct with the old step 7, because Send does not call `batchChange`. The 2am job itself still can.
2. **`pick_tokens` table** and `SUPABASE_SERVICE_KEY`.
3. **Wholesale token** with `INVENTORY_WRITE` and `ITEMS_READ`. Invoice scopes only if `createInvoice` is on.
4. **Counting items.** INV001–INV056 stay on the 2am count. They are rejected here even if a sellable id's SKU is one of those codes.
5. **Jordan notify.** With no webhook, the summary is still in the Send response, the server log, and the phone's Already sent screen.
6. **`APP_BASE_URL`** if the public host is not the production default, so the PDF QR points at the right origin.
