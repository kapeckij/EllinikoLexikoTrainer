create table if not exists public.trainer_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.trainer_state enable row level security;

revoke all on table public.trainer_state from anon, authenticated;
grant select, insert, update on table public.trainer_state to authenticated;

drop policy if exists "Users read their trainer state" on public.trainer_state;
create policy "Users read their trainer state"
on public.trainer_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create their trainer state" on public.trainer_state;
create policy "Users create their trainer state"
on public.trainer_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their trainer state" on public.trainer_state;
create policy "Users update their trainer state"
on public.trainer_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);