import {test} from 'node:test';import assert from 'node:assert/strict';
import {MailboxAuth,createAuthStorage} from '../docs/auth.js';
const config={enabled:true,url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic',redirectTo:'https://site.test/daybreak/'};
function store(){const map=new Map();return{map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
function factoryFixture({fail=false}={}){
 let options;
 const factory=(url,key,opts)=>{
  options=opts;
  return {auth:{
   stopAutoRefresh(){},
   async signInWithOAuth(input){
    assert.equal(input.provider,'github');assert.equal(input.options.redirectTo,config.redirectTo);
    opts.auth.storage.setItem(opts.auth.storageKey+'-code-verifier','test-verifier');
    return {data:{url:config.url+'/auth/v1/authorize?provider=github'},error:null};
   },
   async exchangeCodeForSession(code){
    assert.equal(code,'test-code');assert.equal(opts.auth.storage.getItem(opts.auth.storageKey+'-code-verifier'),'test-verifier');
    return {data:{session:{access_token:'synthetic-token',provider_token:'discard-me',refresh_token:'synthetic-refresh',expires_at:2000,user:{id:'owner'}}}};
   },
   async getUser(){return fail?{error:Error('invalid'),data:{}}:{data:{user:{id:'owner'}}};}
  }};
 };
 return {factory,options:()=>options};
}
test('only verifier uses tab storage; tokens/provider tokens never persist',()=>{const tab=store(),s=createAuthStorage(tab,'flow');s.setItem('flow-code-verifier','synthetic');s.setItem('flow',JSON.stringify({access_token:'access',refresh_token:'refresh',provider_token:'provider'}));assert.equal(tab.map.size,1);assert.ok(!s.getItem('flow').includes('provider'));s.clear();assert.equal(tab.map.size,0);assert.equal(s.getItem('flow'),null)});
test('GitHub PKCE callback strips code, verifies user and retains memory-only session',async()=>{const tab=store(),mock=factoryFixture();let destination;const first=new MailboxAuth(config,{factory:mock.factory,tabStorage:tab,clock:()=>1000,navigate:u=>destination=u});await first.begin();assert.equal(destination,config.url+'/auth/v1/authorize?provider=github');const auth=new MailboxAuth(config,{factory:mock.factory,tabStorage:tab,clock:()=>1000});let cleaned;await auth.finish(new URL(config.redirectTo+'?code=test-code'),v=>cleaned=v);assert.equal(cleaned,'/daybreak/');assert.equal((await auth.session()).access_token,'synthetic-token');assert.equal(tab.map.size,0);await auth.forget();assert.equal(await auth.session(),null)});
test('expired/missing PKCE and unverified user fail closed',async()=>{const tab=store(),mock=factoryFixture({fail:true}),auth=new MailboxAuth(config,{factory:mock.factory,tabStorage:tab,clock:()=>1000,navigate:()=>{}});await assert.rejects(auth.finish(new URL(config.redirectTo+'?code=test-code'),()=>{}));await auth.begin();await assert.rejects(auth.finish(new URL(config.redirectTo+'?code=test-code'),()=>{}));assert.equal(await auth.session(),null);assert.equal(tab.map.size,0)});
test('unconfigured auth cannot initiate network/redirect',async()=>{const auth=new MailboxAuth({...config,enabled:false},{factory:()=>{throw Error('must not initialize')},tabStorage:store()});await assert.rejects(auth.begin());});
