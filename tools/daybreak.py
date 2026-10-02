"""Hosted Daybreak data validation and immutable merge logic. No legacy vault credentials."""
from __future__ import annotations
import base64,copy,datetime as dt,hashlib,json,os,re
from pathlib import Path
from urllib.parse import urlparse,parse_qsl,urlencode,urlunparse
from jsonschema import Draft202012Validator,FormatChecker
ROOT=Path(__file__).resolve().parents[1]
MAX_BYTES=25*1024*1024
class ValidationError(ValueError):pass
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def parse_date(v):return dt.datetime.fromisoformat(v.replace('Z','+00:00'))
def read_json(p):
 p=Path(p)
 if p.stat().st_size>MAX_BYTES*1.5:raise ValidationError('JSON input exceeds 37.5 MiB limit')
 return json.loads(p.read_text(encoding='utf-8'))
def b64(x):return base64.b64encode(x).decode('ascii')
def un64(x):return base64.b64decode(x,validate=True)
def schema_validate(data,name='vault'):
    schema=read_json(ROOT/f'schema/{name}.schema.json')
    errors=sorted(Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(data),key=lambda e:str(list(e.path)))
    if errors:
        lines=[f'{".".join(map(str,e.path)) or "root"}: failed {e.validator} constraint' for e in errors[:8]]
        raise ValidationError('Invalid data:\n'+'\n'.join(lines))

def validate(data):
    schema_validate(data)
    for field in ['jobs','resumes','artifacts','feeds','runs','decisions']:
        ids=[x['id'] for x in data[field]]
        if len(set(ids))!=len(ids):raise ValidationError(f'Duplicate IDs in {field}')
    artifacts={a['id']:a for a in data['artifacts']}
    for a in artifacts.values():
        raw=un64(a['base64'])
        if len(raw)>2*1024*1024:raise ValidationError('Each embedded artifact must be <=2 MiB')
        if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValidationError('Artifact SHA-256 mismatch: '+a['id'])
    resumes={r['id']:r for r in data['resumes']}
    for r in resumes.values():
        a=artifacts.get(r['artifactId'])
        if not a or a['sha256']!=r['sha256']:raise ValidationError('Resume must reference its exact, hashed artifact: '+r['id'])
    for j in data['jobs']:
        if j['salary'] and j['salary']['max'] is not None and j['salary']['max']<j['salary']['min']:raise ValidationError('Invalid salary range')
        if j['resumeId'] and j['resumeId'] not in resumes:raise ValidationError('Unknown resumeId: '+j['id'])
        for field in ['sourceUrl','applyUrl']:
            u=urlparse(j[field])
            if u.scheme not in ['http','https'] or not u.netloc or u.username:raise ValidationError('Job URLs must be public http(s) links')
        if j['status']=='applied':
            s=j['submission']
            if not s or not s['evidence']['summary'].strip() or not s['evidence']['reference'].strip():raise ValidationError('Applied requires recorded confirmation evidence: '+j['id'])
            r=resumes.get(s['resumeId'])
            if not r or not r['approved'] or r['sha256']!=s['resumeSha256'] or r['version']!=s['resumeVersion']:raise ValidationError('Applied requires exact approved resume version: '+j['id'])
            if not any(a['result']=='confirmed' for a in j['attempts']):raise ValidationError('Applied requires a confirmed attempt: '+j['id'])
        if j['submission'] and j['status']!='applied':raise ValidationError('A confirmed submission must retain applied status; track hiring updates in outcome')
        if j['submission'] and j['submission']['evidence']['artifactId'] and j['submission']['evidence']['artifactId'] not in artifacts:raise ValidationError('Missing evidence artifact')
    for f in data['feeds']:
        if f['verified'] and not f['sources']:raise ValidationError('Verified research requires source URLs')
        for s in f['sources']:
            if urlparse(s['url']).scheme not in ['http','https']:raise ValidationError('Unsafe research source URL')
    seen_identity={}
    for j in data['jobs']:
        for key in identity_keys(j):
            if key in seen_identity and seen_identity[key]!=j['id']:raise ValidationError('Duplicate job identity: '+j['id']+' and '+seen_identity[key])
            seen_identity[key]=j['id']
        for field in ['events','attempts']:
            if len({x['id'] for x in j[field]})!=len(j[field]):raise ValidationError('Duplicate event/attempt IDs: '+j['id'])
    jobids={j['id'] for j in data['jobs']}
    if any(d['jobId'] not in jobids for d in data['decisions']):raise ValidationError('Decision references unknown job')
    for field in ['requests','requestReceipts']:
        ids=[r['id'] for r in data.get(field,[])]
        if len(ids)!=len(set(ids)):raise ValidationError('Duplicate '+field+' IDs')
    decisions={d['id']:d for d in data['decisions']}
    for r in data.get('requests',[]):
        from cv_requests import digest
        d=decisions.get(r['id'])
        if not d or r['jobId']!=d['jobId'] or r['action']!=d['type'] or r['digest']!=digest(d):raise ValidationError('Request provenance/content mismatch')
        if r['resultResumeId'] is not None and r['resultResumeId'] not in resumes:raise ValidationError('Unknown request result CV')
        if r['history'][-1]['status']!=r['status']:raise ValidationError('Request status history mismatch')
    return data

def norm(s):return re.sub(r'[^a-z0-9]+',' ',(s or '').lower()).strip()
def canonical_url(url):
    """Drop tracking only; preserve requisition keys and other meaningful query params."""
    u=urlparse(url)
    host=(u.hostname or '').lower().removeprefix('www.')
    q=[(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in {'trk','trackingid','ref','refid','source','src','referrer','campaign','sessionid','session'}]
    if host.endswith('linkedin.com'):
        m=re.search(r'/jobs/view/(?:.*?-)?(\d+)',u.path)
        if m:return 'https://linkedin.com/jobs/view/'+m[1]
    if host.endswith('indeed.com'):
        jid=dict(q).get('jk') or dict(q).get('vjk')
        if jid:return f'https://{host}/viewjob?jk={jid}'
    return urlunparse(('https',host,u.path.rstrip('/') or '/', '',urlencode(sorted(q)),''))
def identity_keys(job):
    i=job.get('identity',{});keys=set()
    company=norm(i.get('canonicalEmployer') or job.get('company',''))
    if i.get('requisitionId'):keys.add('req:'+company+':'+norm(i['requisitionId']))
    if i.get('platformJobId'):keys.add('platform:'+norm(job.get('platform',''))+':'+i['platformJobId'])
    for url in [job.get('sourceUrl'),job.get('applyUrl'),*i.get('urls',[])]:
        if url:keys.add('url:'+canonical_url(url))
    return keys

def check_job(data,job,at=None):
    keys=identity_keys(job)
    for existing in data['jobs']:
        overlap=keys&identity_keys(existing)
        if job.get('id')==existing['id'] or overlap:
            blocked=existing['status'] in {'applied','in_progress','needs_review','failed','skipped'}
            return {'decision':'blocked' if blocked else 'existing_open','existingId':existing['id'],'status':existing['status'],'reason':'Existing identity; never retry an applied, uncertain, failed or reviewed record automatically.','matchedKeys':sorted(overlap)}
    for existing in data['jobs']:
        if norm(existing['company'])==norm(job.get('company')) and norm(existing['title'])==norm(job.get('title')) and norm(existing['location'])==norm(job.get('location')):
            # Different requisition IDs are strong evidence of separate roles.
            a=existing['identity'].get('requisitionId');b=job.get('identity',{}).get('requisitionId')
            if not (a and b and a!=b):return {'decision':'possible_duplicate','existingId':existing['id'],'reason':'Same company, title and location without distinct requisition evidence. Review before submitting.'}
    stamp=job.get('postedAt')
    if not stamp:return {'decision':'needs_review','reason':'Posting date unknown; fresh-only rule cannot be verified.'}
    age=((parse_date(at) if at else dt.datetime.now(dt.timezone.utc))-parse_date(stamp)).total_seconds()/3600
    if age< -1:return {'decision':'needs_review','reason':'Posting time is in the future.'}
    if age>data['preferences']['freshnessHours']:return {'decision':'stale','reason':'Posting is outside the configured freshness window.'}
    return {'decision':'new','reason':'No known identity match; posting is within freshness window. Not a submission authorization.'}

def merge(data,update):
    schema_validate(update,'update')
    if update['id'] in data['meta']['processedUpdateIds']:return data,False
    if update['baseRevision']!=data['meta']['revision']:raise ValidationError('Stale update: recover latest hosted state, reconcile and use current baseRevision')
    out=copy.deepcopy(data)
    for field in ['artifacts','resumes','jobs','feeds','runs']:
        byid={x['id']:x for x in out[field]}
        for item in update.get(field,[]):
            old=byid.get(item['id'])
            if old and field in ['artifacts','resumes'] and old!=item:raise ValidationError(f'{field} are immutable: add a new version/ID')
            if field=='jobs':
                if old:
                    if old['status']=='applied' and (item['status']!='applied' or item['submission']!=old['submission']):raise ValidationError('Confirmed submission record is immutable. Only outcome/notes may change.')
                    for key in ['events','attempts']:
                        prev={e['id']:e for e in old[key]};nxt={e['id']:e for e in item[key]}
                        if any(nxt.get(k)!=v for k,v in prev.items()):raise ValidationError('Job events and attempts are append-only')
                else:
                    for j in byid.values():
                        if identity_keys(j)&identity_keys(item):raise ValidationError('Duplicate identity: update existing job '+j['id']+' instead of creating '+item['id'])
            byid[item['id']]=copy.deepcopy(item)
        out[field]=list(byid.values())
    for field in ['profile','preferences']:
        if field in update:out[field]=copy.deepcopy(update[field])
    out['meta']['revision']+=1;out['meta']['updatedAt']=update['generatedAt'];out['meta']['processedUpdateIds'].append(update['id'])
    validate(out);return out,True

def prevent_public_plaintext(path):
    p=Path(path).expanduser().resolve()
    if p==ROOT or ROOT in p.parents:raise ValidationError('Plaintext output must be outside the public checkout')
