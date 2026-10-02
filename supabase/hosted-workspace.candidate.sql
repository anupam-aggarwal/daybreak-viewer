-- REVIEW CANDIDATE ONLY. Existing owner registry remains authoritative.
-- Additive: no legacy mailbox, vault, identity or storage records removed.
begin;
create table public.daybreak_snapshots (
 owner_id uuid not null references public.daybreak_owners(owner_id),
 revision bigint not null check(revision>=0),
 document jsonb not null check(jsonb_typeof(document)='object'),
 canonical_sha256 text not null check(canonical_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 primary key(owner_id,revision),
 check((document->'meta'->>'revision')::bigint=revision),
 check(document->'preferences'->'approvedForSubmission'='false'::jsonb)
);
create table public.daybreak_workspaces (
 owner_id uuid primary key references public.daybreak_owners(owner_id),
 revision bigint not null,
 updated_at timestamptz not null default now(),
 foreign key(owner_id,revision) references public.daybreak_snapshots(owner_id,revision)
);
create table public.daybreak_files (
 owner_id uuid not null references public.daybreak_owners(owner_id),
 id text not null check(length(id) between 1 and 200),
 path text not null,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint not null check(size between 1 and 2097152),
 mime text not null check(mime in ('application/pdf','text/plain','image/png','image/jpeg')),
 filename text not null check(length(filename) between 1 and 255),
 primary key(owner_id,id),
 check(path=owner_id::text||'/'||sha256)
);
create index daybreak_files_path on public.daybreak_files(owner_id,path);
create table public.daybreak_cv_requests (
 id uuid primary key,
 owner_id uuid not null default auth.uid() references public.daybreak_owners(owner_id),
 job_id text not null check(length(job_id) between 1 and 200),
 base_revision bigint not null check(base_revision>=0),
 action text not null check(action in ('prepare_cv','request_revision','skip','reconsider')),
 content text not null default '' check(length(content)<=10000),
 target_resume_id text,
 target_resume_sha256 text check(target_resume_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'queued' check(status in ('queued','working','needs_input','ready')),
 result text not null default '' check(length(result)<=1000),
 lease_token uuid,
 lease_until timestamptz,
 checkpoint_revision bigint,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,owner_id),
 foreign key(owner_id,base_revision) references public.daybreak_snapshots(owner_id,revision),
 check(action<>'request_revision' or (length(trim(content))>0 and target_resume_id is not null and target_resume_sha256 is not null)),
 check(status<>'ready' or checkpoint_revision is not null)
);
create index daybreak_cv_requests_owner_created on public.daybreak_cv_requests(owner_id,created_at desc);
create index daybreak_cv_requests_queue on public.daybreak_cv_requests(status,lease_until,created_at);
create table public.daybreak_cv_replies (
 id uuid primary key,
 request_id uuid not null,
 owner_id uuid not null,
 body text not null check(length(body) between 1 and 10000),
 created_at timestamptz not null default now(),
 foreign key(request_id,owner_id) references public.daybreak_cv_requests(id,owner_id)
);
create index daybreak_cv_replies_owner_created on public.daybreak_cv_replies(owner_id,created_at desc);
alter table public.daybreak_snapshots enable row level security;
alter table public.daybreak_workspaces enable row level security;
alter table public.daybreak_files enable row level security;
alter table public.daybreak_cv_requests enable row level security;
alter table public.daybreak_cv_replies enable row level security;
revoke all on public.daybreak_snapshots,public.daybreak_workspaces,public.daybreak_files,public.daybreak_cv_requests,public.daybreak_cv_replies from public,anon,authenticated;
grant select on public.daybreak_snapshots,public.daybreak_workspaces,public.daybreak_files,public.daybreak_cv_requests,public.daybreak_cv_replies to authenticated;
grant insert(id,owner_id,job_id,base_revision,action,content,target_resume_id,target_resume_sha256) on public.daybreak_cv_requests to authenticated;
grant select,insert,update on public.daybreak_workspaces,public.daybreak_cv_requests to service_role;
grant select,insert on public.daybreak_snapshots,public.daybreak_files,public.daybreak_cv_replies to service_role;
create policy hosted_snapshot_owner on public.daybreak_snapshots for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_snapshots.owner_id and o.enabled));
create policy hosted_workspace_owner on public.daybreak_workspaces for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_workspaces.owner_id and o.enabled));
create policy hosted_file_owner on public.daybreak_files for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_files.owner_id and o.enabled));
create policy hosted_request_owner on public.daybreak_cv_requests for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_cv_requests.owner_id and o.enabled));
create policy hosted_request_insert on public.daybreak_cv_requests for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_cv_requests.owner_id and o.enabled) and exists(select 1 from public.daybreak_snapshots s where s.owner_id=daybreak_cv_requests.owner_id and s.revision=base_revision and exists(select 1 from jsonb_array_elements(s.document->'jobs') j where j->>'id'=job_id)));
create policy hosted_reply_owner on public.daybreak_cv_replies for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.daybreak_owners o where o.owner_id=daybreak_cv_replies.owner_id and o.enabled));
-- The private bucket is created/verified through the official Storage API,
-- id/name daybreak-private, public=false, 2 MiB limit, allowed MIME types above.
-- This policy does NOT create storage objects; only the Storage API writes bytes.
create policy hosted_private_file_download on storage.objects for select to authenticated
using(bucket_id='daybreak-private' and exists(
 select 1 from public.daybreak_files f join public.daybreak_owners o on o.owner_id=f.owner_id
 where f.owner_id=(select auth.uid()) and o.enabled and f.path=storage.objects.name
));
-- No browser INSERT/UPDATE/DELETE Storage policy. No unauthenticated function.
commit;
