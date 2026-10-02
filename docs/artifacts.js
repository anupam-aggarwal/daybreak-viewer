/** Bounded, hash-checked bytes used by the authenticated hosted store. */
export const sha256=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function boundedBytes(response,max,expected=null){
 if(!response.ok)throw Error(`Private file unavailable (HTTP ${response.status}). Sign in again or try later.`);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('Private file too large');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Private file too large');chunks.push(value);}}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 if(expected!==null&&size!==expected)throw Error('Private file size mismatch');
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}return raw;
}
