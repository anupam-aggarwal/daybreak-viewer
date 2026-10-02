import copy,sys,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from hosted_worker import Worker,transition
from hosted_api import API,HostedError
from daybreak import ROOT,read_json,ValidationError,merge
from cv_requests import update_request

class HostedWorkerTests(unittest.TestCase):
 def setUp(self):
  self.data=read_json(ROOT/'examples/demo.json');self.data['preferences']['approvedForSubmission']=False
  self.owner='11111111-1111-4111-8111-111111111111';self.worker=Worker(self.owner,object())
  self.job=next(j for j in self.data['jobs'] if j['status']=='queued')
  self.row={'id':str(uuid.uuid4()),'owner_id':self.owner,'status':'working','lease_token':str(uuid.uuid4()),'job_id':self.job['id'],'action':'prepare_cv','content':'Synthetic request only','base_revision':self.data['meta']['revision'],'created_at':'2026-10-02T00:00:00Z','target_resume_id':None,'target_resume_sha256':None}
 def test_import_to_working_and_exact_provenance(self):
  out=self.worker.import_claim(self.data,self.row);transition(self.data,out)
  self.assertEqual(out['requests'][0]['status'],'working');self.assertEqual(out['requests'][0]['owner'],self.owner)
  self.assertEqual(out['jobs'],self.data['jobs'])
  with self.assertRaises(ValidationError):self.worker.import_claim(out,self.row)
 def test_stale_and_protected_held(self):
  self.row['base_revision']-=1
  out=self.worker.import_claim(self.data,self.row);self.assertEqual(out['requests'][0]['status'],'needs_input')
  self.row['base_revision']+=1;self.row['job_id']=next(j['id'] for j in self.data['jobs'] if j['status']=='applied')
  out=self.worker.import_claim(self.data,self.row);self.assertEqual(out['requests'][0]['status'],'needs_input')
 def test_owner_and_target_fail_closed(self):
  self.row['owner_id']=str(uuid.uuid4())
  with self.assertRaises(ValidationError):self.worker.import_claim(self.data,self.row)
  self.row['owner_id']=self.owner;self.row['action']='request_revision';self.row['target_resume_id']='absent'
  with self.assertRaises(ValidationError):self.worker.import_claim(self.data,self.row)
 def test_history_and_files_immutable(self):
  out=self.worker.import_claim(self.data,self.row)
  out['artifacts'][0]['name']='changed.txt'
  with self.assertRaises(ValidationError):transition(self.data,out)
  out=self.worker.import_claim(self.data,self.row);out['jobs'].pop()
  with self.assertRaises(ValidationError):transition(self.data,out)
 def test_cas_failure_is_not_success(self):
  class Fake:
   def call(self,path,*args,**kwargs):return False
  w=Worker(self.owner,Fake())
  with self.assertRaises(ValidationError):w.renew(self.row)
 def test_transport_rejects_redirect_destination(self):
  from unittest.mock import patch
  with patch.dict('os.environ',{'DAYBREAK_SUPABASE_WORKER_KEY':'network-placeholder'}):
   api=API()
   for path in ['https://example.invalid/','//example.invalid/rest/v1/','/rest/v1/../auth']:
    with self.assertRaises(HostedError):api.call(path)

if __name__=='__main__':unittest.main()
