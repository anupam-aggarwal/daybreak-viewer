-- For a NEW dedicated project only; do not reapply to the running project.
-- Enroll the verified existing Auth UUID only after checking its identity.
begin;
create table public.daybreak_owners (
 owner_id uuid primary key references auth.users(id),
 github_user_id text not null unique check(github_user_id ~ '^[0-9]+$'),
 enabled boolean not null default true
);
alter table public.daybreak_owners enable row level security;
revoke all on public.daybreak_owners from public,anon,authenticated;
grant select on public.daybreak_owners to authenticated;
create policy owner_identity on public.daybreak_owners for select to authenticated
 using(owner_id=(select auth.uid()) and enabled);
commit;
