import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {loadArtifact,sha256,checkDescriptor,boundedBytes} from '../docs/artifacts.js';
import {to64,utf8} from '../docs/crypto.js';
if(!globalThis.crypto)Object.defineProperty(globalThis,"crypto",{value:webcrypto});
async function fixture(){
 const raw=utf8.encode('%PDF-1.4\nsynthetic only');const key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
 const a={id:'synthetic',name:'test.pdf',mime:'application/pdf',size:raw.length,sha256:await sha256(raw)};
 const k=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);const aad=utf8.encode(JSON.stringify(['daybreak','pdf',1,a.id,a.sha256,a.mime,a.size]));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},k,raw));
 a.storage={version:1,path:'artifacts/'+'a'.repeat(32)+'.enc',key:to64(key),iv:to64(iv),ciphertextSize:encrypted.length,ciphertextSha256:await sha256(encrypted)};
 return {a,raw,encrypted};
}
test('one exact PDF fetched on demand; hash and AAD verified',async()=>{const {a,raw,encrypted}=await fixture();let count=0;const out=await loadArtifact(a,{base:new URL('https://local.test/docs/'),fetcher:async(url,opts)=>{count++;assert.equal(url.href,'https://local.test/docs/'+a.storage.path);assert.equal(opts.credentials,'omit');return new Response(encrypted);}});assert.deepEqual(out,raw);assert.equal(count,1);});
test('reject unsafe paths, descriptors, overlarge streams and missing blobs',async()=>{const {a}=await fixture();for(const p of ['../vault','https://evil.test/file','/artifacts/a.enc','artifacts/%2e.enc'])assert.throws(()=>checkDescriptor({...a,storage:{...a.storage,path:p}}));await assert.rejects(boundedBytes(new Response('12345'),4));await assert.rejects(loadArtifact(a,{base:new URL('https://local.test/'),fetcher:async()=>new Response('',{status:404})}));});
test('reject corruption, substitution and cancellation',async()=>{const {a,encrypted}=await fixture();const opts={base:new URL('https://local.test/'),fetcher:async()=>new Response(encrypted)};await assert.rejects(loadArtifact({...a,id:'substituted'},opts));const wrong=encrypted.slice();wrong[0]^=1;await assert.rejects(loadArtifact(a,{...opts,fetcher:async()=>new Response(wrong)}));const controller=new AbortController();controller.abort();await assert.rejects(loadArtifact(a,{...opts,signal:controller.signal}));});
test('embedded legacy artifact still works without any fetch',async()=>{const raw=utf8.encode('synthetic legacy');const a={mime:'text/plain',base64:to64(raw),sha256:await sha256(raw)};assert.deepEqual(await loadArtifact(a,{fetcher:()=>{throw Error('must not fetch');}}),raw);});
