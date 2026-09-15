# Square read-only bridge

HTTP API for assistants to **read** Square catalog, inventory, orders, and payments from this app. It does **not** create orders, take payments, or adjust inventory.

Existing Daily Log routes stay as they are:

- `GET /api/catalog` — unauthenticated UI catalog (do not require `BRIDGE_API_KEY`)
- `POST /api/push-inventory` — human UI inventory writes (not part of this contract)

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

If `BRIDGE_API_KEY` is unset, these routes return **503** `{ "error": "Bridge is not configured" }` (fail closed). A missing or wrong key returns **401**.

## Accounts

| Query | Env token | Env location | Meaning |
|---|---|---|---|
| `account=wholesale` (default) | `SQUARE_TOKEN` | `SQUARE_LOCATION_ID` | Rachael's Wholesale |
| `account=restaurant` | `SQUARE_RESTAURANT_TOKEN` | `SQUARE_RESTAURANT_LOCATION_ID` | Maurice / cafe (optional) |

`locationId` may be passed on inventory, orders, and payments to override the account's default location.

## Response shape

Success: `{ "data": ... }` and `"cursor"` when Square has another page.

Error: `{ "error": "message" }` (Square messages only; tokens are never returned).

All bridge routes are **GET**. Square Search Orders / inventory counts use POST internally; that is still read-only.

Default page size is capped (`orders` 50, max 100; `payments` 100; `inventory` 100, max 200). Pass `cursor` from the previous response to continue.

`begin` / `end` on orders and payments are ISO-8601. If omitted, the last **7 days** is used.

## Endpoints

### `GET /api/square/health`

Token-present checks only (no Square call).

```json
{ "ok": true, "accounts": { "wholesale": true, "restaurant": false } }
```

### `GET /api/square/catalog`

Normalized catalog: categories + items + variations (id, name, sku, price). Price `amount` is Square's smallest currency unit (cents for USD). Fetches every catalog page internally, so there is no cursor.

### `GET /api/square/inventory`

Current counts for a location (`IN_STOCK` and other tracked states Square returns).

### `GET /api/square/orders`

Square Orders Search for `created_at` in `[begin, end]`, newest first.

### `GET /api/square/payments`

Square List Payments for sales totals in the same time window.

## curl examples

Replace `YOUR_BRIDGE_API_KEY` and timestamps. Do not put real keys in git.

```bash
# Health
curl -sS "https://rachael-production-log.vercel.app/api/square/health" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Catalog (wholesale)
curl -sS "https://rachael-production-log.vercel.app/api/square/catalog?account=wholesale" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"

# Catalog (restaurant, if configured)
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
curl -sS "https://rachael-production-log.vercel.app/api/square/payments?account=wholesale&begin=2026-09-01T00:00:00Z&end=2026-09-15T23:59:59Z" \
  -H "Authorization: Bearer YOUR_BRIDGE_API_KEY"
```

Header alternative:

```bash
curl -sS "https://rachael-production-log.vercel.app/api/square/health" \
  -H "x-bridge-key: YOUR_BRIDGE_API_KEY"
```

## Vercel env vars to add

| Variable | Required | Notes |
|---|---|---|
| `BRIDGE_API_KEY` | Yes (for `/api/square/*`) | Shared secret. Routes 503 if unset. |
| `SQUARE_RESTAURANT_TOKEN` | No | Second merchant access token |
| `SQUARE_RESTAURANT_LOCATION_ID` | No | Default location for `account=restaurant` |

`SQUARE_TOKEN` and `SQUARE_LOCATION_ID` are already used by Daily Log.
