-- Maurice → Wholesale pick tokens.
-- Run once in the Supabase SQL editor for this project.
-- The app writes with SUPABASE_SERVICE_KEY (service role bypasses RLS).
-- No policies: the anon key used by the browser cannot read these rows.

create table if not exists public.pick_tokens (
  token text primary key,
  status text not null default 'open' check (status in ('open', 'sending', 'sent')),
  lines jsonb not null,
  print_day text,
  pick_date text,
  estimated_total text,
  create_invoice boolean not null default false,
  note text,
  sent_lines jsonb,
  occurred_at timestamptz,
  invoice_id text,
  invoice_number text,
  order_id text,
  public_url text,
  notify jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.pick_tokens add column if not exists print_day text;
alter table public.pick_tokens add column if not exists pick_date text;
alter table public.pick_tokens add column if not exists estimated_total text;
alter table public.pick_tokens add column if not exists create_invoice boolean not null default false;
alter table public.pick_tokens add column if not exists notify jsonb;
alter table public.pick_tokens add column if not exists priced_lines jsonb;

-- One unpaid Monday rollup per Maurice pick week (Monday date is the key).
-- Daily Send never writes this table.
create table if not exists public.pick_week_invoices (
  week_start text primary key,
  week_end text not null,
  customer_id text,
  invoice_id text,
  invoice_number text,
  order_id text,
  public_url text,
  lines jsonb not null,
  logged_total text,
  pick_count integer not null default 0,
  dry_run_skipped integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.pick_week_invoices enable row level security;

revoke all on table public.pick_week_invoices from anon, authenticated;
grant select, insert, update, delete on table public.pick_week_invoices to service_role;

alter table public.pick_tokens enable row level security;

revoke all on table public.pick_tokens from anon, authenticated;
grant select, insert, update, delete on table public.pick_tokens to service_role;
