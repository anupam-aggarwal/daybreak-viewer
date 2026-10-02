-- Bounded, service-only operations. Invoker privileges; no browser elevation.
begin;
grant select(owner_id,github_user_id,enabled) on public.daybreak_owners to service_role;

create function public.daybreak_claim(p_owner uuid,p_request uuid,p_token uuid)
returns setof public.daybreak_cv_requests language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.daybreak_owners where owner_id=p_owner and enabled) then raise exception 'Owner unavailable'; end if;
 -- An expired Working row is NEVER automatically reclaimed: reconcile its durable checkpoint.
 return query update public.daybreak_cv_requests set status='working',lease_token=p_token,
 lease_until=now()+interval '15 minutes',updated_at=now()
 where owner_id=p_owner and id=p_request and status='queued' and lease_token is null returning *;
end $$;

create function public.daybreak_renew(p_owner uuid,p_request uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 update public.daybreak_cv_requests set lease_until=now()+interval '15 minutes',updated_at=now()
 where owner_id=p_owner and id=p_request and status='working' and lease_token=p_token and lease_until>now()
 and exists(select 1 from public.daybreak_owners where owner_id=p_owner and enabled);
 get diagnostics changed=row_count;return changed=1;
end $$;

create function public.daybreak_checkpoint(p_owner uuid,p_expected bigint,p_revision bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if p_revision<=p_expected then raise exception 'Revision must advance'; end if;
 update public.daybreak_workspaces set revision=p_revision,updated_at=now()
 where owner_id=p_owner and revision=p_expected
 and exists(select 1 from public.daybreak_owners where owner_id=p_owner and enabled)
 and exists(select 1 from public.daybreak_snapshots where owner_id=p_owner and revision=p_revision);
 get diagnostics changed=row_count;return changed=1;
end $$;

create function public.daybreak_finish(p_owner uuid,p_request uuid,p_token uuid,p_revision bigint,p_status text,p_result text,p_reply uuid,p_body text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.daybreak_cv_requests; current_revision bigint; doc jsonb;
begin
 if p_status not in ('ready','needs_input') or length(trim(p_body))<1 or length(p_body)>10000 then raise exception 'Invalid completion'; end if;
 select revision into current_revision from public.daybreak_workspaces where owner_id=p_owner for update;
 if current_revision is distinct from p_revision then raise exception 'Stale checkpoint'; end if;
 select * into r from public.daybreak_cv_requests where owner_id=p_owner and id=p_request for update;
 if not found then raise exception 'Request unavailable'; end if;
 -- An exact retry after an ambiguous HTTP response succeeds without another reply.
 if r.status=p_status and r.checkpoint_revision=p_revision and r.result=p_result and exists(
   select 1 from public.daybreak_cv_replies where id=p_reply and request_id=p_request and owner_id=p_owner and body=p_body
 ) then return true; end if;
 if r.status<>'working' or r.lease_token is distinct from p_token or r.lease_until<=now() or r.lease_until is null then raise exception 'Lease unavailable'; end if;
 if not exists(select 1 from public.daybreak_owners where owner_id=p_owner and enabled) then raise exception 'Owner unavailable'; end if;
 select document into doc from public.daybreak_snapshots where owner_id=p_owner and revision=p_revision;
 if not exists(select 1 from jsonb_array_elements(coalesce(doc->'requests','[]'::jsonb)) q
   where q->>'id'=p_request::text and q->>'owner'=p_owner::text and q->>'jobId'=r.job_id
   and q->>'status'=p_status and q->>'result'=p_result) then raise exception 'Durable request checkpoint required'; end if;
 insert into public.daybreak_cv_replies(id,request_id,owner_id,body) values(p_reply,p_request,p_owner,p_body);
 update public.daybreak_cv_requests set status=p_status,result=p_result,checkpoint_revision=p_revision,
 lease_token=null,lease_until=null,updated_at=now() where id=p_request and owner_id=p_owner;
 return true;
end $$;

revoke all on function public.daybreak_claim(uuid,uuid,uuid),public.daybreak_renew(uuid,uuid,uuid),public.daybreak_checkpoint(uuid,bigint,bigint),public.daybreak_finish(uuid,uuid,uuid,bigint,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.daybreak_claim(uuid,uuid,uuid),public.daybreak_renew(uuid,uuid,uuid),public.daybreak_checkpoint(uuid,bigint,bigint),public.daybreak_finish(uuid,uuid,uuid,bigint,text,text,uuid,text) to service_role;
commit;
