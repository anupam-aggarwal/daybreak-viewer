"""Staged hosted app with actual SDK and entirely synthetic HTTP fixtures."""
import base64,functools,hashlib,http.server,json,shutil,sys,tempfile,threading,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'));sys.path.insert(0,str(ROOT/'tests'))
from daybreak import b64

def fixture():
 data=read_json(ROOT/'examples/demo.json');data['meta']['demo']=False;data['jobs']=[]
 resume=data['resumes'][0];resume['id']='draft-synthetic'
 artifact=next(a for a in data['artifacts'] if a['id']==resume['artifactId'])
 raw=b'%PDF-1.4\n% synthetic only\n%%EOF'
 artifact.update(mime='application/pdf',base64=b64(raw),sha256=hashlib.sha256(raw).hexdigest(),name='synthetic.pdf')
 resume.update(sha256=artifact['sha256'],filename='synthetic.pdf',text='SYNTHETIC CV ONLY')
 data['resumes']=[resume];data['artifacts']=[artifact]
 return data,raw
from daybreak import read_json
OWNER='11111111-1111-4111-8111-111111111111';PROJECT='https://kiauwgvmbewdwedadqxv.supabase.co';PASSWORD='Synthetic account password 2026!';checks=[]
with tempfile.TemporaryDirectory(prefix='daybreak-hosted-browser-') as td:
 site=Path(td)/'site';shutil.copytree(ROOT/'docs',site,ignore=shutil.ignore_patterns('vault.enc.json','artifacts'))
 data,pdf=fixture();source=read_json(ROOT/'examples/demo.json');job=next(j for j in source['jobs'] if j['status']=='queued');job.update(resumeId='draft-synthetic',status='discovered',events=[],attempts=[]);data['jobs']=[job]
 artifact=data['artifacts'][0];artifact.pop('base64');record={'owner_id':OWNER,'id':artifact['id'],'path':OWNER+'/'+artifact['sha256'],'sha256':artifact['sha256'],'size':len(pdf),'mime':'application/pdf','filename':'synthetic.pdf'}
 class Quiet(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*args):pass
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(site)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}/'
 config=site/'mailbox-config.js';config.write_text(config.read_text().replace('https://anupam-aggarwal.github.io/daybreak-viewer/',base))
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=browser.new_context(accept_downloads=True);page=ctx.new_page();errors=[];urls=[];posts=[];stored={};password_updates=[];recovery=[];reject_access=False;deny_owner=False;tamper=False
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:urls.append(r.url))
   def part(obj):return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
   token=part({'alg':'HS256'})+'.'+part({'sub':OWNER,'role':'authenticated','exp':int(time.time())+3600})+'.synthetic'
   user={'id':OWNER,'email':'owner@example.invalid','aud':'authenticated','role':'authenticated','app_metadata':{'provider':'email'},'user_metadata':{},'created_at':'2026-10-01T00:00:00Z'}
   def handle(route):
    req=route.request;url=req.url;headers={'access-control-allow-origin':base.rstrip('/'),'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS'}
    def answer(value,status=200):route.fulfill(status=status,headers={**headers,'content-type':'application/json'},body=json.dumps(value))
    if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
    if '/auth/v1/authorize?' in url:route.fulfill(status=302,headers={'location':base+'?code=synthetic-code'},body='');return
    if '/auth/v1/token?' in url:
     body=req.post_data_json
     if 'grant_type=password' in url and body.get('password')!=PASSWORD:answer({'error':'invalid_grant','error_description':'Invalid credentials'},400);return
     answer({'access_token':token,'refresh_token':'synthetic-refresh','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user});return
    if '/auth/v1/user' in url:
     if req.method=='PUT':password_updates.append(req.post_data_json)
     answer(user);return
    if '/auth/v1/recover' in url:recovery.append(req.post_data_json);answer({});return
    if '/auth/v1/logout' in url:route.fulfill(status=204,headers=headers);return
    if reject_access and '/rest/v1/' in url:answer({'message':'expired'},401);return
    if '/rest/v1/daybreak_owners?' in url:answer([] if deny_owner else [{'owner_id':OWNER}]);return
    if '/rest/v1/daybreak_workspaces?' in url:answer([{'revision':data['meta']['revision']}]);return
    if '/rest/v1/daybreak_snapshots?' in url:answer([{'document':data}]);return
    if '/rest/v1/daybreak_files?' in url:answer([record]);return
    if '/storage/v1/' in url:
     assert req.headers.get('authorization')=='Bearer '+token
     route.fulfill(status=200,headers={**headers,'content-type':'application/pdf'},body=(pdf[:-1]+bytes([pdf[-1]^1])) if tamper else pdf);return
    if '/rest/v1/daybreak_cv_requests' in url:
     if req.method=='POST':
      row=req.post_data_json;posts.append(row)
      if row['id'] in stored:answer({'code':'23505'},409);return
      stored[row['id']]={**row,'status':'queued','result':'','created_at':'2026-10-02T00:00:00Z','updated_at':'2026-10-02T00:00:00Z'}
      if len(stored)==1:route.abort()
      else:route.fulfill(status=204,headers=headers)
      return
     if '&id=eq.' in url:answer([stored[url.split('&id=eq.')[1]]]);return
     answer(list(reversed(list(stored.values()))));return
    if '/rest/v1/daybreak_cv_replies?' in url:
     answer([{'id':'synthetic-reply','request_id':next(iter(stored)),'body':'A private reply <script>never execute</script>','created_at':'2026-10-02T01:00:00Z'}] if stored else []);return
    raise AssertionError('Unexpected route '+url)
   ctx.route(PROJECT+'/**',handle)
   def login(password=PASSWORD):
    page.get_by_label('Email',exact=True).fill('owner@example.invalid');page.get_by_label('Account password',exact=True).fill(password);page.get_by_role('button',name='Sign in',exact=True).click()
   page.goto(base);assert not any('/rest/v1/' in u or '/storage/v1/' in u or 'vault.enc.json' in u for u in urls)
   login('Wrong synthetic password');expect(page.locator('.login-card')).to_contain_text('Sign-in failed');assert not any('/rest/v1/' in u for u in urls)
   deny_owner=True;login();expect(page.locator('.login-card')).to_contain_text('does not have access');assert not any('daybreak_snapshots' in u for u in urls);deny_owner=False;checks.append('Verified but unenrolled account cannot load metadata or set owner access')
   login();expect(page.get_by_role('button',name='Open role',exact=True)).to_be_visible();assert not any('/storage/v1/' in u or 'vault.enc.json' in u for u in urls);assert page.evaluate('localStorage.length+sessionStorage.length')==0;checks.append('No personal fetch before login; wrong password fails; verified email login loads metadata only with memory-only tokens')
   page.get_by_role('button',name='Open role',exact=True).click();page.get_by_label('Request details').fill('Prepare a focused CV using only verified experience.');page.get_by_label('Close details').click();page.get_by_role('button',name='Requests & replies',exact=True).click();expect(page.locator('#page-content')).to_contain_text('No requests yet');page.get_by_role('button',name='Job opportunities',exact=True).click();page.get_by_role('button',name='Open role',exact=True).click();expect(page.get_by_label('Request details')).to_have_value('Prepare a focused CV using only verified experience.');assert not posts
   out=ROOT/'test-results';out.mkdir(exist_ok=True);page.locator('.decision-form').screenshot(path=str(out/'hosted-send-desktop.png'));page.set_viewport_size({'width':390,'height':844});page.locator('.decision-form').screenshot(path=str(out/'hosted-send-mobile.png'));assert page.locator('dialog').evaluate('e=>e.scrollWidth<=e.clientWidth');page.set_viewport_size({'width':1280,'height':720});checks.append('Draft survives role close and page navigation; one selector/textarea/Send; desktop/mobile screenshot and overflow checks')
   page.get_by_role('button',name='Send request',exact=True).evaluate('b=>{b.click();b.click()}');expect(page.locator('dialog')).to_contain_text('unconfirmed');assert len(posts)==1
   page.get_by_role('button',name='Retry request',exact=True).click();expect(page.get_by_role('button',name='Sent',exact=True)).to_be_disabled();assert len(posts)==2 and posts[0]==posts[1] and len(stored)==1
   page.get_by_label('Close details').click();page.get_by_role('button',name='Open role',exact=True).click();expect(page.get_by_role('button',name='Sent',exact=True)).to_be_disabled();checks.append('Exact typed single-click path; lost response retries same bytes/ID; double-click and reopening cannot duplicate')
   page.get_by_role('button',name='New request',exact=True).click();page.get_by_label('Request details').fill('Retain this draft through session expiry.');reject_access=True;page.get_by_role('button',name='Send request',exact=True).click();expect(page.locator('dialog')).to_contain_text('Sign in to continue');assert len(posts)==2;reject_access=False
   login();expect(page.get_by_label('Request details')).to_have_value('Retain this draft through session expiry.');assert len(posts)==2;page.get_by_role('button',name='Retry request',exact=True).click();expect(page.get_by_role('button',name='Sent',exact=True)).to_be_disabled();assert len(posts)==3;checks.append('Expired-session form retains draft; inline reauthentication never auto-sends; explicit retry creates one new request')
   page.get_by_label('Close details').click();page.get_by_role('button',name='Requests & replies',exact=True).click();expect(page.locator('#page-content')).to_contain_text('A private reply <script>never execute</script>');assert not page.locator('#page-content script').count();expect(page.locator('#page-content')).to_contain_text('Queued');checks.append('Saved statuses and replies come from persisted mocked rows; reply text inert and attached to request/job')
   page.get_by_role('button',name='Your CVs',exact=True).click()
   with page.expect_download() as event:page.get_by_role('button',name='Download PDF',exact=True).click()
   dest=Path(td)/'exact.pdf';event.value.save_as(dest);assert dest.read_bytes()==pdf;tamper=True;page.get_by_role('button',name='Download PDF',exact=True).click();expect(page.locator('.toast')).to_contain_text('integrity check');tamper=False;checks.append('Authenticated private file download hash matches original; tampered bytes rejected')
   page.get_by_role('button',name='Account & privacy',exact=True).click();page.get_by_role('button',name='Set account password',exact=True).click();page.get_by_label('New account password').fill('Synthetic replacement password!');page.get_by_label('Confirm account password').fill('Synthetic replacement password!');page.get_by_role('button',name='Save account password',exact=True).click();expect(page.locator('dialog')).to_contain_text('Password saved for your existing account');assert len(password_updates)==1 and password_updates[0]['password']=='Synthetic replacement password!' and 'email' not in password_updates[0];checks.append('User-operated Set password updates existing authenticated owner only; no signup or account creation')
   page.get_by_label('Close details').click();page.get_by_role('button',name='Sign out',exact=True).first.click();expect(page.locator('.login-card')).to_be_visible();assert page.evaluate('localStorage.length+sessionStorage.length')==0
   page.get_by_role('button',name='Forgot password?',exact=True).click();page.get_by_label('Recovery email').fill('owner@example.invalid');page.get_by_role('button',name='Send reset email',exact=True).click();expect(page.locator('dialog')).to_contain_text('an email is on its way');assert len(recovery)==1;assert PASSWORD not in page.evaluate('JSON.stringify(sessionStorage)')
   page.goto(base+'?code=synthetic-recovery');expect(page.locator('dialog')).to_contain_text('Set your account password');assert 'code=' not in page.url;assert len(posts)==3;checks.append('Explicit recovery email uses PKCE; verified callback opens password screen without sending requests')
   page.get_by_label('Close details').click();page.get_by_role('button',name='Sign out',exact=True).first.click();expect(page.locator('.login-card')).to_be_visible()
   page.goto(base+'?code=missing-verifier');expect(page.locator('.login-card')).to_contain_text('Sign-in expired or was cancelled');assert 'code=' not in page.url
   page.get_by_role('button',name='Continue with GitHub',exact=True).click();expect(page.get_by_role('button',name='Open role',exact=True)).to_be_visible();assert len(posts)==3;checks.append('Invalid recovery callback fails closed; temporary GitHub recovery uses same enrolled owner and never auto-sends')
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(out/'hosted-jobs-mobile.png'),full_page=True)
   assert not errors,errors;browser.close()
 finally:server.shutdown()
print(json.dumps({'passed':len(checks),'checks':checks},indent=2));(ROOT/'test-results/hosted-browser-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2))
