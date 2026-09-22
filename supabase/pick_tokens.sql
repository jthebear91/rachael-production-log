-- Maurice → Wholesale pick tokens.
-- Run once in the Supabase SQL editor for this project.
-- The app writes with SUPABASE_SERVICE_KEY (service role bypasses RLS).
-- No policies: the anon key used by the browser cannot read these rows.

create table if not exists public.pick_tokens (
  token text primary key,
  status text not null default 'open' check (status in ('open', 'sending', 'sent')),
  lines jsonb not null,
  note text,
  sent_lines jsonb,
  occurred_at timestamptz,
  invoice_id text,
  invoice_number text,
  order_id text,
  public_url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.pick_tokens enable row level security;

revoke all on table public.pick_tokens from anon, authenticated;
grant select, insert, update, delete on table public.pick_tokens to service_role;
