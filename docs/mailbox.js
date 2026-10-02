/** Transport only. Not enabled/wired until reviewed project + GitHub OAuth configuration.
 * getSession must use verified Supabase Auth state, never user_metadata authority.
 * No tokens persist here; RLS is the authorization boundary, not client assertions.
 */
import {sha256,boundedBytes} from './artifacts.js';
import {utf8} from './crypto.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class MailboxError extends Error{constructor(message,code){super(message);this.code=code;}}
export class SupabaseMailbox {
 constructor({url,publishableKey,ownerId,getSession,fetcher=fetch}){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)||!uuid.test(ownerId)||typeof publishableKey!=='string'||!publishableKey.startsWith('sb_publishable_'))throw Error('Unverified mailbox configuration');
  this.url=parsed.origin;this.key=publishableKey;this.ownerId=ownerId;this.getSession=getSession;this.fetcher=(...args)=>fetcher(...args);
 }
 async call(path,options={}){
  const session=await this.getSession();
  if(!session||session.user?.id!==this.ownerId||!session.access_token||!Number.isFinite(session.expires_at)||session.expires_at*1000<=Date.now())throw new MailboxError('Sign in again. Your request has not been confirmed sent.','auth');
  let response;
  try{response=await this.fetcher(this.url+'/rest/v1/'+path,{...options,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',headers:{apikey:this.key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',...options.headers}});}catch{throw new MailboxError('Connection unavailable. Keep this draft and retry with the same request ID. Delivery is unconfirmed.','unavailable');}
  if([401,403].includes(response.status))throw new MailboxError('Login expired or owner access denied. Keep this draft.','auth');
  if(response.status===409)throw new MailboxError('Request already exists; checking its saved contents.','conflict');
  if(!response.ok)throw new MailboxError(response.status===429?'Mailbox quota or rate limit reached. Keep this draft and try later.':'Mailbox unavailable or paused. Keep this draft; delivery is unconfirmed.','unavailable');
  if(response.status===204||!response.body)return null;
  const bytes=await boundedBytes(response,1024*1024);return bytes.length?JSON.parse(new TextDecoder().decode(bytes)):null;
 }
 async send({id,envelope}){
  if(!uuid.test(id)||typeof envelope!=='string'||utf8.encode(envelope).length>131072)throw Error('Invalid encrypted request');
  const digest=await sha256(utf8.encode(envelope));
  try{await this.call('daybreak_requests',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,owner_id:this.ownerId,envelope})});}
  catch(e){if(e.code!=='conflict')throw e;}
  // Read-back also covers retries after a lost write response; never regenerate IDs/encryption on retry.
  const rows=await this.call(`daybreak_requests?id=eq.${id}&select=id,payload_sha256&limit=1`);
  if(rows?.length!==1||rows[0].payload_sha256!==digest)throw new MailboxError('Saved request differs or cannot be verified. Keep this draft for private review.','integrity');
  return {id,confirmed:true};
 }
 async replies(){return this.call('daybreak_replies?select=id,request_id,envelope,payload_sha256,created_at&order=created_at.desc&limit=20');}
}
export async function openReply(row,password){
 if(typeof row.envelope!=='string'||utf8.encode(row.envelope).length>131072||await sha256(utf8.encode(row.envelope))!==row.payload_sha256)throw Error('Reply integrity check failed');
 const {unlock}=await import('./crypto.js');const {data}=await unlock(password,JSON.parse(row.envelope),'reply');
 if(data.schemaVersion!=='1.0'||data.type!=='daybreak-reply'||data.requestId!==row.request_id||typeof data.body!=='string'||data.body.length>10000||!Number.isInteger(data.revision)||data.revision<0)throw Error('Invalid private reply');
 return data;
}
