/** Minimal DOM components. Data is always text, never interpreted as HTML. */
const SVG='http://www.w3.org/2000/svg';
export function h(tag, props={}, ...children) {
 const el=document.createElement(tag);
 for(const [key,value] of Object.entries(props||{})) {
  if(value==null||value===false)continue;
  if(key==='class')el.className=value;
  else if(key==='style')Object.assign(el.style,value);
  else if(key.startsWith('on')&&typeof value==='function')el.addEventListener(key.slice(2).toLowerCase(),value);
  else if(key==='text')el.textContent=value;
  else if(key in el && !key.startsWith('aria')&&!key.startsWith('data'))el[key]=value;
  else el.setAttribute(key,value===true?'':String(value));
 }
 const add=c=>{if(c==null||c===false)return;if(Array.isArray(c))c.forEach(add);else el.append(c instanceof Node?c:document.createTextNode(String(c)));};children.forEach(add);return el;
}
export function svg(tag,attrs={},...children) {const el=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);children.flat().forEach(c=>el.append(c));return el;}
const paths={
 sun:['M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4','M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
 briefcase:['M8 6V4h8v2','M3 7h18v13H3z','M3 11l9 3 9-3M10 13v3h4v-3'],
 grid:['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
 check:['M5 12l4 4L19 6'],
 shield:['M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z','m8 12 3 3 5-6'],
 lock:['M6 10h12v11H6z','M8 10V6a4 4 0 0 1 8 0v4'],
 arrow:['M4 12h16m-6-6 6 6-6 6'],
 up:['m4 16 6-6 4 4 6-10m-5 0h5v5'],
 down:['M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4'],
 chevron:['m9 5 7 7-7 7'],
 external:['M14 3h7v7m0-7L10 14M9 3H3v18h18v-6'],
 alert:['m12 3 10 18H2z','M12 9v5m0 3v.1'],
 clock:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0','M12 7v6l4 2'],
 file:['M4 2h10l6 6v14H4zM14 2v6h6M8 12h8M8 16h6'],
 robot:['M5 7h14v14H5zM12 3v4M2 11v5m20-5v5M8 11v2m8-2v2M9 17h6'],
 spark:['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z'],
 layers:['m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6'],
 search:['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6'],
 x:['m6 6 12 12M6 18 18 6'],
 eye:['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12','M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
 refresh:['M20 7A9 9 0 0 0 4 5L2 8m0-6v6h6M4 17a9 9 0 0 0 16 2l2-3m0 6v-6h-6'],
 copy:['M8 8h13v13H8zM16 8V3H3v13h5'],
 settings:['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8','M9 2h6l1 4 4 1 2 5-3 3v5l-5 2-3-3H6l-3-5 2-4z'],
 mail:['M2 4h20v16H2zM2 4l10 9L22 4'],
 terminal:['m4 6 6 6-6 6M13 18h7'],
 bookmark:['M6 3h12v19l-6-4-6 4z'],
 menu:['M3 6h18M3 12h18M3 18h18'],
 bell:['M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4']
};
export function icon(name,size=18){return svg('svg',{viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},...(paths[name]||paths.spark).map(d=>svg('path',{d})));}
export const btn=(label,click,kind='secondary',ic=null,attrs={})=>h('button',{class:`btn ${kind}`,type:'button',onClick:click,...attrs},ic&&icon(ic,16),label);
export const badge=(text,tone='neutral')=>h('span',{class:`badge ${tone}`},h('i',{}),text);
export function empty(title,description,ic='search') {return h('div',{class:'empty-state'},icon(ic,28),h('h3',{},title),h('p',{},description));}
export function download(name,content,type='application/json') {const url=URL.createObjectURL(new Blob([content],{type}));const a=h('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
