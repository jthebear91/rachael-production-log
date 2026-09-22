# Square read-only bridge

HTTP API for assistants to **read** Square catalog, inventory, orders, payments, and sales totals from this app. GET routes do **not** create orders, take payments, or adjust inventory.

Unpaid wholesale invoice **writes** are a separate route, `POST /api/square/invoices/create`. They never call Square Payments. See [wholesale-text-orders.md](wholesale-text-orders.md).

Existing Daily Log routes stay as they are:

- `GET /api/catalog` — unauthenticated UI catalog (do not require `BRIDGE_API_KEY`)
- `POST /api/push-inventory` — human UI inventory writes (not part of this contract)
- `GET /dashboard` — human sales totals (server-side Square calls; no tokens in the browser). Gated by `SALES_DASHBOARD_PIN` at `/sales-login`. Daily Log is not gated.

Base URL (production): `https://rachael-production-log.vercel.app`

## Auth

Every `/api/square/*` route requires `BRIDGE_API_KEY`.

Send either:

```
Authorization: Bearer <BRIDGE_API_KEY>
```

or:

```
x-bridge-key: <BRIDGE_API_KEY>
```

If `BRIDGE_API_KEY` is unset, catalog / inventory / health return **503** `{ "error": "Bridge is not configured" }` (fail closed). A missing or wrong key returns **401**.

Sales-sensitive routes (`/sales`, `/payments`, `/orders`) also accept a valid sales PIN cookie (same session as `/dashboard`). Unauthenticated requests to those routes return **401**. Catalog, inventory, and health do not use the PIN — they stay bridge-key only so Daily Log tooling is not over-locked.

## Accounts

Query `account=` selects the merchant. Default is **wholesale**.

| Query | Env token (first hit) | Env location (first hit) | Meaning |
|---|---|---|---|
| `account=wholesale` (default) | `SQUARE_WHOLESALE_TOKEN`, then `SQUARE_TOKEN` | `SQUARE_WHOLESALE_LOCATION_ID`, then `SQUARE_LOCATION_ID` | Rachael's Seafood |
| `account=lafayette` | `SQUARE_LAFAYETTE_TOKEN` | `SQUARE_LAFAYETTE_LOCATION_ID` | Lafayette cafe |
| `account=maurice` | `SQUARE_MAURICE_TOKEN`, then `SQUARE_RESTAURANT_TOKEN` | `SQUARE_MAURICE_LOCATION_ID`, then `SQUARE_RESTAURANT_LOCATION_ID` | Maurice cafe |
| `account=restaurant` | same as `maurice` | same as `maurice` | **Deprecated alias** for Maurice. Kept so existing agents do not break. Prefer `maurice`. |

`locationId` may be passed on inventory, orders, payments, and sales to override the account's default location.

Wholesale Daily Log inventory writes still use the wholesale token/location (new names with the same legacy fallback). They are **not** exposed under `/api/square/`.

## Response shape

Success: `{ "data": ... }` and `"cursor"` when Square has another page.

Error: `{ "error": "message" }` (Square messages only; tokens are never returned).

Read bridge routes are **GET**. Square Search Orders / inventory counts use POST internally; that is still read-only. The only bridge write is `POST /api/square/invoices/create` (unpaid wholesale invoices). `GET /api/square/payments` stays a read of List Payments.

Default page size is capped (`orders` 50, max 100; `payments` 100; `inventory` 100, max 200). Pass `cursor` from the previous response to continue.

`begin` / `end` on orders and payments are ISO-8601. If omitted, the last **7 days** is used.

## Endpoints

### `GET /api/square/health`

Token **and** location present checks only (no Square call). Booleans only — never token values.

`restaurant` mirrors `maurice` for older clients.

```json
{
  "ok": true,
  "accounts": {
    "wholesale": true,
    "lafayette": false,
    "maurice": true,
    "restaurant": true
  }
}
```

### `GET /api/square/catalog`

Normalized catalog: categories + items + variations (id, name, sku, price). Price `amount` is Square's smallest currency unit (cents for USD). Fetches every catalog page internally, so there is no cursor.

### `GET /api/square/inventory`

Current counts for a location (`IN_STOCK` and other tracked states Square returns).

### `GET /api/square/orders`

Square Orders Search for `created_at` in `[begin, end]`, newest first.

### `GET /api/square/payments`

Square List Payments for sales totals in the same time window. Read-only. This route does not create or complete payments.

### `POST /api/square/invoices/create`

Creates an **unpaid** wholesale invoice (order + invoice + publish, no Square Payment). Bridge key required. Body and blockers: [wholesale-text-orders.md](wholesale-text-orders.md).

### `GET /api/square/sales`

Today / week-to-date / month-to-date totals for **one** account. Day boundaries are **America/Chicago**. WTD starts **Monday 00:00** Chicago time.

Totals are completed Square payments: `total_money` (includes tips) minus `refunded_money`. The payload also includes `gross`, `tips`, `refunds`, and `paymentCount`.

If the account token/location pair is missing, this route returns **503** (or **400** if a token exists but no location). The `/dashboard` page shows those accounts as “not configured” instead of failing the whole page.

## Sales dashboard

`GET /dashboard` loads the same Chicago windows for wholesale, Lafayette, and Maurice in one table, plus a combined total. It calls Square from the server (`lib/square-sales.js`) — **never** from the browser. Missing accounts render as “not configured”.

The page is PIN-gated (`SALES_DASHBOARD_PIN`). Unauthenticated visits redirect to `/sales-login`. The Daily Log at `/` stays public.

## curl examples

Replace `YOUR_BRIDGE_API_KEY` and timestamps. Do not put real keys in git.

```bash
# Health
curl -sS "https://rachael-production-log.vercel.app/api/square/health" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Catalog (wholesale — default, same as omitting account=)
curl -sS "https://rachael-production-log.vercel.app/api/square/catalog?account=wholesale" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Catalog (Lafayette)
curl -sS "https://rachael-production-log.vercel.app/api/square/catalog?account=lafayette" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Catalog (Maurice)
curl -sS "https://rachael-production-log.vercel.app/api/square/catalog?account=maurice" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Deprecated alias — same merchant as maurice
curl -sS "https://rachael-production-log.vercel.app/api/square/catalog?account=restaurant" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Inventory (default wholesale location)
curl -sS "https://rachael-production-log.vercel.app/api/square/inventory?account=wholesale" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Inventory, next page
curl -sS "https://rachael-production-log.vercel.app/api/square/inventory?account=wholesale&cursor=SQUARE_CURSOR" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Orders in a range
curl -sS "https://rachael-production-log.vercel.app/api/square/orders?account=wholesale&begin=2026-09-01T00:00:00Z&end=2026-09-15T23:59:59Z&limit=50" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Payments in a range
curl -sS "https://rachael-production-log.vercel.app/api/square/payments?account=lafayette&begin=2026-09-01T00:00:00Z&end=2026-09-15T23:59:59Z" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Sales today / WTD / MTD (Chicago)
curl -sS "https://rachael-production-log.vercel.app/api/square/sales?account=maurice" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"
```

Header alternative:

```bash
curl -sS "https://rachael-production-log.vercel.app/api/square/health" \
  -H "x-bridge-key: YOUR_BRIDGE_API_KEY"
```

## Vercel env vars

| Variable | Required | Notes |
|---|---|---|
| `BRIDGE_API_KEY` | Yes (for `/api/square/*`) | Shared secret. Catalog/inventory/health 503 if unset. |
| `SALES_DASHBOARD_PIN` | Yes in production (for `/dashboard` and sales totals) | Shared PIN. Daily Log is not gated. Unset in production blocks sales with “PIN not configured”. |
| `SQUARE_WHOLESALE_TOKEN` | No if `SQUARE_TOKEN` is set | Preferred wholesale token |
| `SQUARE_WHOLESALE_LOCATION_ID` | No if `SQUARE_LOCATION_ID` is set | Preferred wholesale location |
| `SQUARE_TOKEN` | No if `SQUARE_WHOLESALE_TOKEN` is set | Legacy wholesale token (Daily Log + default bridge account) |
| `SQUARE_LOCATION_ID` | No if `SQUARE_WHOLESALE_LOCATION_ID` is set | Legacy wholesale location |
| `SQUARE_LAFAYETTE_TOKEN` | No | Lafayette cafe token |
| `SQUARE_LAFAYETTE_LOCATION_ID` | No | Lafayette cafe location |
| `SQUARE_MAURICE_TOKEN` | No | Maurice cafe token |
| `SQUARE_MAURICE_LOCATION_ID` | No | Maurice cafe location |
| `SQUARE_RESTAURANT_TOKEN` | No | Legacy Maurice token (`account=restaurant`) |
| `SQUARE_RESTAURANT_LOCATION_ID` | No | Legacy Maurice location |

`SQUARE_TOKEN` / `SQUARE_LOCATION_ID` already power Daily Log. New `SQUARE_WHOLESALE_*` names are optional aliases that take precedence when set.
