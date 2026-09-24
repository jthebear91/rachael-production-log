-- Wholesale Square pull → Todoist Takeout idempotency and pick-list PDFs.
-- Run once in the Supabase SQL editor for this project.
-- The app writes with SUPABASE_SERVICE_KEY (service role bypasses RLS).
-- No policies: the anon key used by the browser cannot read these rows.
-- This table is not used by Maurice pick tokens.

create table if not exists public.wholesale_pulls (
  idempotency_key text primary key,
  invoice_id text,
  order_id text,
  payment_id text,
  invoice_number text,
  account_name text,
  reference text,
  pick_date text,
  lines jsonb not null default '[]'::jsonb,
  square_links jsonb,
  todoist_task_id text,
  pdf_base64 text,
  status text not null default 'creating' check (status in ('creating', 'ready', 'printed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  printed_at timestamptz
);

create unique index if not exists wholesale_pulls_invoice_id_uidx
  on public.wholesale_pulls (invoice_id) where invoice_id is not null;

create unique index if not exists wholesale_pulls_order_id_uidx
  on public.wholesale_pulls (order_id) where order_id is not null;

create unique index if not exists wholesale_pulls_payment_id_uidx
  on public.wholesale_pulls (payment_id) where payment_id is not null;

create index if not exists wholesale_pulls_status_idx
  on public.wholesale_pulls (status, created_at);

alter table public.wholesale_pulls enable row level security;

revoke all on table public.wholesale_pulls from anon, authenticated;
grant select, insert, update, delete on table public.wholesale_pulls to service_role;
