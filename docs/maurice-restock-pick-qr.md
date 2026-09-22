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

This app **does not deduct when it mints a token.** Mint only stores `PRINT_DAY`, the date, the sellable lines, and `estimatedTotal`, then returns URLs. The only `batchChange` is `POST /api/pick/[token]/send`, after someone confirms the pull.

**If Claude still runs step 7 and someone also taps Send, wholesale stock is deducted twice.**

Before go-live, edit the Claude prompt:

- Step 7 becomes a no-op. Do not call `inventory.batchChange` in the 2am job.
- After the PDF lines and `estimatedTotal` exist, `POST /api/pick/maurice-restock/create` with the nightly payload below.
- Embed `qrUrl` (SVG) on the PDF. `sheetUrl` is the printable page if you want the whole sheet instead of only the image.
- Leave INV001–INV056 counting alone. This QR job never adjusts those codes.

Until that prompt change ships, do not point a live PDF at Send.

Hard never for this job: `payments.create`, Lafayette merge, adjusting INV001–INV056, and Twilio. `orders.create` stays out of the 2am prompt. The app calls it only when an unpaid invoice is explicitly turned on, and only as the invoice's backing order (see below).

## What Send does

1. Catalog-read each sellable variation (SKU and price). If the id, name, or SKU is INV001–INV056, Send stops and does not adjust inventory.
2. `POST /v2/inventory/changes/batch-create` on the **wholesale** token. Location is always `L6D106R4VNA72`. Each positive quantity is `from_state: IN_STOCK` → `to_state: SOLD`. Lines shorted to 0 are omitted. Idempotency key `mp-<token>` and `occurred_at` are fixed on the first Send.
3. Optional unpaid invoice, only when `createInvoice` is true on the payload or `MAURICE_PICK_CREATE_INVOICE=1`. That path is the existing `createUnpaidInvoice` helper: `SHARE_MANUALLY`, `automatic_payment_source: NONE`, customer `TQ8JFGXMZGTY8JNKCY1TV72618` unless `SQUARE_MAURICE_CUSTOMER_ID` is set. Square requires a backing order for an invoice, so this is the only `orders.create`. It does not take a payment. Default is **off**, so a normal Send does not call Orders or Invoices.
4. Notify with the final total and short deltas. The Send JSON always includes them. A structured log line `maurice_pick_notify` is written. If `JORDAN_NOTIFY_WEBHOOK` is an http(s) URL, Send also POSTs that JSON. Twilio hosts are refused. A second Send is **Already sent** and does not deduct or notify again.

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

`GET /api/pick/[token]/sheet` — printable HTML with the same QR, `PRINT_DAY`, date, estimated total, and ordered quantities. The page states that inventory is not changed until Send.

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
  "invoiceId": null,
  "lines": []
}
```

`finalTotal` is the sum of sent quantity times the catalog variation price. It is null if a sent line has no Square price. `alreadySent` is true on the second call. The phone shows **Already sent**, the final total, and the short deltas.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `BRIDGE_API_KEY` | Yes, for create | Same secret as `/api/square/*`. |
| `SQUARE_WHOLESALE_TOKEN` | Yes, for send | Wholesale token. Fallback `SQUARE_TOKEN`. Needs `INVENTORY_WRITE` and `ITEMS_READ`. Add `INVOICES_WRITE`, `ORDERS_WRITE`, and `CUSTOMERS_READ` only if invoices are turned on. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes, in production | Supabase project URL. |
| `SUPABASE_SERVICE_KEY` | Yes, in production | Service role key. Server-only. |
| `APP_BASE_URL` | No | Origin baked into the QR. Production default `https://rachael-production-log.vercel.app`. |
| `SQUARE_MAURICE_CUSTOMER_ID` | No | Maurice as a **customer on the wholesale account** (Rachaels Cafe Maurice). Default `TQ8JFGXMZGTY8JNKCY1TV72618`. |
| `MAURICE_PICK_CREATE_INVOICE` | No | Set to `1` to book the unpaid invoice on every Send. Default off. A payload `createInvoice: true` turns it on for that night only. |
| `JORDAN_NOTIFY_WEBHOOK` | No | http(s) URL that receives the final total and shorts. Not Twilio. |

The adjustment location is **not** taken from `SQUARE_WHOLESALE_LOCATION_ID`. Send always uses `L6D106R4VNA72`.

`PAYMENTS_WRITE` is not used.

## Blockers

1. **Claude prompt.** Step 7 must stop deducting before any live QR is scanned. This is the double-deduct risk.
2. **`pick_tokens` table** and `SUPABASE_SERVICE_KEY`.
3. **Wholesale token** with `INVENTORY_WRITE` and `ITEMS_READ`. Invoice scopes only if `createInvoice` is on.
4. **Counting items.** INV001–INV056 stay on the 2am count. They are rejected here even if a sellable id's SKU is one of those codes.
5. **Jordan notify.** With no webhook, the summary is still in the Send response, the server log, and the phone's Already sent screen.
6. **`APP_BASE_URL`** if the public host is not the production default, so the PDF QR points at the right origin.
