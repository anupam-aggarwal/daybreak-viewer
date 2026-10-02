-- Hosted QA only. All synthetic requests/replies/checkpoints roll back together.
-- Uses existing owner and real job identifier without displaying private contents.
begin;
set local role service_role;
do $$
declare owner uuid; rev bigint; doc jsonb; job text; rid uuid=gen_random_uuid(); token uuid=gen_random_uuid(); reply uuid=gen_random_uuid(); n integer; denied boolean;
begin
 select owner_id into strict owner from public.daybreak_owners where enabled;
 select revision into strict rev from public.daybreak_workspaces where owner_id=owner;
 select document into strict doc from public.daybreak_snapshots where owner_id=owner and revision=rev;
 job=doc->'jobs'->0->>'id';
 insert into public.daybreak_cv_requests(id,owner_id,job_id,base_revision,action,content) values(rid,owner,job,rev,'prepare_cv','SYNTHETIC ROLLBACK TEST');
 select count(*) into n from public.daybreak_claim(owner,rid,token);if n<>1 then raise exception 'Claim failed';end if;
 select count(*) into n from public.daybreak_claim(owner,rid,gen_random_uuid());if n<>0 then raise exception 'Duplicate claim';end if;
 if public.daybreak_renew(owner,rid,gen_random_uuid()) then raise exception 'Wrong lease accepted';end if;
 if not public.daybreak_renew(owner,rid,token) then raise exception 'Renew failed';end if;
 denied=false;
 begin perform public.daybreak_finish(owner,rid,token,rev,'needs_input','input_required',reply,'SYNTHETIC ROLLBACK REPLY');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'Missing checkpoint accepted';end if;
 doc=jsonb_set(doc,'{meta,revision}',to_jsonb(rev+1));
 doc=jsonb_set(doc,'{requests}',coalesce(doc->'requests','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',rid,'owner',owner,'jobId',job,'status','needs_input','result','input_required')));
 insert into public.daybreak_snapshots(owner_id,revision,document,canonical_sha256) values(owner,rev+1,doc,repeat('a',64));
 if public.daybreak_checkpoint(owner,rev-1,rev+1) then raise exception 'Stale CAS accepted';end if;
 if not public.daybreak_checkpoint(owner,rev,rev+1) then raise exception 'Checkpoint CAS failed';end if;
 update public.daybreak_cv_requests set lease_until=now()-interval '1 second' where id=rid;
 if public.daybreak_renew(owner,rid,token) then raise exception 'Expired lease renewed';end if;
 select count(*) into n from public.daybreak_claim(owner,rid,gen_random_uuid());if n<>0 then raise exception 'Expired work reclaimed';end if;
 denied=false;
 begin perform public.daybreak_finish(owner,rid,token,rev+1,'needs_input','input_required',reply,'SYNTHETIC ROLLBACK REPLY');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'Expired lease finished';end if;
 update public.daybreak_cv_requests set lease_until=now()+interval '5 minutes' where id=rid;
 if not public.daybreak_finish(owner,rid,token,rev+1,'needs_input','input_required',reply,'SYNTHETIC ROLLBACK REPLY') then raise exception 'Finish failed';end if;
 if not public.daybreak_finish(owner,rid,token,rev+1,'needs_input','input_required',reply,'SYNTHETIC ROLLBACK REPLY') then raise exception 'Exact retry failed';end if;
 if (select count(*) from public.daybreak_cv_replies where request_id=rid)<>1 then raise exception 'Duplicate reply';end if;
end $$;
select 'PASS: claim, duplicate denial, lease token, expiry, stale CAS, checkpoint-before-reply and exact completion retry; rolled back' as result;
rollback;
