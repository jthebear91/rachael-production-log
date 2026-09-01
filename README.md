# Rachael's Production Log

Daily production logging app for Rachael's Wholesale LLC.

## Environment Variables (set in Vercel)

| Variable | Description |
|---|---|
| `SQUARE_TOKEN` | Square Production Access Token |
| `SQUARE_LOCATION_ID` | Square Location ID (L6D106R4VNA72) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Publishable Key |
| `TODOIST_TOKEN` | Todoist API Token |
| `TODOIST_COOK_PROJECT_ID` | Todoist Cook Board Project ID (optional) |

## Features
- Load Square catalog by category
- Log daily production and push to Square inventory
- Sync completed cook tasks from Todoist
- Track batch yields over time in Supabase
