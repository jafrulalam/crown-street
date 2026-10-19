-- CROWN STREET setup: run this entire script in Supabase Dashboard -> SQL Editor.
-- This keeps the existing app's data model intact in one JSONB row so the supplied
-- storefront, customer login, product admin, orders and cancel-order flows continue to work.
-- Access is server-only: do not add anon/authenticated policies to this table.
create table if not exists public.store_state (
  id text primary key check (id = 'main'),
  data jsonb not null default '{"users":[],"products":[],"orders":[],"nextOrder":1001}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.store_state enable row level security;
revoke all on table public.store_state from anon, authenticated;
grant all on table public.store_state to service_role;

-- Optional: ensure REST API schema cache refreshes shortly after setup.
notify pgrst, 'reload schema';
