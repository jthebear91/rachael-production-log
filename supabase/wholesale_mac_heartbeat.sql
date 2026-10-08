-- Wholesale Mac morning heartbeat.
-- POST /api/mac-heartbeat inserts one row per call. See docs/mac-heartbeat.md.
--
-- Already created on Supabase project sbsqnzqswodxanbddoks (rachael-production).
-- This file is the schema record. Do not create the production table again.
-- CREATE and INDEX are IF NOT EXISTS so a fresh database can apply them.
-- The app inserts with SUPABASE_SERVICE_KEY (service role bypasses RLS).
-- No policies: the anon key used by the browser cannot read these rows.

create table if not exists public.wholesale_mac_heartbeat (
  id bigserial primary key,
  check_date date not null,
  received_at timestamptz not null default now(),
  mac_reported_at timestamptz,
  hostname text,
  pick_list_found boolean not null,
  pick_list_filename text,
  pick_list_mtime timestamptz,
  pick_list_has_qr boolean,
  note text
);

create index if not exists wholesale_mac_heartbeat_check_date_idx
  on public.wholesale_mac_heartbeat (check_date desc, received_at desc);

alter table public.wholesale_mac_heartbeat enable row level security;

revoke all on table public.wholesale_mac_heartbeat from anon, authenticated;
grant select, insert, update, delete on table public.wholesale_mac_heartbeat to service_role;

grant usage, select on sequence public.wholesale_mac_heartbeat_id_seq to service_role;
