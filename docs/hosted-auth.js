import {MailboxAuth} from './auth.js';
const FLOW='daybreak-oauth-flow-v1';
const RECOVERY='daybreak-password-recovery-v1';
/** Existing owner only. Passwords go directly to Auth; tokens stay in memory. */
export class HostedAuth extends MailboxAuth {
 async accept(session){
  if(!session?.access_token)throw Error('Sign-in was not completed.');
  const generation=this.generation;
  const {data,error}=await this.client.auth.getUser(session.access_token);
  if(generation!==this.generation)return null;
  if(error||!data?.user||data.user.id!==session.user.id)throw Error('Could not verify your sign-in.');
  this.current={access_token:session.access_token,expires_at:session.expires_at,user:{id:data.user.id,email:data.user.email}};
  return this.current;
 }
 async begin(){this.tabStorage.removeItem(RECOVERY);this.recovering=false;return super.begin();}
 async emailLogin(email,password){
  this.tabStorage.removeItem(RECOVERY);this.recovering=false;
  await this.forget();const generation=this.generation;
  const client=this.startClient('daybreak-auth-'+crypto.randomUUID());
  const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
  if(error||!data?.session)throw Error('Sign-in failed. Check your email and password, or reset your password.');
  if(generation!==this.generation)return null;
  return this.accept(data.session);
 }
 async session(){
  if(!this.current)return null;
  if(this.current.expires_at*1000>Date.now()+30000)return this.current;
  const generation=this.generation;
  const {data,error}=await this.client.auth.refreshSession();
  if(generation!==this.generation)return null;
  if(error||!data?.session){this.current=null;return null;}
  return this.accept(data.session);
 }
 async sendReset(email){
  // User explicitly initiates the email. No signup or new identity.
  await this.forget();const key='daybreak-auth-'+crypto.randomUUID();
  this.tabStorage.setItem(FLOW,JSON.stringify({key,at:Date.now()}));
  this.tabStorage.setItem(RECOVERY,String(Date.now()));
  const client=this.startClient(key);
  const {error}=await client.auth.resetPasswordForEmail(email.trim(),{redirectTo:this.config.redirectTo});
  if(error){this.clearFlow();this.tabStorage.removeItem(RECOVERY);throw Error('Password reset could not be requested. Please try again later.');}
 }
 async finish(...args){
  const callback=new URL(location.href).searchParams.has('code')||new URL(location.href).searchParams.has('error');
  const at=Number(this.tabStorage.getItem(RECOVERY));
  this.recovering=at>0&&Date.now()-at<10*60*1000;
  try{await super.finish(...args);}finally{if(callback)this.tabStorage.removeItem(RECOVERY);}
  return this.current;
 }
 async setPassword(password){
  if(!await this.session())throw Error('Sign in again before setting your password.');
  if(typeof password!=='string'||password.length<12)throw Error('Use at least 12 characters for your account password.');
  const {error}=await this.client.auth.updateUser({password});
  if(error)throw Error('Password could not be updated. Sign in again if requested, or choose a stronger password.');
  this.recovering=false;this.tabStorage.removeItem(RECOVERY);
 }
}
