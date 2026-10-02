import {checkDescriptor} from './artifacts.js';
/** Pure view-model functions. No stored sessions, requests, or side effects. */
export const STATUS = {
  applied:{label:'Applied',tone:'green'}, needs_review:{label:'Needs review',tone:'amber'},
  failed:{label:'Failed',tone:'red'}, in_progress:{label:'In progress',tone:'blue'},
  queued:{label:'Ready',tone:'violet'}, discovered:{label:'Discovered',tone:'neutral'}, skipped:{label:'Skipped',tone:'neutral'}
};
export function safeURL(value) { try {const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : null;} catch {return null;} }
export function assertData(d) {
  if(!d || d.schemaVersion!=='1.0' || !d.meta || !Array.isArray(d.jobs) || !Array.isArray(d.resumes) || !Array.isArray(d.feeds) || !Array.isArray(d.runs) || !Array.isArray(d.artifacts) || !Array.isArray(d.decisions)) throw new Error('Unsupported dashboard schema');
  if(d.jobs.some(j=>!j.id||!j.company||!j.title||!STATUS[j.status])) throw new Error('Invalid job records');
  if(new Set(d.jobs.map(j=>j.id)).size!==d.jobs.length) throw new Error('Duplicate record IDs');
  if(d.viewerFormat!==undefined&&d.viewerFormat!==2)throw new Error('Unsupported viewer format');
  if(d.viewerFormat===2){
    d.artifacts.forEach(checkDescriptor);
    if(new Set(d.artifacts.map(a=>a.id)).size!==d.artifacts.length)throw new Error('Duplicate artifacts');
    if(d.resumes.some(r=>!r.id.startsWith('draft-')||r.text!==''||!d.artifacts.some(a=>a.id===r.artifactId&&a.sha256===r.sha256)))throw new Error('Invalid selected CV');
    if(d.preferences.approvedForSubmission||d.decisions.length||d.runs.length||d.feeds.length)throw new Error('Invalid public viewer boundary');
    if((d.requestStatus||[]).some(r=>!d.jobs.some(j=>j.id===r.jobId)||!['queued','working','needs_input','ready'].includes(r.status)||!Object.hasOwn(REQUEST_RESULTS,r.result)))throw new Error('Invalid request status');
  }
  return d;
}
export function dateKey(iso) { if(!iso) return ''; const d=new Date(iso); return Number.isNaN(+d)?'':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }
export function fmt(iso,compact=false) { if(!iso) return 'Not recorded'; const d=new Date(iso); if(Number.isNaN(+d))return 'Not recorded'; return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',...(compact?{}:{hour:'2-digit',minute:'2-digit',hour12:true})}).format(d); }
export function dayLabel(iso) {return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(iso));}
export function shortDate(iso) {return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short'}).format(new Date(iso));}
export function referenceDate(d) {return d.meta.demo?d.meta.updatedAt:new Date().toISOString();}
export function matchesPeriod(j,period,ref) {if(period==='all')return true;const t=Date.parse(j.submission?.at||j.discoveredAt);return t<=Date.parse(ref)&&t>=Date.parse(ref)-Number(period)*86400000;}
export function stats(d) {
 const all=d.jobs, applied=all.filter(j=>j.status==='applied'), today=dateKey(referenceDate(d));
 const successful=all.flatMap(j=>j.attempts||[]).filter(a=>a.result==='confirmed').length;
 const failed=all.flatMap(j=>j.attempts||[]).filter(a=>a.result==='failed').length;
 return {applied:applied.length,today:applied.filter(j=>dateKey(j.submission?.at)===today).length,review:all.filter(j=>['needs_review','in_progress'].includes(j.status)).length,ready:all.filter(j=>j.status==='queued').length,attempts:successful+failed,successRate:successful+failed?Math.round(100*successful/(successful+failed)):null,interviews:applied.filter(j=>j.outcome==='interview').length,failed:all.filter(j=>j.status==='failed').length};
}
export function trend(d,n=14) {
 const end=new Date(referenceDate(d));const data=[];
 for(let i=n-1;i>=0;i--) {const day=new Date(+end-i*86400000),key=dateKey(day);data.push({date:day.toISOString(),value:d.jobs.filter(j=>j.status==='applied'&&dateKey(j.submission?.at)===key).length});}
 return data;
}
export function initials(name) {return String(name).split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();}
export function currency(j) {const s=j.salary;if(!s||s.min==null)return 'Not disclosed';if(s.currency==='INR')return `₹${(s.min/100000).toFixed(0)}${s.max?`–${(s.max/100000).toFixed(0)}`:''}L ${s.component||''}`;return `${s.currency} ${s.min.toLocaleString('en-IN')}${s.max?`–${s.max.toLocaleString('en-IN')}`:''}`;}
export function countsBy(jobs,key) {const counts=new Map();jobs.forEach(j=>counts.set(j[key],(counts.get(j[key])||0)+1));return [...counts.entries()].sort((a,b)=>b[1]-a[1]);}

export const REQUEST_LABELS={queued:'Queued',working:'Working',needs_input:'Needs your input',ready:'Ready'};
export const REQUEST_RESULTS={none:'Request received',cv_prepared:'CV prepared; dashboard download requires owner selection',role_skipped:'Role skipped',role_reconsidered:'Role reconsidered',input_required:'Private input needed',stale_request:'Review needed against newer saved state',legacy_review:'Private review needed'};
export function requestForJob(data,id){return (data.requestStatus||[]).filter(r=>r.jobId===id).at(-1)||null;}
