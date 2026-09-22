# Maurice → Wholesale pick-list QR

v1. Claude (or any bridge caller) mints a pick list. Wholesale prints the sheet, pulls stock, and scans the QR. The phone confirms what actually left. Send does two things, in order:

1. Decrease wholesale Square inventory by the quantities that left.
2. Book an **unpaid** invoice on the wholesale Square account to the Maurice customer, for the weekly check total.

Production host: `https://rachael-production-log.vercel.app`

This does not rebuild the 2am planner, send Twilio or customer SMS, or call Square Payments.

Square-Version stays **`2024-02-22`**, the same header as `lib/square-client.js` and `pages/api/push-inventory.js`.

## Storage

Pick tokens live in Supabase table `public.pick_tokens`.

This repo does not use Vercel KV or Blob. Batch Tracker already talks to Supabase REST with `SUPABASE_SERVICE_KEY` (`pages/api/get-batches.js`, `pages/api/package-batches.js`). The pick store uses that same key. It does **not** use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Apply [`supabase/pick_tokens.sql`](../supabase/pick_tokens.sql) once in the Supabase SQL editor. The table has RLS enabled and no policies, so the anon key cannot read tokens. The service role bypasses RLS.

If the URL or service key is missing, create/send/sheet return **503** `Pick store is not configured`. If the table was never created, the store returns **503** telling you to apply the SQL file.

`PICK_STORE=memory` keeps tokens in the Node process only. It works for local `next dev` and the verify script. It is ignored when `NODE_ENV=production` or `VERCEL=1`, so a production deploy cannot silently drop tokens on the next cold start.

## Unpaid-only guarantee

Pick routes never call Square Payments (`CreatePayment`, `CompletePayment`, PayOrder, or `/v2/payments`).

`POST /api/pick/[token]/send` calls:

1. `POST /v2/inventory/changes/batch-create` on the **wholesale** token. Each positive quantity is an adjustment `from_state: IN_STOCK` → `to_state: SOLD`. That is the decrease (the Daily Log increase is `NONE` → `IN_STOCK`). Lines shorted to 0 are omitted. Idempotency key is `mp-<token>`, and `occurred_at` is fixed on the first Send so a retry is the same Square body.
2. The existing `createUnpaidInvoice` helper (`lib/square-invoices.js`), same path as `POST /api/square/invoices/create`:
   - `GET /v2/catalog/object/{id}` — must be an `ITEM_VARIATION`
   - `POST /v2/orders` — open order, catalog variation id + quantity, no amounts, no tenders
   - `POST /v2/invoices` — `delivery_method: SHARE_MANUALLY` (Square does not email or text Maurice), `automatic_payment_source: NONE`
   - `POST /v2/invoices/{id}/publish` — leaves the invoice **UNPAID**

The same `mp-<token>` idempotency key is passed into the invoice helper (it appends `:invoice` and `:publish`). A second Send after success does not call Square again. The phone and the sheet say **Already sent**.

Bodies with payment-shaped fields are rejected with **400** before any Square call.

## `POST /api/pick/maurice-restock/create`

Auth: `BRIDGE_API_KEY`, same as the invoice bridge (`Authorization: Bearer …` or `x-bridge-key`). Missing key → **503**. Wrong key → **401**.

```json
{
  "lines": [
    { "catalogObjectId": "VARIATION_ID", "name": "Stuffed shrimp", "orderedQty": 4 }
  ],
  "note": "optional"
}
```

`catalogObjectId` is a Square **item variation** id on the wholesale catalog. `name` is for the sheet and the phone only. `orderedQty` is a positive number up to 10000. Do not send prices.

Success:

```json
{
  "token": "…",
  "pickUrl": "https://rachael-production-log.vercel.app/pick/…",
  "sheetUrl": "https://rachael-production-log.vercel.app/api/pick/…/sheet"
}
```

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/pick/maurice-restock/create" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lines":[{"catalogObjectId":"VARIATION_ID","name":"Stuffed shrimp","orderedQty":4}]}'
```

## Sheet and phone

`GET /api/pick/[token]/sheet` — printable HTML. Large QR encodes `pickUrl`. The page lists each item and ordered quantity. No bridge key; the token is the secret.

`GET /pick/[token]` — phone page. Each line is an input defaulting to `orderedQty` with `max` set to that ordered quantity. Short a line by editing that number down. Leave the others. Then **Send**.

`POST /api/pick/[token]/send` — JSON body optional.

```json
{ "lines": [{ "catalogObjectId": "VARIATION_ID", "qty": 3 }] }
```

Omitted lines stay at the ordered quantity. A line can be `0` (nothing left). At least one line must be above 0. Quantity cannot be raised. The first Send locks those quantities. If Square fails afterward, reload and Send again; the retry reuses the locked quantities and the same Square idempotency key. It does not re-key the whole order.

Success and the idempotent replay both return **200**:

```json
{
  "alreadySent": false,
  "token": "…",
  "status": "sent",
  "invoiceId": "…",
  "invoiceNumber": "1042",
  "orderId": "…",
  "publicUrl": null,
  "lines": [{ "catalogObjectId": "VARIATION_ID", "name": "Stuffed shrimp", "orderedQty": "4", "qty": "3" }]
}
```

`alreadySent` is `true` when this token was already sent. `publicUrl` is whatever Square returned. The phone shows **Already sent** and the invoice number. It does not link Maurice to a card checkout. Wholesale still collects the weekly check and records it in the Square Dashboard.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `BRIDGE_API_KEY` | Yes, for create | Same shared secret as `/api/square/*`. Create returns 503 if unset. |
| `SQUARE_WHOLESALE_TOKEN` | Yes, for send | Wholesale access token. Falls back to `SQUARE_TOKEN`. Needs `INVENTORY_WRITE`, `INVOICES_WRITE`, `ORDERS_WRITE`, and `ITEMS_READ`. |
| `SQUARE_WHOLESALE_LOCATION_ID` | Yes, for send | Wholesale location for the inventory adjustment and the invoice. Falls back to `SQUARE_LOCATION_ID`. |
| `SQUARE_MAURICE_CUSTOMER_ID` | No | Maurice as a **customer on the wholesale account**, not the Maurice cafe merchant token. Default `TQ8JFGXMZGTY8JNKCY1TV72618`. |
| `APP_BASE_URL` | No | Origin baked into `pickUrl` and `sheetUrl`. Example `https://rachael-production-log.vercel.app`. When unset, production uses that host. Local `next dev` uses the request host. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes, in production | Supabase project URL. |
| `SUPABASE_SERVICE_KEY` | Yes, in production | Service role key. Server-only. Never expose it to the browser. |

`PAYMENTS_WRITE` is not used. Do not add a payments call to finish this flow.

## Blockers

Live Send fails closed until these are true. Tokens in Square error text are redacted. Square 401/403 comes back as **502**.

1. **`pick_tokens` table.** Apply `supabase/pick_tokens.sql`. Confirm `SUPABASE_SERVICE_KEY` is the service role key already used by Batch Tracker, set in Vercel and not in git.
2. **Wholesale Square token scopes.** `SQUARE_WHOLESALE_TOKEN` (fallback `SQUARE_TOKEN`) needs:
   - `INVENTORY_WRITE` — inventory adjustment decrease
   - `INVOICES_WRITE` — CreateInvoice, PublishInvoice
   - `ORDERS_WRITE` — CreateOrder
   - `ITEMS_READ` — catalog variation lookup (Square does not publish a `CATALOG_READ` scope)
   - `CUSTOMERS_READ` — the existing unpaid-invoice publish path reads the customer profile onto the recipient
   The current bridge token may be read-only. Send will not succeed until the wholesale token includes those scopes. `PAYMENTS_WRITE` is the scope Square uses to charge a card. This feature does not use it.
3. **Maurice customer profile.** Default id `TQ8JFGXMZGTY8JNKCY1TV72618`, or `SQUARE_MAURICE_CUSTOMER_ID`. Square requires a phone or email on that customer before publish. `SHARE_MANUALLY` does not email or text the invoice.
4. **Accepted payment method.** Unchanged from [wholesale-text-orders.md](wholesale-text-orders.md): card is enabled only so Square will publish, with `automatic_payment_source: NONE`. This app still never charges. The weekly check is recorded by staff.
5. **Inventory tracking.** Each variation must be inventory-tracked at the wholesale location. Square rejects an adjustment when it is not. A failed Send stays in `sending` with the quantities locked; fix the catalog and Send again on the same QR.
6. **`APP_BASE_URL`.** Set it if the deployment host is not `https://rachael-production-log.vercel.app`, so printed QRs do not point at the wrong origin.

Out of scope: the 2am Maurice par planner, Twilio, customer SMS, and charging the invoice.
