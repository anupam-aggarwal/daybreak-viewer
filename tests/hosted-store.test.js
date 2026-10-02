import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedStore,AuthRequired} from '../docs/hosted-store.js';
const owner='11111111-1111-4111-8111-111111111111';
const config={url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'};
test('no personal API call without a session or after account switch',async()=>{
 let session=null,calls=0;
 const store=new HostedStore(config,{session:async()=>session},{fetcher:()=>{calls++;throw Error('unexpected')}});
 await assert.rejects(store.requests(),AuthRequired);assert.equal(calls,0);
 store.owner=owner;session={user:{id:'22222222-2222-4222-8222-222222222222'},access_token:'synthetic'};
 await assert.rejects(store.requests(),AuthRequired);assert.equal(calls,0);
});
test('lost-response retry accepts only the exact saved request',async()=>{
 const request={id:'33333333-3333-4333-8333-333333333333',owner_id:owner,content:'Synthetic request'};
 let altered=false;
 const store=new HostedStore(config,{session:async()=>({user:{id:owner},access_token:'synthetic'})},{fetcher:async(url,init)=>init.method==='POST'?new Response('{}',{status:409}):new Response(JSON.stringify([{...request,content:altered?'Changed':request.content}]))});
 store.owner=owner;assert.deepEqual(await store.send(request),request);altered=true;await assert.rejects(store.send(request),/could not be confirmed/);
});
test('expired access requires explicit reauthentication; provider body stays hidden',async()=>{
 const store=new HostedStore(config,{session:async()=>({user:{id:owner},access_token:'synthetic'})},{fetcher:async()=>new Response('PRIVATE PROVIDER ERROR',{status:401})});
 store.owner=owner;await assert.rejects(store.requests(),e=>e instanceof AuthRequired&&!e.message.includes('PRIVATE PROVIDER'));
});
