import {boundedBytes,sha256} from './artifacts.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class AuthRequired extends Error {}
export class HostedStore {
 constructor(config,auth,{fetcher=fetch}={}){this.config=config;this.auth=auth;this.fetcher=(...args)=>fetcher(...args);this.owner=null;}
 async call(path,{method='GET',body,bytes=false}={}){
  if(!/^\/(rest|storage)\/v1\//.test(path))throw Error('Unsupported request');
  const session=await this.auth.session();
  if(!session||this.owner&&session.user.id!==this.owner)throw new AuthRequired('Please sign in again. Your draft is still in this tab.');
  let response;try{response=await this.fetcher(this.config.url+path,{method,signal:AbortSignal.timeout(30000),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',headers:{apikey:this.config.publishableKey,Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json',Prefer:'return=minimal'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw Error('Connection unavailable. Your request is unconfirmed; retry from this form.');}
  if(response.status===401||response.status===403)throw new AuthRequired('Your session expired or access was denied. Sign in again; your draft stays in this tab.');
  if(response.status===409){const error=Error('Request already exists');error.conflict=true;throw error;}
  if(!response.ok)throw Error(response.status===429?'Too many requests. Please try again shortly.':'The workspace is temporarily unavailable. Please retry.');
  if(response.status===204)return null;
  const raw=await boundedBytes(response,bytes?2097152:8*1024*1024);
  return bytes?raw:raw.length?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null;
 }
 async verifyOwner(){
  const session=await this.auth.session();if(!session||!UUID.test(session.user.id))throw new AuthRequired('Sign in to continue.');
  const rows=await this.call('/rest/v1/daybreak_owners?select=owner_id&owner_id=eq.'+session.user.id);
  if(rows?.length!==1||rows[0].owner_id!==session.user.id)throw new AuthRequired('This account does not have access to Daybreak. Use your enrolled owner account.');
  this.owner=session.user.id;return this.owner;
 }
 async load(){
  await this.verifyOwner();const rows=await this.call('/rest/v1/daybreak_workspaces?select=revision&owner_id=eq.'+this.owner);
  if(rows?.length!==1||!Number.isSafeInteger(rows[0].revision))throw Error('Your workspace migration is not ready yet. Your account is signed in; no data was changed.');
  const rev=rows[0].revision;const snapshots=await this.call(`/rest/v1/daybreak_snapshots?select=document&owner_id=eq.${this.owner}&revision=eq.${rev}`);
  const doc=snapshots?.[0]?.document;
  if(snapshots?.length!==1||doc?.meta?.revision!==rev||doc?.preferences?.approvedForSubmission!==false||!['jobs','resumes','artifacts'].every(k=>Array.isArray(doc[k])))throw Error('Workspace integrity check failed.');
  if(doc.jobs.some(j=>j.submission))throw Error('This interface supports CV preparation only.');
  return doc;
 }
 async requests(){return this.call('/rest/v1/daybreak_cv_requests?select=id,job_id,action,content,status,result,created_at,updated_at&owner_id=eq.'+this.owner+'&order=created_at.desc&limit=100');}
 async replies(){return this.call('/rest/v1/daybreak_cv_replies?select=id,request_id,body,created_at&owner_id=eq.'+this.owner+'&order=created_at.asc&limit=100');}
 async send(request){
  if(request.owner_id!==this.owner||!UUID.test(request.id))throw Error('Request identity mismatch');
  try{await this.call('/rest/v1/daybreak_cv_requests',{method:'POST',body:request});}catch(e){if(!e.conflict)throw e;}
  const saved=await this.call('/rest/v1/daybreak_cv_requests?select=*&owner_id=eq.'+this.owner+'&id=eq.'+request.id);
  if(saved?.length!==1||Object.entries(request).some(([key,value])=>saved[0][key]!==value))throw Error('Saved contents could not be confirmed. Keep this form and retry the same request.');
  return saved[0];
 }
 async file(artifact){
  const rows=await this.call('/rest/v1/daybreak_files?select=*&owner_id=eq.'+this.owner+'&id=eq.'+encodeURIComponent(artifact.id));
  const f=rows?.[0];
  if(rows?.length!==1||f.sha256!==artifact.sha256||!/^[a-f0-9]{64}$/.test(f.sha256)||f.path!==this.owner+'/'+f.sha256||f.size>2097152||!['application/pdf','text/plain','image/png','image/jpeg'].includes(f.mime))throw Error('File descriptor integrity check failed.');
  const raw=await this.call('/storage/v1/object/authenticated/daybreak-private/'+f.path,{bytes:true});
  if(raw.length!==f.size||await sha256(raw)!==f.sha256)throw Error('Downloaded file failed its integrity check.');
  if(f.mime==='application/pdf'&&new TextDecoder().decode(raw.slice(0,5))!=='%PDF-')throw Error('Invalid PDF file');
  return {raw,file:f};
 }
}
