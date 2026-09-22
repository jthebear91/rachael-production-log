# Wholesale text → unpaid Square invoices

v1 scaffold. Known phones text an order. The app creates an **unpaid** invoice on the wholesale Square account, then notifies crew. It does **not** charge cards.

Production host: `https://rachael-production-log.vercel.app`

Square-Version stays **`2024-02-22`** (same header as the rest of this app, including `pages/api/push-inventory.js`). `CreateOrder`, `CreateInvoice`, and `PublishInvoice` already exist in that version, so the header was not bumped.

## Unpaid-only guarantee

`POST /api/square/invoices/create` and the Twilio webhook never call Square Payments (`CreatePayment`, `CompletePayment`, PayOrder, or `/v2/payments`).

What the write does:

1. `GET /v2/catalog/object/{id}` — the id must be an `ITEM_VARIATION`. The price on that object is not copied into the order.
2. `POST /v2/orders` — `state: OPEN`, `customer_id`, `line_items[].catalog_object_id` + `quantity` only. No tenders. `pricing_options.auto_apply_discounts` and `auto_apply_taxes` are `false` because Square rejects invoice orders when pricing rules auto-apply. Square still prices each variation from the catalog.
3. `POST /v2/invoices` — `delivery_method: SHARE_MANUALLY` (Square does not email or text the customer), one `BALANCE` payment request with `automatic_payment_source: NONE`, `store_payment_method_enabled: false`.
4. `POST /v2/invoices/{id}/publish` — moves the draft to **UNPAID** and returns `public_url` when Square has it. Publish does not take a payment when `automatic_payment_source` is `NONE`.

`GET /api/square/payments` is unchanged and remains List Payments (read-only).

Bodies that contain payment-shaped fields (`source_id`, card nonce, `card_id`, CVV, amounts, tenders, and similar) are rejected with **400** before any Square call.

Lafayette and Maurice (`account=lafayette`, `account=maurice`, and the `restaurant` alias) are rejected. Omitted `account` means **wholesale** (`SQUARE_WHOLESALE_TOKEN` / `SQUARE_TOKEN` and the matching location).

## `POST /api/square/invoices/create`

Auth: `BRIDGE_API_KEY`, same as the read bridge (`Authorization: Bearer …` or `x-bridge-key`). Missing key → **503**. Wrong key → **401**.

```json
{
  "account": "wholesale",
  "customerId": "SQUARE_CUSTOMER_ID",
  "locationId": "optional — defaults to the wholesale location",
  "title": "optional",
  "description": "optional",
  "lines": [{ "catalogObjectId": "VARIATION_ID", "quantity": "2" }],
  "dueDays": 0,
  "idempotencyKey": "required-unique-string"
}
```

`catalogObjectId` is a Square **item variation** id. Do not send prices. `dueDays` defaults to **0** (due the same America/Chicago calendar day). `idempotencyKey` is reused, with `:invoice` and `:publish` suffixes, so a retry does not create a second order.

Success:

```json
{
  "data": {
    "invoiceId": "inv:…",
    "invoiceNumber": "000123",
    "orderId": "…",
    "status": "UNPAID",
    "publicUrl": "https://…"
  }
}
```

`publicUrl` is null when Square has not attached one yet.

```bash
curl -sS -X POST "https://rachael-production-log.vercel.app/api/square/invoices/create" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"SQUARE_CUSTOMER_ID","lines":[{"catalogObjectId":"VARIATION_ID","quantity":"2"}],"idempotencyKey":"order-2026-09-22-001"}'
```

## Twilio inbound

`POST /api/wholesale-text/twilio/inbound`

Twilio sends `application/x-www-form-urlencoded` (`From`, `Body`, `MessageSid`).

**Webhook URL (Grogu port checklist):**

`https://rachael-production-log.vercel.app/api/wholesale-text/twilio/inbound`

When `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are both set, the route checks `X-Twilio-Signature` (HMAC-SHA1 over the public URL + sorted form fields). A bad signature is **403**.

When those vars are unset, the route returns **503** (fail closed). The only bypass is `NODE_ENV` **not** `production` **and** `WHOLESALE_TEXT_DEV_BYPASS=1`. That bypass adds response header `X-Wholesale-Text-Dev-Bypass: 1` and a log line. Do not set the bypass in production. If the Twilio vars are set, the signature is required even in development.

Flow:

1. Normalize `From` to E.164 and look it up in the allowlist.
2. Unknown number → TwiML `Number not authorized`. No Square call. No crew SMS.
3. Known number → stub parser. Lines like `2x stuffed shrimp` are recognized, but v1 does **not** map names to catalog variation ids (`needs_review` stays true).
4. No billable catalog lines → **do not** create an invoice. TwiML tells the sender the order needs staff review.
5. A future parser that returns variation ids and `needs_review: false` creates the unpaid invoice **then** SMSes crew (Jordan lock: write, then notify). The v1 parser never takes that branch.

Outbound crew SMS is a log line plus, only when `TWILIO_FROM_NUMBER` is set, Twilio Messages create to `notifyPhones` on the allowlist entry and `WHOLESALE_TEXT_NOTIFY_PHONES`. A notify failure does not change the TwiML reply. This path never calls Square Payments.

## Allowlist

Committed file: `data/wholesale-text-allowlist.json` (`[]`).

Optional override (full replacement, not a merge): `WHOLESALE_TEXT_ALLOWLIST_JSON`.

```json
[
  {
    "phone": "+1...",
    "label": "Hebert's Broussard",
    "squareCustomerId": "",
    "notifyPhones": []
  }
]
```

Phones are matched after E.164 normalize (10-digit US numbers become `+1…`). An entry with an empty `squareCustomerId` is known but cannot be invoiced.

R2D2 / Jordan fill this later. Do not put real numbers in git until they are ready. Accounts to add:

- Hebert's Broussard
- Nunu's (two phones)
- Premier

## Blockers (Grogu / ops)

Live invoice create will fail until these are true. The app fails closed (503 when bridge or Twilio config is missing; Square 401/403 comes back as 502 with the Square message, tokens redacted).

1. **Wholesale Square token scopes.** `SQUARE_WHOLESALE_TOKEN` (fallback `SQUARE_TOKEN`) needs these OAuth permission names (Square does not publish a `CATALOG_READ` scope — catalog read is `ITEMS_READ`):
   - `INVOICES_WRITE` — CreateInvoice, PublishInvoice
   - `ORDERS_WRITE` — CreateOrder
   - `ITEMS_READ` — catalog variation lookup
   - `CUSTOMERS_READ` — Square reads the Customer Directory profile onto the invoice recipient
   Confirm the token is **not** payments-write-only. `PAYMENTS_WRITE` is the scope Square requires to **charge a card on file**. This feature does not use it and must not call Payments. The current bridge token may be read-only; invoice create will not succeed until Grogu installs a wholesale token that includes the four scopes above.
2. **Customer profiles.** Square requires the invoice recipient to have a phone or email on the customer profile before publish. `SHARE_MANUALLY` does not send that invoice for us.
3. **Accepted payment method.** Square will not publish an invoice unless at least one of card, gift card, bank account, buy now pay later, or Cash App Pay is enabled. This app enables **card** only so publish can succeed, with `automatic_payment_source: NONE` and `store_payment_method_enabled: false`. We still never charge. Wholesale payment stays check, recorded by staff in the Square Dashboard. The public URL is for print/share. If Jordan wants card disabled on that page, Grogu needs a Square-supported method the wholesale location can publish with.
4. **Taxes.** Automatic pricing-rule discounts and taxes are off, because Square rejects those orders for invoicing. Confirm whether wholesale invoices need tax added by some other Square-supported field. Variation prices still come from the catalog.
5. **Twilio port.** Production SMS waits on the Google Voice → Twilio port. Until then leave `TWILIO_FROM_NUMBER` empty. Grogu collects `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` via secure cards — not in git or chat. Point the Twilio messaging webhook at the URL above (HTTP POST).
6. **Allowlist empty.** No account maps to a Square customer yet, so inbound texts cannot create invoices.
7. **Parser.** v1 does not resolve product aliases to variation ids. Known senders get a staff-review reply and no invoice.

Out of scope: NLP / LLM parsing, a YES confirm before create, buying a Twilio number, auto-print, and filling real customer phones.
