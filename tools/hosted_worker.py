"""Explicit private CV worker adapter. No scheduler, automatic reclaim or execution of request text.

Use import_claim() to save a validated Working/Needs-input canonical checkpoint BEFORE
CV work; merge() and update_request() retain the existing schema/history safeguards.
publish() uploads immutable files and snapshots before a compare-and-swap pointer.
finish() posts a private reply only against the durable request checkpoint and live lease.
An ambiguous/expired Working row requires operator reconciliation, never automatic retry.
"""
import base64,copy,uuid
from urllib.parse import quote
from hosted_api import API,HostedError
from hosted_verify import recover
from hosted_backup import encoded,digest
from daybreak import validate,merge,now,ValidationError
from cv_requests import import_requests,update_request,VerifiedDelivery

def require(ok):
    if not ok: raise ValidationError('Hosted worker invariant failed; reconcile privately')

def transition(previous,current):
    validate(previous);validate(current)
    require(current['meta']['revision']>previous['meta']['revision'])
    require(current['preferences']['approvedForSubmission'] is False)
    require(current['preferences'].get('permittedApplicationHosts',[])==[])
    for collection in ('artifacts','resumes','decisions','requestReceipts'):
        old={x['id']:x for x in previous.get(collection,[])};new={x['id']:x for x in current.get(collection,[])}
        require(all(new.get(k)==v for k,v in old.items()))
    before={j['id']:j for j in previous['jobs']};after={j['id']:j for j in current['jobs']}
    require(set(before)<=set(after))
    for key,j in after.items():
        old=before.get(key)
        require(j['status'] not in ('applied','in_progress') or old==j)
        if old:
            for field in ('events','attempts'):
                indexed={x['id']:x for x in j[field]}
                require(all(indexed.get(x['id'])==x for x in old[field]))
            if old['submission']:require(j['submission']==old['submission'])
    requests={r['id']:r for r in current.get('requests',[])}
    for old in previous.get('requests',[]):
        new=requests.get(old['id']);require(new is not None)
        require(new['history'][:len(old['history'])]==old['history'])
        for key in ('id','jobId','action','digest','baseRevision','owner','targetResumeId','targetResumeSha256'):
            require(new.get(key)==old.get(key))
        if old['status']=='ready':require(new==old)
    require(set(previous['meta']['processedUpdateIds'])<=set(current['meta']['processedUpdateIds']))
    return current

class Worker:
    def __init__(self,owner,api=None):
        self.owner=str(uuid.UUID(owner));self.api=api or API()
    def rpc(self,name,**fields):
        return self.api.call('/rest/v1/rpc/daybreak_'+name,'POST',{'p_owner':self.owner,**fields})
    def load(self):return recover(self.api,self.owner)
    def queued(self):
        return self.api.call('/rest/v1/daybreak_cv_requests?select=*&owner_id=eq.'+self.owner+'&status=eq.queued&order=created_at.asc&limit=20')
    def claim(self,request_id,token):
        rows=self.rpc('claim',p_request=str(uuid.UUID(request_id)),p_token=str(uuid.UUID(token)))
        require(len(rows)==1);return rows[0]
    def renew(self,row):
        require(self.rpc('renew',p_request=row['id'],p_token=row['lease_token']) is True)
    def import_claim(self,data,row):
        require(row['owner_id']==self.owner and row['status']=='working')
        decision={'id':row['id'],'jobId':row['job_id'],'type':row['action'],'content':row['content'],'actor':'user','createdAt':row['created_at']}
        if row['target_resume_id'] is not None:decision['targetResumeId']=row['target_resume_id']
        if row['target_resume_sha256'] is not None:decision['targetResumeSha256']=row['target_resume_sha256']
        box={'type':'daybreak-decisions','schemaVersion':'1.0','id':row['id'],'baseRevision':row['base_revision'],'createdAt':row['created_at'],'decisions':[decision]}
        out,changed=import_requests(data,box,VerifiedDelivery(self.owner,'hosted:'+row['id'],'authenticated_mailbox'))
        require(changed) # Existing receipt is an ambiguous/recovered operation: inspect first.
        request=next(r for r in out['requests'] if r['id']==row['id'])
        if request['status']=='queued':
            out,_=update_request(out,{'requestId':row['id'],'baseRevision':out['meta']['revision'],'status':'working','result':'none','resultResumeId':None,'privateNote':'Verified hosted claim; durable checkpoint before work','reconciled':False})
        return out
    def insert_exact(self,table,record,keys):
        query='&'.join(k+'=eq.'+quote(str(record[k]),safe='') for k in keys)
        path='/rest/v1/'+table+'?select=*&'+query
        rows=self.api.call(path)
        if not rows:
            try:self.api.call('/rest/v1/'+table,'POST',record)
            except HostedError:pass # Resolve a lost response or conflict by exact readback only.
            rows=self.api.call(path)
        require(len(rows)==1 and all(rows[0].get(k)==v for k,v in record.items()))
    def publish(self,previous,current):
        transition(previous,current)
        bucket=self.api.call('/storage/v1/bucket/daybreak-private')
        require(bucket['public'] is False and int(bucket['file_size_limit'])==2097152)
        metadata=copy.deepcopy(current)
        for a in metadata['artifacts']:
            raw=base64.b64decode(a.pop('base64'),validate=True);path=self.owner+'/'+a['sha256']
            require(digest(raw)==a['sha256'])
            endpoint='/storage/v1/object/authenticated/daybreak-private/'+path
            try:existing=self.api.call(endpoint,raw=True)
            except HostedError as e:
                require(e.status in (400,404))
                try:self.api.call('/storage/v1/object/daybreak-private/'+path,'POST',raw,mime=a['mime'])
                except HostedError:pass
                existing=self.api.call(endpoint,raw=True)
            require(existing==raw)
            self.insert_exact('daybreak_files',{'owner_id':self.owner,'id':a['id'],'path':path,'sha256':a['sha256'],'size':len(raw),'mime':a['mime'],'filename':a['name']},('owner_id','id'))
        revision=current['meta']['revision']
        self.insert_exact('daybreak_snapshots',{'owner_id':self.owner,'revision':revision,'document':metadata,'canonical_sha256':digest(encoded(current))},('owner_id','revision'))
        require(self.rpc('checkpoint',p_expected=previous['meta']['revision'],p_revision=revision) is True)
        require(encoded(self.load())==encoded(current))
    def finish(self,row,current,reply_id,body):
        require(encoded(self.load())==encoded(current))
        request=next(r for r in current['requests'] if r['id']==row['id'])
        require(request['status'] in ('ready','needs_input'))
        require(self.rpc('finish',p_request=row['id'],p_token=row['lease_token'],p_revision=current['meta']['revision'],p_status=request['status'],p_result=request['result'],p_reply=str(uuid.UUID(reply_id)),p_body=body) is True)
