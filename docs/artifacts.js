import {from64,utf8} from './crypto.js';
const MAX=2*1024*1024;
export const sha256=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function checkDescriptor(a){
 if(!a||a.mime!=='application/pdf'||!Number.isInteger(a.size)||a.size<5||a.size>MAX||!/^([a-f0-9]{64})$/.test(a.sha256)||typeof a.id!=='string')throw Error('Invalid PDF descriptor');
 const s=a.storage;
 if(!s||s.version!==1||!/^artifacts\/[a-f0-9]{32}\.enc$/.test(s.path)||s.ciphertextSize!==a.size+16||!/^[a-f0-9]{64}$/.test(s.ciphertextSha256)||from64(s.key).length!==32||from64(s.iv).length!==12)throw Error('Invalid PDF storage descriptor');
 return a;
}
export async function boundedBytes(response,max,expected=null){
 if(!response.ok)throw Error(`Encrypted file unavailable (HTTP ${response.status}). Refresh the snapshot or try again later.`);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('Encrypted file too large');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Encrypted file too large');chunks.push(value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 if(expected!==null&&size!==expected)throw Error('Encrypted file size mismatch');
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}return raw;
}
export async function loadArtifact(a,{signal,fetcher=fetch,base=new URL('.',import.meta.url)}={}){
 let raw;
 if(a.storage){
  checkDescriptor(a);
  const url=new URL(a.storage.path,base);if(url.origin!==base.origin||url.pathname!==base.pathname+a.storage.path)throw Error('Unsafe artifact URL');
  const response=await fetcher(url,{signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
  const encrypted=await boundedBytes(response,MAX+16,a.storage.ciphertextSize);
  if(await sha256(encrypted)!==a.storage.ciphertextSha256)throw Error('Encrypted artifact hash check failed');
  const key=await crypto.subtle.importKey('raw',from64(a.storage.key),'AES-GCM',false,['decrypt']);
  const aad=utf8.encode(JSON.stringify(['daybreak','pdf',1,a.id,a.sha256,'application/pdf',a.size]));
  raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(a.storage.iv),additionalData:aad,tagLength:128},key,encrypted));
  if(raw.length!==a.size||new TextDecoder().decode(raw.subarray(0,5))!=='%PDF-')throw Error('Invalid PDF bytes');
 }else{
  if(!['text/plain','application/pdf','image/png','image/jpeg'].includes(a.mime)||typeof a.base64!=='string'||a.base64.length>Math.ceil(MAX/3)*4)throw Error('Invalid embedded artifact');
  raw=from64(a.base64);
 }
 if(raw.length>MAX||await sha256(raw)!==a.sha256)throw Error('Artifact hash check failed');
 if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
 return raw;
}
