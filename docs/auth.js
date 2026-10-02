import {createClient} from './vendor/supabase.js';
const FLOW='daybreak-oauth-flow-v1';
const MAX_AGE=10*60*1000;
/** Access/refresh/provider tokens never go into persistent browser storage.
 * Only a short-lived PKCE verifier/attempt marker survives the OAuth redirect.
 */
export function createAuthStorage(tabStorage,flowKey){
 const memory=new Map(),verifierKey=flowKey+'-code-verifier';
 return {
  getItem(key){return key===verifierKey?tabStorage.getItem(key):memory.get(key)||null;},
  setItem(key,value){
   if(key===verifierKey){tabStorage.setItem(key,value);return;}
   // Supabase provider tokens are not needed for identity or mailbox operations.
   try{const data=JSON.parse(value);if(data&&typeof data==='object'){delete data.provider_token;delete data.provider_refresh_token;value=JSON.stringify(data);}}catch{}
   memory.set(key,value);
  },
  removeItem(key){memory.delete(key);if(key===verifierKey)tabStorage.removeItem(key);},
  clear(){memory.clear();tabStorage.removeItem(verifierKey);}
 };
}
export class MailboxAuth {
 constructor(config,{factory=createClient,tabStorage=globalThis.sessionStorage,clock=()=>Date.now(),navigate=url=>location.assign(url)}={}){
  this.config=config;this.factory=factory;this.tabStorage=tabStorage;this.clock=clock;this.navigate=navigate;this.current=null;this.client=null;this.generation=0;this.message='';
 }
 configured(){return this.config.enabled&&/^sb_publishable_/.test(this.config.publishableKey||'');}
 startClient(flowKey){
  this.storage=createAuthStorage(this.tabStorage,flowKey);this.flowKey=flowKey;
  this.client=this.factory(this.config.url,this.config.publishableKey,{auth:{flowType:'pkce',storageKey:flowKey,storage:this.storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
  return this.client;
 }
 clearFlow(){
  let previous;try{previous=JSON.parse(this.tabStorage.getItem(FLOW)||'null');}catch{}
  if(previous?.key&&/^daybreak-auth-[a-f0-9-]{36}$/.test(previous.key))this.tabStorage.removeItem(previous.key+'-code-verifier');
  if(this.flowKey)this.tabStorage.removeItem(this.flowKey+'-code-verifier');
  this.tabStorage.removeItem(FLOW);
 }
 async begin(){
  if(!this.configured())throw Error('Mailbox setup is pending. Requests remain unsent.');
  await this.forget();const generation=this.generation;
  const key='daybreak-auth-'+crypto.randomUUID();this.tabStorage.setItem(FLOW,JSON.stringify({key,at:this.clock()}));
  const client=this.startClient(key);
  const {data,error}=await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:this.config.redirectTo,skipBrowserRedirect:true}});
  if(error||!data?.url){this.clearFlow();throw Error('GitHub sign-in is unavailable. No request was sent.');}
  const url=new URL(data.url);
  if(url.origin!==new URL(this.config.url).origin||url.pathname!=='/auth/v1/authorize'||url.searchParams.get('provider')!=='github'){this.clearFlow();throw Error('Unexpected sign-in destination');}
  if(generation===this.generation)this.navigate(url.href);
 }
 async finish(url=new URL(location.href),replace=value=>history.replaceState(null,'',value)){
  const code=url.searchParams.get('code'),failed=url.searchParams.has('error')||url.hash.includes('error=');
  if(!code&&!failed)return;
  // Remove auth callback parameters before any external links or UI interaction.
  url.searchParams.delete('code');url.searchParams.delete('error');url.searchParams.delete('error_description');url.searchParams.delete('error_code');url.hash='';replace(url.pathname+url.search);
  let flow;try{flow=JSON.parse(this.tabStorage.getItem(FLOW)||'null');}catch{}
  if(!this.configured()||failed||!flow||!/^daybreak-auth-[a-f0-9-]{36}$/.test(flow.key)||!Number.isFinite(flow.at)||this.clock()-flow.at>MAX_AGE||flow.at>this.clock()){
   if(flow?.key&&/^daybreak-auth-[a-f0-9-]{36}$/.test(flow.key))this.tabStorage.removeItem(flow.key+'-code-verifier');
   this.tabStorage.removeItem(FLOW);throw Error('Sign-in expired or was cancelled. Start GitHub sign-in again.');
  }
  const generation=this.generation;const client=this.startClient(flow.key);
  try{
   const {data,error}=await client.auth.exchangeCodeForSession(code);
   if(error||!data.session)throw Error('Sign-in could not be completed. Try again.');
   const verified=await client.auth.getUser(data.session.access_token);
   if(verified.error||!verified.data.user||verified.data.user.id!==data.session.user.id)throw Error('Could not verify signed-in identity.');
   if(generation!==this.generation)return;
   this.current={access_token:data.session.access_token,expires_at:data.session.expires_at,user:{id:verified.data.user.id}};
  }catch(e){await this.forget();throw e;}finally{this.clearFlow();}
 }
 async session(){
  if(!this.current||!Number.isFinite(this.current.expires_at)||this.current.expires_at*1000<=this.clock())return null;
  return this.current;
 }
 async forget(){
  this.generation++;this.current=null;this.clearFlow();
  if(this.client)this.client.auth.stopAutoRefresh();
  if(this.storage)this.storage.clear();this.client=null;this.storage=null;
 }
 async signOut(){
  const client=this.client,session=this.current;await this.forget();
  if(client&&session){
   // Explicit server logout, with tokens kept only in this transient call.
   const response=await fetch(this.config.url+'/auth/v1/logout?scope=local',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',headers:{apikey:this.config.publishableKey,Authorization:'Bearer '+session.access_token}});
   if(!response.ok)throw Error('Signed out in this tab. Server revocation could not be confirmed.');
  }
 }
}
