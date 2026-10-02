#!/usr/bin/env python3
"""Stage a reviewed, one-page CV for one already claimed hosted request.

Run only with private source/PDF/notes outside the public checkout. This writes
a private update JSON; hosted_cli complete performs the durable hosted write.
"""
import argparse,base64,copy,hashlib,json,os,re,subprocess,sys
from pathlib import Path
from daybreak import ROOT,ValidationError,now,read_json,schema_validate
from hosted_backup import encoded

def private_file(value):
 path=Path(value).expanduser().resolve()
 if path==ROOT or ROOT in path.parents or not path.is_file():raise ValidationError('Use an existing private file outside this checkout')
 return path

def artifact(path,id,name,mime):
 raw=path.read_bytes()
 if not raw or len(raw)>2*1024*1024:raise ValidationError('Artifact exceeds 2 MiB or is empty')
 return {'id':id,'name':name,'mime':mime,'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}

def build(directory,pdf,source,notes,resume_id,skills):
 directory=Path(directory).expanduser().resolve()
 if directory==ROOT or ROOT in directory.parents:raise ValidationError('Operation directory must be private')
 working=read_json(directory/'working.json');op=read_json(directory/'operation.json');request=next((r for r in working['requests'] if r['id']==op['request_id']),None)
 if not request or request['status']!='working' or request['action'] not in ('prepare_cv','request_revision'):raise ValidationError('Expected a claimed Working CV request')
 if not re.fullmatch(r'draft-[a-zA-Z0-9-]{1,180}',resume_id) or any(r['id']==resume_id for r in working['resumes']):raise ValidationError('Use a new immutable draft ID')
 job=copy.deepcopy(next(j for j in working['jobs'] if j['id']==request['jobId']))
 if job['status'] in ('applied','in_progress','failed'):raise ValidationError('Protected job')
 pdf=private_file(pdf);source=private_file(source);notes=private_file(notes)
 if not pdf.read_bytes().startswith(b'%PDF-'):raise ValidationError('PDF signature missing')
 info=subprocess.run(['pdfinfo',str(pdf)],capture_output=True,text=True,check=True).stdout
 if not re.search(r'^Pages:\s*1\s*$',info,re.M) or not re.search(r'^Page size:\s*595\.\d+ x 841\.\d+ pts \(A4\)',info,re.M):raise ValidationError('CV must be one A4 page')
 extracted=subprocess.run(['pdftotext',str(pdf),'-'],capture_output=True,text=True,check=True).stdout.strip()
 if len(extracted)<300 or len(extracted)>30000:raise ValidationError('Selectable CV text missing or too long')
 if not source.read_text().lstrip().startswith('\\documentclass'):raise ValidationError('Expected reviewed LaTeX source')
 if not notes.read_text().strip():raise ValidationError('Private QA/tailoring notes required')
 stamp=now();suffix=op['request_id'];pdf_id='artifact-'+resume_id;source_id='artifact-latex-'+resume_id;notes_id='artifact-tailoring-'+resume_id
 artifacts=[artifact(pdf,pdf_id,pdf.name,'application/pdf'),artifact(source,source_id,source.name+'.txt','text/plain'),artifact(notes,notes_id,notes.name,'text/plain')]
 resume={'id':resume_id,'label':job['company']+' — '+job['title'],'version':'1-review','approved':False,'filename':pdf.name,'updatedAt':stamp,'artifactId':pdf_id,'sha256':artifacts[0]['sha256'],'text':extracted,'skills':skills}
 job['resumeId']=resume_id
 job['events'].append({'id':'cv-ready-'+suffix,'at':stamp,'type':'needs_review','note':'Owner-requested, source-reviewed one-page draft saved for private review. No employer submission. Private QA: '+notes_id+'.'})
 update={'schemaVersion':'1.0','id':'cv-request-'+suffix,'generatedAt':stamp,'baseRevision':working['meta']['revision'],'artifacts':artifacts,'resumes':[resume],'jobs':[job]}
 schema_validate(update,'update')
 return update

if __name__=='__main__':
 try:
  parser=argparse.ArgumentParser(description=__doc__)
  for field in ('directory','pdf','source','notes','resume_id','output'):parser.add_argument(field)
  parser.add_argument('--skill',action='append',required=True,help='One source-confirmed skill; repeat')
  args=parser.parse_args();update=build(args.directory,args.pdf,args.source,args.notes,args.resume_id,args.skill)
  output=Path(args.output).expanduser().resolve()
  if output==ROOT or ROOT in output.parents:raise ValidationError('Update output must be private')
  fd=os.open(output,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'wb') as stream:stream.write(encoded(update))
  print('Private CV update staged; inspect PDF, notes and update before complete')
 except Exception:print('Private CV staging failed; inspect inputs locally',file=sys.stderr);sys.exit(1)
