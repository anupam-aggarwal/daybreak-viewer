#!/usr/bin/env python3
"""Explicit, single-publisher commands for the Supabase-only CV workspace.

Never run claim/complete concurrently. Request text is data, never code.
All working files and extracted documents must stay outside this public checkout.
"""
import argparse,copy,json,os,sys,uuid
from pathlib import Path
from daybreak import ROOT,ValidationError,merge,read_json
from cv_requests import update_request
from hosted_api import API
from hosted_backup import encoded
from hosted_worker import Worker

def private_path(path):
 path=Path(path).expanduser().resolve()
 if path==ROOT or ROOT in path.parents:raise ValidationError('Private work must stay outside the public checkout')
 return path

def save(path,value):
 path=private_path(path);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(encoded(value))

def operation(directory):
 directory=private_path(directory)
 if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode&0o077:raise ValidationError('Use an existing private 0700 directory')
 return directory

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--owner',default=os.environ.get('DAYBREAK_OWNER_ID'),required=not os.environ.get('DAYBREAK_OWNER_ID'),help='Verified existing owner UUID; defaults to DAYBREAK_OWNER_ID')
 sub=parser.add_subparsers(dest='command',required=True)
 sub.add_parser('status')
 p=sub.add_parser('extract');p.add_argument('artifact_id');p.add_argument('output')
 p=sub.add_parser('claim');p.add_argument('request_id');p.add_argument('directory')
 p=sub.add_parser('renew');p.add_argument('directory')
 p=sub.add_parser('complete');p.add_argument('directory');p.add_argument('update_file');p.add_argument('reply_file')
 args=parser.parse_args();owner=str(uuid.UUID(args.owner));worker=Worker(owner)
 if args.command=='status':
  data=worker.load();rows=worker.api.call('/rest/v1/daybreak_cv_requests?select=id,status,job_id,action,base_revision&owner_id=eq.'+owner+'&order=created_at.asc')
  print(json.dumps({'revision':data['meta']['revision'],'artifacts':len(data['artifacts']),'requests':rows},indent=2));return
 if args.command=='extract':
  data=worker.load();item=next((a for a in data['artifacts'] if a['id']==args.artifact_id),None)
  if item is None:raise ValidationError('Artifact not found')
  import base64
  path=private_path(args.output);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb') as stream:stream.write(base64.b64decode(item['base64'],validate=True))
  print('Verified private artifact extracted');return
 directory=operation(args.directory)
 if args.command=='claim':
  request=str(uuid.UUID(args.request_id));before=worker.load()
  if any((directory/name).exists() for name in ('operation.json','claimed.json','working.json')):raise ValidationError('Operation directory already used; reconcile')
  if len([r for r in worker.queued() if r['id']==request])!=1:raise ValidationError('Request is not queued; reconcile')
  op={'request_id':request,'owner_id':owner,'lease_token':str(uuid.uuid4()),'reply_id':str(uuid.uuid4())}
  save(directory/'operation.json',op)
  row=worker.claim(request,op['lease_token']);save(directory/'claimed.json',row)
  current=worker.import_claim(before,row);save(directory/'working.json',current)
  worker.publish(before,current)
  print('Durable Working checkpoint revision',current['meta']['revision']);return
 op=read_json(directory/'operation.json');row=read_json(directory/'claimed.json')
 if op['owner_id']!=owner or row['id']!=op['request_id'] or row['lease_token']!=op['lease_token']:raise ValidationError('Operation identity mismatch')
 if args.command=='renew':
  worker.renew(row);print('Matching lease renewed');return
 previous=read_json(directory/'working.json')
 ready_file=directory/'ready.json'
 if ready_file.exists():current=read_json(ready_file)
 else:
  if encoded(worker.load())!=encoded(previous):raise ValidationError('Workspace changed; reconcile before preparing')
  update=read_json(private_path(args.update_file));current,changed=merge(previous,update)
  if not changed:raise ValidationError('Update already processed; reconcile')
  current,_=update_request(current,{'requestId':op['request_id'],'baseRevision':current['meta']['revision'],'status':'ready','result':'cv_prepared','resultResumeId':update['resumes'][0]['id'],'privateNote':'Verified private CV draft, source and QA saved before reply','reconciled':False})
  save(ready_file,current)
 body=private_path(args.reply_file).read_text(encoding='utf-8')
 if not body.strip():raise ValidationError('Empty reply')
 saved_reply=directory/'reply-body.json'
 if saved_reply.exists():
  if read_json(saved_reply)['body']!=body:raise ValidationError('Reply changed after preparation; reconcile')
 else:save(saved_reply,{'body':body})
 live=worker.load()
 if encoded(live)==encoded(previous):
  worker.renew(row);worker.publish(previous,current)
 elif encoded(live)!=encoded(current):raise ValidationError('Workspace does not match saved checkpoint; reconcile')
 worker.finish(row,current,op['reply_id'],body)
 replies=worker.api.call('/rest/v1/daybreak_cv_replies?select=id,body&owner_id=eq.'+owner+'&id=eq.'+op['reply_id'])
 if len(replies)!=1 or replies[0]['body']!=body:raise ValidationError('Reply readback mismatch')
 requests=worker.api.call('/rest/v1/daybreak_cv_requests?select=id,status,result,checkpoint_revision&owner_id=eq.'+owner+'&id=eq.'+op['request_id'])
 if len(requests)!=1 or requests[0]['status']!='ready' or requests[0]['result']!='cv_prepared' or requests[0]['checkpoint_revision']!=current['meta']['revision']:raise ValidationError('Request readback mismatch')
 print('Ready revision',current['meta']['revision'],'request',op['request_id'],'reply verified')

if __name__=='__main__':
 try:main()
 except Exception:print('Hosted operation failed; inspect private checkpoints and reconcile before retry',file=sys.stderr);sys.exit(1)
