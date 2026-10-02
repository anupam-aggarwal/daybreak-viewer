import {HostedAuth} from './hosted-auth.js';
import {HostedStore,AuthRequired} from './hosted-store.js';
import {MAILBOX_CONFIG} from './mailbox-config.js';
import {h,icon,btn,badge,empty,download} from './ui.js';
const auth=new HostedAuth(MAILBOX_CONFIG),store=new HostedStore(MAILBOX_CONFIG,auth);
const root=document.querySelector('#app');
const state={data:null,page:'jobs',query:'',requests:[],replies:[],historyLoaded:false,historyError:'',historyBusy:false,drafts:new Map(),generation:0};
const ACTIONS={prepare_cv:'Prepare CV',request_revision:'Request revision',skip:'Skip role',reconsider:'Reconsider role'};
const STATUS={queued:'Queued',working:'Working',needs_input:'Needs your input',ready:'Ready'};
let dialog=null,lastActivity=Date.now();
const fmt=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
const unsent=()=>[...state.drafts.values()].some(d=>!d.sent&&(d.text||d.record||d.action!=='prepare_cv'));
window.addEventListener('beforeunload',e=>{if(unsent()){e.preventDefault();e.returnValue='';}});
['pointerdown','keydown','touchstart'].forEach(name=>document.addEventListener(name,()=>lastActivity=Date.now(),{passive:true}));
setInterval(()=>{if(state.data&&Date.now()-lastActivity>15*60*1000)signOut(true);},30000);
function logo(){return h('div',{class:'logo'},h('div',{class:'logo-mark'},icon('sun',24)),h('span',{},'daybreak',h('i',{},'.')));}
function feedback(message,error=false){document.querySelector('.toast')?.remove();const node=h('div',{class:'toast',role:error?'alert':'status'},icon(error?'alert':'check'),message);document.body.append(node);setTimeout(()=>node.remove(),6000);}
function close(){dialog?.close();dialog?.remove();dialog=null;}
function modal(title,body,{closable=true}={}){close();dialog=h('dialog',{class:'drawer'},h('div',{class:'drawer-head'},h('div',{},h('span',{class:'eyebrow'},'YOUR PRIVATE WORKSPACE'),h('h2',{},title)),closable&&btn('',close,'icon-only','x',{'aria-label':'Close details'})),h('div',{class:'drawer-body'},body));if(!closable)dialog.addEventListener('cancel',e=>e.preventDefault());document.body.append(dialog);dialog.showModal();}
function label(text,input){return h('label',{class:'hosted-label'},text,input);}
function safeJobLink(url){try{const u=new URL(url);if(u.protocol==='https:'||u.protocol==='http:')return h('a',{class:'btn secondary small',href:u.href,target:'_blank',rel:'noopener noreferrer',referrerPolicy:'no-referrer'},'View job posting',icon('external',14));}catch{}return null;}
function heading(kicker,title,copy){return h('header',{class:'page-heading'},h('div',{},h('span',{class:'eyebrow'},kicker),h('h1',{},title),h('p',{},copy)));}
function loginForm({reauth=false,returnJob=null}={}){
 const email=h('input',{type:'email',required:true,autoComplete:'username','aria-label':'Email',placeholder:'Your account email'});
 const password=h('input',{type:'password',required:true,autoComplete:'current-password','aria-label':'Account password',placeholder:'Your account password'});
 const message=h('p',{class:'auth-message',role:'status'});const submit=btn('Sign in',null,'primary','arrow',{type:'submit'});
 const form=h('form',{onSubmit:async e=>{
  e.preventDefault();submit.disabled=true;message.textContent='Signing in…';const generation=state.generation;
  try{const session=await auth.emailLogin(email.value,password.value);password.value='';if(!session||generation!==state.generation)return;
   if(reauth){await store.verifyOwner();close();render();if(returnJob)openJob(returnJob);feedback('Signed in. Your draft is ready; click Send when you are ready.');}
   else await loadWorkspace();
  }catch(error){password.value='';message.textContent=error.message;}finally{submit.disabled=false;}
 }},label('Email',email),label('Password',password),message,submit);
 if(!reauth)form.append(btn('Forgot password?',()=>resetPassword(email.value),'text-button'),btn('Continue with GitHub',async()=>{try{await auth.begin();}catch(e){message.textContent=e.message;}},'secondary','arrow'),h('p',{class:'small-note'},'GitHub remains available for account recovery. This workspace is owner-only; there is no public signup.'));
 else form.append(btn('Sign out and discard draft',()=>signOut(false),'secondary'));
 return form;
}
function gate(message=''){
 root.replaceChildren(h('div',{class:'login-layout'},h('section',{class:'login-story'},logo(),h('div',{class:'story-copy'},h('span',{class:'story-kicker'},'YOUR NEXT MOVE, WITH CLARITY.'),h('h1',{},'A little focus.',h('br'),h('em',{},'A lot of possibility.')),h('p',{},'Your opportunities, tailored CVs, and a direct line to Dot. All in one private workspace.')),h('div',{class:'sunrise-art','aria-hidden':'true'},h('div',{class:'orbit o1'}),h('div',{class:'orbit o2'}),h('div',{class:'sun'}),h('div',{class:'horizon'}))),h('section',{class:'login-main'},h('div',{class:'login-card'},h('div',{class:'lock-tile'},icon('lock',24)),h('h2',{},'Welcome back.'),h('p',{class:'login-description'},'Sign in to your private Daybreak workspace.'),message&&h('p',{role:'status',class:'auth-message'},message),loginForm(),auth.current&&btn('Set account password',()=>passwordScreen(),'secondary'),h('p',{class:'privacy-hint'},'Your files stay private. Your password goes directly to the sign-in provider and is never stored by this page.')))));
}
function resetPassword(initial=''){
 const email=h('input',{type:'email',value:initial,required:true,autoComplete:'username','aria-label':'Recovery email'}),message=h('p',{role:'status',class:'auth-message'});
 const send=btn('Send reset email',null,'primary','mail',{type:'submit'});
 modal('Reset your account password',h('form',{onSubmit:async e=>{e.preventDefault();send.disabled=true;message.textContent='Requesting email…';try{await auth.sendReset(email.value);message.textContent='If this account can reset its password, an email is on its way. Open the newest link in this same browser tab within 10 minutes. No account was created.';}catch(err){message.textContent=err.message;}finally{send.disabled=false;}}},h('p',{},'Request a link for your existing account. Keep this tab open so the link can be verified.'),label('Account email',email),message,send));
}
async function passwordScreen(){
 const generation=state.generation;
 try{await store.verifyOwner();if(generation!==state.generation)return;}catch(e){return requireLogin(e.message);}
 const first=h('input',{type:'password',autoComplete:'new-password',minLength:12,required:true,'aria-label':'New account password'}),second=h('input',{type:'password',autoComplete:'new-password',required:true,'aria-label':'Confirm account password'}),message=h('p',{role:'status',class:'auth-message'});
 const save=btn('Save account password',null,'primary','lock',{type:'submit'});
 modal('Set your account password',h('form',{onSubmit:async e=>{e.preventDefault();if(first.value!==second.value){message.textContent='Passwords do not match.';return;}save.disabled=true;message.textContent='Saving securely…';try{await store.verifyOwner();await auth.setPassword(first.value);first.value=second.value='';message.textContent='Password saved for your existing account. Sign out and test email sign-in when ready. GitHub recovery remains available.';save.disabled=true;}catch(err){first.value=second.value='';message.textContent=err.message;save.disabled=false;}}},h('p',{},'This changes the password for your existing owner account. Choose a unique password of at least 12 characters. Do not send it to Dot or enter it in chat.'),label('New password',first),label('Confirm password',second),message,save));
}
function requireLogin(message,returnJob=null){modal('Sign in to continue',h('div',{},h('p',{class:'auth-message'},message),h('p',{},'Your unsent draft is still in this tab. Sign in with the same account; nothing will send automatically.'),loginForm({reauth:true,returnJob})),{closable:false});}
async function loadWorkspace(){
 const generation=state.generation;root.replaceChildren(h('div',{class:'hosted-loading',role:'status'},logo(),h('p',{},'Loading your private workspace…')));
 try{const data=await store.load();if(generation!==state.generation)return;state.data=data;render();await refreshHistory();if(auth.recovering)await passwordScreen();}
 catch(e){if(generation!==state.generation)return;state.data=null;gate(e.message);if(auth.recovering&&auth.current)await passwordScreen();}
}
async function signOut(force){
 if(!force&&unsent()&&!confirm('Sign out and discard unsent drafts?'))return;
 state.generation++;close();state.data=null;state.drafts.clear();state.requests=[];state.replies=[];state.historyLoaded=false;store.owner=null;root.replaceChildren(h('p',{role:'status'},'Signing out…'));
 try{await auth.signOut();gate(force?'Your workspace locked after inactivity. Sign in again.':'Signed out.');}catch{gate('Signed out in this tab. Server sign-out could not be confirmed.');}
}
function render(){
 if(!state.data)return;const items=[['jobs','Job opportunities','briefcase'],['cvs','Your CVs','file'],['requests','Requests & replies','mail'],['account','Account & privacy','settings']];
 const nav=h('nav',{'aria-label':'Main navigation'},items.map(([id,title,ic])=>btn(title,()=>{state.page=id;render();if(id==='requests')refreshHistory();},`nav-item ${state.page===id?'active':''}`,ic)));
 const side=h('aside',{class:'sidebar'},logo(),h('div',{class:'workspace-label'},h('div',{class:'avatar'},icon('sun')),h('div',{},h('strong',{},'Your workspace'),h('span',{},'CV preparation only'))),nav,h('div',{class:'sidebar-bottom'},h('p',{class:'small-note'},'No automatic job applications.'),btn('Sign out',()=>signOut(false),'lock-button','lock')));
 const content=h('div',{class:'content',id:'page-content'});const name=items.find(([id])=>id===state.page)?.[1];
 root.replaceChildren(h('div',{class:'shell hosted-shell'},side,h('main',{class:'main'},h('header',{class:'topbar'},h('div',{class:'breadcrumbs'},h('span',{},'Workspace'),icon('chevron',12),h('strong',{},name)),h('div',{class:'topbar-actions'},badge('Signed in','green'),btn('Refresh',async()=>{if(state.page==='requests')await refreshHistory();else await loadWorkspace();},'secondary small','refresh'))),content)));
 content.append(({jobs:jobsView,cvs:cvView,requests:requestsView,account:accountView}[state.page]||jobsView)());
}
function jobsView(){
 const data=state.data;const search=h('input',{type:'search',value:state.query,placeholder:'Search role, company or location…','aria-label':'Search roles'});
 const list=h('div',{class:'hosted-job-list'});
 function draw(){const q=search.value.toLowerCase();state.query=search.value;const jobs=data.jobs.filter(j=>[j.title,j.company,j.location].join(' ').toLowerCase().includes(q));list.replaceChildren(...(jobs.length?jobs.map(j=>{
  const request=state.requests.find(r=>r.job_id===j.id);return h('article',{class:'hosted-job'},h('div',{class:'company-avatar'},j.company.slice(0,2).toUpperCase()),h('div',{class:'hosted-job-copy'},h('button',{class:'role-link',onClick:()=>openJob(j.id)},j.title),h('p',{},j.company+' · '+j.location),h('small',{},request?'Latest request: '+(STATUS[request.status]||'Unknown'):j.resumeId?'Prepared CV available':'No request yet')),btn('Open role',()=>openJob(j.id),'secondary small','arrow'));}):[empty('No matching roles','Try another search or check back after your next update.')]));}
 search.addEventListener('input',draw);draw();
 return h('div',{},heading('YOUR CAREER, MOVING FORWARD','Make your next move.','Review opportunities, download your CVs and send a request directly to Dot.'),h('p',{class:'small-note'},'Job snapshot updated '+fmt(data.meta.updatedAt)+' · IST. Request status refreshes separately.'),h('section',{class:'panel application-panel'},h('div',{class:'table-toolbar'},h('div',{class:'search-input'},icon('search'),search)),list));
}
function openJob(id){
 const job=state.data.jobs.find(j=>j.id===id);if(!job)return;let d=state.drafts.get(id);if(!d){d={action:'prepare_cv',text:'',record:null,busy:false,sent:false,message:''};state.drafts.set(id,d);}
 const resume=state.data.resumes.find(r=>r.id===job.resumeId);const action=h('select',{'aria-label':'CV request action',onChange:e=>{d.action=e.target.value;}},Object.entries(ACTIONS).map(([value,title])=>h('option',{value},title)));action.value=d.action;
 const input=h('textarea',{rows:4,maxLength:10000,'aria-label':'Request details',placeholder:'What would you like Dot to prepare or change?',onInput:e=>{d.text=e.target.value;}});input.value=d.text;
 const message=h('p',{class:'auth-message',role:'status'});const send=btn('Send request',async()=>{
  if(d.busy||d.sent)return;if(d.action==='request_revision'&&(!resume||!d.text.trim())){d.message=resume?'Describe the changes you want.':'There is no prepared CV for this role yet. Choose Prepare CV.';update();return;}
  d.busy=true;d.message='Sending…';update();const generation=state.generation;
  try{
   if(!d.record)d.record={id:crypto.randomUUID(),owner_id:store.owner,job_id:id,base_revision:state.data.meta.revision,action:d.action,content:d.text.trim(),target_resume_id:resume?.id||null,target_resume_sha256:resume?.sha256||null};
   const saved=await store.send(d.record);if(generation!==state.generation)return;d.sent=true;d.message='Sent — saved in your private workspace. '+(STATUS[saved.status]||'Queued')+'.';state.requests=[saved,...state.requests.filter(r=>r.id!==saved.id)];
  }catch(e){if(generation!==state.generation)return;d.message=e.message;if(e instanceof AuthRequired)requireLogin(e.message,id);}
  finally{d.busy=false;if(generation===state.generation)d.update?.();}
 },'primary','arrow');
 const next=btn('New request',()=>{if(d.sent){state.drafts.delete(id);openJob(id);}},'secondary');
 function update(){input.disabled=action.disabled=d.busy||!!d.record||d.sent;send.disabled=d.busy||d.sent;send.textContent=d.busy?'Sending…':d.sent?'Sent':d.record?'Retry request':'Send request';message.textContent=d.message||'Nothing is sent until you click Send request. Your draft stays in this tab.';next.hidden=!d.sent;}
 d.update=update;update();const latest=state.requests.find(r=>r.job_id===id);
 modal(job.title,h('div',{},h('div',{class:'detail-company'},h('div',{class:'company-avatar large'},job.company.slice(0,2)),h('div',{},h('h3',{},job.company),h('p',{},job.location))),h('div',{class:'button-row'},safeJobLink(job.sourceUrl),resume&&btn('Download prepared CV',()=>getFile(resume.artifactId),'secondary small','down')),latest&&h('p',{class:'small-note'},'Saved request: '+(STATUS[latest.status]||'Unknown')+' · '+fmt(latest.created_at)),h('section',{class:'decision-form detail-section'},h('h3',{},'Send a CV request'),label('Action',action),label('Details',input),h('div',{class:'button-row'},send,next),message,h('p',{class:'small-note'},'This sends a private instruction to Dot. It never submits an application to an employer.'))));
}
async function getFile(id){const generation=state.generation;try{const artifact=state.data.artifacts.find(a=>a.id===id);if(!artifact)throw Error('File is not in this snapshot.');const {raw,file}=await store.file(artifact);if(generation!==state.generation)return;download(file.filename.split(/[\\/]/).pop(),raw,file.mime);feedback('File downloaded.');}catch(e){if(generation!==state.generation)return;if(e instanceof AuthRequired)requireLogin(e.message);else feedback(e.message,true);}}
function cvView(){const rows=state.data.resumes;return h('div',{},heading('PREPARED FOR YOUR NEXT STEP','Your CVs.','Review the exact PDFs. Request revisions from the related job page.'),rows.length?h('div',{class:'resume-grid'},rows.map(r=>h('article',{class:'panel resume-card'},h('div',{class:'resume-card-top'},h('div',{class:'document-tile'},icon('file',30)),badge(r.id.startsWith('draft-')?'Prepared draft':'Original resume',r.id.startsWith('draft-')?'violet':'neutral')),h('h2',{},r.label),h('p',{class:'resume-meta'},r.filename),h('p',{class:'small-note'},'Version '+r.version+' · '+fmt(r.updatedAt)),btn('Download PDF',()=>getFile(r.artifactId),'primary','down')))):empty('No CVs available','Your original resumes and prepared drafts will appear here.'));}
async function refreshHistory(){if(state.historyBusy||!state.data)return;state.historyBusy=true;state.historyError='';const generation=state.generation;if(state.page==='requests')render();try{const [requests,replies]=await Promise.all([store.requests(),store.replies()]);if(generation!==state.generation)return;state.requests=requests||[];state.replies=replies||[];state.historyLoaded=true;}catch(e){if(generation!==state.generation)return;state.historyError=e.message;if(e instanceof AuthRequired)requireLogin(e.message);}finally{state.historyBusy=false;if(generation===state.generation)render();}}
function requestsView(){return h('div',{},heading('YOUR DIRECT LINE TO DOT','Requests & replies.','Only saved requests appear here. Drafts in a job form have not been sent.'),state.historyBusy&&h('p',{role:'status',class:'auth-message'},'Loading saved requests…'),state.historyError&&h('p',{role:'alert',class:'auth-message'},state.historyError),!state.historyBusy&&!state.historyError&&state.historyLoaded&&!state.requests.length&&empty('No requests yet','Open a job, choose an action and send your request.','mail'),...state.requests.map(r=>{const job=state.data.jobs.find(j=>j.id===r.job_id),replies=state.replies.filter(x=>x.request_id===r.id);return h('article',{class:'panel hosted-request'},h('div',{class:'hosted-request-head'},h('div',{},h('h2',{},job?.title||'Saved job request'),h('p',{},(job?.company||'')+' · '+(ACTIONS[r.action]||r.action))),badge(STATUS[r.status]||'Unknown',r.status==='ready'?'green':r.status==='needs_input'?'amber':'violet')),h('p',{class:'small-note'},'Sent '+fmt(r.created_at)+' · request '+r.id.slice(0,8)),r.content&&h('p',{class:'hosted-message'},r.content),r.result&&h('p',{class:'hosted-message'},r.result),...replies.map(reply=>h('section',{class:'hosted-reply'},h('strong',{},'Dot replied · '+fmt(reply.created_at)),h('p',{class:'hosted-message'},reply.body))),!replies.length&&h('p',{class:'small-note'},'No reply yet.'),job&&btn('Open role',()=>openJob(job.id),'secondary small','arrow'));}));}
function accountView(){return h('div',{},heading('SIMPLE, PRIVATE, YOURS','Account & privacy.','One sign-in for your jobs, CVs, requests and replies.'),h('section',{class:'panel setting-panel'},h('h2',{},'Your sign-in'),h('p',{},'Email and password use your existing owner account. GitHub remains available for recovery while the new login is verified.'),btn('Set account password',()=>passwordScreen(),'secondary','lock'),h('h2',{},'Your private data'),h('p',{},'Your records and files are stored privately in Supabase and available only to your enrolled account. Supabase and authorized project administrators can access hosted data. Public GitHub Pages contains the app, not your personal records.'),h('p',{},'Passwords and login tokens are not saved in browser storage. Refresh requires signing in again. Drafts stay in memory across pages, but are cleared when you refresh, sign out or the workspace locks after 15 minutes of inactivity.'),h('p',{},'Sending a request saves it for processing. It does not automatically apply to jobs or schedule a run.'),btn('Sign out',()=>signOut(false),'secondary','lock')));}
(async()=>{gate('Checking sign-in…');try{await auth.finish();if(auth.current)await loadWorkspace();else gate();}catch(e){gate(e.message);}})();
