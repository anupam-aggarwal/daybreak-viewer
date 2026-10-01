/** Password-based authenticated encryption, interoperable with tools/daybreak.py. */
export const ITERATIONS = 600000;
const MAX_BYTES = 25 * 1024 * 1024;
export const utf8 = new TextEncoder();
export function from64(s) { if (typeof s !== 'string') throw new Error('Invalid encoding'); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export function to64(bytes) { let out=''; for(let i=0;i<bytes.length;i+=16384) out+=String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(out); }
function validate(e, purpose='vault') {
  if(e.version!==1 || e.kdf!=='PBKDF2-SHA256' || e.cipher!=='AES-256-GCM' || e.purpose!==purpose || e.iterations!==ITERATIONS) throw new Error('Unsupported encrypted file');
  if(from64(e.salt).length!==16 || from64(e.iv).length!==12 || from64(e.ciphertext).length>MAX_BYTES+16) throw new Error('Invalid encrypted file');
}
const aad = p => utf8.encode(`daybreak:v1:${p}:PBKDF2-SHA256:600000:AES-256-GCM`);
export async function unlock(password, envelope) {
  if(!crypto.subtle) throw new Error('Use HTTPS or localhost for browser encryption.');
  validate(envelope);
  const material = await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:from64(envelope.salt),iterations:ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(envelope.iv),additionalData:aad('vault'),tagLength:128},key,from64(envelope.ciphertext));
  const data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear));
  return {data, session:{key,salt:envelope.salt,iterations:ITERATIONS}};
}
export async function sealOutbox(data, session) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad('outbox'),tagLength:128},session.key,utf8.encode(JSON.stringify(data)));
  return {version:1,purpose:'outbox',kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt:session.salt,iv:to64(iv),ciphertext:to64(new Uint8Array(ciphertext))};
}
export async function loadEnvelope(file=null) {
  if(file) { if(file.size>MAX_BYTES*1.4) throw new Error('File too large'); return JSON.parse(await file.text()); }
  const response = await fetch(new URL('./vault.enc.json',import.meta.url),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok) throw new Error(`Encrypted file unavailable (HTTP ${response.status}).`);
  const txt=await response.text(); if(txt.length>MAX_BYTES*1.4) throw new Error('File too large'); return JSON.parse(txt);
}
