"""Private CV request ledger. Transport must verify delivery outside encrypted content.

VerifiedDelivery is a trust boundary for privileged adapters, not authentication.
Never construct it from a browser payload. No transport is configured here.
"""
import copy
import hashlib
import json
from dataclasses import dataclass
from daybreak import ValidationError, now, schema_validate, validate

ACTIONS = {'prepare_cv', 'request_revision', 'skip', 'reconsider'}
RESULTS = {'none', 'cv_prepared', 'role_skipped', 'role_reconsidered', 'input_required', 'stale_request', 'legacy_review'}

@dataclass(frozen=True)
class VerifiedDelivery:
    owner: str
    reference: str
    transport: str

    def check(self):
        if self.transport not in {'owner_verified_handoff', 'authenticated_mailbox'} or not self.owner or not self.reference:
            raise ValidationError('Verified owner delivery provenance is required')
        if len(self.owner)>200 or len(self.reference)>500:
            raise ValidationError('Invalid delivery provenance')

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=False).encode()).hexdigest()

def job_fingerprint(data,job):
    resume=next((r for r in data['resumes'] if r['id']==job['resumeId']),None)
    return digest({'identity':job['identity'],'status':job['status'],'resumeId':job['resumeId'],'sha256':resume['sha256'] if resume else None})

def import_requests(data, box, delivery=None):
    validate(data)
    schema_validate(box, 'outbox')
    if not isinstance(delivery, VerifiedDelivery):
        raise ValidationError('Verified owner delivery provenance is required')
    delivery.check()
    if box['baseRevision'] > data['meta']['revision']:
        raise ValidationError('Future baseRevision: recover the latest canonical state')
    receipts={r['id']:r for r in data.get('requestReceipts',[])}
    fingerprint=digest(box)
    if box['id'] in receipts:
        if receipts[box['id']]['digest'] != fingerprint or receipts[box['id']]['owner'] != delivery.owner:
            raise ValidationError('Conflicting handoff ID or owner')
        return data,False
    if box['id'] in data['meta']['processedUpdateIds']:
        raise ValidationError('Legacy processed ID lacks a receipt; reconcile privately')
    existing={d['id']:d for d in data['decisions']}
    known_requests={r['id']:r for r in data.get('requests',[])}
    jobs={j['id']:j for j in data['jobs']}
    seen=set()
    for d in box['decisions']:
        if d['id'] in seen:raise ValidationError('Duplicate request IDs in handoff')
        seen.add(d['id'])
        if d['jobId'] not in jobs:raise ValidationError('Unknown request job')
        if d['id'] in existing:
            r=known_requests.get(d['id'])
            if existing[d['id']] != d or not r or r['baseRevision']!=box['baseRevision'] or r['owner']!=delivery.owner:
                raise ValidationError('Conflicting or untracked legacy request ID')
    out=copy.deepcopy(data)
    out.setdefault('requests',[]);out.setdefault('requestReceipts',[])
    stamp=now()
    for d in box['decisions']:
        if d['id'] in existing:continue
        stale=box['baseRevision']!=data['meta']['revision']
        legacy=d['type'] not in ACTIONS
        job=jobs[d['jobId']]
        target=next((r for r in data['resumes'] if r['id']==d.get('targetResumeId')),None)
        if d['type']=='request_revision' and (not target or target['sha256']!=d.get('targetResumeSha256') or target['id']!=job['resumeId']):
            raise ValidationError('Revision requires the exact current draft ID and hash; reconcile target privately')
        protected=job['status'] in {'applied','in_progress','failed'}
        held=stale or legacy or protected
        result='stale_request' if stale else 'legacy_review' if legacy else 'input_required' if protected else 'none'
        out['decisions'].append(copy.deepcopy(d))
        out['requests'].append({'id':d['id'],'jobId':d['jobId'],'action':d['type'],
            'digest':digest(d),'baseRevision':box['baseRevision'],'owner':delivery.owner,
            'jobFingerprint':job_fingerprint(data,job),'targetResumeId':d.get('targetResumeId'),'targetResumeSha256':d.get('targetResumeSha256'),
            'status':'needs_input' if held else 'queued','result':result,'resultResumeId':None,
            'updatedAt':stamp,'history':[{'at':stamp,'status':'needs_input' if held else 'queued','note':'Imported; reconciliation required' if held else 'Imported'}]})
    out['requestReceipts'].append({'id':box['id'],'digest':fingerprint,'owner':delivery.owner,
        'transport':delivery.transport,'reference':delivery.reference,'receivedAt':stamp})
    out['meta']['revision']+=1;out['meta']['updatedAt']=stamp
    return validate(out),True

def update_request(data, update):
    """Privileged worker checkpoint; never executes request text or submits a job."""
    schema_validate(update,'request-update')
    if update['baseRevision']!=data['meta']['revision']:raise ValidationError('Stale request update')
    out=copy.deepcopy(data)
    req=next((r for r in out.get('requests',[]) if r['id']==update['requestId']),None)
    if not req:raise ValidationError('Unknown request')
    status=update['status']; result=update['result']; rid=update.get('resultResumeId')
    if req['status']=='ready':raise ValidationError('Completed request is immutable; create a new request')
    allowed={'queued':{'working','needs_input'},'working':{'ready','needs_input'},'needs_input':{'queued'}}
    if status not in allowed[req['status']]:raise ValidationError('Invalid request transition')
    if req['status']=='needs_input' and (not update.get('reconciled') or not update['privateNote'].strip()):
        raise ValidationError('Explicit private reconciliation is required')
    if req['action'] not in ACTIONS and status!='needs_input':raise ValidationError('Legacy request needs a new explicit CV action')
    job=next(j for j in out['jobs'] if j['id']==req['jobId'])
    if status=='working' and req['jobFingerprint']!=job_fingerprint(out,job):raise ValidationError('Request target changed; hold for explicit reconciliation')
    if req['status']=='needs_input' and status=='queued':req['jobFingerprint']=job_fingerprint(out,job)
    if status in {'working','ready'} and job['status'] in {'applied','in_progress','failed'}:
        raise ValidationError('Protected job state requires owner reconciliation; no CV execution')
    if status=='ready':
        expected={'prepare_cv':'cv_prepared','request_revision':'cv_prepared','skip':'role_skipped','reconsider':'role_reconsidered'}[req['action']]
        if result!=expected:raise ValidationError('Result does not match action')
        if result=='cv_prepared':
            resume=next((r for r in out['resumes'] if r['id']==rid),None)
            if req['action']=='request_revision' and (rid==req['targetResumeId'] or (resume and resume['sha256']==req['targetResumeSha256'])):raise ValidationError('Revision requires a new changed immutable draft')
            if not resume or not rid.startswith('draft-') or job['resumeId']!=rid:raise ValidationError('Completed CV requires a saved linked draft')
        elif rid is not None:raise ValidationError('Unexpected result resume')
        if result=='role_skipped' and job['status']!='skipped':raise ValidationError('Skip must be checkpointed in job state first')
        if result=='role_reconsidered' and job['status'] not in {'discovered','needs_review'}:raise ValidationError('Reconsidered job must remain unsubmitted')
    elif result not in ({'none'} if status in {'queued','working'} else {'input_required','stale_request','legacy_review'}):
        raise ValidationError('Invalid status/result combination')
    if status!='ready' and rid is not None:raise ValidationError('Unexpected result resume')
    stamp=now();req.update(status=status,result=result,resultResumeId=rid,updatedAt=stamp)
    req['history'].append({'at':stamp,'status':status,'note':update['privateNote']})
    out['meta']['revision']+=1;out['meta']['updatedAt']=stamp
    return validate(out),True
