var e=Object.defineProperty,t=(t,n)=>{let r={};for(var i in t)e(r,i,{get:t[i],enumerable:!0});return n||e(r,Symbol.toStringTag,{value:`Module`}),r};function n(e){if(e.debugMode!==void 0){if(e.debugMode===`none`||e.debugMode===`trace`||e.debugMode===`lldb`)return e.debugMode;throw Error(`unsupported wasm-clang debug mode: ${String(e.debugMode)}`)}return e.debug?`trace`:`none`}function r(e,...t){let n={};for(let r of t)n[r]=(e[r]||(()=>0)).bind(e);return n}function i(e,t,n=-1){let r=n===-1?e.length:t+n,i=``;for(let n=t;n<r&&e[n];++n)i+=String.fromCharCode(e[n]);return i}function a(e,t,n=-1){let r=n===-1?e.length:t+n,i=[];for(let n=t;n<r&&e[n];++n)i.push(e[n]);return new TextDecoder().decode(Uint8Array.from(i))}function o(e,t,n){return parseInt(i(e,t,n),8)}var s=class{memory;view;buffer;u8;u32;constructor(e){this.memory=e,this.buffer=e.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer)}check(){this.buffer.byteLength===0&&(this.buffer=this.memory.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer))}read8(e){return this.u8[e]}read32(e){return this.u32[e>>2]}readInt32(e){return this.view.getInt32(e,!0)}readFloat32(e){return this.view.getFloat32(e,!0)}readFloat64(e){return this.view.getFloat64(e,!0)}readStr(e,t){return i(this.u8,e,t)}readStrR(e,t){return a(this.u8,e,t)}write8(e,t){this.u8[e]=t}write32(e,t){this.u32[e>>2]=t}write64(e,t,n=0){this.write32(e,t),this.write32(e+4,n)}writeStr(e,t){return e+=this.write(e,t),this.write8(e,0),t.length+1}writeUint8(e,t){return new Uint8Array(this.buffer,e,t.length).set(t),t.length}write(e,t){return t instanceof ArrayBuffer||t instanceof SharedArrayBuffer?this.writeUint8(e,new Uint8Array(t)):typeof t==`string`?this.writeUint8(e,t.split(``).map(e=>e.charCodeAt(0))):this.writeUint8(e,t)}};const c=new Map,l=new Map,u=e=>e.byteLength>=2&&e[0]===31&&e[1]===139,d=128*1024*1024,f=4*1024*1024,p=64*1024;async function m(e,t,n,r){let i=e.getReader(),a=r,o=!1;if(a?.aborted){o=!0;let e=_(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}try{i.releaseLock()}catch{}throw e}let s,c=a?new Promise((e,t)=>{s=()=>{if(o)return;o=!0;let e=_(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}t(e)},a.addEventListener(`abort`,s,{once:!0})}):void 0,l=new Uint8Array(Math.min(p,n)),u=0,d=!1,f,m;try{for(y(a);;){let e=i.read(),{done:r,value:o}=c?await Promise.race([e,c]):await e;if(y(a),r)break;if(!o)continue;let s=u+o.byteLength;if(s>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);if(s>l.byteLength){let e=Math.min(n,Math.max(s,Math.max(l.byteLength*2,1))),t=new Uint8Array(e);t.set(l.subarray(0,u)),l=t}l.set(o,u),u=s}y(a),f=l.subarray(0,u),d=!0}catch(e){if(a?.aborted)throw _(a);if(!o){o=!0;try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}}throw e}finally{s&&a?.removeEventListener(`abort`,s);try{i.releaseLock()}catch(e){d&&(m={error:e})}}if(m)throw m.error;return f}function h(e){let t;try{t=new URL(e,typeof location<`u`?location.href:void 0)}catch{throw Error(`Runtime asset URL must be absolute outside a browser document`)}if(t.protocol!==`http:`&&t.protocol!==`https:`)throw Error(`Runtime assets must use HTTP(S)`);if(t.username||t.password)throw Error(`Runtime asset URLs must not include credentials`);if(t.hash)throw Error(`Runtime asset URLs must not include fragments`);return t}function g(e){let t=e.headers.get(`Content-Length`);if(t===null)return 0;let n=Number(t);if(!/^\d+$/u.test(t)||!Number.isSafeInteger(n))throw Error(`Runtime asset has an invalid Content-Length`);return n}function _(e){return e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`)}function v(e,t,n){return t?new Promise((r,i)=>{let a=!1,o=()=>{a||(a=!0,t.removeEventListener(`abort`,o),i(_(t)))};t.addEventListener(`abort`,o,{once:!0}),e.then(e=>{if(a){n&&Promise.resolve().then(()=>n(e,t.reason)).catch(()=>{});return}a=!0,t.removeEventListener(`abort`,o),r(e)},e=>{a||(a=!0,t.removeEventListener(`abort`,o),i(e))}),t.aborted&&o()}):e}function y(e){if(e?.aborted)throw _(e)}function b(e,t){try{e.body?.cancel(t).catch(()=>{})}catch{}}async function x(e,t,n,r,i){if(i?.aborted){let t=_(i);throw b(e,t),t}let a;try{a=g(e)}catch(t){throw b(e,t),t}if(a>n)throw b(e),Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);if(!e.body){let a=new Uint8Array(await v(e.arrayBuffer(),i));if(i?.aborted)throw _(i);if(a.byteLength>n)throw Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);return r?.set?.(1),a}let o=i,s=e.body.getReader(),c=!1,l=e=>{if(!c){c=!0;try{Promise.resolve(s.cancel(e)).catch(()=>{})}catch{}}};if(o?.aborted){let e=_(o);l(e);try{s.releaseLock()}catch{}throw e}let u,d=o?new Promise((e,t)=>{u=()=>{let e=_(o);l(e),t(e)},o.addEventListener(`abort`,u,{once:!0})}):void 0,f,m=0,h,x;try{for(f=new Uint8Array(Math.min(n,a||p));;){y(o);let e=s.read(),{done:i,value:c}=d?await Promise.race([e,d]):await e;if(y(o),i)break;if(!c)continue;let u=m+c.byteLength;if(u>n){let e=Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);throw l(e),e}if(u>f.byteLength){let e=Math.min(n,Math.max(u,Math.max(f.byteLength*2,1))),t=new Uint8Array(e);t.set(f.subarray(0,m)),f=t}f.set(c,m),m=u,a>0&&r?.set?.(m/a)}y(o),h=f.subarray(0,m)}catch(e){if(o?.aborted){let e=_(o);throw l(e),e}throw l(e),e}finally{u&&o?.removeEventListener(`abort`,u);try{s.releaseLock()}catch(e){o?.aborted||(x={error:e})}}if(o?.aborted){let e=_(o);throw l(e),e}if(x)throw x.error;return h}async function S(e,t={}){let n=t.maxBytes??4194304;if(!Number.isSafeInteger(n)||n<=0)throw Error(`Runtime JSON byte limit must be a positive safe integer`);let r=h(e.toString()),i=t.label?.trim()||`runtime JSON`,a=t.fetchImpl??globalThis.fetch?.bind(globalThis);if(!a)throw Error(`Fetch is unavailable while loading ${i}`);if(t.signal?.aborted)throw _(t.signal);let o={cache:`no-store`,credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`};t.signal&&(o.signal=t.signal);let s=await v(Promise.resolve(a(r.toString(),o)),t.signal,(e,t)=>{b(e,t)});if(t.signal?.aborted){let e=_(t.signal);throw b(s,e),e}if(s.url){let e;try{e=new URL(s.url)}catch{throw b(s),Error(`${i} returned an invalid final URL`)}if(e.href!==r.href)throw b(s),Error(`${i} returned an unexpected final URL`)}if(!s.ok)throw b(s),Error(`Failed to load ${i} from ${r}: ${s.status}`);let c=await x(s,r,n,void 0,t.signal),l;try{l=new TextDecoder(`utf-8`,{fatal:!0}).decode(c)}catch(e){throw Error(`${i} is not valid UTF-8`,{cause:e})}try{return JSON.parse(l)}catch(e){throw Error(`${i} is not valid JSON`,{cause:e})}}async function C(e,t=`runtime asset`,n=d,r){if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset decompression limit must be a non-negative safe integer`);if(y(r),!u(e)){if(e.byteLength>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);return e}if(typeof DecompressionStream!=`function`)throw Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);try{let i=Uint8Array.from(e),a=new ReadableStream({start(e){e.enqueue(i),e.close()}}),o=new DecompressionStream(`gzip`);return await m(a.pipeThrough({readable:o.readable,writable:o.writable}),t,n,r)}catch(e){throw r?.aborted?_(r):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function w(e,t,n,r,i){if(i?.aborted){let t=_(i);throw b(e,t),t}let a;try{a=g(e)}catch(t){throw b(e,t),t}if(a>n)throw b(e),Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);if(!e.body){let a=new Uint8Array(await v(e.arrayBuffer(),i));if(y(i),a.byteLength>n)throw Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);let o=await C(a,t,n,i);return y(i),r?.set?.(1),o}let o=e.body.getReader(),s=[],c=0,l=0,u=!1,d=!1,f=!1,p=()=>{d||(d=!0,o.releaseLock())},h=e=>{if(!(d||f)){f=!0;try{Promise.resolve(o.cancel(e)).catch(()=>{})}catch{}try{p()}catch{}}};if(i?.aborted){let e=_(i);throw h(e),e}let x,S=i?new Promise((e,t)=>{x=()=>{let e=_(i);h(e),t(e)},i.addEventListener(`abort`,x,{once:!0})}):void 0;try{for(y(i);c<2;){let e=o.read(),{done:d,value:f}=S?await Promise.race([e,S]):await e;if(y(i),d){u=!0,p();break}if(!f)continue;let m=l+f.byteLength;if(m>n){let e=Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);throw h(e),e}s.push(f),c+=f.byteLength,l=m,a>0&&r?.set?.(Math.min(l/a,1))}y(i)}catch(e){throw h(e),i?.aborted?_(i):e}finally{x&&i?.removeEventListener(`abort`,x)}let w,T;for(let e of s){for(let t of e)if(w===void 0?w=t:T===void 0&&(T=t),T!==void 0)break;if(T!==void 0)break}let E=0,D=new ReadableStream({async pull(e){if(E<s.length){e.enqueue(s[E++]);return}if(u){e.close();return}try{let{done:s,value:c}=await o.read();if(y(i),s){u=!0,p(),e.close();return}if(!c)return;let d=l+c.byteLength;if(d>n){let r=Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);h(r),e.error(r);return}l=d,a>0&&r?.set?.(Math.min(l/a,1)),e.enqueue(c)}catch(t){h(t),e.error(t)}},cancel(e){h(e)}}),O=D;if(w===31&&T===139){if(typeof DecompressionStream!=`function`){let e=Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);throw h(e),e}let e=new DecompressionStream(`gzip`);O=D.pipeThrough({readable:e.readable,writable:e.writable})}try{let e=await m(O,t,n,i);return r?.set?.(1),e}catch(e){throw h(e),i?.aborted?_(i):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function T(e,t,n,r){y(r);let{unzipSync:i}=await import(`./chunks/BR24SaiU.js`);y(r);let a,o=i(e,{filter(e){if(e.name.endsWith(`/`)||a!==void 0)return!1;if(e.originalSize>n)throw Error(`Runtime asset ${t} extracted size exceeds the ${n} byte limit`);return a=e.name,!0}});y(r);for(let[e,t]of Object.entries(o))if(!e.endsWith(`/`))return t;throw Error(`No entry found`)}const E=async(e,t,n=d,r)=>{if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset byte limit must be a non-negative safe integer`);y(r);let i=`${e}\0${n}`,a=r?void 0:l.get(i);a||(a=(async()=>{let i=h(e),a={credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`};r&&(a.signal=r);let o;try{o=await v(Promise.resolve(fetch(i,a)),r,(e,t)=>{b(e,t)})}catch(e){throw r?.aborted?_(r):e}if(r?.aborted){let e=_(r);throw b(o,e),e}if(o.url){let e;try{e=new URL(o.url)}catch{throw b(o),Error(`Runtime asset returned an invalid final URL`)}if(e.href!==i.href)throw b(o),Error(`Runtime asset returned an unexpected final URL`)}if(!o.ok)throw b(o),Error(`Failed to load runtime asset ${i}: ${o.status}`);if(i.pathname.endsWith(`.gz`))return await w(o,i,n,t,r);let s=await x(o,i,n,t,r);return i.pathname.endsWith(`.zip`)?await T(s,i,n,r):s})(),r||(a=a.catch(e=>{throw l.get(i)===a&&l.delete(i),e}),l.set(i,a)));let o=await a;return y(r),t?.set?.(1),Uint8Array.from(o)};async function D(e,t,n,r=d){y(n);let i=`${e}\0${r}`,a=n?void 0:c.get(i);if(a)return a;let o=(async()=>{let i=await E(e,t,r,n);y(n);let a=await v(WebAssembly.compile(i),n);return y(n),a})();return n||(o=o.catch(e=>{throw c.get(i)===o&&c.delete(i),e}),c.set(i,o)),o}function O(e,t){return WebAssembly.instantiate(e,t)}var k=class extends Error{code;constructor(e){super(`process exited with code ${e}.`),this.code=e}},A=class extends Error{constructor(e,t){super(`${e}.${t} not implemented.`)}},j=class extends Error{constructor(e=`abort`){super(e)}},ee=class extends Error{constructor(e){super(e)}};function te(e){if(!e)throw new ee(`assertion failed.`)}const ne=[`&&`,`||`,`==`,`!=`,`<=`,`>=`,`+`,`-`,`*`,`/`,`%`,`<`,`>`,`!`],re=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`array`,ie=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`object`,ae=(e,t)=>{let n=e[t];if(n!==`'`&&n!==`"`)throw Error(`expected quoted string`);let r=t+1,i=``;for(;r<e.length;){let t=e[r];if(!t)break;if(t===`\\`){let t=e[r+1];if(!t)throw Error(`unterminated string literal`);t===`n`?i+=`
`:t===`r`?i+=`\r`:t===`t`?i+=`	`:i+=t,r+=2;continue}if(t===n)return{value:i,next:r+1};i+=t,r+=1}throw Error(`unterminated string literal`)},oe=e=>{let t=[];for(let n=0;n<e.length;){let r=e[n];if(!r)break;if(/\s/.test(r)){n+=1;continue}if(r===`(`||r===`)`){t.push({type:`paren`,value:r}),n+=1;continue}if(r===`[`||r===`]`){t.push({type:`bracket`,value:r}),n+=1;continue}if(r===`.`){t.push({type:`dot`}),n+=1;continue}let i=ne.find(t=>e.startsWith(t,n));if(i){t.push({type:`operator`,value:i}),n+=i.length;continue}if(r===`'`||r===`"`){let r=ae(e,n);t.push({type:`string`,value:r.value}),n=r.next;continue}let a=e.slice(n).match(/^\d+(?:\.\d+)?/);if(a?.[0]){t.push({type:`number`,value:a[0]}),n+=a[0].length;continue}let o=e.slice(n).match(/^[A-Za-z_]\w*/);if(o?.[0]){o[0]===`true`||o[0]===`false`||o[0]===`True`||o[0]===`False`?t.push({type:`boolean`,value:o[0]===`true`||o[0]===`True`}):o[0]===`null`||o[0]===`None`?t.push({type:`null`}):o[0]===`and`?t.push({type:`operator`,value:`&&`}):o[0]===`or`?t.push({type:`operator`,value:`||`}):o[0]===`not`?t.push({type:`operator`,value:`!`}):t.push({type:`identifier`,value:o[0]}),n+=o[0].length;continue}throw Error(`unsupported token near "${e.slice(n)}"`)}return t},M=(e,t=0)=>{let n=t;for(;/\s/.test(e[n]||``);)n+=1;let r=e[n];if(r===`[`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}let r=M(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}}if(r===`(`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}let r=M(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}}if(r===`{`){n+=1;let t={};for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`}`)return{value:t,next:n+1};if(e.startsWith(`...`,n))throw Error(`unavailable`);let r=``;if(e[n]===`'`||e[n]===`"`){let t=ae(e,n);r=t.value,n=t.next}else{let t=e.slice(n).match(/^[A-Za-z_]\w*/)?.[0];if(!t)throw Error(`unsupported object preview`);r=t,n+=t.length}for(;/\s/.test(e[n]||``);)n+=1;if(e[n]!==`:`)throw Error(`unsupported object preview`);n+=1;let i=M(e,n);for(t[r]=i.value,n=i.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`}`)return{value:t,next:n+1};throw Error(`unsupported object preview`)}}if(r===`'`||r===`"`)return ae(e,n);if(e.startsWith(`true`,n))return{value:!0,next:n+4};if(e.startsWith(`false`,n))return{value:!1,next:n+5};if(e.startsWith(`True`,n))return{value:!0,next:n+4};if(e.startsWith(`False`,n))return{value:!1,next:n+5};if(e.startsWith(`null`,n)||e.startsWith(`None`,n))return{value:null,next:n+4};let i=e.slice(n).match(/^-?\d+(?:\.\d+)?/);if(i?.[0])return{value:Number(i[0]),next:n+i[0].length};throw Error(`unsupported preview`)},se=e=>{let t=e.trim();if(!t||t===`?`)throw Error(`unavailable`);if(t===`true`||t===`false`||t===`True`||t===`False`)return t===`true`||t===`True`;if(t===`null`||t===`None`)return null;let n=Number(t);if(!Number.isNaN(n))return n;if(t.startsWith(`[`)||t.startsWith(`(`)||t.startsWith(`{`)||t.startsWith(`'`)||t.startsWith(`"`)){let e=M(t);if(t.slice(e.next).trim())throw Error(`unsupported preview`);return e.value}throw Error(`unsupported preview`)},ce=e=>`'${e.replaceAll(`\\`,`\\\\`).replaceAll(`'`,`\\'`).replaceAll(`
`,`\\n`).replaceAll(`\r`,`\\r`).replaceAll(`	`,`\\t`)}'`,N=(e,t,n)=>{if(e===null)return`null`;if(typeof e==`number`||typeof e==`boolean`)return`${e}`;if(typeof e==`string`)return t?ce(e):e;if(n>=4)return`...`;if(Array.isArray(e)){let t=Math.min(e.length,8);return`[${e.slice(0,t).map(e=>N(e,!0,n+1)).join(`, `)}${e.truncated||e.length>t?`, ...`:``}]`}if(re(e)){let t=e.keys?.()||[],r=Math.min(t.length||e.length||0,8),i=[];for(let a=0;a<r;a+=1){let r=t[a]??a;i.push(N(e.get(r),!0,n+1))}let a=e.truncated||e.length!=null&&e.length>r;return`[${i.join(`, `)}${a?`, ...`:``}]`}if(ie(e)){let t=e.keys?.()||[],r=Math.min(t.length,8);return`{${t.slice(0,r).map(t=>`${t}: ${N(e.get(t),!0,n+1)}`).join(`, `)}${t.length>r?`, ...`:``}}`}let r=Object.keys(e),i=Math.min(r.length,8);return`{${r.slice(0,i).map(t=>`${t}: ${N(e[t],!0,n+1)}`).join(`, `)}${r.length>i?`, ...`:``}}`},le=e=>N(e,!1,0),ue=(e,t)=>{let n=e.trim();if(!n)throw Error(`empty expression`);let r=oe(n),i=new Map,a=e=>{if(i.has(e))return i.get(e);let n=t(e);return i.set(e,n),n},o=(e,t)=>{if(!Number.isInteger(t))throw Error(`unsupported index access`);if(Array.isArray(e)){if(t<0||t>=e.length)throw Error(`unavailable`);return e[t]}if(re(e)){if(e.length!=null&&(t<0||t>=e.length))throw Error(`unavailable`);return e.get(t)}throw Error(`unsupported index access`)},s=(e,t)=>{if(Array.isArray(e)||re(e)||!e)throw Error(`unsupported member access`);if(ie(e)){if(!e.has(t))throw Error(`unavailable`);return e.get(t)}if(typeof e!=`object`||!Object.hasOwn(e,t))throw Error(`unavailable`);return e[t]},c=0,l=!0,u=e=>{let t=l;l=!1;try{return e()}finally{l=t}},d=()=>{let e=r[c];if(!e)throw Error(`unexpected end of expression`);if(e.type===`number`)return c+=1,Number(e.value);if(e.type===`boolean`)return c+=1,e.value;if(e.type===`null`)return c+=1,null;if(e.type===`string`)return c+=1,e.value;if(e.type===`identifier`){c+=1;let t=l?a(e.value):null;for(;;){let e=r[c];if(e?.type===`bracket`&&e.value===`[`){c+=1;let e=Number(v()),n=r[c];if(!n||n.type!==`bracket`||n.value!==`]`)throw Error(`missing closing bracket`);c+=1,t=l?o(t,e):null;continue}if(e?.type===`dot`){c+=1;let e=r[c];if(!e||e.type!==`identifier`)throw Error(`missing property name`);c+=1,t=l?s(t,e.value):null;continue}break}return t}if(e.type===`paren`&&e.value===`(`){c+=1;let e=v(),t=r[c];if(!t||t.type!==`paren`||t.value!==`)`)throw Error(`missing closing parenthesis`);return c+=1,e}throw Error(`expected value`)},f=()=>{let e=r[c];return e?.type===`operator`&&e.value===`!`?(c+=1,!f()):e?.type===`operator`&&e.value===`-`?(c+=1,-Number(f())):e?.type===`operator`&&e.value===`+`?(c+=1,Number(f())):d()},p=()=>{let e=f();for(;;){let t=r[c];if(t?.type!==`operator`||![`*`,`/`,`%`].includes(t.value))return e;c+=1;let n=f();t.value===`*`&&(e=Number(e)*Number(n)),t.value===`/`&&(e=Number(e)/Number(n)),t.value===`%`&&(e=Number(e)%Number(n))}},m=()=>{let e=p();for(;;){let t=r[c];if(t?.type!==`operator`||![`+`,`-`].includes(t.value))return e;c+=1;let n=p();t.value===`+`&&(e=typeof e==`string`||typeof n==`string`?`${e??`null`}${n??`null`}`:Number(e)+Number(n)),t.value===`-`&&(e=Number(e)-Number(n))}},h=()=>{let e=m();for(;;){let t=r[c];if(t?.type!==`operator`||![`<`,`<=`,`>`,`>=`].includes(t.value))return e;c+=1;let n=m(),i=typeof e==`string`&&typeof n==`string`?e:Number(e),a=typeof e==`string`&&typeof n==`string`?n:Number(n);t.value===`<`&&(e=i<a),t.value===`<=`&&(e=i<=a),t.value===`>`&&(e=i>a),t.value===`>=`&&(e=i>=a)}},g=()=>{let e=h();for(;;){let t=r[c];if(t?.type!==`operator`||![`==`,`!=`].includes(t.value))return e;c+=1;let n=h();t.value===`==`&&(e=e===n),t.value===`!=`&&(e=e!==n)}},_=()=>{let e=g();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`&&`)break;c+=1;let n=l&&e?g():u(g);l&&(e=!!e&&!!n)}return e},v=()=>{let e=_();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`||`)break;c+=1;let n=l&&!e?_():u(_);l&&(e=!!e||!!n)}return e},y=v();if(c!==r.length)throw Error(`unexpected trailing tokens`);return le(y)},de=Int32Array.BYTES_PER_ELEMENT*2,P=new TextEncoder,fe=new TextDecoder,pe=e=>e instanceof Int32Array?e:new Int32Array(e),me=e=>new Uint8Array(e.buffer,e.byteOffset+de,e.byteLength-de),he=(e,t)=>{let n=P.encode(e);if(n.length<=t)return{bytes:n,rest:``};let r=0,i=e.length;for(;r<i;){let n=Math.ceil((r+i)/2);P.encode(e.slice(0,n)).length<=t?r=n:i=n-1}let a=e.slice(0,r);return{bytes:P.encode(a),rest:e.slice(r)}},ge=(e,t)=>{if(!e.length)return!1;let n=pe(t),r=me(n),{bytes:i,rest:a}=he(e[0]||``,r.length);return r.fill(0),r.set(i),Atomics.store(n,1,i.length),Atomics.add(n,0,1),Atomics.notify(n,0),a?e[0]=a:e.shift(),!0},_e=e=>{let t=pe(e),n=Atomics.load(t,1);if(n===-1)return null;let r=me(t);return fe.decode(r.slice(0,n))};var ve=class{ready;mem=null;memfs;instance=null;exports;trace=()=>{};debugSession;useJsReadOverlay=!1;useJsSourceReadOverlay=!1;argv;environ;handles=new Map;nextHandle=1024;syntheticFileHandles=new Set;nextSyntheticInode=1;syntheticInodes=new Map;readFileHandles=new Map;writeFileHandles=new Map;constructor(e,t,n,...i){let a=i.at(-1),o=a&&typeof a==`object`?i.pop():{};this.argv=[n,...i],this.environ={USER:`wasm-clang`},this.memfs=t,this.useJsReadOverlay=n===`wasm-ld`||n===`ld.lld`||n===`lld`,this.useJsSourceReadOverlay=n===`clang`||n===`clang++`||n===`cobc`;let c=r(this,`__wasm_idle_debug_enter`,`__wasm_idle_debug_leave`,`__wasm_idle_debug_line`,`__wasm_idle_debug_value_num`,`__wasm_idle_debug_value_bool`,`__wasm_idle_debug_value_addr`,`__wasm_idle_debug_value_text`),l={...r(this,`proc_exit`,`environ_sizes_get`,`environ_get`,`args_sizes_get`,`args_get`,`random_get`,`clock_time_get`,`poll_oneoff`,`fd_filestat_set_times`,`path_filestat_set_times`,`sock_accept`,`sock_recv`,`sock_send`,`sock_shutdown`,`path_link`,`path_rename`),...this.memfs.exports,...r(this,`path_open`,`path_filestat_get`,`path_readlink`,`path_unlink_file`,`fd_fdstat_get`,`fd_fdstat_set_flags`,`fd_filestat_get`,`fd_filestat_set_size`,`fd_datasync`,`fd_read`,`fd_pread`,`fd_seek`,`fd_tell`,`fd_write`,`fd_close`)},u=o.extraImports?.env||{};this.ready=O(e,{...o.extraImports,wasi_unstable:l,wasi_snapshot_preview1:l,env:{...u,...c}}).then(e=>{this.instance=e,o.instanceRef&&(o.instanceRef.current=e),this.exports=this.instance.exports,this.mem=new s(this.exports.memory),this.memfs.hostMem=this.mem})}async run(){await this.ready,this.trace(`start(argv=${JSON.stringify(this.argv)}, exports=${JSON.stringify(Object.keys(this.exports||{}))})`);try{this.exports._start()}catch(e){let t=!0;if(e instanceof k){if(this.trace(`proc_exit(code=${e.code})`),e.code===789514)return this.trace(`allow_rAF_after_exit`),!0;if(this.trace(`disallow_rAF_after_exit(code=${e.code})`),e.code==0)return!1;t=!1}e instanceof A&&this.trace(`not_implemented(${e.message})`);let n=`\x1b[91mError: ${e.message}`;throw t&&(n+=`\n${e.stack}`),n+=`\x1B[0m
`,this.memfs.stdout(n),e}this.trace(`start() returned without proc_exit`)}proc_exit(e){throw this.trace(`proc_exit_throw(code=${e})`),new k(e)}toNumber(e){return typeof e==`bigint`?Number(e):e}writeU32(e,t){this.mem.view.setUint32(e,t>>>0,!0)}writeU64(e,t){let n=BigInt(t);this.mem.view.setUint32(e,Number(n&4294967295n),!0),this.mem.view.setUint32(e+4,Number(n>>32n&4294967295n),!0)}readMemfsFile(e){let t=[e,e.replace(/^\/+/,``),e.replace(/^\.\//,``),e.replace(/^\/+/,``).replace(/^\.\//,``)];for(let e of t)if(this.memfs.hasFile(e))try{return Uint8Array.from(this.memfs.getFileContents(e))}catch{}return null}shouldUseJsReadForPath(e){return this.useJsReadOverlay?!0:this.useJsSourceReadOverlay}syntheticInodeForPath(e){let t=e.replace(/^\/+/,``).replace(/^\.\//,``)||e,n=this.syntheticInodes.get(t);return n||(n=this.nextSyntheticInode++,this.syntheticInodes.set(t,n)),n}copyFileToIovs(e,t,n,r,i){this.mem.check();let a=0;for(let i=0;i<r;i+=1){let r=this.mem.read32(n);n+=4;let i=this.mem.read32(n);if(n+=4,i<=0)continue;let o=Math.max(0,e.length-t),s=Math.min(i,o);if(s>0&&(this.mem.write(r,e.subarray(t,t+s)),t+=s,a+=s),s<i)break}return this.writeU32(i,a),{copied:a,position:t}}writeRegularFileStat(e,t,n){this.mem.check(),this.writeU64(e,1),this.writeU64(e+8,this.syntheticInodeForPath(n)),this.mem.write8(e+16,4),this.writeU64(e+24,1),this.writeU64(e+32,t),this.writeU64(e+40,0),this.writeU64(e+48,0),this.writeU64(e+56,0)}seekPosition(e,t,n,r){let i=this.toNumber(n);return r===0?Math.max(0,i):r===1?Math.max(0,e+i):r===2?Math.max(0,t+i):null}ensureWriteCapacity(e,t){if(e.contents.length>=t)return;let n=Math.max(1024,e.contents.length);for(;n<t;)n*=2;let r=new Uint8Array(n);r.set(e.contents.subarray(0,e.size)),e.contents=r}atomicOutputTarget(e){let t=e.match(/^(.+)-[0-9a-f]+(\.[^.]+)\.tmp$/);return t?`${t[1]}${t[2]}`:null}storeFileContents(e,t){if(this.useJsReadOverlay||this.useJsSourceReadOverlay){this.memfs.setFile(e,t);return}this.memfs.addFile(e,t)}path_open(e,t,n,r,i,a,o,s,c){this.mem.check();let l=this.mem.readStr(n,r),u=this.toNumber(a),d=(u&64)!=0||(i&9)!=0;this.trace(`path_open_request(path=${JSON.stringify(l)}, rights=${u}, oflags=${i}, write=${d})`);let f=!d&&this.shouldUseJsReadForPath(l)&&u&2?this.readMemfsFile(l):null;if(!d&&this.shouldUseJsReadForPath(l)&&u&2&&!f)return this.trace(`path_open_read_missing(path=${JSON.stringify(l)})`),44;let p=0,m;if(this.useJsReadOverlay&&(d||f))m=this.nextHandle++,this.syntheticFileHandles.add(m),this.writeU32(c,m),this.trace(`path_open_overlay(fd=${m}, path=${JSON.stringify(l)})`);else{if(p=this.memfs.exports.path_open(e,t,n,r,i,a,o,s,c),p!==0)return p;m=this.mem.read32(c)}if(d){let e=i&8?null:this.readMemfsFile(l),t=e?Uint8Array.from(e):new Uint8Array;return this.writeFileHandles.set(m,{path:l,contents:t,position:0,size:t.length}),this.readFileHandles.delete(m),this.trace(`path_open_write(fd=${m}, path=${JSON.stringify(l)}, size=${t.length})`),p}if(!this.shouldUseJsReadForPath(l)||!(u&2))return p;let h=f||this.readMemfsFile(l);return h?(this.readFileHandles.set(m,{path:l,contents:h,position:0}),this.trace(`path_open_read(fd=${m}, path=${JSON.stringify(l)}, size=${h.length})`),p):p}path_filestat_get(e,t,n,r,i){this.mem.check();let a=this.mem.readStr(n,r);if(!this.shouldUseJsReadForPath(a))return this.memfs.exports.path_filestat_get(e,t,n,r,i);let o=this.readMemfsFile(a);return o?(this.writeRegularFileStat(i,o.length,a),this.trace(`path_filestat_get(path=${JSON.stringify(a)}, size=${o.length})`),0):this.memfs.exports.path_filestat_get(e,t,n,r,i)}fd_fdstat_get(e,t){let n=this.readFileHandles.get(e)||this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_fdstat_get(e,t);let r=this.writeFileHandles.has(e)?6291572:2097190;return this.mem.check(),this.mem.write8(t,4),this.mem.write8(t+1,0),this.mem.write8(t+2,0),this.mem.write8(t+3,0),this.writeU64(t+8,r),this.writeU64(t+16,0),this.trace(`fd_fdstat_get(fd=${e}, path=${JSON.stringify(n.path)})`),0}fd_filestat_get(e,t){let n=this.writeFileHandles.get(e),r=this.readFileHandles.get(e),i=n||r;if(!i)return this.memfs.exports.fd_filestat_get(e,t);let a=n?n.size:r?.contents.length||0;return this.writeRegularFileStat(t,a,i.path),this.trace(`fd_filestat_get(fd=${e}, path=${JSON.stringify(i.path)}, size=${a})`),0}fd_filestat_set_size(e,t){let n=this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_filestat_set_size(e,t);let r=this.toNumber(t);return this.ensureWriteCapacity(n,r),r>n.size&&n.contents.fill(0,n.size,r),n.size=r,n.position>r&&(n.position=r),this.trace(`fd_filestat_set_size(fd=${e}, size=${r})`),0}fd_read(e,t,n,r){let i=this.readFileHandles.get(e);if(!i)return this.memfs.exports.fd_read(e,t,n,r);let a=this.copyFileToIovs(i.contents,i.position,t,n,r);return i.position=a.position,this.trace(`fd_read(fd=${e}, bytes=${a.copied})`),0}fd_pread(e,t,n,r,i){let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_pread(e,t,n,r,i);let o=this.copyFileToIovs(a.contents,this.toNumber(r),t,n,i);return this.trace(`fd_pread(fd=${e}, offset=${this.toNumber(r)}, bytes=${o.copied})`),0}fd_seek(e,t,n,r){let i=this.writeFileHandles.get(e);if(i){let a=this.seekPosition(i.position,i.size,t,n);return a==null?this.memfs.exports.fd_seek(e,t,n,r):(i.position=a,this.mem.check(),this.writeU64(r,i.position),this.trace(`fd_seek_write(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_seek(e,t,n,r);let o=this.seekPosition(a.position,a.contents.length,t,n);return o==null?this.memfs.exports.fd_seek(e,t,n,r):(a.position=o,this.mem.check(),this.writeU64(r,a.position),this.trace(`fd_seek(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}fd_tell(e,t){let n=this.writeFileHandles.get(e)?.position??this.readFileHandles.get(e)?.position;if(n==null){let n=this.memfs.exports.fd_tell;return typeof n==`function`?n(e,t):44}return this.mem.check(),this.writeU64(t,n),this.trace(`fd_tell(fd=${e}, offset=${n})`),0}fd_datasync(e){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let t=this.memfs.exports.fd_datasync;return typeof t==`function`?t(e):0}fd_fdstat_set_flags(e,t){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let n=this.memfs.exports.fd_fdstat_set_flags;return typeof n==`function`?n(e,t):0}path_readlink(e,t,n,r,i,a){return this.mem.check(),this.writeU32(a,0),this.trace(`path_readlink(path=${JSON.stringify(this.mem.readStr(t,n))})`),44}path_unlink_file(e,t,n){this.mem.check();let r=this.mem.readStr(t,n);return this.trace(`path_unlink_file(path=${JSON.stringify(r)})`),0}fd_write(e,t,n,r){let i=this.writeFileHandles.get(e);if(!i)return this.memfs.exports.fd_write(e,t,n,r);this.mem.check();let a=0;for(let e=0;e<n;e+=1){let e=this.mem.read32(t);t+=4;let n=this.mem.read32(t);t+=4,!(n<=0)&&(this.ensureWriteCapacity(i,i.position+n),i.contents.set(new Uint8Array(this.mem.buffer,e,n),i.position),i.position+=n,i.size=Math.max(i.size,i.position),a+=n)}return this.writeU32(r,a),this.trace(`fd_write(fd=${e}, bytes=${a})`),0}fd_close(e){let t=this.syntheticFileHandles.delete(e);if(this.readFileHandles.has(e)){this.readFileHandles.delete(e);let n=t?0:this.memfs.exports.fd_close(e);return this.trace(`fd_close_read(fd=${e}, close=${n})`),n}let n=this.writeFileHandles.get(e);if(n){this.writeFileHandles.delete(e);let r=t?0:this.memfs.exports.fd_close(e),i=n.contents.subarray(0,n.size);this.storeFileContents(n.path,i);let a=this.atomicOutputTarget(n.path);return a&&this.storeFileContents(a,i),this.trace(`fd_close_write(fd=${e}, path=${JSON.stringify(n.path)}, size=${n.size}, close=${r}, target=${JSON.stringify(a)})`),0}return t?0:this.memfs.exports.fd_close(e)}debugEvaluate(e){let t=this.debugSession;if(!t)throw Error(`unavailable`);let n=[...t.frames].reverse().find(e=>e.functionId===t.currentFunctionId),r=t.currentLine,i=[...t.variableMetadata[t.currentFunctionId]||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine),a=[...t.globalVariableMetadata||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine);return ue(e,e=>{let r=(e,t)=>{let n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[],r=Number(t);if(!Number.isFinite(r)||r<=0||!n.length||!e.elementKind&&!e.structFields?.length)throw Error(`unavailable`);this.mem?.check?.();let i=e.structFields?.length&&e.structSize?e.structSize:e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4,a=(e,t)=>{if(e===`bool`)return!!this.mem.read8(t);if(e===`char`){let e=this.mem.read8(t);return e>=32&&e<=126?String.fromCharCode(e):e}return e===`float`?this.mem.readFloat32(t):e===`double`?this.mem.readFloat64(t):this.mem.readInt32(t)},o=t=>({__debugExpressionKind:`object`,has:t=>!!e.structFields?.some(e=>e.name===t),get:n=>{let r=e.structFields?.find(e=>e.name===n);if(!r)throw Error(`unavailable`);return a(r.kind,t+r.offset)},keys:()=>e.structFields?.map(e=>e.name)||[]}),s=(t,n)=>({__debugExpressionKind:`array`,length:n[0],truncated:n[0]>8,get:r=>{if(!Number.isInteger(r)||r<0||r>=n[0])throw Error(`unavailable`);if(n.length>1)return s(t+r*(n.slice(1).reduce((e,t)=>e*t,1)*i),n.slice(1));if(e.structFields?.length&&e.structSize)return o(t+r*e.structSize);if(!e.elementKind)throw Error(`unavailable`);return a(e.elementKind,t+r*i)},keys:()=>Array.from({length:Math.min(n[0],8)},(e,t)=>t)});return s(r,n)},o=(e,t)=>{if(t==null||t===`?`)throw Error(`unavailable`);return e.kind===`array`?r(e,t):se(t)},s=i.find(t=>t.name===e);if(s)return o(s,n?.values.get(s.slot));let c=a.find(t=>t.name===e);if(c)return o(c,t.globalValues.get(c.slot));throw Error(`unavailable`)})}pauseDebugSession(e,t,n,r){let i=e.buffer;if(!i)return 0;e.currentFunctionId=t,e.currentLine=n;let a=[...e.frames].reverse().find(e=>e.functionId===t);a&&(a.line=n),e.pauseOnEntry=!1,e.stepArmed=!1,e.nextLineArmed=!1,e.nextLineDepth=0,e.stepOutArmed=!1,this.trace(`pause(function=${t}, line=${n}, reason=${r})`);let o=e.variableMetadata[t]?.flatMap(e=>{if(n<e.fromLine||n>e.toLine)return[];if(e.kind===`array`){this.mem?.check?.();let t=Number(a?.values.get(e.slot)??NaN),n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[];if(!Number.isFinite(t)||t<=0||!n.length||!e.elementKind&&!e.structFields?.length)return[{name:e.name,value:`?`}];if(e.structFields?.length&&e.structSize){let r=Math.min(n[0],8),i=[];for(let n=0;n<r;n+=1){let r=[];for(let i of e.structFields){let a=t+n*e.structSize+i.offset;if(i.kind===`bool`){r.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let e=this.mem.read8(a);r.push(`${i.name}: ${e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`}`);continue}if(i.kind===`float`){r.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){r.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}r.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${r.join(`, `)}}`)}return[{name:e.name,value:`[${i.join(`, `)}${n[0]>r?`, ...`:``}]`}]}if(!e.elementKind)return[{name:e.name,value:`?`}];let r=e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4;if(n.length===2){let i=Math.min(n[0],4),a=Math.min(n[1],8),o=[];for(let s=0;s<i;s+=1){let i=[];for(let o=0;o<a;o+=1){let a=t+(s*n[1]+o)*r;if(e.elementKind===`bool`){i.push(this.mem.read8(a)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(a);i.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){i.push(`${this.mem.readFloat32(a)}`);continue}if(e.elementKind===`double`){i.push(`${this.mem.readFloat64(a)}`);continue}i.push(`${this.mem.readInt32(a)}`)}o.push(`[${i.join(`, `)}${n[1]>a?`, ...`:``}]`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let i=Math.min(n[0],8),o=[];for(let n=0;n<i;n+=1){let i=t+n*r;if(e.elementKind===`bool`){o.push(this.mem.read8(i)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(i);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){o.push(`${this.mem.readFloat32(i)}`);continue}if(e.elementKind===`double`){o.push(`${this.mem.readFloat64(i)}`);continue}o.push(`${this.mem.readInt32(i)}`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let t=a?.values.get(e.slot)??`?`;return[{name:e.name,value:t}]})||[],s=new Set(o.map(e=>e.name)),c=(e.globalVariableMetadata||[]).flatMap(t=>{if(s.has(t.name)||n<t.fromLine||n>t.toLine)return[];if(t.kind===`array`){this.mem?.check?.();let n=Number(e.globalValues?.get(t.slot)??NaN),r=t.dimensions?.length?t.dimensions:t.length?[t.length]:[];if(!Number.isFinite(n)||n<=0||!r.length||!t.elementKind&&!t.structFields?.length)return[{name:t.name,value:`?`}];if(t.structFields?.length&&t.structSize){let e=Math.min(r[0],8),i=[];for(let r=0;r<e;r+=1){let e=[];for(let i of t.structFields){let a=n+r*t.structSize+i.offset;if(i.kind===`bool`){e.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let t=this.mem.read8(a);e.push(`${i.name}: ${t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`}`);continue}if(i.kind===`float`){e.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){e.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}e.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${e.join(`, `)}}`)}return[{name:t.name,value:`[${i.join(`, `)}${r[0]>e?`, ...`:``}]`}]}if(!t.elementKind)return[{name:t.name,value:`?`}];let i=t.elementKind===`double`?8:t.elementKind===`bool`||t.elementKind===`char`?1:4;if(r.length===2){let e=Math.min(r[0],4),a=Math.min(r[1],8),o=[];for(let s=0;s<e;s+=1){let e=[];for(let o=0;o<a;o+=1){let a=n+(s*r[1]+o)*i;if(t.elementKind===`bool`){e.push(this.mem.read8(a)?`true`:`false`);continue}if(t.elementKind===`char`){let t=this.mem.read8(a);e.push(t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`);continue}if(t.elementKind===`float`){e.push(`${this.mem.readFloat32(a)}`);continue}if(t.elementKind===`double`){e.push(`${this.mem.readFloat64(a)}`);continue}e.push(`${this.mem.readInt32(a)}`)}o.push(`[${e.join(`, `)}${r[1]>a?`, ...`:``}]`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>e?`, ...`:``}]`}]}let a=Math.min(r[0],8),o=[];for(let e=0;e<a;e+=1){let r=n+e*i;if(t.elementKind===`bool`){o.push(this.mem.read8(r)?`true`:`false`);continue}if(t.elementKind===`char`){let e=this.mem.read8(r);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(t.elementKind===`float`){o.push(`${this.mem.readFloat32(r)}`);continue}if(t.elementKind===`double`){o.push(`${this.mem.readFloat64(r)}`);continue}o.push(`${this.mem.readInt32(r)}`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>a?`, ...`:``}]`}]}let r=e.globalValues?.get(t.slot)??`?`;return[{name:t.name,value:r}]})||[],l=new Map(o.map(e=>[e.name,e])),u=new Map(c.map(e=>[e.name,e]));for(let e of l.keys())u.delete(e);e.onPause?.({type:`pause`,line:n,reason:r,locals:[...l.values(),...u.values()],callStack:[...e.frames].reverse().map(e=>({functionName:e.functionName,line:e.line}))});let d=Atomics.load(i,0);for(;;){if(e.interruptBuffer?.[0]===2||(Atomics.wait(i,0,d,100),e.interruptBuffer?.[0]===2))throw new j;let t=Atomics.exchange(i,1,0);if(t===1)return e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===2)return e.stepArmed=!0,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===3)return e.nextLineArmed=!0,e.nextLineFunctionId=e.currentFunctionId,e.nextLineLine=e.currentLine,e.nextLineDepth=e.callDepth,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===4)return e.stepOutArmed=!0,e.stepOutDepth=Math.max(0,e.callDepth-1),e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===5){let t=e.watchBuffer?_e(e.watchBuffer):``,n=`?`;try{n=t?this.debugEvaluate(t):`?`}catch(e){n=e instanceof Error&&e.message===`unavailable`?`?`:`error`}e.watchResultBuffer&&ge([n],e.watchResultBuffer)}}}__wasm_idle_debug_enter(e,t){let n=this.debugSession;return n?.buffer?(n.callDepth+=1,n.currentFunctionId=e,n.currentLine=t,n.frames.push({functionId:e,functionName:n.functionMetadata[e]||`fn_${e}`,line:t,values:new Map}),this.trace(`enter(function=${e}, line=${t}, depth=${n.callDepth})`),n.pauseOnEntry?this.pauseDebugSession(n,e,t,`entry`):n.stepArmed?this.pauseDebugSession(n,e,t,`step`):0):0}__wasm_idle_debug_leave(e){let t=this.debugSession;if(!t?.buffer)return 0;this.trace(`leave(function=${e}, depth=${t.callDepth})`),t.nextLineArmed&&e===t.nextLineFunctionId&&t.callDepth<=(t.nextLineDepth??t.callDepth)&&(t.nextLineArmed=!1,t.nextLineDepth=0,t.stepArmed=!0),t.callDepth=Math.max(0,t.callDepth-1),t.currentFunctionId===e&&(t.currentFunctionId=0);for(let n=t.frames.length-1;n>=0;--n)if(t.frames[n]?.functionId===e){t.frames.splice(n,1);break}return 0}__wasm_idle_debug_value_num(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,Number.isInteger(n)?String(n):`${n}`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,Number.isInteger(n)?String(n):`${n}`);break}}return 0}__wasm_idle_debug_value_bool(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,n?`true`:`false`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,n?`true`:`false`);break}}return 0}__wasm_idle_debug_value_addr(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,String(n>>>0)),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,String(n>>>0));break}}return 0}__wasm_idle_debug_value_text(e,t,n,r){let i=this.debugSession;if(!i?.buffer)return 0;this.mem?.check?.();let a=this.mem?.readStr?this.mem.readStr(n,r):`?`;if(e===0)return i.globalValues.set(t,a),0;for(let n=i.frames.length-1;n>=0;--n){let r=i.frames[n];if(r?.functionId===e){r.values.set(t,a);break}}return 0}__wasm_idle_debug_line(e,t){let n=this.debugSession;if(!n?.buffer)return 0;let r=Atomics.load(n.buffer,2);if(r!==n.breakpointVersion){let e=Math.max(0,Atomics.load(n.buffer,3)),t=new Set;for(let r=0;r<e&&r+4<n.buffer.length;r+=1){let e=Atomics.load(n.buffer,r+4);e>0&&t.add(e)}n.breakpoints=t,n.breakpointVersion=r}if(n.resumeSkipActive){if(e===n.resumeSkipFunctionId&&t===n.resumeSkipLine)return 0;n.resumeSkipActive=!1,n.resumeSkipFunctionId=0,n.resumeSkipLine=0}let i=``;return n.pauseOnEntry?i=`entry`:n.breakpoints.has(t)?i=`breakpoint`:n.stepArmed?i=`step`:n.nextLineArmed&&n.callDepth<=(n.nextLineDepth??n.callDepth)&&e===n.nextLineFunctionId&&t!==n.nextLineLine?i=`nextLine`:n.stepOutArmed&&n.callDepth<=n.stepOutDepth&&(i=`stepOut`),i?this.pauseDebugSession(n,e,t,i):0}environ_sizes_get(e,t){this.mem.check();let n=0,r=Object.getOwnPropertyNames(this.environ);for(let e of r){let t=this.environ[e];n+=e.length+t.length+2}return this.mem.write32(e,r.length),this.mem.write32(t,n),this.trace(`environ_sizes_get(count=${r.length}, bytes=${n})`),0}environ_get(e,t){this.mem.check();let n=Object.getOwnPropertyNames(this.environ);this.trace(`environ_get(entries=${JSON.stringify(n)})`);for(let r of n)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,`${r}=${this.environ[r]}`);return 0}args_sizes_get(e,t){this.mem.check();let n=0;for(let e of this.argv)n+=e.length+1;return this.mem.write32(e,this.argv.length),this.mem.write32(t,n),this.trace(`args_sizes_get(count=${this.argv.length}, bytes=${n})`),0}args_get(e,t){this.mem.check(),this.trace(`args_get(argv=${JSON.stringify(this.argv)})`);for(let n of this.argv)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,n);return 0}random_get(e,t){let n=new Uint8Array(this.mem.buffer,e,t);for(let e=0;e<t;++e)n[e]=Math.random()*256|0}clock_time_get(e,t,n){this.mem.check();let r=e===1&&typeof performance<`u`?performance.now():Date.now(),i=BigInt(Math.floor(r*1e6));return this.mem.view.setBigUint64(n,i,!0),this.trace(`clock_time_get(clock=${e}, ns=${i})`),0}poll_oneoff(){throw new A(`wasi_unstable`,`poll_oneoff`)}fd_filestat_set_times(){return this.trace(`fd_filestat_set_times()`),0}path_filestat_set_times(){return this.trace(`path_filestat_set_times()`),0}sock_accept(){return this.trace(`sock_accept() unsupported`),58}sock_recv(){return this.trace(`sock_recv() unsupported`),58}sock_send(){return this.trace(`sock_send() unsupported`),58}sock_shutdown(){return this.trace(`sock_shutdown() unsupported`),58}path_link(e,t,n,r,i,a,o){this.mem.check();let s=this.mem.readStr(n,r).replace(/^\/+/,``),c=this.mem.readStr(a,o).replace(/^\/+/,``);return this.trace(`path_link(source=${JSON.stringify(s)}, target=${JSON.stringify(c)})`),this.storeFileContents(c,new Uint8Array(this.memfs.getFileContents(s))),0}path_rename(e,t,n,r,i,a){this.mem.check();let o=this.mem.readStr(t,n).replace(/^\/+/,``),s=this.mem.readStr(i,a).replace(/^\/+/,``);return this.trace(`path_rename(source=${JSON.stringify(o)}, target=${JSON.stringify(s)})`),this.storeFileContents(s,new Uint8Array(this.memfs.getFileContents(o))),0}};const ye=[`-fobjc-runtime=gnustep-2.0`,`-fblocks`];function be(e){return(e||``).trim().toUpperCase().replaceAll(/\s+/g,``)}function xe(e){switch(be(e)){case`03`:case`CPP03`:case`C++03`:case`GNU++03`:case`GNUC++03`:return`-std=gnu++03`;case`11`:case`CPP11`:case`C++11`:case`GNU++11`:case`GNUC++11`:return`-std=gnu++11`;case`14`:case`CPP14`:case`C++14`:case`GNU++14`:case`GNUC++14`:return`-std=gnu++14`;case`17`:case`CPP17`:case`C++17`:case`GNU++17`:case`GNUC++17`:return`-std=gnu++17`;case`20`:case`CPP20`:case`C++20`:case`GNU++20`:case`GNUC++20`:return`-std=gnu++20`;case`23`:case`CPP23`:case`C++23`:case`GNU++23`:case`GNUC++23`:return`-std=gnu++23`;case`26`:case`CPP26`:case`C++26`:case`GNU++26`:case`GNUC++26`:return`-std=gnu++26`;default:return`-std=gnu++20`}}function Se(e){switch(be(e)){case`99`:case`C99`:case`GNU99`:case`GNUC99`:return`-std=gnu99`;case`11`:case`C11`:case`GNU11`:case`GNUC11`:return`-std=gnu11`;case`17`:case`18`:case`C17`:case`C18`:case`GNU17`:case`GNU18`:case`GNUC17`:case`GNUC18`:return`-std=gnu17`;default:return`-std=gnu11`}}function Ce(e,t){return e===`C`?{languageArg:`c`,standardArg:Se(t.cVersion)}:e===`OBJC`?{languageArg:`objective-c`,standardArg:Se(t.cVersion)}:{languageArg:`c++`,standardArg:xe(t.cppVersion)}}function we(e,t=``,n){return[...[`CPP`,`OBJCXX`].includes(e)?[`${t}/include/c++/v1`,`${t}/include/wasm32-wasi/c++/v1`]:[],...n?[`${n.replace(/\/+$/,``)}/include`]:[],`${t}/include/wasm32-wasi`,`${t}/include`]}const Te=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP
#define WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP

#include <cstddef>

namespace __gnu_pbds {

struct null_type {};
struct rb_tree_tag {};
struct splay_tree_tag {};
struct ov_tree_tag {};

template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn, typename Allocator>
class null_node_update {
public:
	typedef Node_CItr node_const_iterator;
	typedef Node_Itr node_iterator;
	typedef Cmp_Fn cmp_fn;
	typedef Allocator allocator_type;
};

template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn, typename Allocator>
class tree_order_statistics_node_update {
public:
	typedef Node_CItr node_const_iterator;
	typedef Node_Itr node_iterator;
	typedef Cmp_Fn cmp_fn;
	typedef Allocator allocator_type;
};

} // namespace __gnu_pbds

#endif
`,Ee=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP
#define WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP

#include <algorithm>
#include <cstddef>
#include <functional>
#include <iterator>
#include <map>
#include <memory>
#include <set>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <ext/pb_ds/tree_policy.hpp>

namespace __gnu_pbds {

namespace detail {

template <typename Allocator, typename Value>
struct rebind_allocator {
	typedef typename std::allocator_traits<Allocator>::template rebind_alloc<Value> type;
};

template <typename Iterator>
Iterator advance_to_order(Iterator first, Iterator last, std::size_t order) {
	if (order >= static_cast<std::size_t>(std::distance(first, last))) return last;
	std::advance(
		first,
		static_cast<typename std::iterator_traits<Iterator>::difference_type>(order)
	);
	return first;
}

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn,
	typename Eq_Fn,
	typename Allocator
>
struct hash_table_selector {
	typedef std::pair<const Key, Mapped> value_type;
	typedef typename rebind_allocator<Allocator, value_type>::type allocator_type;
	typedef std::unordered_map<Key, Mapped, Hash_Fn, Eq_Fn, allocator_type> type;
};

template <typename Key, typename Hash_Fn, typename Eq_Fn, typename Allocator>
struct hash_table_selector<Key, null_type, Hash_Fn, Eq_Fn, Allocator> {
	typedef typename rebind_allocator<Allocator, Key>::type allocator_type;
	typedef std::unordered_set<Key, Hash_Fn, Eq_Fn, allocator_type> type;
};

} // namespace detail

template <
	typename Key,
	typename Mapped,
	typename Cmp_Fn = std::less<Key>,
	typename Tag = rb_tree_tag,
	template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn_, typename Allocator_>
	class Node_Update = null_node_update,
	typename Allocator = std::allocator<char>
>
class tree {
public:
	typedef Key key_type;
	typedef Mapped mapped_type;
	typedef std::pair<const Key, Mapped> value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;

private:
	typedef typename detail::rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::map<Key, Mapped, Cmp_Fn, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator iterator;
	typedef typename container_type::const_iterator const_iterator;
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;
	typedef typename container_type::reverse_iterator reverse_iterator;
	typedef typename container_type::const_reverse_iterator const_reverse_iterator;

	tree() = default;
	explicit tree(const Cmp_Fn& compare) : values_(compare) {}

	template <typename InputIt>
	tree(InputIt first, InputIt last) : values_(first, last) {}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	size_type max_size() const { return values_.max_size(); }

	iterator begin() { return values_.begin(); }
	const_iterator begin() const { return values_.begin(); }
	const_iterator cbegin() const { return values_.cbegin(); }
	iterator end() { return values_.end(); }
	const_iterator end() const { return values_.end(); }
	const_iterator cend() const { return values_.cend(); }
	reverse_iterator rbegin() { return values_.rbegin(); }
	const_reverse_iterator rbegin() const { return values_.rbegin(); }
	reverse_iterator rend() { return values_.rend(); }
	const_reverse_iterator rend() const { return values_.rend(); }

	std::pair<iterator, bool> insert(const value_type& value) { return values_.insert(value); }
	std::pair<iterator, bool> insert(value_type&& value) { return values_.insert(std::move(value)); }

	template <typename InputIt>
	void insert(InputIt first, InputIt last) {
		values_.insert(first, last);
	}

	mapped_type& operator[](const key_type& key) { return values_[key]; }
	mapped_type& at(const key_type& key) { return values_.at(key); }
	const mapped_type& at(const key_type& key) const { return values_.at(key); }

	iterator find(const key_type& key) { return values_.find(key); }
	const_iterator find(const key_type& key) const { return values_.find(key); }
	bool contains(const key_type& key) const { return values_.find(key) != values_.end(); }
	size_type count(const key_type& key) const { return values_.count(key); }

	iterator lower_bound(const key_type& key) { return values_.lower_bound(key); }
	const_iterator lower_bound(const key_type& key) const { return values_.lower_bound(key); }
	iterator upper_bound(const key_type& key) { return values_.upper_bound(key); }
	const_iterator upper_bound(const key_type& key) const { return values_.upper_bound(key); }

	size_type erase(const key_type& key) { return values_.erase(key); }
	iterator erase(const_iterator position) { return values_.erase(position); }
	iterator erase(const_iterator first, const_iterator last) { return values_.erase(first, last); }
	void clear() { values_.clear(); }
	void swap(tree& other) { values_.swap(other.values_); }

	iterator find_by_order(size_type order) {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	const_iterator find_by_order(size_type order) const {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	size_type order_of_key(const key_type& key) const {
		return static_cast<size_type>(std::distance(values_.begin(), values_.lower_bound(key)));
	}

	void join(tree& other) {
		values_.insert(other.values_.begin(), other.values_.end());
		other.values_.clear();
	}

	void split(const key_type& key, tree& other) {
		iterator first = values_.upper_bound(key);
		other.values_.insert(first, values_.end());
		values_.erase(first, values_.end());
	}

private:
	container_type values_;
};

template <
	typename Key,
	typename Cmp_Fn,
	typename Tag,
	template <typename Node_CItr, typename Node_Itr, typename Cmp_Fn_, typename Allocator_>
	class Node_Update,
	typename Allocator
>
class tree<Key, null_type, Cmp_Fn, Tag, Node_Update, Allocator> {
public:
	typedef Key key_type;
	typedef null_type mapped_type;
	typedef Key value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;

private:
	typedef typename detail::rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::set<Key, Cmp_Fn, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator iterator;
	typedef typename container_type::const_iterator const_iterator;
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;
	typedef typename container_type::reverse_iterator reverse_iterator;
	typedef typename container_type::const_reverse_iterator const_reverse_iterator;

	tree() = default;
	explicit tree(const Cmp_Fn& compare) : values_(compare) {}

	template <typename InputIt>
	tree(InputIt first, InputIt last) : values_(first, last) {}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	size_type max_size() const { return values_.max_size(); }

	iterator begin() { return values_.begin(); }
	const_iterator begin() const { return values_.begin(); }
	const_iterator cbegin() const { return values_.cbegin(); }
	iterator end() { return values_.end(); }
	const_iterator end() const { return values_.end(); }
	const_iterator cend() const { return values_.cend(); }
	reverse_iterator rbegin() { return values_.rbegin(); }
	const_reverse_iterator rbegin() const { return values_.rbegin(); }
	reverse_iterator rend() { return values_.rend(); }
	const_reverse_iterator rend() const { return values_.rend(); }

	std::pair<iterator, bool> insert(const value_type& value) { return values_.insert(value); }
	std::pair<iterator, bool> insert(value_type&& value) { return values_.insert(std::move(value)); }

	template <typename InputIt>
	void insert(InputIt first, InputIt last) {
		values_.insert(first, last);
	}

	iterator find(const key_type& key) { return values_.find(key); }
	const_iterator find(const key_type& key) const { return values_.find(key); }
	bool contains(const key_type& key) const { return values_.find(key) != values_.end(); }
	size_type count(const key_type& key) const { return values_.count(key); }

	iterator lower_bound(const key_type& key) { return values_.lower_bound(key); }
	const_iterator lower_bound(const key_type& key) const { return values_.lower_bound(key); }
	iterator upper_bound(const key_type& key) { return values_.upper_bound(key); }
	const_iterator upper_bound(const key_type& key) const { return values_.upper_bound(key); }

	size_type erase(const key_type& key) { return values_.erase(key); }
	iterator erase(const_iterator position) { return values_.erase(position); }
	iterator erase(const_iterator first, const_iterator last) { return values_.erase(first, last); }
	void clear() { values_.clear(); }
	void swap(tree& other) { values_.swap(other.values_); }

	iterator find_by_order(size_type order) {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	const_iterator find_by_order(size_type order) const {
		return detail::advance_to_order(values_.begin(), values_.end(), order);
	}

	size_type order_of_key(const key_type& key) const {
		return static_cast<size_type>(std::distance(values_.begin(), values_.lower_bound(key)));
	}

	void join(tree& other) {
		values_.insert(other.values_.begin(), other.values_.end());
		other.values_.clear();
	}

	void split(const key_type& key, tree& other) {
		iterator first = values_.upper_bound(key);
		other.values_.insert(first, values_.end());
		values_.erase(first, values_.end());
	}

private:
	container_type values_;
};

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn = std::hash<Key>,
	typename Eq_Fn = std::equal_to<Key>,
	typename Comb_Hash_Fn = void,
	typename Resize_Policy = void,
	bool Store_Hash = false,
	typename Allocator = std::allocator<char>
>
using gp_hash_table = typename detail::hash_table_selector<
	Key,
	Mapped,
	Hash_Fn,
	Eq_Fn,
	Allocator
>::type;

template <
	typename Key,
	typename Mapped,
	typename Hash_Fn = std::hash<Key>,
	typename Eq_Fn = std::equal_to<Key>,
	typename Comb_Hash_Fn = void,
	typename Resize_Policy = void,
	bool Store_Hash = false,
	typename Allocator = std::allocator<char>
>
using cc_hash_table = typename detail::hash_table_selector<
	Key,
	Mapped,
	Hash_Fn,
	Eq_Fn,
	Allocator
>::type;

} // namespace __gnu_pbds

#endif
`,De=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP
#define WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP

#include <cstddef>

namespace __gnu_pbds {

template <typename Size_Type = std::size_t>
class direct_mask_range_hashing {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class direct_mod_range_hashing {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class linear_probe_fn {
public:
	typedef Size_Type size_type;
};

template <typename Size_Type = std::size_t>
class quadratic_probe_fn {
public:
	typedef Size_Type size_type;
};

class hash_exponential_size_policy {};
class hash_prime_size_policy {};

template <bool External_Load_Access = false, typename Size_Type = std::size_t>
class hash_load_check_resize_trigger {
public:
	typedef Size_Type size_type;
	explicit hash_load_check_resize_trigger(float = 0.125, float = 0.5) {}
};

template <bool External_Load_Access = false, typename Size_Type = std::size_t>
class cc_hash_max_collision_check_resize_trigger {
public:
	typedef Size_Type size_type;
	explicit cc_hash_max_collision_check_resize_trigger(float = 0.5) {}
};

template <
	typename Size_Policy = hash_exponential_size_policy,
	typename Trigger_Policy = hash_load_check_resize_trigger<>,
	bool External_Size_Access = false,
	typename Size_Type = std::size_t
>
class hash_standard_resize_policy {
public:
	typedef Size_Type size_type;
	hash_standard_resize_policy() = default;
	explicit hash_standard_resize_policy(const Size_Policy&) {}
	hash_standard_resize_policy(const Size_Policy&, const Trigger_Policy&) {}
};

} // namespace __gnu_pbds

#endif
`,Oe=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP
#define WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP

#include <algorithm>
#include <cstddef>
#include <functional>
#include <memory>
#include <queue>
#include <utility>
#include <vector>

namespace __gnu_pbds {

struct pairing_heap_tag {};
struct binary_heap_tag {};
struct binomial_heap_tag {};
struct rc_binomial_heap_tag {};
struct thin_heap_tag {};

namespace detail {

template <typename Allocator, typename Value>
struct priority_queue_rebind_allocator {
	typedef typename std::allocator_traits<Allocator>::template rebind_alloc<Value> type;
};

} // namespace detail

template <
	typename Value_Type,
	typename Cmp_Fn = std::less<Value_Type>,
	typename Tag = pairing_heap_tag,
	typename Allocator = std::allocator<char>
>
class priority_queue {
public:
	typedef Value_Type value_type;
	typedef Cmp_Fn cmp_fn;
	typedef Tag container_category;
	typedef Allocator allocator_type;
	typedef std::size_t size_type;
	typedef value_type& reference;
	typedef const value_type& const_reference;

private:
	typedef typename detail::priority_queue_rebind_allocator<Allocator, value_type>::type value_allocator_type;
	typedef std::vector<value_type, value_allocator_type> container_type;

public:
	typedef typename container_type::iterator point_iterator;
	typedef typename container_type::const_iterator const_point_iterator;

	priority_queue() : values_(), compare_() {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	explicit priority_queue(const Cmp_Fn& compare) : values_(), compare_(compare) {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	template <typename InputIt>
	priority_queue(InputIt first, InputIt last) : values_(first, last), compare_() {
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	bool empty() const { return values_.empty(); }
	size_type size() const { return values_.size(); }
	const_reference top() const { return values_.front(); }
	void clear() { values_.clear(); }
	void swap(priority_queue& other) {
		values_.swap(other.values_);
		std::swap(compare_, other.compare_);
	}

	point_iterator push(const_reference value) {
		values_.push_back(value);
		std::push_heap(values_.begin(), values_.end(), compare_);
		return values_.empty() ? values_.end() : values_.begin();
	}

	void pop() {
		std::pop_heap(values_.begin(), values_.end(), compare_);
		values_.pop_back();
	}

	void modify(point_iterator position, const_reference value) {
		if (position == values_.end()) return;
		*position = value;
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	void erase(point_iterator position) {
		if (position == values_.end()) return;
		values_.erase(position);
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

	void join(priority_queue& other) {
		values_.insert(values_.end(), other.values_.begin(), other.values_.end());
		other.values_.clear();
		std::make_heap(values_.begin(), values_.end(), compare_);
	}

private:
	container_type values_;
	Cmp_Fn compare_;
};

} // namespace __gnu_pbds

#endif
`,ke=String.raw`#ifndef WASM_CLANG_EXT_ROPE
#define WASM_CLANG_EXT_ROPE

#include <algorithm>
#include <cstddef>
#include <iosfwd>
#include <iterator>
#include <memory>
#include <ostream>
#include <string>
#include <utility>

namespace __gnu_cxx {

template <typename CharT, typename Alloc = std::allocator<CharT>>
class rope {
public:
	typedef CharT value_type;
	typedef Alloc allocator_type;
	typedef std::basic_string<CharT, std::char_traits<CharT>, Alloc> string_type;
	typedef typename string_type::traits_type traits_type;
	typedef typename string_type::size_type size_type;
	typedef typename string_type::difference_type difference_type;
	typedef typename string_type::reference reference;
	typedef typename string_type::const_reference const_reference;
	typedef typename string_type::iterator iterator;
	typedef typename string_type::const_iterator const_iterator;

	static const size_type npos = string_type::npos;

	rope() = default;
	rope(const rope&) = default;
	rope(rope&&) = default;
	rope& operator=(const rope&) = default;
	rope& operator=(rope&&) = default;

	rope(const CharT* value) : data_(value ? value : empty_c_str()) {}
	rope(const CharT* value, size_type count) : data_(value, count) {}
	rope(size_type count, CharT value) : data_(count, value) {}
	rope(const string_type& value) : data_(value) {}
	rope(string_type&& value) : data_(std::move(value)) {}

	template <typename InputIt>
	rope(InputIt first, InputIt last) : data_(first, last) {}

	bool empty() const { return data_.empty(); }
	size_type size() const { return data_.size(); }
	size_type length() const { return data_.length(); }
	size_type max_size() const { return data_.max_size(); }
	void clear() { data_.clear(); }

	const CharT* c_str() const { return data_.c_str(); }
	const string_type& str() const { return data_; }

	iterator begin() { return data_.begin(); }
	const_iterator begin() const { return data_.begin(); }
	const_iterator cbegin() const { return data_.cbegin(); }
	iterator end() { return data_.end(); }
	const_iterator end() const { return data_.end(); }
	const_iterator cend() const { return data_.cend(); }

	reference operator[](size_type index) { return data_[index]; }
	const_reference operator[](size_type index) const { return data_[index]; }
	reference at(size_type index) { return data_.at(index); }
	const_reference at(size_type index) const { return data_.at(index); }
	reference mutable_reference_at(size_type index) { return data_.at(index); }

	void push_back(CharT value) { data_.push_back(value); }
	void pop_back() { data_.pop_back(); }

	rope& append(const rope& value) {
		data_.append(value.data_);
		return *this;
	}

	rope& append(const CharT* value) {
		data_.append(value ? value : empty_c_str());
		return *this;
	}

	rope& append(const CharT* value, size_type count) {
		data_.append(value, count);
		return *this;
	}

	rope& append(size_type count, CharT value) {
		data_.append(count, value);
		return *this;
	}

	rope& insert(size_type position, const rope& value) {
		data_.insert(position, value.data_);
		return *this;
	}

	rope& insert(size_type position, const CharT* value) {
		data_.insert(position, value ? value : empty_c_str());
		return *this;
	}

	rope& insert(size_type position, const CharT* value, size_type count) {
		data_.insert(position, value, count);
		return *this;
	}

	rope& insert(size_type position, size_type count, CharT value) {
		data_.insert(position, count, value);
		return *this;
	}

	rope& erase(size_type position = 0, size_type count = npos) {
		data_.erase(position, count);
		return *this;
	}

	rope& replace(size_type position, size_type count, const rope& value) {
		data_.replace(position, count, value.data_);
		return *this;
	}

	rope& replace(size_type position, size_type count, const CharT* value) {
		data_.replace(position, count, value ? value : empty_c_str());
		return *this;
	}

	rope substr(size_type position = 0, size_type count = npos) const {
		return rope(data_.substr(position, count));
	}

	size_type copy(size_type position, size_type count, CharT* target) const {
		if (position > data_.size()) return 0;
		const size_type copied = std::min(count, data_.size() - position);
		traits_type::copy(target, data_.data() + position, copied);
		return copied;
	}

	int compare(const rope& value) const { return data_.compare(value.data_); }

	rope& operator+=(const rope& value) { return append(value); }
	rope& operator+=(const CharT* value) { return append(value); }
	rope& operator+=(CharT value) {
		push_back(value);
		return *this;
	}

private:
	static const CharT* empty_c_str() {
		static const CharT empty[1] = {};
		return empty;
	}

	string_type data_;
};

template <typename CharT, typename Alloc>
rope<CharT, Alloc> operator+(rope<CharT, Alloc> left, const rope<CharT, Alloc>& right) {
	left += right;
	return left;
}

template <typename CharT, typename Alloc>
bool operator==(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return left.compare(right) == 0;
}

template <typename CharT, typename Alloc>
bool operator!=(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return !(left == right);
}

template <typename CharT, typename Alloc>
bool operator<(const rope<CharT, Alloc>& left, const rope<CharT, Alloc>& right) {
	return left.compare(right) < 0;
}

template <typename CharT, typename Alloc>
std::basic_ostream<CharT>& operator<<(
	std::basic_ostream<CharT>& output,
	const rope<CharT, Alloc>& value
) {
	return output << value.str();
}

typedef rope<char> crope;
typedef rope<wchar_t> wrope;

} // namespace __gnu_cxx

#endif
`,Ae=String.raw`#ifndef WASM_CLANG_SETJMP_H
#define WASM_CLANG_SETJMP_H

#ifdef __cplusplus
extern "C" {
#endif

typedef long jmp_buf[32];
int setjmp(jmp_buf);
__attribute__((noreturn)) void longjmp(jmp_buf, int);

#ifdef __cplusplus
}
#endif

#endif
`,je=String.raw`#ifndef WASM_CLANG_BITS_STDCPP_H
#define WASM_CLANG_BITS_STDCPP_H

#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <cctype>
#include <cerrno>
#include <cfloat>
#include <climits>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#endif
`,Me=String.raw`#ifndef WASM_CLANG_BITS_EXTCXX_H
#define WASM_CLANG_BITS_EXTCXX_H

#include <bits/stdc++.h>
#include <ext/hash_map>
#include <ext/hash_set>
#include <ext/rope>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/hash_policy.hpp>
#include <ext/pb_ds/priority_queue.hpp>
#include <ext/pb_ds/tree_policy.hpp>

#endif
`,Ne=[{path:`include/setjmp.h`,contents:Ae},{path:`include/bits/stdc++.h`,contents:je},{path:`include/bits/extc++.h`,contents:Me},{path:`include/c++/v1/ext/rope`,contents:ke},{path:`include/c++/v1/ext/pb_ds/tree_policy.hpp`,contents:Te},{path:`include/c++/v1/ext/pb_ds/assoc_container.hpp`,contents:Ee},{path:`include/c++/v1/ext/pb_ds/hash_policy.hpp`,contents:De},{path:`include/c++/v1/ext/pb_ds/priority_queue.hpp`,contents:Oe}];function Pe(e){e.addDirectory(`include/c++/v1/ext/pb_ds`),e.addDirectory(`include/bits`);for(let t of Ne)e.addFile(t.path,t.contents)}const Fe=Object.freeze({"builtins.h":`/*===---- builtins.h - Standard header for extra builtins -----------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

/// Some legacy compilers have builtin definitions in a file named builtins.h.
/// This header file has been added to allow compatibility with code that was
/// written for those compilers. Code may have an include line for this file
/// and to avoid an error an empty file with this name is provided.
#ifndef __BUILTINS_H
#define __BUILTINS_H

#if defined(__MVS__) && __has_include_next(<builtins.h>)
#include_next <builtins.h>
#endif /* __MVS__ */
#endif /* __BUILTINS_H */
`,"float.h":`/*===---- float.h - Characteristics of floating point types ----------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if defined(__MVS__) && __has_include_next(<float.h>)
#include <__float_header_macro.h>
#include_next <float.h>
#else

#if !defined(__need_infinity_nan)
#define __need_float_float
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#define __need_infinity_nan
#endif
#include <__float_header_macro.h>
#endif

#ifdef __need_float_float
/* If we're on MinGW, fall back to the system's float.h, which might have
 * additional definitions provided for Windows.
 * For more details see http://msdn.microsoft.com/en-us/library/y0ybw9fy.aspx
 *
 * Also fall back on AIX to allow additional definitions and
 * implementation-defined values.
 */
#if (defined(__MINGW32__) || defined(_MSC_VER) || defined(_AIX)) &&            \\
    __STDC_HOSTED__ && __has_include_next(<float.h>)

#  include_next <float.h>

#endif

#include <__float_float.h>
#undef __need_float_float
#endif

#ifdef __need_infinity_nan
#include <__float_infinity_nan.h>
#undef __need_infinity_nan
#endif

#endif /* __MVS__ */
`,"__float_float.h":`/*===---- __float_float.h --------------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_FLOAT_H
#define __CLANG_FLOAT_FLOAT_H

#if (defined(__MINGW32__) || defined(_MSC_VER) || defined(_AIX)) &&            \\
    __STDC_HOSTED__

/* Undefine anything that we'll be redefining below. */
#  undef FLT_EVAL_METHOD
#  undef FLT_ROUNDS
#  undef FLT_RADIX
#  undef FLT_MANT_DIG
#  undef DBL_MANT_DIG
#  undef LDBL_MANT_DIG
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#    undef DECIMAL_DIG
#  endif
#  undef FLT_DIG
#  undef DBL_DIG
#  undef LDBL_DIG
#  undef FLT_MIN_EXP
#  undef DBL_MIN_EXP
#  undef LDBL_MIN_EXP
#  undef FLT_MIN_10_EXP
#  undef DBL_MIN_10_EXP
#  undef LDBL_MIN_10_EXP
#  undef FLT_MAX_EXP
#  undef DBL_MAX_EXP
#  undef LDBL_MAX_EXP
#  undef FLT_MAX_10_EXP
#  undef DBL_MAX_10_EXP
#  undef LDBL_MAX_10_EXP
#  undef FLT_MAX
#  undef DBL_MAX
#  undef LDBL_MAX
#  undef FLT_EPSILON
#  undef DBL_EPSILON
#  undef LDBL_EPSILON
#  undef FLT_MIN
#  undef DBL_MIN
#  undef LDBL_MIN
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201703L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#    undef FLT_TRUE_MIN
#    undef DBL_TRUE_MIN
#    undef LDBL_TRUE_MIN
#    undef FLT_DECIMAL_DIG
#    undef DBL_DECIMAL_DIG
#    undef LDBL_DECIMAL_DIG
#    undef FLT_HAS_SUBNORM
#    undef DBL_HAS_SUBNORM
#    undef LDBL_HAS_SUBNORM
#  endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#    undef FLT_NORM_MAX
#    undef DBL_NORM_MAX
#    undef LDBL_NORM_MAX
#endif
#endif

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
#  undef FLT_SNAN
#  undef DBL_SNAN
#  undef LDBL_SNAN
#endif

/* Characteristics of floating point types, C99 5.2.4.2.2 */

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)
#define FLT_EVAL_METHOD __FLT_EVAL_METHOD__
#endif
#define FLT_ROUNDS (__builtin_flt_rounds())
#define FLT_RADIX __FLT_RADIX__

#define FLT_MANT_DIG __FLT_MANT_DIG__
#define DBL_MANT_DIG __DBL_MANT_DIG__
#define LDBL_MANT_DIG __LDBL_MANT_DIG__

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#  define DECIMAL_DIG __DECIMAL_DIG__
#endif

#define FLT_DIG __FLT_DIG__
#define DBL_DIG __DBL_DIG__
#define LDBL_DIG __LDBL_DIG__

#define FLT_MIN_EXP __FLT_MIN_EXP__
#define DBL_MIN_EXP __DBL_MIN_EXP__
#define LDBL_MIN_EXP __LDBL_MIN_EXP__

#define FLT_MIN_10_EXP __FLT_MIN_10_EXP__
#define DBL_MIN_10_EXP __DBL_MIN_10_EXP__
#define LDBL_MIN_10_EXP __LDBL_MIN_10_EXP__

#define FLT_MAX_EXP __FLT_MAX_EXP__
#define DBL_MAX_EXP __DBL_MAX_EXP__
#define LDBL_MAX_EXP __LDBL_MAX_EXP__

#define FLT_MAX_10_EXP __FLT_MAX_10_EXP__
#define DBL_MAX_10_EXP __DBL_MAX_10_EXP__
#define LDBL_MAX_10_EXP __LDBL_MAX_10_EXP__

#define FLT_MAX __FLT_MAX__
#define DBL_MAX __DBL_MAX__
#define LDBL_MAX __LDBL_MAX__

#define FLT_EPSILON __FLT_EPSILON__
#define DBL_EPSILON __DBL_EPSILON__
#define LDBL_EPSILON __LDBL_EPSILON__

#define FLT_MIN __FLT_MIN__
#define DBL_MIN __DBL_MIN__
#define LDBL_MIN __LDBL_MIN__

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    !defined(__STRICT_ANSI__) ||                                               \\
    (defined(__cplusplus) && __cplusplus >= 201703L) ||                        \\
    (__STDC_HOSTED__ && defined(_AIX) && defined(_ALL_SOURCE))
#  define FLT_TRUE_MIN __FLT_DENORM_MIN__
#  define DBL_TRUE_MIN __DBL_DENORM_MIN__
#  define LDBL_TRUE_MIN __LDBL_DENORM_MIN__
#  define FLT_DECIMAL_DIG __FLT_DECIMAL_DIG__
#  define DBL_DECIMAL_DIG __DBL_DECIMAL_DIG__
#  define LDBL_DECIMAL_DIG __LDBL_DECIMAL_DIG__
#  define FLT_HAS_SUBNORM __FLT_HAS_DENORM__
#  define DBL_HAS_SUBNORM __DBL_HAS_DENORM__
#  define LDBL_HAS_SUBNORM __LDBL_HAS_DENORM__
#endif

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    !defined(__STRICT_ANSI__)
   /* C23 5.2.5.3.2p28 */
#  define FLT_SNAN (__builtin_nansf(""))
#  define DBL_SNAN (__builtin_nans(""))
#  define LDBL_SNAN (__builtin_nansl(""))

   /* C23 5.2.5.3.3p32 */
#  define FLT_NORM_MAX __FLT_NORM_MAX__
#  define DBL_NORM_MAX __DBL_NORM_MAX__
#  define LDBL_NORM_MAX __LDBL_NORM_MAX__
#endif

#ifdef __STDC_WANT_IEC_60559_TYPES_EXT__
#  define FLT16_MANT_DIG    __FLT16_MANT_DIG__
#  define FLT16_DECIMAL_DIG __FLT16_DECIMAL_DIG__
#  define FLT16_DIG         __FLT16_DIG__
#  define FLT16_MIN_EXP     __FLT16_MIN_EXP__
#  define FLT16_MIN_10_EXP  __FLT16_MIN_10_EXP__
#  define FLT16_MAX_EXP     __FLT16_MAX_EXP__
#  define FLT16_MAX_10_EXP  __FLT16_MAX_10_EXP__
#  define FLT16_MAX         __FLT16_MAX__
#  define FLT16_EPSILON     __FLT16_EPSILON__
#  define FLT16_MIN         __FLT16_MIN__
#  define FLT16_TRUE_MIN    __FLT16_TRUE_MIN__
#endif /* __STDC_WANT_IEC_60559_TYPES_EXT__ */

#endif /* __CLANG_FLOAT_FLOAT_H */
`,"__float_header_macro.h":`/*===---- __float_header_macro.h -------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_H
#define __CLANG_FLOAT_H
#endif /* __CLANG_FLOAT_H */
`,"__float_infinity_nan.h":`/*===---- __float_infinity_nan.h -------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_FLOAT_INFINITY_NAN_H
#define __CLANG_FLOAT_INFINITY_NAN_H

/* C23 5.2.5.3.3p29-30 */
#undef INFINITY
#undef NAN

#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))

#endif /* __CLANG_FLOAT_INFINITY_NAN_H */
`,"inttypes.h":`/*===---- inttypes.h - Standard header for integer printf macros ----------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_INTTYPES_H
// AIX system headers need inttypes.h to be re-enterable while _STD_TYPES_T
// is defined until an inclusion of it without _STD_TYPES_T occurs, in which
// case the header guard macro is defined.
#if !defined(_AIX) || !defined(_STD_TYPES_T)
#define __CLANG_INTTYPES_H
#endif
#if defined(__MVS__) && __has_include_next(<inttypes.h>)
#include_next <inttypes.h>
#else

#if defined(_MSC_VER) && _MSC_VER < 1800
#error MSVC does not have inttypes.h prior to Visual Studio 2013
#endif

#include_next <inttypes.h>

#if defined(_MSC_VER) && _MSC_VER < 1900
/* MSVC headers define int32_t as int, but PRIx32 as "lx" instead of "x".
 * This triggers format warnings, so fix it up here. */
#undef PRId32
#undef PRIdLEAST32
#undef PRIdFAST32
#undef PRIi32
#undef PRIiLEAST32
#undef PRIiFAST32
#undef PRIo32
#undef PRIoLEAST32
#undef PRIoFAST32
#undef PRIu32
#undef PRIuLEAST32
#undef PRIuFAST32
#undef PRIx32
#undef PRIxLEAST32
#undef PRIxFAST32
#undef PRIX32
#undef PRIXLEAST32
#undef PRIXFAST32

#undef SCNd32
#undef SCNdLEAST32
#undef SCNdFAST32
#undef SCNi32
#undef SCNiLEAST32
#undef SCNiFAST32
#undef SCNo32
#undef SCNoLEAST32
#undef SCNoFAST32
#undef SCNu32
#undef SCNuLEAST32
#undef SCNuFAST32
#undef SCNx32
#undef SCNxLEAST32
#undef SCNxFAST32

#define PRId32 "d"
#define PRIdLEAST32 "d"
#define PRIdFAST32 "d"
#define PRIi32 "i"
#define PRIiLEAST32 "i"
#define PRIiFAST32 "i"
#define PRIo32 "o"
#define PRIoLEAST32 "o"
#define PRIoFAST32 "o"
#define PRIu32 "u"
#define PRIuLEAST32 "u"
#define PRIuFAST32 "u"
#define PRIx32 "x"
#define PRIxLEAST32 "x"
#define PRIxFAST32 "x"
#define PRIX32 "X"
#define PRIXLEAST32 "X"
#define PRIXFAST32 "X"

#define SCNd32 "d"
#define SCNdLEAST32 "d"
#define SCNdFAST32 "d"
#define SCNi32 "i"
#define SCNiLEAST32 "i"
#define SCNiFAST32 "i"
#define SCNo32 "o"
#define SCNoLEAST32 "o"
#define SCNoFAST32 "o"
#define SCNu32 "u"
#define SCNuLEAST32 "u"
#define SCNuFAST32 "u"
#define SCNx32 "x"
#define SCNxLEAST32 "x"
#define SCNxFAST32 "x"
#endif

#endif /* __MVS__ */
#endif /* __CLANG_INTTYPES_H */
`,"iso646.h":`/*===---- iso646.h - Standard header for alternate spellings of operators---===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __ISO646_H
#define __ISO646_H
#if defined(__MVS__) && __has_include_next(<iso646.h>)
#include_next <iso646.h>
#else

#ifndef __cplusplus
#define and    &&
#define and_eq &=
#define bitand &
#define bitor  |
#define compl  ~
#define not    !
#define not_eq !=
#define or     ||
#define or_eq  |=
#define xor    ^
#define xor_eq ^=
#endif

#endif /* __MVS__ */
#endif /* __ISO646_H */
`,"limits.h":`/*===---- limits.h - Standard header for integer sizes --------------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_LIMITS_H
#define __CLANG_LIMITS_H

#if defined(__MVS__) && __has_include_next(<limits.h>)
#include_next <limits.h>
#else

/* The system's limits.h may, in turn, try to #include_next GCC's limits.h.
   Avert this #include_next madness. */
#if defined __GNUC__ && !defined _GCC_LIMITS_H_
#define _GCC_LIMITS_H_
#endif

/* System headers include a number of constants from POSIX in <limits.h>.
   Include it if we're hosted. */
#if __STDC_HOSTED__ && __has_include_next(<limits.h>)
#include_next <limits.h>
#endif

/* Many system headers try to "help us out" by defining these.  No really, we
   know how big each datatype is. */
#undef  SCHAR_MIN
#undef  SCHAR_MAX
#undef  UCHAR_MAX
#undef  SHRT_MIN
#undef  SHRT_MAX
#undef  USHRT_MAX
#undef  INT_MIN
#undef  INT_MAX
#undef  UINT_MAX
#undef  LONG_MIN
#undef  LONG_MAX
#undef  ULONG_MAX

#undef  CHAR_BIT
#undef  CHAR_MIN
#undef  CHAR_MAX

/* C90/99 5.2.4.2.1 */
#define SCHAR_MAX __SCHAR_MAX__
#define SHRT_MAX  __SHRT_MAX__
#define INT_MAX   __INT_MAX__
#define LONG_MAX  __LONG_MAX__

#define SCHAR_MIN (-__SCHAR_MAX__-1)
#define SHRT_MIN  (-__SHRT_MAX__ -1)
#define INT_MIN   (-__INT_MAX__  -1)
#define LONG_MIN  (-__LONG_MAX__ -1L)

#define UCHAR_MAX (__SCHAR_MAX__*2  +1)
#if __SHRT_WIDTH__ < __INT_WIDTH__
#define USHRT_MAX (__SHRT_MAX__ * 2 + 1)
#else
#define USHRT_MAX (__SHRT_MAX__ * 2U + 1U)
#endif
#define UINT_MAX  (__INT_MAX__  *2U +1U)
#define ULONG_MAX (__LONG_MAX__ *2UL+1UL)

#ifndef MB_LEN_MAX
#define MB_LEN_MAX 1
#endif

#define CHAR_BIT  __CHAR_BIT__

/* C23 5.2.4.2.1 */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define BOOL_WIDTH   __BOOL_WIDTH__
#define CHAR_WIDTH   CHAR_BIT
#define SCHAR_WIDTH  CHAR_BIT
#define UCHAR_WIDTH  CHAR_BIT
#define USHRT_WIDTH  __SHRT_WIDTH__
#define SHRT_WIDTH   __SHRT_WIDTH__
#define UINT_WIDTH   __INT_WIDTH__
#define INT_WIDTH    __INT_WIDTH__
#define ULONG_WIDTH  __LONG_WIDTH__
#define LONG_WIDTH   __LONG_WIDTH__
#define ULLONG_WIDTH __LLONG_WIDTH__
#define LLONG_WIDTH  __LLONG_WIDTH__

#define BITINT_MAXWIDTH __BITINT_MAXWIDTH__
#endif

#ifdef __CHAR_UNSIGNED__  /* -funsigned-char */
#define CHAR_MIN 0
#define CHAR_MAX UCHAR_MAX
#else
#define CHAR_MIN SCHAR_MIN
#define CHAR_MAX __SCHAR_MAX__
#endif

/* C99 5.2.4.2.1: Added long long.
   C++11 18.3.3.2: same contents as the Standard C Library header <limits.h>.
 */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)

#undef  LLONG_MIN
#undef  LLONG_MAX
#undef  ULLONG_MAX

#define LLONG_MAX  __LONG_LONG_MAX__
#define LLONG_MIN  (-__LONG_LONG_MAX__-1LL)
#define ULLONG_MAX (__LONG_LONG_MAX__*2ULL+1ULL)
#endif

/* LONG_LONG_MIN/LONG_LONG_MAX/ULONG_LONG_MAX are a GNU extension. Android's
   bionic also defines them. It's too bad that we don't have something like
   #pragma poison that could be used to deprecate a macro - the code should just
   use LLONG_MAX and friends.
 */
#if (defined(__GNU_LIBRARY__) ? defined(__USE_GNU)                             \\
                              : !defined(__STRICT_ANSI__)) ||                  \\
    defined(__BIONIC__)

#undef   LONG_LONG_MIN
#undef   LONG_LONG_MAX
#undef   ULONG_LONG_MAX

#define LONG_LONG_MAX  __LONG_LONG_MAX__
#define LONG_LONG_MIN  (-__LONG_LONG_MAX__-1LL)
#define ULONG_LONG_MAX (__LONG_LONG_MAX__*2ULL+1ULL)
#endif

#endif /* __MVS__ */
#endif /* __CLANG_LIMITS_H */
`,"stdalign.h":`/*===---- stdalign.h - Standard header for alignment ------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDALIGN_H
#define __STDALIGN_H

#if defined(__cplusplus) ||                                                    \\
    (defined(__STDC_VERSION__) && __STDC_VERSION__ < 202311L)
#ifndef __cplusplus
#define alignas _Alignas
#define alignof _Alignof
#endif

#define __alignas_is_defined 1
#define __alignof_is_defined 1
#endif /* __STDC_VERSION__ */

#endif /* __STDALIGN_H */
`,"stdarg.h":`/*===---- stdarg.h - Variable argument handling ----------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * This header is designed to be included multiple times. If any of the __need_
 * macros are defined, then only that subset of interfaces are provided. This
 * can be useful for POSIX headers that need to not expose all of stdarg.h, but
 * need to use some of its interfaces. Otherwise this header provides all of
 * the expected interfaces.
 *
 * When clang modules are enabled, this header is a textual header to support
 * the multiple include behavior. As such, it doesn't directly declare anything
 * so that it doesn't add duplicate declarations to all of its includers'
 * modules.
 */
#if defined(__MVS__) && __has_include_next(<stdarg.h>)
#undef __need___va_list
#undef __need_va_list
#undef __need_va_arg
#undef __need___va_copy
#undef __need_va_copy
#include <__stdarg_header_macro.h>
#include_next <stdarg.h>

#else
#if !defined(__need___va_list) && !defined(__need_va_list) &&                  \\
    !defined(__need_va_arg) && !defined(__need___va_copy) &&                   \\
    !defined(__need_va_copy)
#define __need___va_list
#define __need_va_list
#define __need_va_arg
#define __need___va_copy
/* GCC always defines __va_copy, but does not define va_copy unless in c99 mode
 * or -ansi is not specified, since it was not part of C90.
 */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L) ||                        \\
    !defined(__STRICT_ANSI__)
#define __need_va_copy
#endif
#include <__stdarg_header_macro.h>
#endif

#ifdef __need___va_list
#include <__stdarg___gnuc_va_list.h>
#undef __need___va_list
#endif /* defined(__need___va_list) */

#ifdef __need_va_list
#include <__stdarg_va_list.h>
#undef __need_va_list
#endif /* defined(__need_va_list) */

#ifdef __need_va_arg
#include <__stdarg_va_arg.h>
#undef __need_va_arg
#endif /* defined(__need_va_arg) */

#ifdef __need___va_copy
#include <__stdarg___va_copy.h>
#undef __need___va_copy
#endif /* defined(__need___va_copy) */

#ifdef __need_va_copy
#include <__stdarg_va_copy.h>
#undef __need_va_copy
#endif /* defined(__need_va_copy) */

#endif /* __MVS__ */
`,"__stdarg___gnuc_va_list.h":`/*===---- __stdarg___gnuc_va_list.h - Definition of __gnuc_va_list ---------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __GNUC_VA_LIST
#define __GNUC_VA_LIST
typedef __builtin_va_list __gnuc_va_list;
#endif
`,"__stdarg___va_copy.h":`/*===---- __stdarg___va_copy.h - Definition of __va_copy -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __va_copy
#define __va_copy(d, s) __builtin_va_copy(d, s)
#endif
`,"__stdarg_header_macro.h":`/*===---- __stdarg_header_macro.h ------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDARG_H
#define __STDARG_H
#endif
`,"__stdarg_va_arg.h":`/*===---- __stdarg_va_arg.h - Definitions of va_start, va_arg, va_end-------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef va_arg

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* C23 uses a special builtin. */
#define va_start(...) __builtin_c23_va_start(__VA_ARGS__)
#else
/* Versions before C23 do require the second parameter. */
#define va_start(ap, param) __builtin_va_start(ap, param)
#endif
#define va_end(ap) __builtin_va_end(ap)
#define va_arg(ap, type) __builtin_va_arg(ap, type)

#endif
`,"__stdarg_va_copy.h":`/*===---- __stdarg_va_copy.h - Definition of va_copy------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef va_copy
#define va_copy(dest, src) __builtin_va_copy(dest, src)
#endif
`,"__stdarg_va_list.h":`/*===---- __stdarg_va_list.h - Definition of va_list -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef _VA_LIST
#define _VA_LIST
typedef __builtin_va_list va_list;
#endif
`,"stdatomic.h":`/*===---- stdatomic.h - Standard header for atomic types and operations -----===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_STDATOMIC_H
#define __CLANG_STDATOMIC_H

/* If we're hosted, fall back to the system's stdatomic.h. FreeBSD, for
 * example, already has a Clang-compatible stdatomic.h header.
 *
 * Exclude the MSVC path as well as the MSVC header as of the 14.31.30818
 * explicitly disallows \`stdatomic.h\` in the C mode via an \`#error\`.  Fallback
 * to the clang resource header until that is fully supported.  The
 * \`stdatomic.h\` header requires C++23 or newer.
 */
#if __STDC_HOSTED__ &&                                                         \\
    __has_include_next(<stdatomic.h>) &&                                       \\
    (!defined(_MSC_VER) || (defined(__cplusplus) && __cplusplus >= 202002L))
# include_next <stdatomic.h>
#else

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 7.17.1 Introduction */

#define ATOMIC_BOOL_LOCK_FREE       __CLANG_ATOMIC_BOOL_LOCK_FREE
#define ATOMIC_CHAR_LOCK_FREE       __CLANG_ATOMIC_CHAR_LOCK_FREE
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define ATOMIC_CHAR8_T_LOCK_FREE    __CLANG_ATOMIC_CHAR8_T_LOCK_FREE
#endif
#define ATOMIC_CHAR16_T_LOCK_FREE   __CLANG_ATOMIC_CHAR16_T_LOCK_FREE
#define ATOMIC_CHAR32_T_LOCK_FREE   __CLANG_ATOMIC_CHAR32_T_LOCK_FREE
#define ATOMIC_WCHAR_T_LOCK_FREE    __CLANG_ATOMIC_WCHAR_T_LOCK_FREE
#define ATOMIC_SHORT_LOCK_FREE      __CLANG_ATOMIC_SHORT_LOCK_FREE
#define ATOMIC_INT_LOCK_FREE        __CLANG_ATOMIC_INT_LOCK_FREE
#define ATOMIC_LONG_LOCK_FREE       __CLANG_ATOMIC_LONG_LOCK_FREE
#define ATOMIC_LLONG_LOCK_FREE      __CLANG_ATOMIC_LLONG_LOCK_FREE
#define ATOMIC_POINTER_LOCK_FREE    __CLANG_ATOMIC_POINTER_LOCK_FREE

/* 7.17.2 Initialization */
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ < 202311L) ||               \\
    defined(__cplusplus)
/* ATOMIC_VAR_INIT was removed in C23, but still remains in C++23. */
#define ATOMIC_VAR_INIT(value) (value)
#endif

#if ((defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201710L &&              \\
      __STDC_VERSION__ < 202311L) ||                                           \\
     (defined(__cplusplus) && __cplusplus >= 202002L)) &&                      \\
    !defined(_CLANG_DISABLE_CRT_DEPRECATION_WARNINGS)
/* ATOMIC_VAR_INIT was deprecated in C17 and C++20. */
#pragma clang deprecated(ATOMIC_VAR_INIT)
#endif
#define atomic_init __c11_atomic_init

/* 7.17.3 Order and consistency */

typedef enum memory_order {
  memory_order_relaxed = __ATOMIC_RELAXED,
  memory_order_consume = __ATOMIC_CONSUME,
  memory_order_acquire = __ATOMIC_ACQUIRE,
  memory_order_release = __ATOMIC_RELEASE,
  memory_order_acq_rel = __ATOMIC_ACQ_REL,
  memory_order_seq_cst = __ATOMIC_SEQ_CST
} memory_order;

#define kill_dependency(y) (y)

/* 7.17.4 Fences */

/* These should be provided by the libc implementation. */
void atomic_thread_fence(memory_order);
void atomic_signal_fence(memory_order);

#define atomic_thread_fence(order) __c11_atomic_thread_fence(order)
#define atomic_signal_fence(order) __c11_atomic_signal_fence(order)

/* 7.17.5 Lock-free property */

#define atomic_is_lock_free(obj) __c11_atomic_is_lock_free(sizeof(*(obj)))

/* 7.17.6 Atomic integer types */

#ifdef __cplusplus
typedef _Atomic(bool)               atomic_bool;
#else
typedef _Atomic(_Bool)              atomic_bool;
#endif
typedef _Atomic(char)               atomic_char;
typedef _Atomic(signed char)        atomic_schar;
typedef _Atomic(unsigned char)      atomic_uchar;
typedef _Atomic(short)              atomic_short;
typedef _Atomic(unsigned short)     atomic_ushort;
typedef _Atomic(int)                atomic_int;
typedef _Atomic(unsigned int)       atomic_uint;
typedef _Atomic(long)               atomic_long;
typedef _Atomic(unsigned long)      atomic_ulong;
typedef _Atomic(long long)          atomic_llong;
typedef _Atomic(unsigned long long) atomic_ullong;
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
typedef _Atomic(unsigned char)      atomic_char8_t;
#endif
typedef _Atomic(uint_least16_t)     atomic_char16_t;
typedef _Atomic(uint_least32_t)     atomic_char32_t;
typedef _Atomic(wchar_t)            atomic_wchar_t;
typedef _Atomic(int_least8_t)       atomic_int_least8_t;
typedef _Atomic(uint_least8_t)      atomic_uint_least8_t;
typedef _Atomic(int_least16_t)      atomic_int_least16_t;
typedef _Atomic(uint_least16_t)     atomic_uint_least16_t;
typedef _Atomic(int_least32_t)      atomic_int_least32_t;
typedef _Atomic(uint_least32_t)     atomic_uint_least32_t;
typedef _Atomic(int_least64_t)      atomic_int_least64_t;
typedef _Atomic(uint_least64_t)     atomic_uint_least64_t;
typedef _Atomic(int_fast8_t)        atomic_int_fast8_t;
typedef _Atomic(uint_fast8_t)       atomic_uint_fast8_t;
typedef _Atomic(int_fast16_t)       atomic_int_fast16_t;
typedef _Atomic(uint_fast16_t)      atomic_uint_fast16_t;
typedef _Atomic(int_fast32_t)       atomic_int_fast32_t;
typedef _Atomic(uint_fast32_t)      atomic_uint_fast32_t;
typedef _Atomic(int_fast64_t)       atomic_int_fast64_t;
typedef _Atomic(uint_fast64_t)      atomic_uint_fast64_t;
typedef _Atomic(intptr_t)           atomic_intptr_t;
typedef _Atomic(uintptr_t)          atomic_uintptr_t;
typedef _Atomic(size_t)             atomic_size_t;
typedef _Atomic(ptrdiff_t)          atomic_ptrdiff_t;
typedef _Atomic(intmax_t)           atomic_intmax_t;
typedef _Atomic(uintmax_t)          atomic_uintmax_t;

/* 7.17.7 Operations on atomic types */

#define atomic_store(object, desired) __c11_atomic_store(object, desired, __ATOMIC_SEQ_CST)
#define atomic_store_explicit __c11_atomic_store

#define atomic_load(object) __c11_atomic_load(object, __ATOMIC_SEQ_CST)
#define atomic_load_explicit __c11_atomic_load

#define atomic_exchange(object, desired) __c11_atomic_exchange(object, desired, __ATOMIC_SEQ_CST)
#define atomic_exchange_explicit __c11_atomic_exchange

#define atomic_compare_exchange_strong(object, expected, desired) __c11_atomic_compare_exchange_strong(object, expected, desired, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)
#define atomic_compare_exchange_strong_explicit __c11_atomic_compare_exchange_strong

#define atomic_compare_exchange_weak(object, expected, desired) __c11_atomic_compare_exchange_weak(object, expected, desired, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)
#define atomic_compare_exchange_weak_explicit __c11_atomic_compare_exchange_weak

#define atomic_fetch_add(object, operand) __c11_atomic_fetch_add(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_add_explicit __c11_atomic_fetch_add

#define atomic_fetch_sub(object, operand) __c11_atomic_fetch_sub(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_sub_explicit __c11_atomic_fetch_sub

#define atomic_fetch_or(object, operand) __c11_atomic_fetch_or(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_or_explicit __c11_atomic_fetch_or

#define atomic_fetch_xor(object, operand) __c11_atomic_fetch_xor(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_xor_explicit __c11_atomic_fetch_xor

#define atomic_fetch_and(object, operand) __c11_atomic_fetch_and(object, operand, __ATOMIC_SEQ_CST)
#define atomic_fetch_and_explicit __c11_atomic_fetch_and

/* 7.17.8 Atomic flag type and operations */

typedef struct atomic_flag { atomic_bool _Value; } atomic_flag;

#ifdef __cplusplus
#define ATOMIC_FLAG_INIT {false}
#else
#define ATOMIC_FLAG_INIT { 0 }
#endif

/* These should be provided by the libc implementation. */
#ifdef __cplusplus
bool atomic_flag_test_and_set(volatile atomic_flag *);
bool atomic_flag_test_and_set_explicit(volatile atomic_flag *, memory_order);
#else
_Bool atomic_flag_test_and_set(volatile atomic_flag *);
_Bool atomic_flag_test_and_set_explicit(volatile atomic_flag *, memory_order);
#endif
void atomic_flag_clear(volatile atomic_flag *);
void atomic_flag_clear_explicit(volatile atomic_flag *, memory_order);

#define atomic_flag_test_and_set(object) __c11_atomic_exchange(&(object)->_Value, 1, __ATOMIC_SEQ_CST)
#define atomic_flag_test_and_set_explicit(object, order) __c11_atomic_exchange(&(object)->_Value, 1, order)

#define atomic_flag_clear(object) __c11_atomic_store(&(object)->_Value, 0, __ATOMIC_SEQ_CST)
#define atomic_flag_clear_explicit(object, order) __c11_atomic_store(&(object)->_Value, 0, order)

#ifdef __cplusplus
}
#endif

#endif /* __STDC_HOSTED__ */
#endif /* __CLANG_STDATOMIC_H */

`,"stdbool.h":`/*===---- stdbool.h - Standard header for booleans -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDBOOL_H
#define __STDBOOL_H

#define __bool_true_false_are_defined 1

#if defined(__MVS__) && __has_include_next(<stdbool.h>)
#include_next <stdbool.h>
#else

#if defined(__STDC_VERSION__) && __STDC_VERSION__ > 201710L
/* FIXME: We should be issuing a deprecation warning here, but cannot yet due
 * to system headers which include this header file unconditionally.
 */
#elif !defined(__cplusplus)
#define bool _Bool
#define true 1
#define false 0
#elif defined(__GNUC__) && !defined(__STRICT_ANSI__)
/* Define _Bool as a GNU extension. */
#define _Bool bool
#if defined(__cplusplus) && __cplusplus < 201103L
/* For C++98, define bool, false, true as a GNU extension. */
#define bool bool
#define false false
#define true true
#endif
#endif

#endif /* __MVS__ */
#endif /* __STDBOOL_H */
`,"stdcountof.h":`/*===---- stdcountof.h - Standard header for countof -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDCOUNTOF_H
#define __STDCOUNTOF_H

#define countof _Countof

#endif /* __STDCOUNTOF_H */
`,"stdckdint.h":`/*===---- stdckdint.h - Standard header for checking integer----------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDCKDINT_H
#define __STDCKDINT_H

/* If we're hosted, fall back to the system's stdckdint.h. FreeBSD, for
 * example, already has a Clang-compatible stdckdint.h header.
 *
 * The \`stdckdint.h\` header requires C 23 or newer.
 */
#if __STDC_HOSTED__ && __has_include_next(<stdckdint.h>)
#include_next <stdckdint.h>
#else

/* C23 7.20.1 Defines several macros for performing checked integer arithmetic*/

#define __STDC_VERSION_STDCKDINT_H__ 202311L

// Both A and B shall be any integer type other than "plain" char, bool, a bit-
// precise integer type, or an enumerated type, and they need not be the same.

// R shall be a modifiable lvalue of any integer type other than "plain" char,
// bool, a bit-precise integer type, or an enumerated type. It shouldn't be
// short type, either. Otherwise, it may be unable to hold two the result of
// operating two 'int's.

// A diagnostic message will be produced if A or B are not suitable integer
// types, or if R is not a modifiable lvalue of a suitable integer type or R
// is short type.
#define ckd_add(R, A, B) __builtin_add_overflow((A), (B), (R))
#define ckd_sub(R, A, B) __builtin_sub_overflow((A), (B), (R))
#define ckd_mul(R, A, B) __builtin_mul_overflow((A), (B), (R))

#endif /* __STDC_HOSTED__ */
#endif /* __STDCKDINT_H */
`,"stddef.h":`/*===---- stddef.h - Basic type definitions --------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * This header is designed to be included multiple times. If any of the __need_
 * macros are defined, then only that subset of interfaces are provided. This
 * can be useful for POSIX headers that need to not expose all of stddef.h, but
 * need to use some of its interfaces. Otherwise this header provides all of
 * the expected interfaces.
 *
 * When clang modules are enabled, this header is a textual header to support
 * the multiple include behavior. As such, it doesn't directly declare anything
 * so that it doesn't add duplicate declarations to all of its includers'
 * modules.
 */
#if defined(__MVS__) && __has_include_next(<stddef.h>)
#undef __need_ptrdiff_t
#undef __need_size_t
#undef __need_rsize_t
#undef __need_wchar_t
#undef __need_NULL
#undef __need_nullptr_t
#undef __need_unreachable
#undef __need_max_align_t
#undef __need_offsetof
#undef __need_wint_t
#include <__stddef_header_macro.h>
#include_next <stddef.h>

#else

#if !defined(__need_ptrdiff_t) && !defined(__need_size_t) &&                   \\
    !defined(__need_rsize_t) && !defined(__need_wchar_t) &&                    \\
    !defined(__need_NULL) && !defined(__need_nullptr_t) &&                     \\
    !defined(__need_unreachable) && !defined(__need_max_align_t) &&            \\
    !defined(__need_offsetof) && !defined(__need_wint_t)
#define __need_ptrdiff_t
#define __need_size_t
/* ISO9899:2011 7.20 (C11 Annex K): Define rsize_t if __STDC_WANT_LIB_EXT1__ is
 * enabled. */
#if defined(__STDC_WANT_LIB_EXT1__) && __STDC_WANT_LIB_EXT1__ >= 1
#define __need_rsize_t
#endif
#define __need_wchar_t
#if !defined(__STDDEF_H) || __has_feature(modules)
/*
 * __stddef_null.h is special when building without modules: if __need_NULL is
 * set, then it will unconditionally redefine NULL. To avoid stepping on client
 * definitions of NULL, __need_NULL should only be set the first time this
 * header is included, that is when __STDDEF_H is not defined. However, when
 * building with modules, this header is a textual header and needs to
 * unconditionally include __stdef_null.h to support multiple submodules
 * exporting _Builtin_stddef.null. Take module SM with submodules A and B, whose
 * headers both include stddef.h When SM.A builds, __STDDEF_H will be defined.
 * When SM.B builds, the definition from SM.A will leak when building without
 * local submodule visibility. stddef.h wouldn't include __stddef_null.h, and
 * SM.B wouldn't import _Builtin_stddef.null, and SM.B's \`export *\` wouldn't
 * export NULL as expected. When building with modules, always include
 * __stddef_null.h so that everything works as expected.
 */
#define __need_NULL
#endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L) ||              \\
    defined(__cplusplus)
#define __need_nullptr_t
#endif
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define __need_unreachable
#endif
#if (defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L) ||              \\
    (defined(__cplusplus) && __cplusplus >= 201103L)
#define __need_max_align_t
#endif
#define __need_offsetof
/* wint_t is provided by <wchar.h> and not <stddef.h>. It's here
 * for compatibility, but must be explicitly requested. Therefore
 * __need_wint_t is intentionally not defined here. */
#include <__stddef_header_macro.h>
#endif

#if defined(__need_ptrdiff_t)
#include <__stddef_ptrdiff_t.h>
#undef __need_ptrdiff_t
#endif /* defined(__need_ptrdiff_t) */

#if defined(__need_size_t)
#include <__stddef_size_t.h>
#undef __need_size_t
#endif /*defined(__need_size_t) */

#if defined(__need_rsize_t)
#include <__stddef_rsize_t.h>
#undef __need_rsize_t
#endif /* defined(__need_rsize_t) */

#if defined(__need_wchar_t)
#include <__stddef_wchar_t.h>
#undef __need_wchar_t
#endif /* defined(__need_wchar_t) */

#if defined(__need_NULL)
#include <__stddef_null.h>
#undef __need_NULL
#endif /* defined(__need_NULL) */

#if defined(__need_nullptr_t)
#include <__stddef_nullptr_t.h>
#undef __need_nullptr_t
#endif /* defined(__need_nullptr_t) */

#if defined(__need_unreachable)
#include <__stddef_unreachable.h>
#undef __need_unreachable
#endif /* defined(__need_unreachable) */

#if defined(__need_max_align_t)
#include <__stddef_max_align_t.h>
#undef __need_max_align_t
#endif /* defined(__need_max_align_t) */

#if defined(__need_offsetof)
#include <__stddef_offsetof.h>
#undef __need_offsetof
#endif /* defined(__need_offsetof) */

/* Some C libraries expect to see a wint_t here. Others (notably MinGW) will use
__WINT_TYPE__ directly; accommodate both by requiring __need_wint_t */
#if defined(__need_wint_t)
#include <__stddef_wint_t.h>
#undef __need_wint_t
#endif /* __need_wint_t */

#endif /* __MVS__ */
`,"stddefer.h":`/*===---- stddefer.h - Standard header for 'defer' -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_STDDEFER_H
#define __CLANG_STDDEFER_H

/* Provide 'defer' if '_Defer' is supported. */
#ifdef __STDC_DEFER_TS25755__
#define __STDC_VERSION_STDDEFER_H__ 202602L
#define defer _Defer
#endif

#endif /* __CLANG_STDDEFER_H */
`,"__stddef_header_macro.h":`/*===---- __stddef_header_macro.h ------------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDDEF_H
#define __STDDEF_H
#endif
`,"__stddef_max_align_t.h":`/*===---- __stddef_max_align_t.h - Definition of max_align_t ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __CLANG_MAX_ALIGN_T_DEFINED
#define __CLANG_MAX_ALIGN_T_DEFINED

#if defined(_MSC_VER)
typedef double max_align_t;
#elif defined(__APPLE__)
typedef long double max_align_t;
#else
// Define 'max_align_t' to match the GCC definition.
typedef struct {
  long long __clang_max_align_nonce1
      __attribute__((__aligned__(__alignof__(long long))));
  long double __clang_max_align_nonce2
      __attribute__((__aligned__(__alignof__(long double))));
} max_align_t;
#endif

#endif
`,"__stddef_null.h":`/*===---- __stddef_null.h - Definition of NULL -----------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if !defined(NULL) || !__building_module(_Builtin_stddef)

/* linux/stddef.h will define NULL to 0. glibc (and other) headers then define
 * __need_NULL and rely on stddef.h to redefine NULL to the correct value again.
 * Modules don't support redefining macros like that, but support that pattern
 * in the non-modules case.
 */
#undef NULL

#ifdef __cplusplus
#if !defined(__MINGW32__) && !defined(_MSC_VER)
#define NULL __null
#else
#define NULL 0
#endif
#else
#define NULL ((void*)0)
#endif

#endif
`,"__stddef_nullptr_t.h":`/*===---- __stddef_nullptr_t.h - Definition of nullptr_t -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_NULLPTR_T) ||                                                    \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _NULLPTR_T

#ifdef __cplusplus
#if defined(_MSC_EXTENSIONS) && defined(_NATIVE_NULLPTR_SUPPORTED)
namespace std {
typedef decltype(nullptr) nullptr_t;
}
using ::std::nullptr_t;
#endif
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
typedef typeof(nullptr) nullptr_t;
#endif

#endif
`,"__stddef_offsetof.h":`/*===---- __stddef_offsetof.h - Definition of offsetof ---------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(offsetof) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define offsetof(t, d) __builtin_offsetof(t, d)
#endif
`,"__stddef_ptrdiff_t.h":`/*===---- __stddef_ptrdiff_t.h - Definition of ptrdiff_t -------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_PTRDIFF_T) ||                                                    \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _PTRDIFF_T

typedef __PTRDIFF_TYPE__ ptrdiff_t;

#endif
`,"__stddef_rsize_t.h":`/*===---- __stddef_rsize_t.h - Definition of rsize_t -----------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_RSIZE_T) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _RSIZE_T

typedef __SIZE_TYPE__ rsize_t;

#endif
`,"__stddef_size_t.h":`/*===---- __stddef_size_t.h - Definition of size_t -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_SIZE_T) ||                                                       \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _SIZE_T

typedef __SIZE_TYPE__ size_t;

#endif
`,"__stddef_unreachable.h":`/*===---- __stddef_unreachable.h - Definition of unreachable ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __cplusplus

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(unreachable) ||                                                   \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define unreachable() __builtin_unreachable()
#endif

#endif
`,"__stddef_wchar_t.h":`/*===---- __stddef_wchar.h - Definition of wchar_t -------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#if !defined(__cplusplus) || (defined(_MSC_VER) && !_NATIVE_WCHAR_T_DEFINED)

/*
 * When -fbuiltin-headers-in-system-modules is set this is a non-modular header
 * and needs to behave as if it was textual.
 */
#if !defined(_WCHAR_T) ||                                                      \\
    (__has_feature(modules) && !__building_module(_Builtin_stddef))
#define _WCHAR_T

#ifdef _MSC_EXTENSIONS
#define _WCHAR_T_DEFINED
#endif

typedef __WCHAR_TYPE__ wchar_t;

#endif

#endif
`,"__stddef_wint_t.h":`/*===---- __stddef_wint.h - Definition of wint_t ---------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef _WINT_T
#define _WINT_T

typedef __WINT_TYPE__ wint_t;

#endif
`,"stdint.h":`/*===---- stdint.h - Standard header for sized integer types --------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_STDINT_H
// AIX system headers need stdint.h to be re-enterable while _STD_TYPES_T
// is defined until an inclusion of it without _STD_TYPES_T occurs, in which
// case the header guard macro is defined.
#if !defined(_AIX) || !defined(_STD_TYPES_T) || !defined(__STDC_HOSTED__)
#define __CLANG_STDINT_H
#endif

#if defined(__MVS__) && __has_include_next(<stdint.h>)
#include_next <stdint.h>
#else

/* If we're hosted, fall back to the system's stdint.h, which might have
 * additional definitions.
 */
#if __STDC_HOSTED__ && __has_include_next(<stdint.h>)

// C99 7.18.3 Limits of other integer types
//
//  Footnote 219, 220: C++ implementations should define these macros only when
//  __STDC_LIMIT_MACROS is defined before <stdint.h> is included.
//
//  Footnote 222: C++ implementations should define these macros only when
//  __STDC_CONSTANT_MACROS is defined before <stdint.h> is included.
//
// C++11 [cstdint.syn]p2:
//
//  The macros defined by <cstdint> are provided unconditionally. In particular,
//  the symbols __STDC_LIMIT_MACROS and __STDC_CONSTANT_MACROS (mentioned in
//  footnotes 219, 220, and 222 in the C standard) play no role in C++.
//
// C11 removed the problematic footnotes.
//
// Work around this inconsistency by always defining those macros in C++ mode,
// so that a C library implementation which follows the C99 standard can be
// used in C++.
# ifdef __cplusplus
#  if !defined(__STDC_LIMIT_MACROS)
#   define __STDC_LIMIT_MACROS
#   define __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
#  endif
#  if !defined(__STDC_CONSTANT_MACROS)
#   define __STDC_CONSTANT_MACROS
#   define __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
#  endif
# endif

# include_next <stdint.h>

# ifdef __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
#  undef __STDC_LIMIT_MACROS
#  undef __STDC_LIMIT_MACROS_DEFINED_BY_CLANG
# endif
# ifdef __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
#  undef __STDC_CONSTANT_MACROS
#  undef __STDC_CONSTANT_MACROS_DEFINED_BY_CLANG
# endif

#else

/* C99 7.18.1.1 Exact-width integer types.
 * C99 7.18.1.2 Minimum-width integer types.
 * C99 7.18.1.3 Fastest minimum-width integer types.
 *
 * The standard requires that exact-width type be defined for 8-, 16-, 32-, and
 * 64-bit types if they are implemented. Other exact width types are optional.
 * This implementation defines an exact-width types for every integer width
 * that is represented in the standard integer types.
 *
 * The standard also requires minimum-width types be defined for 8-, 16-, 32-,
 * and 64-bit widths regardless of whether there are corresponding exact-width
 * types.
 *
 * To accommodate targets that are missing types that are exactly 8, 16, 32, or
 * 64 bits wide, this implementation takes an approach of cascading
 * redefinitions, redefining __int_leastN_t to successively smaller exact-width
 * types. It is therefore important that the types are defined in order of
 * descending widths.
 *
 * We currently assume that the minimum-width types and the fastest
 * minimum-width types are the same. This is allowed by the standard, but is
 * suboptimal.
 *
 * In violation of the standard, some targets do not implement a type that is
 * wide enough to represent all of the required widths (8-, 16-, 32-, 64-bit).
 * To accommodate these targets, a required minimum-width type is only
 * defined if there exists an exact-width type of equal or greater width.
 */

#ifdef __INT64_TYPE__
# ifndef __int8_t_defined /* glibc sys/types.h also defines int64_t*/
typedef __INT64_TYPE__ int64_t;
# endif /* __int8_t_defined */
typedef __UINT64_TYPE__ uint64_t;
# undef __int_least64_t
# define __int_least64_t int64_t
# undef __uint_least64_t
# define __uint_least64_t uint64_t
# undef __int_least32_t
# define __int_least32_t int64_t
# undef __uint_least32_t
# define __uint_least32_t uint64_t
# undef __int_least16_t
# define __int_least16_t int64_t
# undef __uint_least16_t
# define __uint_least16_t uint64_t
# undef __int_least8_t
# define __int_least8_t int64_t
# undef __uint_least8_t
# define __uint_least8_t uint64_t
#endif /* __INT64_TYPE__ */

#ifdef __int_least64_t
typedef __int_least64_t int_least64_t;
typedef __uint_least64_t uint_least64_t;
typedef __int_least64_t int_fast64_t;
typedef __uint_least64_t uint_fast64_t;
#endif /* __int_least64_t */

#ifdef __INT56_TYPE__
typedef __INT56_TYPE__ int56_t;
typedef __UINT56_TYPE__ uint56_t;
typedef int56_t int_least56_t;
typedef uint56_t uint_least56_t;
typedef int56_t int_fast56_t;
typedef uint56_t uint_fast56_t;
# undef __int_least32_t
# define __int_least32_t int56_t
# undef __uint_least32_t
# define __uint_least32_t uint56_t
# undef __int_least16_t
# define __int_least16_t int56_t
# undef __uint_least16_t
# define __uint_least16_t uint56_t
# undef __int_least8_t
# define __int_least8_t int56_t
# undef __uint_least8_t
# define __uint_least8_t uint56_t
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
typedef __INT48_TYPE__ int48_t;
typedef __UINT48_TYPE__ uint48_t;
typedef int48_t int_least48_t;
typedef uint48_t uint_least48_t;
typedef int48_t int_fast48_t;
typedef uint48_t uint_fast48_t;
# undef __int_least32_t
# define __int_least32_t int48_t
# undef __uint_least32_t
# define __uint_least32_t uint48_t
# undef __int_least16_t
# define __int_least16_t int48_t
# undef __uint_least16_t
# define __uint_least16_t uint48_t
# undef __int_least8_t
# define __int_least8_t int48_t
# undef __uint_least8_t
# define __uint_least8_t uint48_t
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
typedef __INT40_TYPE__ int40_t;
typedef __UINT40_TYPE__ uint40_t;
typedef int40_t int_least40_t;
typedef uint40_t uint_least40_t;
typedef int40_t int_fast40_t;
typedef uint40_t uint_fast40_t;
# undef __int_least32_t
# define __int_least32_t int40_t
# undef __uint_least32_t
# define __uint_least32_t uint40_t
# undef __int_least16_t
# define __int_least16_t int40_t
# undef __uint_least16_t
# define __uint_least16_t uint40_t
# undef __int_least8_t
# define __int_least8_t int40_t
# undef __uint_least8_t
# define __uint_least8_t uint40_t
#endif /* __INT40_TYPE__ */


#ifdef __INT32_TYPE__

# ifndef __int8_t_defined /* glibc sys/types.h also defines int32_t*/
typedef __INT32_TYPE__ int32_t;
# endif /* __int8_t_defined */

# ifndef __uint32_t_defined  /* more glibc compatibility */
# define __uint32_t_defined
typedef __UINT32_TYPE__ uint32_t;
# endif /* __uint32_t_defined */

# undef __int_least32_t
# define __int_least32_t int32_t
# undef __uint_least32_t
# define __uint_least32_t uint32_t
# undef __int_least16_t
# define __int_least16_t int32_t
# undef __uint_least16_t
# define __uint_least16_t uint32_t
# undef __int_least8_t
# define __int_least8_t int32_t
# undef __uint_least8_t
# define __uint_least8_t uint32_t
#endif /* __INT32_TYPE__ */

#ifdef __int_least32_t
typedef __int_least32_t int_least32_t;
typedef __uint_least32_t uint_least32_t;
typedef __int_least32_t int_fast32_t;
typedef __uint_least32_t uint_fast32_t;
#endif /* __int_least32_t */

#ifdef __INT24_TYPE__
typedef __INT24_TYPE__ int24_t;
typedef __UINT24_TYPE__ uint24_t;
typedef int24_t int_least24_t;
typedef uint24_t uint_least24_t;
typedef int24_t int_fast24_t;
typedef uint24_t uint_fast24_t;
# undef __int_least16_t
# define __int_least16_t int24_t
# undef __uint_least16_t
# define __uint_least16_t uint24_t
# undef __int_least8_t
# define __int_least8_t int24_t
# undef __uint_least8_t
# define __uint_least8_t uint24_t
#endif /* __INT24_TYPE__ */

#ifdef __INT16_TYPE__
#ifndef __int8_t_defined /* glibc sys/types.h also defines int16_t*/
typedef __INT16_TYPE__ int16_t;
#endif /* __int8_t_defined */
typedef __UINT16_TYPE__ uint16_t;
# undef __int_least16_t
# define __int_least16_t int16_t
# undef __uint_least16_t
# define __uint_least16_t uint16_t
# undef __int_least8_t
# define __int_least8_t int16_t
# undef __uint_least8_t
# define __uint_least8_t uint16_t
#endif /* __INT16_TYPE__ */

#ifdef __int_least16_t
typedef __int_least16_t int_least16_t;
typedef __uint_least16_t uint_least16_t;
typedef __int_least16_t int_fast16_t;
typedef __uint_least16_t uint_fast16_t;
#endif /* __int_least16_t */


#ifdef __INT8_TYPE__
#ifndef __int8_t_defined  /* glibc sys/types.h also defines int8_t*/
typedef __INT8_TYPE__ int8_t;
#endif /* __int8_t_defined */
typedef __UINT8_TYPE__ uint8_t;
# undef __int_least8_t
# define __int_least8_t int8_t
# undef __uint_least8_t
# define __uint_least8_t uint8_t
#endif /* __INT8_TYPE__ */

#ifdef __int_least8_t
typedef __int_least8_t int_least8_t;
typedef __uint_least8_t uint_least8_t;
typedef __int_least8_t int_fast8_t;
typedef __uint_least8_t uint_fast8_t;
#endif /* __int_least8_t */

/* prevent glibc sys/types.h from defining conflicting types */
#ifndef __int8_t_defined
# define __int8_t_defined
#endif /* __int8_t_defined */

/* C99 7.18.1.4 Integer types capable of holding object pointers.
 */
#define __stdint_join3(a,b,c) a ## b ## c

#ifndef _INTPTR_T
#ifndef __intptr_t_defined
typedef __INTPTR_TYPE__ intptr_t;
#define __intptr_t_defined
#define _INTPTR_T
#endif
#endif

#ifndef _UINTPTR_T
typedef __UINTPTR_TYPE__ uintptr_t;
#define _UINTPTR_T
#endif

/* C99 7.18.1.5 Greatest-width integer types.
 */
typedef __INTMAX_TYPE__  intmax_t;
typedef __UINTMAX_TYPE__ uintmax_t;

/* C99 7.18.4 Macros for minimum-width integer constants.
 *
 * The standard requires that integer constant macros be defined for all the
 * minimum-width types defined above. As 8-, 16-, 32-, and 64-bit minimum-width
 * types are required, the corresponding integer constant macros are defined
 * here. This implementation also defines minimum-width types for every other
 * integer width that the target implements, so corresponding macros are
 * defined below, too.
 *
 * Note that C++ should not check __STDC_CONSTANT_MACROS here, contrary to the
 * claims of the C standard (see C++ 18.3.1p2, [cstdint.syn]).
 */

#ifdef __int_least64_t
#define INT64_C(v) __INT64_C(v)
#define UINT64_C(v) __UINT64_C(v)
#endif /* __int_least64_t */


#ifdef __INT56_TYPE__
#define INT56_C(v) __INT56_C(v)
#define UINT56_C(v) __UINT56_C(v)
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
#define INT48_C(v) __INT48_C(v)
#define UINT48_C(v) __UINT48_C(v)
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
#define INT40_C(v) __INT40_C(v)
#define UINT40_C(v) __UINT40_C(v)
#endif /* __INT40_TYPE__ */


#ifdef __int_least32_t
#define INT32_C(v) __INT32_C(v)
#define UINT32_C(v) __UINT32_C(v)
#endif /* __int_least32_t */


#ifdef __INT24_TYPE__
#define INT24_C(v) __INT24_C(v)
#define UINT24_C(v) __UINT24_C(v)
#endif /* __INT24_TYPE__ */


#ifdef __int_least16_t
#define INT16_C(v) __INT16_C(v)
#define UINT16_C(v) __UINT16_C(v)
#endif /* __int_least16_t */


#ifdef __int_least8_t
#define INT8_C(v) __INT8_C(v)
#define UINT8_C(v) __UINT8_C(v)
#endif /* __int_least8_t */


/* C99 7.18.2.1 Limits of exact-width integer types.
 * C99 7.18.2.2 Limits of minimum-width integer types.
 * C99 7.18.2.3 Limits of fastest minimum-width integer types.
 *
 * The presence of limit macros are completely optional in C99.  This
 * implementation defines limits for all of the types (exact- and
 * minimum-width) that it defines above, using the limits of the minimum-width
 * type for any types that do not have exact-width representations.
 *
 * As in the type definitions, this section takes an approach of
 * successive-shrinking to determine which limits to use for the standard (8,
 * 16, 32, 64) bit widths when they don't have exact representations. It is
 * therefore important that the definitions be kept in order of decending
 * widths.
 *
 * Note that C++ should not check __STDC_LIMIT_MACROS here, contrary to the
 * claims of the C standard (see C++ 18.3.1p2, [cstdint.syn]).
 */

#ifdef __INT64_TYPE__
# define INT64_MAX           INT64_C( 9223372036854775807)
# define INT64_MIN         (-INT64_C( 9223372036854775807)-1)
# define UINT64_MAX         UINT64_C(18446744073709551615)

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT64_WIDTH         64
# define INT64_WIDTH          UINT64_WIDTH

# define __UINT_LEAST64_WIDTH UINT64_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT64_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT64_WIDTH
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX UINT64_MAX
#endif /* __STDC_VERSION__ */

# define __INT_LEAST64_MIN   INT64_MIN
# define __INT_LEAST64_MAX   INT64_MAX
# define __UINT_LEAST64_MAX UINT64_MAX
# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT64_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT64_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT64_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT64_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT64_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT64_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT64_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT64_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT64_MAX
#endif /* __INT64_TYPE__ */

#ifdef __INT_LEAST64_MIN
# define INT_LEAST64_MIN   __INT_LEAST64_MIN
# define INT_LEAST64_MAX   __INT_LEAST64_MAX
# define UINT_LEAST64_MAX __UINT_LEAST64_MAX
# define INT_FAST64_MIN    __INT_LEAST64_MIN
# define INT_FAST64_MAX    __INT_LEAST64_MAX
# define UINT_FAST64_MAX  __UINT_LEAST64_MAX

#if defined(__STDC_VERSION__) &&  __STDC_VERSION__ >= 202311L
# define UINT_LEAST64_WIDTH __UINT_LEAST64_WIDTH
# define INT_LEAST64_WIDTH  UINT_LEAST64_WIDTH
# define UINT_FAST64_WIDTH  __UINT_LEAST64_WIDTH
# define INT_FAST64_WIDTH   UINT_FAST64_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST64_MIN */


#ifdef __INT56_TYPE__
# define INT56_MAX           INT56_C(36028797018963967)
# define INT56_MIN         (-INT56_C(36028797018963967)-1)
# define UINT56_MAX         UINT56_C(72057594037927935)
# define INT_LEAST56_MIN     INT56_MIN
# define INT_LEAST56_MAX     INT56_MAX
# define UINT_LEAST56_MAX   UINT56_MAX
# define INT_FAST56_MIN      INT56_MIN
# define INT_FAST56_MAX      INT56_MAX
# define UINT_FAST56_MAX    UINT56_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT56_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT56_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT56_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT56_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT56_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT56_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT56_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT56_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT56_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT56_WIDTH         56
# define INT56_WIDTH          UINT56_WIDTH
# define UINT_LEAST56_WIDTH   UINT56_WIDTH
# define INT_LEAST56_WIDTH    UINT_LEAST56_WIDTH
# define UINT_FAST56_WIDTH    UINT56_WIDTH
# define INT_FAST56_WIDTH     UINT_FAST56_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT56_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT56_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT56_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT56_TYPE__ */


#ifdef __INT48_TYPE__
# define INT48_MAX           INT48_C(140737488355327)
# define INT48_MIN         (-INT48_C(140737488355327)-1)
# define UINT48_MAX         UINT48_C(281474976710655)
# define INT_LEAST48_MIN     INT48_MIN
# define INT_LEAST48_MAX     INT48_MAX
# define UINT_LEAST48_MAX   UINT48_MAX
# define INT_FAST48_MIN      INT48_MIN
# define INT_FAST48_MAX      INT48_MAX
# define UINT_FAST48_MAX    UINT48_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT48_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT48_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT48_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT48_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT48_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT48_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT48_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT48_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT48_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define UINT48_WIDTH         48
#define INT48_WIDTH          UINT48_WIDTH
#define UINT_LEAST48_WIDTH   UINT48_WIDTH
#define INT_LEAST48_WIDTH    UINT_LEAST48_WIDTH
#define UINT_FAST48_WIDTH    UINT48_WIDTH
#define INT_FAST48_WIDTH     UINT_FAST48_WIDTH
#undef __UINT_LEAST32_WIDTH
#define __UINT_LEAST32_WIDTH UINT48_WIDTH
# undef __UINT_LEAST16_WIDTH
#define __UINT_LEAST16_WIDTH UINT48_WIDTH
# undef __UINT_LEAST8_WIDTH
#define __UINT_LEAST8_WIDTH  UINT48_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT48_TYPE__ */


#ifdef __INT40_TYPE__
# define INT40_MAX           INT40_C(549755813887)
# define INT40_MIN         (-INT40_C(549755813887)-1)
# define UINT40_MAX         UINT40_C(1099511627775)
# define INT_LEAST40_MIN     INT40_MIN
# define INT_LEAST40_MAX     INT40_MAX
# define UINT_LEAST40_MAX   UINT40_MAX
# define INT_FAST40_MIN      INT40_MIN
# define INT_FAST40_MAX      INT40_MAX
# define UINT_FAST40_MAX    UINT40_MAX

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT40_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT40_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT40_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT40_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT40_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT40_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT40_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT40_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT40_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT40_WIDTH         40
# define INT40_WIDTH          UINT40_WIDTH
# define UINT_LEAST40_WIDTH   UINT40_WIDTH
# define INT_LEAST40_WIDTH    UINT_LEAST40_WIDTH
# define UINT_FAST40_WIDTH    UINT40_WIDTH
# define INT_FAST40_WIDTH     UINT_FAST40_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT40_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT40_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT40_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT40_TYPE__ */


#ifdef __INT32_TYPE__
# define INT32_MAX           INT32_C(2147483647)
# define INT32_MIN         (-INT32_C(2147483647)-1)
# define UINT32_MAX         UINT32_C(4294967295)

# undef __INT_LEAST32_MIN
# define __INT_LEAST32_MIN   INT32_MIN
# undef __INT_LEAST32_MAX
# define __INT_LEAST32_MAX   INT32_MAX
# undef __UINT_LEAST32_MAX
# define __UINT_LEAST32_MAX UINT32_MAX
# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT32_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT32_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT32_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT32_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT32_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT32_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT32_WIDTH         32
# define INT32_WIDTH          UINT32_WIDTH
# undef __UINT_LEAST32_WIDTH
# define __UINT_LEAST32_WIDTH UINT32_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT32_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT32_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT32_TYPE__ */

#ifdef __INT_LEAST32_MIN
# define INT_LEAST32_MIN   __INT_LEAST32_MIN
# define INT_LEAST32_MAX   __INT_LEAST32_MAX
# define UINT_LEAST32_MAX __UINT_LEAST32_MAX
# define INT_FAST32_MIN    __INT_LEAST32_MIN
# define INT_FAST32_MAX    __INT_LEAST32_MAX
# define UINT_FAST32_MAX  __UINT_LEAST32_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST32_WIDTH __UINT_LEAST32_WIDTH
# define INT_LEAST32_WIDTH  UINT_LEAST32_WIDTH
# define UINT_FAST32_WIDTH  __UINT_LEAST32_WIDTH
# define INT_FAST32_WIDTH   UINT_FAST32_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST32_MIN */


#ifdef __INT24_TYPE__
# define INT24_MAX           INT24_C(8388607)
# define INT24_MIN         (-INT24_C(8388607)-1)
# define UINT24_MAX         UINT24_C(16777215)
# define INT_LEAST24_MIN     INT24_MIN
# define INT_LEAST24_MAX     INT24_MAX
# define UINT_LEAST24_MAX   UINT24_MAX
# define INT_FAST24_MIN      INT24_MIN
# define INT_FAST24_MAX      INT24_MAX
# define UINT_FAST24_MAX    UINT24_MAX

# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT24_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT24_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT24_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT24_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT24_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT24_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT24_WIDTH         24
# define INT24_WIDTH          UINT24_WIDTH
# define UINT_LEAST24_WIDTH   UINT24_WIDTH
# define INT_LEAST24_WIDTH    UINT_LEAST24_WIDTH
# define UINT_FAST24_WIDTH    UINT24_WIDTH
# define INT_FAST24_WIDTH     UINT_FAST24_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT24_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT24_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT24_TYPE__ */


#ifdef __INT16_TYPE__
#define INT16_MAX            INT16_C(32767)
#define INT16_MIN          (-INT16_C(32767)-1)
#define UINT16_MAX          UINT16_C(65535)

# undef __INT_LEAST16_MIN
# define __INT_LEAST16_MIN   INT16_MIN
# undef __INT_LEAST16_MAX
# define __INT_LEAST16_MAX   INT16_MAX
# undef __UINT_LEAST16_MAX
# define __UINT_LEAST16_MAX UINT16_MAX
# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT16_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT16_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT16_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT16_WIDTH         16
# define INT16_WIDTH          UINT16_WIDTH
# undef __UINT_LEAST16_WIDTH
# define __UINT_LEAST16_WIDTH UINT16_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH  UINT16_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT16_TYPE__ */

#ifdef __INT_LEAST16_MIN
# define INT_LEAST16_MIN   __INT_LEAST16_MIN
# define INT_LEAST16_MAX   __INT_LEAST16_MAX
# define UINT_LEAST16_MAX __UINT_LEAST16_MAX
# define INT_FAST16_MIN    __INT_LEAST16_MIN
# define INT_FAST16_MAX    __INT_LEAST16_MAX
# define UINT_FAST16_MAX  __UINT_LEAST16_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST16_WIDTH __UINT_LEAST16_WIDTH
# define INT_LEAST16_WIDTH  UINT_LEAST16_WIDTH
# define UINT_FAST16_WIDTH  __UINT_LEAST16_WIDTH
# define INT_FAST16_WIDTH   UINT_FAST16_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST16_MIN */


#ifdef __INT8_TYPE__
# define INT8_MAX            INT8_C(127)
# define INT8_MIN          (-INT8_C(127)-1)
# define UINT8_MAX          UINT8_C(255)

# undef __INT_LEAST8_MIN
# define __INT_LEAST8_MIN    INT8_MIN
# undef __INT_LEAST8_MAX
# define __INT_LEAST8_MAX    INT8_MAX
# undef __UINT_LEAST8_MAX
# define __UINT_LEAST8_MAX  UINT8_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT8_WIDTH         8
# define INT8_WIDTH          UINT8_WIDTH
# undef __UINT_LEAST8_WIDTH
# define __UINT_LEAST8_WIDTH UINT8_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT8_TYPE__ */

#ifdef __INT_LEAST8_MIN
# define INT_LEAST8_MIN   __INT_LEAST8_MIN
# define INT_LEAST8_MAX   __INT_LEAST8_MAX
# define UINT_LEAST8_MAX __UINT_LEAST8_MAX
# define INT_FAST8_MIN    __INT_LEAST8_MIN
# define INT_FAST8_MAX    __INT_LEAST8_MAX
# define UINT_FAST8_MAX  __UINT_LEAST8_MAX

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
# define UINT_LEAST8_WIDTH __UINT_LEAST8_WIDTH
# define INT_LEAST8_WIDTH  UINT_LEAST8_WIDTH
# define UINT_FAST8_WIDTH  __UINT_LEAST8_WIDTH
# define INT_FAST8_WIDTH   UINT_FAST8_WIDTH
#endif /* __STDC_VERSION__ */
#endif /* __INT_LEAST8_MIN */

/* Some utility macros */
#define  __INTN_MIN(n)  __stdint_join3( INT, n, _MIN)
#define  __INTN_MAX(n)  __stdint_join3( INT, n, _MAX)
#define __UINTN_MAX(n)  __stdint_join3(UINT, n, _MAX)
#define  __INTN_C(n, v) __stdint_join3( INT, n, _C(v))
#define __UINTN_C(n, v) __stdint_join3(UINT, n, _C(v))

/* C99 7.18.2.4 Limits of integer types capable of holding object pointers. */
/* C99 7.18.3 Limits of other integer types. */

#define  INTPTR_MIN  (-__INTPTR_MAX__-1)
#define  INTPTR_MAX    __INTPTR_MAX__
#define UINTPTR_MAX   __UINTPTR_MAX__
#define PTRDIFF_MIN (-__PTRDIFF_MAX__-1)
#define PTRDIFF_MAX   __PTRDIFF_MAX__
#define    SIZE_MAX      __SIZE_MAX__

/* C23 7.22.2.4 Width of integer types capable of holding object pointers. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* NB: The C standard requires that these be the same value, but the compiler
   exposes separate internal width macros. */
#define INTPTR_WIDTH  __INTPTR_WIDTH__
#define UINTPTR_WIDTH __UINTPTR_WIDTH__
#endif

/* ISO9899:2011 7.20 (C11 Annex K): Define RSIZE_MAX if __STDC_WANT_LIB_EXT1__
 * is enabled. */
#if defined(__STDC_WANT_LIB_EXT1__) && __STDC_WANT_LIB_EXT1__ >= 1
#define   RSIZE_MAX            (SIZE_MAX >> 1)
#endif

/* C99 7.18.2.5 Limits of greatest-width integer types. */
#define  INTMAX_MIN (-__INTMAX_MAX__-1)
#define  INTMAX_MAX   __INTMAX_MAX__
#define UINTMAX_MAX  __UINTMAX_MAX__

/* C23 7.22.2.5 Width of greatest-width integer types. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
/* NB: The C standard requires that these be the same value, but the compiler
   exposes separate internal width macros. */
#define INTMAX_WIDTH __INTMAX_WIDTH__
#define UINTMAX_WIDTH __UINTMAX_WIDTH__
#endif

/* C99 7.18.3 Limits of other integer types. */
#define SIG_ATOMIC_MIN __INTN_MIN(__SIG_ATOMIC_WIDTH__)
#define SIG_ATOMIC_MAX __INTN_MAX(__SIG_ATOMIC_WIDTH__)
#ifdef __WINT_UNSIGNED__
# define WINT_MIN       __UINTN_C(__WINT_WIDTH__, 0)
# define WINT_MAX       __UINTN_MAX(__WINT_WIDTH__)
#else
# define WINT_MIN       __INTN_MIN(__WINT_WIDTH__)
# define WINT_MAX       __INTN_MAX(__WINT_WIDTH__)
#endif

#ifndef WCHAR_MAX
# define WCHAR_MAX __WCHAR_MAX__
#endif
#ifndef WCHAR_MIN
# if __WCHAR_MAX__ == __INTN_MAX(__WCHAR_WIDTH__)
#  define WCHAR_MIN __INTN_MIN(__WCHAR_WIDTH__)
# else
#  define WCHAR_MIN __UINTN_C(__WCHAR_WIDTH__, 0)
# endif
#endif

/* 7.18.4.2 Macros for greatest-width integer constants. */
#define  INTMAX_C(v) __INTMAX_C(v)
#define UINTMAX_C(v) __UINTMAX_C(v)

/* C23 7.22.3.x Width of other integer types. */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 202311L
#define PTRDIFF_WIDTH    __PTRDIFF_WIDTH__
#define SIG_ATOMIC_WIDTH __SIG_ATOMIC_WIDTH__
#define SIZE_WIDTH       __SIZE_WIDTH__
#define WCHAR_WIDTH      __WCHAR_WIDTH__
#define WINT_WIDTH       __WINT_WIDTH__
#endif

#endif /* __STDC_HOSTED__ */
#endif /* __MVS__ */
#endif /* __CLANG_STDINT_H */
`,"stdnoreturn.h":`/*===---- stdnoreturn.h - Standard header for noreturn macro ---------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

#ifndef __STDNORETURN_H
#define __STDNORETURN_H

#if defined(__MVS__) && __has_include_next(<stdnoreturn.h>)
#include_next <stdnoreturn.h>
#else

#define noreturn _Noreturn
#define __noreturn_is_defined 1

#endif /* __MVS__ */

#if (defined(__STDC_VERSION__) && __STDC_VERSION__ > 201710L) &&               \\
    !defined(_CLANG_DISABLE_CRT_DEPRECATION_WARNINGS)
/* The noreturn macro is deprecated in C23. We do not mark it as such because
   including the header file in C23 is also deprecated and we do not want to
   issue a confusing diagnostic for code which includes <stdnoreturn.h>
   followed by code that writes [[noreturn]]. The issue with such code is not
   with the attribute, or the use of 'noreturn', but the inclusion of the
   header. */
/* FIXME: We should be issuing a deprecation warning here, but cannot yet due
 * to system headers which include this header file unconditionally.
 */
#endif

#endif /* __STDNORETURN_H */
`,"tgmath.h":`/*===---- tgmath.h - Standard header for type generic math ----------------===*\\
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
\\*===----------------------------------------------------------------------===*/

#ifndef __CLANG_TGMATH_H
#define __CLANG_TGMATH_H

/* C99 7.22 Type-generic math <tgmath.h>. */
#include <math.h>

/*
 * Allow additional definitions and implementation-defined values on Apple
 * platforms. This is done after #include <math.h> to avoid depcycle conflicts
 * between libcxx and darwin in C++ modules builds.
 */
#if defined(__APPLE__) && __STDC_HOSTED__ && __has_include_next(<tgmath.h>)
#  include_next <tgmath.h>
#else

/* C++ handles type genericity with overloading in math.h. */
#ifndef __cplusplus
#include <complex.h>

#define _TG_ATTRSp __attribute__((__overloadable__))
#define _TG_ATTRS __attribute__((__overloadable__, __always_inline__))

// promotion

typedef void _Argument_type_is_not_arithmetic;
static _Argument_type_is_not_arithmetic __tg_promote(...)
  __attribute__((__unavailable__,__overloadable__));
static double               _TG_ATTRSp __tg_promote(int);
static double               _TG_ATTRSp __tg_promote(unsigned int);
static double               _TG_ATTRSp __tg_promote(long);
static double               _TG_ATTRSp __tg_promote(unsigned long);
static double               _TG_ATTRSp __tg_promote(long long);
static double               _TG_ATTRSp __tg_promote(unsigned long long);
static float                _TG_ATTRSp __tg_promote(float);
static double               _TG_ATTRSp __tg_promote(double);
static long double          _TG_ATTRSp __tg_promote(long double);
static float _Complex       _TG_ATTRSp __tg_promote(float _Complex);
static double _Complex      _TG_ATTRSp __tg_promote(double _Complex);
static long double _Complex _TG_ATTRSp __tg_promote(long double _Complex);

#define __tg_promote1(__x)           (__typeof__(__tg_promote(__x)))
#define __tg_promote2(__x, __y)      (__typeof__(__tg_promote(__x) + \\
                                                 __tg_promote(__y)))
#define __tg_promote3(__x, __y, __z) (__typeof__(__tg_promote(__x) + \\
                                                 __tg_promote(__y) + \\
                                                 __tg_promote(__z)))

// acos

static float
    _TG_ATTRS
    __tg_acos(float __x) {return acosf(__x);}

static double
    _TG_ATTRS
    __tg_acos(double __x) {return acos(__x);}

static long double
    _TG_ATTRS
    __tg_acos(long double __x) {return acosl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_acos(float _Complex __x) {return cacosf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_acos(double _Complex __x) {return cacos(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_acos(long double _Complex __x) {return cacosl(__x);}

#undef acos
#define acos(__x) __tg_acos(__tg_promote1((__x))(__x))

// asin

static float
    _TG_ATTRS
    __tg_asin(float __x) {return asinf(__x);}

static double
    _TG_ATTRS
    __tg_asin(double __x) {return asin(__x);}

static long double
    _TG_ATTRS
    __tg_asin(long double __x) {return asinl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_asin(float _Complex __x) {return casinf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_asin(double _Complex __x) {return casin(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_asin(long double _Complex __x) {return casinl(__x);}

#undef asin
#define asin(__x) __tg_asin(__tg_promote1((__x))(__x))

// atan

static float
    _TG_ATTRS
    __tg_atan(float __x) {return atanf(__x);}

static double
    _TG_ATTRS
    __tg_atan(double __x) {return atan(__x);}

static long double
    _TG_ATTRS
    __tg_atan(long double __x) {return atanl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_atan(float _Complex __x) {return catanf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_atan(double _Complex __x) {return catan(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_atan(long double _Complex __x) {return catanl(__x);}

#undef atan
#define atan(__x) __tg_atan(__tg_promote1((__x))(__x))

// acosh

static float
    _TG_ATTRS
    __tg_acosh(float __x) {return acoshf(__x);}

static double
    _TG_ATTRS
    __tg_acosh(double __x) {return acosh(__x);}

static long double
    _TG_ATTRS
    __tg_acosh(long double __x) {return acoshl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_acosh(float _Complex __x) {return cacoshf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_acosh(double _Complex __x) {return cacosh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_acosh(long double _Complex __x) {return cacoshl(__x);}

#undef acosh
#define acosh(__x) __tg_acosh(__tg_promote1((__x))(__x))

// asinh

static float
    _TG_ATTRS
    __tg_asinh(float __x) {return asinhf(__x);}

static double
    _TG_ATTRS
    __tg_asinh(double __x) {return asinh(__x);}

static long double
    _TG_ATTRS
    __tg_asinh(long double __x) {return asinhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_asinh(float _Complex __x) {return casinhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_asinh(double _Complex __x) {return casinh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_asinh(long double _Complex __x) {return casinhl(__x);}

#undef asinh
#define asinh(__x) __tg_asinh(__tg_promote1((__x))(__x))

// atanh

static float
    _TG_ATTRS
    __tg_atanh(float __x) {return atanhf(__x);}

static double
    _TG_ATTRS
    __tg_atanh(double __x) {return atanh(__x);}

static long double
    _TG_ATTRS
    __tg_atanh(long double __x) {return atanhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_atanh(float _Complex __x) {return catanhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_atanh(double _Complex __x) {return catanh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_atanh(long double _Complex __x) {return catanhl(__x);}

#undef atanh
#define atanh(__x) __tg_atanh(__tg_promote1((__x))(__x))

// cos

static float
    _TG_ATTRS
    __tg_cos(float __x) {return cosf(__x);}

static double
    _TG_ATTRS
    __tg_cos(double __x) {return cos(__x);}

static long double
    _TG_ATTRS
    __tg_cos(long double __x) {return cosl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cos(float _Complex __x) {return ccosf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cos(double _Complex __x) {return ccos(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cos(long double _Complex __x) {return ccosl(__x);}

#undef cos
#define cos(__x) __tg_cos(__tg_promote1((__x))(__x))

// sin

static float
    _TG_ATTRS
    __tg_sin(float __x) {return sinf(__x);}

static double
    _TG_ATTRS
    __tg_sin(double __x) {return sin(__x);}

static long double
    _TG_ATTRS
    __tg_sin(long double __x) {return sinl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sin(float _Complex __x) {return csinf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sin(double _Complex __x) {return csin(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sin(long double _Complex __x) {return csinl(__x);}

#undef sin
#define sin(__x) __tg_sin(__tg_promote1((__x))(__x))

// tan

static float
    _TG_ATTRS
    __tg_tan(float __x) {return tanf(__x);}

static double
    _TG_ATTRS
    __tg_tan(double __x) {return tan(__x);}

static long double
    _TG_ATTRS
    __tg_tan(long double __x) {return tanl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_tan(float _Complex __x) {return ctanf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_tan(double _Complex __x) {return ctan(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_tan(long double _Complex __x) {return ctanl(__x);}

#undef tan
#define tan(__x) __tg_tan(__tg_promote1((__x))(__x))

// cosh

static float
    _TG_ATTRS
    __tg_cosh(float __x) {return coshf(__x);}

static double
    _TG_ATTRS
    __tg_cosh(double __x) {return cosh(__x);}

static long double
    _TG_ATTRS
    __tg_cosh(long double __x) {return coshl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cosh(float _Complex __x) {return ccoshf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cosh(double _Complex __x) {return ccosh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cosh(long double _Complex __x) {return ccoshl(__x);}

#undef cosh
#define cosh(__x) __tg_cosh(__tg_promote1((__x))(__x))

// sinh

static float
    _TG_ATTRS
    __tg_sinh(float __x) {return sinhf(__x);}

static double
    _TG_ATTRS
    __tg_sinh(double __x) {return sinh(__x);}

static long double
    _TG_ATTRS
    __tg_sinh(long double __x) {return sinhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sinh(float _Complex __x) {return csinhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sinh(double _Complex __x) {return csinh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sinh(long double _Complex __x) {return csinhl(__x);}

#undef sinh
#define sinh(__x) __tg_sinh(__tg_promote1((__x))(__x))

// tanh

static float
    _TG_ATTRS
    __tg_tanh(float __x) {return tanhf(__x);}

static double
    _TG_ATTRS
    __tg_tanh(double __x) {return tanh(__x);}

static long double
    _TG_ATTRS
    __tg_tanh(long double __x) {return tanhl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_tanh(float _Complex __x) {return ctanhf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_tanh(double _Complex __x) {return ctanh(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_tanh(long double _Complex __x) {return ctanhl(__x);}

#undef tanh
#define tanh(__x) __tg_tanh(__tg_promote1((__x))(__x))

// exp

static float
    _TG_ATTRS
    __tg_exp(float __x) {return expf(__x);}

static double
    _TG_ATTRS
    __tg_exp(double __x) {return exp(__x);}

static long double
    _TG_ATTRS
    __tg_exp(long double __x) {return expl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_exp(float _Complex __x) {return cexpf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_exp(double _Complex __x) {return cexp(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_exp(long double _Complex __x) {return cexpl(__x);}

#undef exp
#define exp(__x) __tg_exp(__tg_promote1((__x))(__x))

// log

static float
    _TG_ATTRS
    __tg_log(float __x) {return logf(__x);}

static double
    _TG_ATTRS
    __tg_log(double __x) {return log(__x);}

static long double
    _TG_ATTRS
    __tg_log(long double __x) {return logl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_log(float _Complex __x) {return clogf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_log(double _Complex __x) {return clog(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_log(long double _Complex __x) {return clogl(__x);}

#undef log
#define log(__x) __tg_log(__tg_promote1((__x))(__x))

// pow

static float
    _TG_ATTRS
    __tg_pow(float __x, float __y) {return powf(__x, __y);}

static double
    _TG_ATTRS
    __tg_pow(double __x, double __y) {return pow(__x, __y);}

static long double
    _TG_ATTRS
    __tg_pow(long double __x, long double __y) {return powl(__x, __y);}

static float _Complex
    _TG_ATTRS
    __tg_pow(float _Complex __x, float _Complex __y) {return cpowf(__x, __y);}

static double _Complex
    _TG_ATTRS
    __tg_pow(double _Complex __x, double _Complex __y) {return cpow(__x, __y);}

static long double _Complex
    _TG_ATTRS
    __tg_pow(long double _Complex __x, long double _Complex __y)
    {return cpowl(__x, __y);}

#undef pow
#define pow(__x, __y) __tg_pow(__tg_promote2((__x), (__y))(__x), \\
                               __tg_promote2((__x), (__y))(__y))

// sqrt

static float
    _TG_ATTRS
    __tg_sqrt(float __x) {return sqrtf(__x);}

static double
    _TG_ATTRS
    __tg_sqrt(double __x) {return sqrt(__x);}

static long double
    _TG_ATTRS
    __tg_sqrt(long double __x) {return sqrtl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_sqrt(float _Complex __x) {return csqrtf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_sqrt(double _Complex __x) {return csqrt(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_sqrt(long double _Complex __x) {return csqrtl(__x);}

#undef sqrt
#define sqrt(__x) __tg_sqrt(__tg_promote1((__x))(__x))

// fabs

static float
    _TG_ATTRS
    __tg_fabs(float __x) {return fabsf(__x);}

static double
    _TG_ATTRS
    __tg_fabs(double __x) {return fabs(__x);}

static long double
    _TG_ATTRS
    __tg_fabs(long double __x) {return fabsl(__x);}

static float
    _TG_ATTRS
    __tg_fabs(float _Complex __x) {return cabsf(__x);}

static double
    _TG_ATTRS
    __tg_fabs(double _Complex __x) {return cabs(__x);}

static long double
    _TG_ATTRS
    __tg_fabs(long double _Complex __x) {return cabsl(__x);}

#undef fabs
#define fabs(__x) __tg_fabs(__tg_promote1((__x))(__x))

// atan2

static float
    _TG_ATTRS
    __tg_atan2(float __x, float __y) {return atan2f(__x, __y);}

static double
    _TG_ATTRS
    __tg_atan2(double __x, double __y) {return atan2(__x, __y);}

static long double
    _TG_ATTRS
    __tg_atan2(long double __x, long double __y) {return atan2l(__x, __y);}

#undef atan2
#define atan2(__x, __y) __tg_atan2(__tg_promote2((__x), (__y))(__x), \\
                                   __tg_promote2((__x), (__y))(__y))

// cbrt

static float
    _TG_ATTRS
    __tg_cbrt(float __x) {return cbrtf(__x);}

static double
    _TG_ATTRS
    __tg_cbrt(double __x) {return cbrt(__x);}

static long double
    _TG_ATTRS
    __tg_cbrt(long double __x) {return cbrtl(__x);}

#undef cbrt
#define cbrt(__x) __tg_cbrt(__tg_promote1((__x))(__x))

// ceil

static float
    _TG_ATTRS
    __tg_ceil(float __x) {return ceilf(__x);}

static double
    _TG_ATTRS
    __tg_ceil(double __x) {return ceil(__x);}

static long double
    _TG_ATTRS
    __tg_ceil(long double __x) {return ceill(__x);}

#undef ceil
#define ceil(__x) __tg_ceil(__tg_promote1((__x))(__x))

// copysign

static float
    _TG_ATTRS
    __tg_copysign(float __x, float __y) {return copysignf(__x, __y);}

static double
    _TG_ATTRS
    __tg_copysign(double __x, double __y) {return copysign(__x, __y);}

static long double
    _TG_ATTRS
    __tg_copysign(long double __x, long double __y) {return copysignl(__x, __y);}

#undef copysign
#define copysign(__x, __y) __tg_copysign(__tg_promote2((__x), (__y))(__x), \\
                                         __tg_promote2((__x), (__y))(__y))

// erf

static float
    _TG_ATTRS
    __tg_erf(float __x) {return erff(__x);}

static double
    _TG_ATTRS
    __tg_erf(double __x) {return erf(__x);}

static long double
    _TG_ATTRS
    __tg_erf(long double __x) {return erfl(__x);}

#undef erf
#define erf(__x) __tg_erf(__tg_promote1((__x))(__x))

// erfc

static float
    _TG_ATTRS
    __tg_erfc(float __x) {return erfcf(__x);}

static double
    _TG_ATTRS
    __tg_erfc(double __x) {return erfc(__x);}

static long double
    _TG_ATTRS
    __tg_erfc(long double __x) {return erfcl(__x);}

#undef erfc
#define erfc(__x) __tg_erfc(__tg_promote1((__x))(__x))

// exp2

static float
    _TG_ATTRS
    __tg_exp2(float __x) {return exp2f(__x);}

static double
    _TG_ATTRS
    __tg_exp2(double __x) {return exp2(__x);}

static long double
    _TG_ATTRS
    __tg_exp2(long double __x) {return exp2l(__x);}

#undef exp2
#define exp2(__x) __tg_exp2(__tg_promote1((__x))(__x))

// expm1

static float
    _TG_ATTRS
    __tg_expm1(float __x) {return expm1f(__x);}

static double
    _TG_ATTRS
    __tg_expm1(double __x) {return expm1(__x);}

static long double
    _TG_ATTRS
    __tg_expm1(long double __x) {return expm1l(__x);}

#undef expm1
#define expm1(__x) __tg_expm1(__tg_promote1((__x))(__x))

// fdim

static float
    _TG_ATTRS
    __tg_fdim(float __x, float __y) {return fdimf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fdim(double __x, double __y) {return fdim(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fdim(long double __x, long double __y) {return fdiml(__x, __y);}

#undef fdim
#define fdim(__x, __y) __tg_fdim(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// floor

static float
    _TG_ATTRS
    __tg_floor(float __x) {return floorf(__x);}

static double
    _TG_ATTRS
    __tg_floor(double __x) {return floor(__x);}

static long double
    _TG_ATTRS
    __tg_floor(long double __x) {return floorl(__x);}

#undef floor
#define floor(__x) __tg_floor(__tg_promote1((__x))(__x))

// fma

static float
    _TG_ATTRS
    __tg_fma(float __x, float __y, float __z)
    {return fmaf(__x, __y, __z);}

static double
    _TG_ATTRS
    __tg_fma(double __x, double __y, double __z)
    {return fma(__x, __y, __z);}

static long double
    _TG_ATTRS
    __tg_fma(long double __x,long double __y, long double __z)
    {return fmal(__x, __y, __z);}

#undef fma
#define fma(__x, __y, __z)                                \\
        __tg_fma(__tg_promote3((__x), (__y), (__z))(__x), \\
                 __tg_promote3((__x), (__y), (__z))(__y), \\
                 __tg_promote3((__x), (__y), (__z))(__z))

// fmax

static float
    _TG_ATTRS
    __tg_fmax(float __x, float __y) {return fmaxf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmax(double __x, double __y) {return fmax(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmax(long double __x, long double __y) {return fmaxl(__x, __y);}

#undef fmax
#define fmax(__x, __y) __tg_fmax(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// fmin

static float
    _TG_ATTRS
    __tg_fmin(float __x, float __y) {return fminf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmin(double __x, double __y) {return fmin(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmin(long double __x, long double __y) {return fminl(__x, __y);}

#undef fmin
#define fmin(__x, __y) __tg_fmin(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// fmod

static float
    _TG_ATTRS
    __tg_fmod(float __x, float __y) {return fmodf(__x, __y);}

static double
    _TG_ATTRS
    __tg_fmod(double __x, double __y) {return fmod(__x, __y);}

static long double
    _TG_ATTRS
    __tg_fmod(long double __x, long double __y) {return fmodl(__x, __y);}

#undef fmod
#define fmod(__x, __y) __tg_fmod(__tg_promote2((__x), (__y))(__x), \\
                                 __tg_promote2((__x), (__y))(__y))

// frexp

static float
    _TG_ATTRS
    __tg_frexp(float __x, int* __y) {return frexpf(__x, __y);}

static double
    _TG_ATTRS
    __tg_frexp(double __x, int* __y) {return frexp(__x, __y);}

static long double
    _TG_ATTRS
    __tg_frexp(long double __x, int* __y) {return frexpl(__x, __y);}

#undef frexp
#define frexp(__x, __y) __tg_frexp(__tg_promote1((__x))(__x), __y)

// hypot

static float
    _TG_ATTRS
    __tg_hypot(float __x, float __y) {return hypotf(__x, __y);}

static double
    _TG_ATTRS
    __tg_hypot(double __x, double __y) {return hypot(__x, __y);}

static long double
    _TG_ATTRS
    __tg_hypot(long double __x, long double __y) {return hypotl(__x, __y);}

#undef hypot
#define hypot(__x, __y) __tg_hypot(__tg_promote2((__x), (__y))(__x), \\
                                   __tg_promote2((__x), (__y))(__y))

// ilogb

static int
    _TG_ATTRS
    __tg_ilogb(float __x) {return ilogbf(__x);}

static int
    _TG_ATTRS
    __tg_ilogb(double __x) {return ilogb(__x);}

static int
    _TG_ATTRS
    __tg_ilogb(long double __x) {return ilogbl(__x);}

#undef ilogb
#define ilogb(__x) __tg_ilogb(__tg_promote1((__x))(__x))

// ldexp

static float
    _TG_ATTRS
    __tg_ldexp(float __x, int __y) {return ldexpf(__x, __y);}

static double
    _TG_ATTRS
    __tg_ldexp(double __x, int __y) {return ldexp(__x, __y);}

static long double
    _TG_ATTRS
    __tg_ldexp(long double __x, int __y) {return ldexpl(__x, __y);}

#undef ldexp
#define ldexp(__x, __y) __tg_ldexp(__tg_promote1((__x))(__x), __y)

// lgamma

static float
    _TG_ATTRS
    __tg_lgamma(float __x) {return lgammaf(__x);}

static double
    _TG_ATTRS
    __tg_lgamma(double __x) {return lgamma(__x);}

static long double
    _TG_ATTRS
    __tg_lgamma(long double __x) {return lgammal(__x);}

#undef lgamma
#define lgamma(__x) __tg_lgamma(__tg_promote1((__x))(__x))

// llrint

static long long
    _TG_ATTRS
    __tg_llrint(float __x) {return llrintf(__x);}

static long long
    _TG_ATTRS
    __tg_llrint(double __x) {return llrint(__x);}

static long long
    _TG_ATTRS
    __tg_llrint(long double __x) {return llrintl(__x);}

#undef llrint
#define llrint(__x) __tg_llrint(__tg_promote1((__x))(__x))

// llround

static long long
    _TG_ATTRS
    __tg_llround(float __x) {return llroundf(__x);}

static long long
    _TG_ATTRS
    __tg_llround(double __x) {return llround(__x);}

static long long
    _TG_ATTRS
    __tg_llround(long double __x) {return llroundl(__x);}

#undef llround
#define llround(__x) __tg_llround(__tg_promote1((__x))(__x))

// log10

static float
    _TG_ATTRS
    __tg_log10(float __x) {return log10f(__x);}

static double
    _TG_ATTRS
    __tg_log10(double __x) {return log10(__x);}

static long double
    _TG_ATTRS
    __tg_log10(long double __x) {return log10l(__x);}

#undef log10
#define log10(__x) __tg_log10(__tg_promote1((__x))(__x))

// log1p

static float
    _TG_ATTRS
    __tg_log1p(float __x) {return log1pf(__x);}

static double
    _TG_ATTRS
    __tg_log1p(double __x) {return log1p(__x);}

static long double
    _TG_ATTRS
    __tg_log1p(long double __x) {return log1pl(__x);}

#undef log1p
#define log1p(__x) __tg_log1p(__tg_promote1((__x))(__x))

// log2

static float
    _TG_ATTRS
    __tg_log2(float __x) {return log2f(__x);}

static double
    _TG_ATTRS
    __tg_log2(double __x) {return log2(__x);}

static long double
    _TG_ATTRS
    __tg_log2(long double __x) {return log2l(__x);}

#undef log2
#define log2(__x) __tg_log2(__tg_promote1((__x))(__x))

// logb

static float
    _TG_ATTRS
    __tg_logb(float __x) {return logbf(__x);}

static double
    _TG_ATTRS
    __tg_logb(double __x) {return logb(__x);}

static long double
    _TG_ATTRS
    __tg_logb(long double __x) {return logbl(__x);}

#undef logb
#define logb(__x) __tg_logb(__tg_promote1((__x))(__x))

// lrint

static long
    _TG_ATTRS
    __tg_lrint(float __x) {return lrintf(__x);}

static long
    _TG_ATTRS
    __tg_lrint(double __x) {return lrint(__x);}

static long
    _TG_ATTRS
    __tg_lrint(long double __x) {return lrintl(__x);}

#undef lrint
#define lrint(__x) __tg_lrint(__tg_promote1((__x))(__x))

// lround

static long
    _TG_ATTRS
    __tg_lround(float __x) {return lroundf(__x);}

static long
    _TG_ATTRS
    __tg_lround(double __x) {return lround(__x);}

static long
    _TG_ATTRS
    __tg_lround(long double __x) {return lroundl(__x);}

#undef lround
#define lround(__x) __tg_lround(__tg_promote1((__x))(__x))

// nearbyint

static float
    _TG_ATTRS
    __tg_nearbyint(float __x) {return nearbyintf(__x);}

static double
    _TG_ATTRS
    __tg_nearbyint(double __x) {return nearbyint(__x);}

static long double
    _TG_ATTRS
    __tg_nearbyint(long double __x) {return nearbyintl(__x);}

#undef nearbyint
#define nearbyint(__x) __tg_nearbyint(__tg_promote1((__x))(__x))

// nextafter

static float
    _TG_ATTRS
    __tg_nextafter(float __x, float __y) {return nextafterf(__x, __y);}

static double
    _TG_ATTRS
    __tg_nextafter(double __x, double __y) {return nextafter(__x, __y);}

static long double
    _TG_ATTRS
    __tg_nextafter(long double __x, long double __y) {return nextafterl(__x, __y);}

#undef nextafter
#define nextafter(__x, __y) __tg_nextafter(__tg_promote2((__x), (__y))(__x), \\
                                           __tg_promote2((__x), (__y))(__y))

// nexttoward

static float
    _TG_ATTRS
    __tg_nexttoward(float __x, long double __y) {return nexttowardf(__x, __y);}

static double
    _TG_ATTRS
    __tg_nexttoward(double __x, long double __y) {return nexttoward(__x, __y);}

static long double
    _TG_ATTRS
    __tg_nexttoward(long double __x, long double __y) {return nexttowardl(__x, __y);}

#undef nexttoward
#define nexttoward(__x, __y) __tg_nexttoward(__tg_promote1((__x))(__x), (__y))

// remainder

static float
    _TG_ATTRS
    __tg_remainder(float __x, float __y) {return remainderf(__x, __y);}

static double
    _TG_ATTRS
    __tg_remainder(double __x, double __y) {return remainder(__x, __y);}

static long double
    _TG_ATTRS
    __tg_remainder(long double __x, long double __y) {return remainderl(__x, __y);}

#undef remainder
#define remainder(__x, __y) __tg_remainder(__tg_promote2((__x), (__y))(__x), \\
                                           __tg_promote2((__x), (__y))(__y))

// remquo

static float
    _TG_ATTRS
    __tg_remquo(float __x, float __y, int* __z)
    {return remquof(__x, __y, __z);}

static double
    _TG_ATTRS
    __tg_remquo(double __x, double __y, int* __z)
    {return remquo(__x, __y, __z);}

static long double
    _TG_ATTRS
    __tg_remquo(long double __x,long double __y, int* __z)
    {return remquol(__x, __y, __z);}

#undef remquo
#define remquo(__x, __y, __z)                         \\
        __tg_remquo(__tg_promote2((__x), (__y))(__x), \\
                    __tg_promote2((__x), (__y))(__y), \\
                    (__z))

// rint

static float
    _TG_ATTRS
    __tg_rint(float __x) {return rintf(__x);}

static double
    _TG_ATTRS
    __tg_rint(double __x) {return rint(__x);}

static long double
    _TG_ATTRS
    __tg_rint(long double __x) {return rintl(__x);}

#undef rint
#define rint(__x) __tg_rint(__tg_promote1((__x))(__x))

// round

static float
    _TG_ATTRS
    __tg_round(float __x) {return roundf(__x);}

static double
    _TG_ATTRS
    __tg_round(double __x) {return round(__x);}

static long double
    _TG_ATTRS
    __tg_round(long double __x) {return roundl(__x);}

#undef round
#define round(__x) __tg_round(__tg_promote1((__x))(__x))

// scalbn

static float
    _TG_ATTRS
    __tg_scalbn(float __x, int __y) {return scalbnf(__x, __y);}

static double
    _TG_ATTRS
    __tg_scalbn(double __x, int __y) {return scalbn(__x, __y);}

static long double
    _TG_ATTRS
    __tg_scalbn(long double __x, int __y) {return scalbnl(__x, __y);}

#undef scalbn
#define scalbn(__x, __y) __tg_scalbn(__tg_promote1((__x))(__x), __y)

// scalbln

static float
    _TG_ATTRS
    __tg_scalbln(float __x, long __y) {return scalblnf(__x, __y);}

static double
    _TG_ATTRS
    __tg_scalbln(double __x, long __y) {return scalbln(__x, __y);}

static long double
    _TG_ATTRS
    __tg_scalbln(long double __x, long __y) {return scalblnl(__x, __y);}

#undef scalbln
#define scalbln(__x, __y) __tg_scalbln(__tg_promote1((__x))(__x), __y)

// tgamma

static float
    _TG_ATTRS
    __tg_tgamma(float __x) {return tgammaf(__x);}

static double
    _TG_ATTRS
    __tg_tgamma(double __x) {return tgamma(__x);}

static long double
    _TG_ATTRS
    __tg_tgamma(long double __x) {return tgammal(__x);}

#undef tgamma
#define tgamma(__x) __tg_tgamma(__tg_promote1((__x))(__x))

// trunc

static float
    _TG_ATTRS
    __tg_trunc(float __x) {return truncf(__x);}

static double
    _TG_ATTRS
    __tg_trunc(double __x) {return trunc(__x);}

static long double
    _TG_ATTRS
    __tg_trunc(long double __x) {return truncl(__x);}

#undef trunc
#define trunc(__x) __tg_trunc(__tg_promote1((__x))(__x))

// carg

static float
    _TG_ATTRS
    __tg_carg(float __x) {return atan2f(0.F, __x);}

static double
    _TG_ATTRS
    __tg_carg(double __x) {return atan2(0., __x);}

static long double
    _TG_ATTRS
    __tg_carg(long double __x) {return atan2l(0.L, __x);}

static float
    _TG_ATTRS
    __tg_carg(float _Complex __x) {return cargf(__x);}

static double
    _TG_ATTRS
    __tg_carg(double _Complex __x) {return carg(__x);}

static long double
    _TG_ATTRS
    __tg_carg(long double _Complex __x) {return cargl(__x);}

#undef carg
#define carg(__x) __tg_carg(__tg_promote1((__x))(__x))

// cimag

static float
    _TG_ATTRS
    __tg_cimag(float __x) {return 0;}

static double
    _TG_ATTRS
    __tg_cimag(double __x) {return 0;}

static long double
    _TG_ATTRS
    __tg_cimag(long double __x) {return 0;}

static float
    _TG_ATTRS
    __tg_cimag(float _Complex __x) {return cimagf(__x);}

static double
    _TG_ATTRS
    __tg_cimag(double _Complex __x) {return cimag(__x);}

static long double
    _TG_ATTRS
    __tg_cimag(long double _Complex __x) {return cimagl(__x);}

#undef cimag
#define cimag(__x) __tg_cimag(__tg_promote1((__x))(__x))

// conj

static float _Complex
    _TG_ATTRS
    __tg_conj(float __x) {return __x;}

static double _Complex
    _TG_ATTRS
    __tg_conj(double __x) {return __x;}

static long double _Complex
    _TG_ATTRS
    __tg_conj(long double __x) {return __x;}

static float _Complex
    _TG_ATTRS
    __tg_conj(float _Complex __x) {return conjf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_conj(double _Complex __x) {return conj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_conj(long double _Complex __x) {return conjl(__x);}

#undef conj
#define conj(__x) __tg_conj(__tg_promote1((__x))(__x))

// cproj

static float _Complex
    _TG_ATTRS
    __tg_cproj(float __x) {return cprojf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cproj(double __x) {return cproj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cproj(long double __x) {return cprojl(__x);}

static float _Complex
    _TG_ATTRS
    __tg_cproj(float _Complex __x) {return cprojf(__x);}

static double _Complex
    _TG_ATTRS
    __tg_cproj(double _Complex __x) {return cproj(__x);}

static long double _Complex
    _TG_ATTRS
    __tg_cproj(long double _Complex __x) {return cprojl(__x);}

#undef cproj
#define cproj(__x) __tg_cproj(__tg_promote1((__x))(__x))

// creal

static float
    _TG_ATTRS
    __tg_creal(float __x) {return __x;}

static double
    _TG_ATTRS
    __tg_creal(double __x) {return __x;}

static long double
    _TG_ATTRS
    __tg_creal(long double __x) {return __x;}

static float
    _TG_ATTRS
    __tg_creal(float _Complex __x) {return crealf(__x);}

static double
    _TG_ATTRS
    __tg_creal(double _Complex __x) {return creal(__x);}

static long double
    _TG_ATTRS
    __tg_creal(long double _Complex __x) {return creall(__x);}

#undef creal
#define creal(__x) __tg_creal(__tg_promote1((__x))(__x))

#undef _TG_ATTRSp
#undef _TG_ATTRS

#endif /* __cplusplus */
#endif /* __has_include_next */
#endif /* __CLANG_TGMATH_H */
`,"unwind.h":`/*===---- unwind.h - Stack unwinding ----------------------------------------===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 */

/* See "Data Definitions for libgcc_s" in the Linux Standard Base.*/

#ifndef __CLANG_UNWIND_H
#define __CLANG_UNWIND_H

#if defined(__APPLE__) && __has_include_next(<unwind.h>)
/* Darwin (from 11.x on) provide an unwind.h. If that's available,
 * use it. libunwind wraps some of its definitions in #ifdef _GNU_SOURCE,
 * so define that around the include.*/
# ifndef _GNU_SOURCE
#  define _SHOULD_UNDEFINE_GNU_SOURCE
#  define _GNU_SOURCE
# endif
// libunwind's unwind.h reflects the current visibility.  However, Mozilla
// builds with -fvisibility=hidden and relies on gcc's unwind.h to reset the
// visibility to default and export its contents.  gcc also allows users to
// override its override by #defining HIDE_EXPORTS (but note, this only obeys
// the user's -fvisibility setting; it doesn't hide any exports on its own).  We
// imitate gcc's header here:
# ifdef HIDE_EXPORTS
#  include_next <unwind.h>
# else
#  pragma GCC visibility push(default)
#  include_next <unwind.h>
#  pragma GCC visibility pop
# endif
# ifdef _SHOULD_UNDEFINE_GNU_SOURCE
#  undef _GNU_SOURCE
#  undef _SHOULD_UNDEFINE_GNU_SOURCE
# endif
#else

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* It is a bit strange for a header to play with the visibility of the
   symbols it declares, but this matches gcc's behavior and some programs
   depend on it */
#ifndef HIDE_EXPORTS
#pragma GCC visibility push(default)
#endif

typedef uintptr_t _Unwind_Word __attribute__((__mode__(__unwind_word__)));
typedef intptr_t _Unwind_Sword __attribute__((__mode__(__unwind_word__)));
typedef uintptr_t _Unwind_Ptr;
typedef uintptr_t _Unwind_Internal_Ptr;
typedef uint64_t _Unwind_Exception_Class;

typedef intptr_t _sleb128_t;
typedef uintptr_t _uleb128_t;

struct _Unwind_Context;
#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) || \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
struct _Unwind_Control_Block;
typedef struct _Unwind_Control_Block _Unwind_Control_Block;
#define _Unwind_Exception _Unwind_Control_Block /* Alias */
#else
struct _Unwind_Exception;
typedef struct _Unwind_Exception _Unwind_Exception;
#endif
typedef enum {
  _URC_NO_REASON = 0,
#if defined(__arm__) && !defined(__USING_SJLJ_EXCEPTIONS__) && \\
    !defined(__ARM_DWARF_EH__) && !defined(__SEH__)
  _URC_OK = 0, /* used by ARM EHABI */
#endif
  _URC_FOREIGN_EXCEPTION_CAUGHT = 1,

  _URC_FATAL_PHASE2_ERROR = 2,
  _URC_FATAL_PHASE1_ERROR = 3,
  _URC_NORMAL_STOP = 4,

  _URC_END_OF_STACK = 5,
  _URC_HANDLER_FOUND = 6,
  _URC_INSTALL_CONTEXT = 7,
  _URC_CONTINUE_UNWIND = 8,
#if defined(__arm__) && !defined(__USING_SJLJ_EXCEPTIONS__) && \\
    !defined(__ARM_DWARF_EH__) && !defined(__SEH__)
  _URC_FAILURE = 9 /* used by ARM EHABI */
#endif
} _Unwind_Reason_Code;

typedef enum {
  _UA_SEARCH_PHASE = 1,
  _UA_CLEANUP_PHASE = 2,

  _UA_HANDLER_FRAME = 4,
  _UA_FORCE_UNWIND = 8,
  _UA_END_OF_STACK = 16 /* gcc extension to C++ ABI */
} _Unwind_Action;

typedef void (*_Unwind_Exception_Cleanup_Fn)(_Unwind_Reason_Code,
                                             _Unwind_Exception *);

#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) || \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
typedef struct _Unwind_Control_Block _Unwind_Control_Block;
typedef uint32_t _Unwind_EHT_Header;

struct _Unwind_Control_Block {
  uint64_t exception_class;
  void (*exception_cleanup)(_Unwind_Reason_Code, _Unwind_Control_Block *);
  /* unwinder cache (private fields for the unwinder's use) */
  struct {
    uint32_t reserved1; /* forced unwind stop function, 0 if not forced */
    uint32_t reserved2; /* personality routine */
    uint32_t reserved3; /* callsite */
    uint32_t reserved4; /* forced unwind stop argument */
    uint32_t reserved5;
  } unwinder_cache;
  /* propagation barrier cache (valid after phase 1) */
  struct {
    uint32_t sp;
    uint32_t bitpattern[5];
  } barrier_cache;
  /* cleanup cache (preserved over cleanup) */
  struct {
    uint32_t bitpattern[4];
  } cleanup_cache;
  /* personality cache (for personality's benefit) */
  struct {
    uint32_t fnstart;         /* function start address */
    _Unwind_EHT_Header *ehtp; /* pointer to EHT entry header word */
    uint32_t additional;      /* additional data */
    uint32_t reserved1;
  } pr_cache;
  long long int : 0; /* force alignment of next item to 8-byte boundary */
} __attribute__((__aligned__(8)));
#else
struct _Unwind_Exception {
  _Unwind_Exception_Class exception_class;
  _Unwind_Exception_Cleanup_Fn exception_cleanup;
#if !defined (__USING_SJLJ_EXCEPTIONS__) && defined (__SEH__)
  _Unwind_Word private_[6];
#else
  _Unwind_Word private_1;
  _Unwind_Word private_2;
#endif
  /* The Itanium ABI requires that _Unwind_Exception objects are "double-word
   * aligned".  GCC has interpreted this to mean "use the maximum useful
   * alignment for the target"; so do we. */
} __attribute__((__aligned__));
#endif

typedef _Unwind_Reason_Code (*_Unwind_Stop_Fn)(int, _Unwind_Action,
                                               _Unwind_Exception_Class,
                                               _Unwind_Exception *,
                                               struct _Unwind_Context *,
                                               void *);

typedef _Unwind_Reason_Code (*_Unwind_Personality_Fn)(int, _Unwind_Action,
                                                      _Unwind_Exception_Class,
                                                      _Unwind_Exception *,
                                                      struct _Unwind_Context *);
typedef _Unwind_Personality_Fn __personality_routine;

typedef _Unwind_Reason_Code (*_Unwind_Trace_Fn)(struct _Unwind_Context *,
                                                void *);

#if defined(__arm__) && !(defined(__USING_SJLJ_EXCEPTIONS__) ||                \\
                          defined(__ARM_DWARF_EH__) || defined(__SEH__))
typedef enum {
  _UVRSC_CORE = 0,        /* integer register */
  _UVRSC_VFP = 1,         /* vfp */
  _UVRSC_WMMXD = 3,       /* Intel WMMX data register */
  _UVRSC_WMMXC = 4,       /* Intel WMMX control register */
  _UVRSC_PSEUDO = 5       /* Special purpose pseudo register */
} _Unwind_VRS_RegClass;

typedef enum {
  _UVRSD_UINT32 = 0,
  _UVRSD_VFPX = 1,
  _UVRSD_UINT64 = 3,
  _UVRSD_FLOAT = 4,
  _UVRSD_DOUBLE = 5
} _Unwind_VRS_DataRepresentation;

typedef enum {
  _UVRSR_OK = 0,
  _UVRSR_NOT_IMPLEMENTED = 1,
  _UVRSR_FAILED = 2
} _Unwind_VRS_Result;

typedef uint32_t _Unwind_State;
#define _US_VIRTUAL_UNWIND_FRAME  ((_Unwind_State)0)
#define _US_UNWIND_FRAME_STARTING ((_Unwind_State)1)
#define _US_UNWIND_FRAME_RESUME   ((_Unwind_State)2)
#define _US_ACTION_MASK           ((_Unwind_State)3)
#define _US_FORCE_UNWIND          ((_Unwind_State)8)

_Unwind_VRS_Result _Unwind_VRS_Get(struct _Unwind_Context *__context,
  _Unwind_VRS_RegClass __regclass,
  uint32_t __regno,
  _Unwind_VRS_DataRepresentation __representation,
  void *__valuep);

_Unwind_VRS_Result _Unwind_VRS_Set(struct _Unwind_Context *__context,
  _Unwind_VRS_RegClass __regclass,
  uint32_t __regno,
  _Unwind_VRS_DataRepresentation __representation,
  void *__valuep);

static __inline__
_Unwind_Word _Unwind_GetGR(struct _Unwind_Context *__context, int __index) {
  _Unwind_Word __value;
  _Unwind_VRS_Get(__context, _UVRSC_CORE, __index, _UVRSD_UINT32, &__value);
  return __value;
}

static __inline__
void _Unwind_SetGR(struct _Unwind_Context *__context, int __index,
                   _Unwind_Word __value) {
  _Unwind_VRS_Set(__context, _UVRSC_CORE, __index, _UVRSD_UINT32, &__value);
}

static __inline__
_Unwind_Word _Unwind_GetIP(struct _Unwind_Context *__context) {
  _Unwind_Word __ip = _Unwind_GetGR(__context, 15);
  return __ip & ~(_Unwind_Word)(0x1); /* Remove thumb mode bit. */
}

static __inline__
void _Unwind_SetIP(struct _Unwind_Context *__context, _Unwind_Word __value) {
  _Unwind_Word __thumb_mode_bit = _Unwind_GetGR(__context, 15) & 0x1;
  _Unwind_SetGR(__context, 15, __value | __thumb_mode_bit);
}
#else
_Unwind_Word _Unwind_GetGR(struct _Unwind_Context *, int);
void _Unwind_SetGR(struct _Unwind_Context *, int, _Unwind_Word);

_Unwind_Word _Unwind_GetIP(struct _Unwind_Context *);
void _Unwind_SetIP(struct _Unwind_Context *, _Unwind_Word);
#endif


_Unwind_Word _Unwind_GetIPInfo(struct _Unwind_Context *, int *);

_Unwind_Word _Unwind_GetCFA(struct _Unwind_Context *);

_Unwind_Word _Unwind_GetBSP(struct _Unwind_Context *);

void *_Unwind_GetLanguageSpecificData(struct _Unwind_Context *);

_Unwind_Ptr _Unwind_GetRegionStart(struct _Unwind_Context *);

/* DWARF EH functions; currently not available on Darwin/ARM */
#if !defined(__APPLE__) || !defined(__arm__)
_Unwind_Reason_Code _Unwind_RaiseException(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_ForcedUnwind(_Unwind_Exception *, _Unwind_Stop_Fn,
                                         void *);
void _Unwind_DeleteException(_Unwind_Exception *);
void _Unwind_Resume(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_Resume_or_Rethrow(_Unwind_Exception *);

#endif

_Unwind_Reason_Code _Unwind_Backtrace(_Unwind_Trace_Fn, void *);

/* setjmp(3)/longjmp(3) stuff */
typedef struct SjLj_Function_Context *_Unwind_FunctionContext_t;

void _Unwind_SjLj_Register(_Unwind_FunctionContext_t);
void _Unwind_SjLj_Unregister(_Unwind_FunctionContext_t);
_Unwind_Reason_Code _Unwind_SjLj_RaiseException(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_SjLj_ForcedUnwind(_Unwind_Exception *,
                                              _Unwind_Stop_Fn, void *);
void _Unwind_SjLj_Resume(_Unwind_Exception *);
_Unwind_Reason_Code _Unwind_SjLj_Resume_or_Rethrow(_Unwind_Exception *);

void *_Unwind_FindEnclosingFunction(void *);

#ifdef __APPLE__

_Unwind_Ptr _Unwind_GetDataRelBase(struct _Unwind_Context *)
    __attribute__((__unavailable__));
_Unwind_Ptr _Unwind_GetTextRelBase(struct _Unwind_Context *)
    __attribute__((__unavailable__));

/* Darwin-specific functions */
void __register_frame(const void *);
void __deregister_frame(const void *);

struct dwarf_eh_bases {
  uintptr_t tbase;
  uintptr_t dbase;
  uintptr_t func;
};
void *_Unwind_Find_FDE(const void *, struct dwarf_eh_bases *);

void __register_frame_info_bases(const void *, void *, void *, void *)
  __attribute__((__unavailable__));
void __register_frame_info(const void *, void *) __attribute__((__unavailable__));
void __register_frame_info_table_bases(const void *, void*, void *, void *)
  __attribute__((__unavailable__));
void __register_frame_info_table(const void *, void *)
  __attribute__((__unavailable__));
void __register_frame_table(const void *) __attribute__((__unavailable__));
void __deregister_frame_info(const void *) __attribute__((__unavailable__));
void __deregister_frame_info_bases(const void *)__attribute__((__unavailable__));

#else

_Unwind_Ptr _Unwind_GetDataRelBase(struct _Unwind_Context *);
_Unwind_Ptr _Unwind_GetTextRelBase(struct _Unwind_Context *);

#endif


#ifndef HIDE_EXPORTS
#pragma GCC visibility pop
#endif

#ifdef __cplusplus
}
#endif

#endif

#endif /* __CLANG_UNWIND_H */
`,"varargs.h":`/*===---- varargs.h - Variable argument handling -------------------------------------===
*
* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
* See https://llvm.org/LICENSE.txt for license information.
* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
*
*===-----------------------------------------------------------------------===
*/
#ifndef __VARARGS_H
#define __VARARGS_H
#if defined(__MVS__) && __has_include_next(<varargs.h>)
#include_next <varargs.h>
#else
#error "Please use <stdarg.h> instead of <varargs.h>"
#endif /* __MVS__ */
#endif
`}),F=Object.freeze({name:`clang`,version:`22.1.8`,revision:`ca7933e47d3a3451d81e72ac174dcb5aa28b59d1`});function Ie(e,t,n){if(t?.name!==F.name||t.version!==F.version||t.revision!==F.revision||n!==`/lib/clang/22`)return!1;let r=new TextDecoder(`utf-8`,{fatal:!0}),i=[];for(let[a,o]of Object.entries(Fe)){let s=`${n}/include/${a}`;try{let n=e.readFile(s);if(n!==null){if(r.decode(n)!==o)throw Error(`Clang ${t.version} resource header differs from its pinned source: ${a}`)}else i.push([s,o])}catch(e){throw Error(`Unable to inspect Clang ${t.version} resource header ${a}: ${e instanceof Error?e.message:String(e)}`,{cause:e})}}if(i.length)try{e.mkdirTree(`${n}/include`)}catch(e){throw Error(`Unable to prepare Clang ${t.version} resource header directory: ${e instanceof Error?e.message:String(e)}`,{cause:e})}let a=new TextEncoder;for(let[n,r]of i)try{e.writeFile(n,a.encode(r))}catch(e){throw Error(`Unable to install Clang ${t.version} resource header ${n.slice(n.lastIndexOf(`/`)+1)}: ${e instanceof Error?e.message:String(e)}`,{cause:e})}return!0}const I=e=>JSON.stringify(e.length>96?e.slice(0,93)+`...`:e);var Le=class{ready;mem=null;hostMem_=null;stdinStr;stdin;stdout;trace;instance=null;exports;out=!0;filePaths=new Set;fileOverlays=new Map;directoryPaths=new Set;constructor(e){this.stdin=e.stdin,this.stdout=e.stdout,this.stdinStr=e.stdinStr||``,this.trace=e.trace||(()=>{});let t=r(this,`abort`,`host_write`,`host_read`,`memfs_log`,`copy_in`,`copy_out`);this.ready=(e.maxAssetBytes===void 0?e.signal?D(e.moduleUrl,e.progress,e.signal):D(e.moduleUrl,e.progress):D(e.moduleUrl,e.progress,e.signal,e.maxAssetBytes)).then(e=>WebAssembly.instantiate(e,{env:t})).then(e=>{this.instance=e,this.exports=e.exports,this.mem=new s(this.exports.memory),this.exports.init()})}set hostMem(e){this.hostMem_=e}setStdinStr(e){this.stdinStr=e}addDirectory(e){let t=this.normalizePath(e);this.directoryPaths.has(t)||(this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e),this.exports.AddDirectoryNode(e.length),this.directoryPaths.add(t))}addFile(e,t){let n=t instanceof ArrayBuffer?t.byteLength:t.length;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let r=this.exports.AddFileNode(e.length,n),i=this.exports.GetFileNodeAddress(r);this.mem.check(),this.mem.write(i,t),this.filePaths.add(this.normalizePath(e))}setFile(e,t){let n=this.normalizePath(e);this.filePaths.add(n),this.fileOverlays.set(n,Uint8Array.from(t))}hasFile(e){return this.filePaths.has(this.normalizePath(e))}normalizePath(e){return e.replaceAll(`\\`,`/`).replace(/^\.\//,``).replace(/^\/+/,``)}getFileContents(e){let t=this.fileOverlays.get(this.normalizePath(e));if(t)return t;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let n=this.exports.FindNode(e.length),r=this.exports.GetFileNodeAddress(n),i=this.exports.GetFileNodeSize(n);return new Uint8Array(this.mem.buffer,r,i)}abort(){throw this.trace(`abort()`),new j}host_write(e,t,n,r){this.hostMem_.check(),te(e<=2);let i=0,a=``;for(let e=0;e<n;++e){let e=this.hostMem_.read32(t);t+=4;let n=this.hostMem_.read32(t);t+=4,a+=this.hostMem_.readStrR(e,n),i+=n}return this.hostMem_.write32(r,i),this.trace(`host_write(fd=${e}, bytes=${i}, data=${I(a)})`),this.out&&this.stdout(a),0}host_read(e,t,n,r){this.hostMem_.check(),te(e===0);let i=0;for(let r=0;r<n;++r){let n=this.hostMem_.read32(t);t+=4;let r=this.hostMem_.read32(t);t+=4,this.stdinStr.length||(this.stdinStr=this.stdin());let a=Math.min(r,this.stdinStr.length);if(a===0)break;let o=this.stdinStr.substring(0,a);if(this.hostMem_.write(n,this.stdinStr.substring(0,a)),this.stdinStr=this.stdinStr.substring(a),i+=a,this.trace(`host_read(fd=${e}, bytes=${a}, data=${I(o)})`),a!==r)break}return this.hostMem_.write32(r,i),i===0&&this.trace(`host_read(fd=${e}, bytes=0)`),0}memfs_log(e,t){this.mem.check();let n=this.mem.readStr(e,t);this.trace(`memfs_log(${I(n)})`)}copy_out(e,t,n){this.hostMem_.check();let r=new Uint8Array(this.hostMem_.buffer,e,n);this.mem.check();let i=new Uint8Array(this.mem.buffer,t,n);r.set(i)}copy_in(e,t,n){this.mem.check();let r=new Uint8Array(this.mem.buffer,e,n);this.hostMem_.check();let i=new Uint8Array(this.hostMem_.buffer,t,n);r.set(i)}};function*Re(e){let t=e instanceof Uint8Array?e:new Uint8Array(e),n=0,r=``,a=e=>(n+=e,i(t,n-e,e)),s=e=>(n+=e,o(t,n-e,e)),c=()=>n=n+511&-512;for(;n+512<=t.length;){let e={filename:a(100),mode:s(8),owner:s(8),group:s(8),size:s(12),mtime:s(12),checksum:s(8),type:a(1),linkname:a(100),ustar:a(8)};if(!e.ustar)return;let o={...e,ownerName:a(32),groupName:a(32),devMajor:a(8),devMinor:a(8),filenamePrefix:a(155)};if(c(),(o.size>0||o.type===`0`||o.type===``||o.type===`L`)&&(o.contents=t.subarray(n,n+o.size),n+=o.size,c()),o.type===`L`){o.contents&&(r=i(o.contents,0,o.size));continue}o.filename=r||(o.filenamePrefix?`${o.filenamePrefix}/${o.filename}`:o.filename),r=``,yield o}}function ze(e,t){for(let n of Re(e))switch(n.type){case``:case`0`:t.addFile(n.filename,n.contents);break;case`5`:t.addDirectory(n.filename);break;default:throw Error(`unsupported tar entry type: ${n.type}`)}}const Be=`\x1B[92m`,Ve=`\x1B[0m`,He=e=>Math.max(0,Math.min(1,Number.isFinite(e)?e:0));function Ue(e){let t={clang:0,lld:0,memfs:0},n=()=>{e((t.clang+t.lld+t.memfs)/3)},r=e=>({set(r){t[e]=He(r),n()}});return{clang:r(`clang`),lld:r(`lld`),memfs:r(`memfs`)}}const We=(e,t)=>{let n=e?.toString().trim();if(!n)throw Error(`${t} is required`);let r;try{r=new URL(n,typeof location<`u`?location.href:void 0)}catch{throw Error(`${t} must be an absolute HTTP(S) URL`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`${t} must use HTTP(S)`);return r},Ge=e=>{let t=We(e,`wasm-clang runtime base URL`);return t.pathname.endsWith(`/`)||(t.pathname+=`/`),t.hash=``,t},L=(e,t)=>new URL(t,Ge(e)).toString(),Ke=(e,t)=>L(e,t),qe=e=>Ge(e).toString(),Je=e=>Ke(e,`runtime-manifest.v1.json`);function Ye(e,t){let n=qe(e);return{manifest:Je(n).toString(),memfs:L(n,t?.compiler.memfs.asset||`bin/memfs.wasm.gz`).toString(),clang:L(n,t?.compiler.clang.asset||`bin/clang.wasm.gz`).toString(),lld:L(n,t?.compiler.lld.asset||`bin/lld.wasm.gz`).toString(),sysroot:L(n,t?.compiler.sysroot.asset||`bin/sysroot.tar.gz`).toString(),clangdJs:L(n,t?.clangd.js||`clangd/clangd.js`).toString(),clangdWasm:L(n,t?.clangd.wasm||`clangd/clangd.wasm.gz`).toString()}}const R=e=>e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`),z=e=>{let t=R(e);return t.startsWith(`workspace/`)?t.slice(10):t};function Xe(e,t){let n=R(t||``),r=`main`,i=n&&/\.[A-Za-z0-9_-]+$/.test(n)?n:`${n||r}.${e===`C`?`c`:e===`OBJC`?`m`:`cc`}`,a=(i.split(`/`).pop()||i).replace(/\.[^.]+$/,``)||r;return{input:i,obj:`${a}.o`,wasm:`${a}.wasm`}}async function Ze(e){let t=typeof e==`string`?new TextEncoder().encode(e):(e instanceof Uint8Array,new Uint8Array(e)),n=await globalThis.crypto.subtle.digest(`SHA-256`,t);return Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``)}async function Qe(e,t,n){if(!n)throw Error(`LLDB debug compilation requires compiler provenance in the wasm-clang runtime manifest`);let{input:r}=Xe(e.language||`CPP`,z(e.activePath||``)||z(e.fileName||``)||void 0),i=new Map;for(let t of e.workspaceFiles||[]){let e=z(t.path);e&&i.set(e,t.content)}i.set(r,e.code);let a=[...i.entries()].sort(([e],[t])=>e<t?-1:+(e>t));return{kind:`dwarf`,sourceRoot:`/workspace`,moduleSha256:await Ze(t),files:await Promise.all(a.map(async([e,t])=>({path:`/workspace/${e}`,contentSha256:await Ze(t)}))),compiler:n}}globalThis.document===void 0&&(globalThis.document={querySelectorAll:(()=>[])});const B=`__wasm_idle_build`,$e=/\.(?:c|cc|cpp|cxx)$/,et=new Set([`-target`,`--target`,`-triple`,`-target-feature`,`-target-cpu`,`-target-abi`,`-mcpu`,`-march`,`-mattr`,`-mthread-model`,`-mllvm`,`-pthread`,`-fopenmp`,`-msimd128`,`-mno-simd128`,`-matomics`,`-mno-atomics`,`-mmemory64`,`-mno-memory64`,`-mshared-memory`,`-mno-shared-memory`,`-mmulti-memory`,`-mno-multi-memory`]),tt=[`-target=`,`--target=`,`-triple=`,`-target-feature=`,`-target-cpu=`,`-target-abi=`,`-mcpu=`,`-march=`,`-mattr=`,`-mthread-model=`,`-mllvm=`],nt=e=>{let t=encodeURIComponent(e),n=``;for(let e=0;e<t.length;){let r=t[e];if(e+=1,r==`%`){let r=t.substring(e,e+=2);r&&(n+=String.fromCharCode(parseInt(r,16)))}else n+=r}return n};function rt(e,t){let n=[...e],r=t,i,a=!1;for(let t=0;t<e.length;t+=1){let o=e[t],s=e[t+1];if(r){n[t]=` `,o===`*`&&s===`/`&&(n[t+1]=` `,t+=1,r=!1);continue}if(i){n[t]=` `,a?a=!1:o===`\\`?a=!0:o===i&&(i=void 0);continue}if(o===`/`&&s===`*`){n[t]=` `,n[t+1]=` `,t+=1,r=!0;continue}if(o===`/`&&s===`/`){for(let r=t;r<e.length;r+=1)n[r]=` `;break}(o===`"`||o===`'`)&&(n[t]=` `,i=o)}return{line:n.join(``),inBlockComment:r}}var it=class{ready;memfs;stdout;moduleCache;showTiming;log;debug=!1;debugBreakpoints=new Set;debugPauseOnEntry=!1;debugBuffer;debugInterruptBuffer;debugWatchBuffer;debugWatchResultBuffer;onDebugEvent;debugVariableMetadata={};debugGlobalMetadata=[];debugFunctionMetadata={};lastBuildKey=``;path;assetUrls;compilerConfig;wasm;lastArtifactPath=`main.wasm`;traceStartedAt=0;progress;maxAssetBytes;constructor(e){let t=e.maxAssetBytes??134217728;if(!Number.isSafeInteger(t)||t<=0)throw TypeError(`Clang maxAssetBytes must be a positive safe integer`);this.maxAssetBytes=t,this.moduleCache={},this.stdout=e.stdout||(()=>{}),this.showTiming=e.showTiming||!1,this.log=e.log||!1,this.path=e.runtimeBaseUrl.toString(),this.assetUrls=Ye(this.path,e.manifest),this.compilerConfig=e.manifest?.compiler,this.onDebugEvent=e.onDebugEvent,this.progress=Ue(t=>e.progress?.(t)),this.memfs=new Le({stdout:this.stdout,stdin:e.stdin||(()=>``),moduleUrl:this.assetUrls.memfs,progress:this.progress.memfs,signal:e.signal,maxAssetBytes:t,trace:e=>this.trace(e)});let n=this.getModule(this.assetUrls.clang,this.progress.clang,e.signal),r=this.getModule(this.assetUrls.lld,this.progress.lld,e.signal),i=this.memfs.ready.then(async()=>{let n=e.signal?E(this.assetUrls.sysroot,void 0,t,e.signal):E(this.assetUrls.sysroot,void 0,t);await this.hostLogAsync(`Untarring ${this.assetUrls.sysroot}`,n.then(e=>ze(e,this.memfs))),Ie({readFile:e=>this.memfs.hasFile(e)?this.memfs.getFileContents(e.replace(/^\/+/,``)):null,mkdirTree:e=>this.memfs.addDirectory(e.replace(/^\/+/,``)),writeFile:(e,t)=>this.memfs.addFile(e.replace(/^\/+/,``),t)},this.compilerConfig?.provenance,this.compilerConfig?.resourceDir),Pe(this.memfs)});this.ready=Promise.all([n,r,i]).then(()=>void 0)}hostLog(e){if(!this.log)return;let t=`[1;93m>${Ve} `;this.stdout(`${t}${e}`)}beginTrace(e){this.debug=e,this.traceStartedAt=Date.now()}trace(e){if(!this.debug||!this.log)return;let t=Date.now()-this.traceStartedAt;this.stdout(`\x1b[2m[debug +${t}ms] ${e}\x1b[0m\n`)}async hostLogAsync(e,t){let n=+new Date;this.hostLog(`${e}...`);let r=await t,i=+new Date;return this.log&&this.stdout(` done.`),this.showTiming&&this.stdout(` ${Be}(${i-n}ms)${Ve}\n`),this.log&&this.stdout(`
`),r}async getModule(e,t,n){if(this.moduleCache[e])return this.moduleCache[e];let r=await this.hostLogAsync(`Fetching and compiling ${e}`,D(e,t,n,this.maxAssetBytes));return this.moduleCache[e]=r,r}addWorkspaceDirectories(e,t=new Set){let n=R(e).split(`/`).slice(0,-1),r=``;for(let e of n)r=r?`${r}/${e}`:e,t.has(r)||(this.memfs.addDirectory(r),t.add(r))}addWorkspaceFiles(e=[],t=``){let n=new Set,r=R(t);for(let t of e){let e=R(t.path);!e||e===r||(this.addWorkspaceDirectories(e,n),this.memfs.addFile(e,nt(t.content)))}}async compile(e){let t=R(e.input||`main.cc`)||`main.cc`,r=e.code,i=e.obj,a=e.language===`C`?`C`:e.language===`OBJC`?`OBJC`:`CPP`,o=e.compileArgs??e.args??[],{languageArg:s,standardArg:c}=Ce(a,e),l=n(e),u=l===`trace`,d=l===`lldb`;if(d)for(let e of o){if(typeof e!=`string`)throw TypeError(`LLDB compile arguments must be strings`);if(et.has(e)||tt.some(t=>e.startsWith(t)))throw Error(`LLDB compile argument ${JSON.stringify(e)} cannot change the WAMR debug target profile`)}let f=l===`none`?e.opt||`2`:`0`;if(u){let e=r.split(`
`),t=!1,n=e.map(e=>{let n=rt(e,t);return t=n.inBlockComment,n.line}),i=e=>{if(/^(?:do|else)$/.test(e))return!0;if(!/^(?:else\s+)?(?:if|for|while)\s*\(/.test(e))return!1;let t=e.indexOf(`(`),n=0;for(let r=t;r<e.length;r+=1)if(e[r]===`(`&&(n+=1),e[r]===`)`&&(--n,n===0))return e.slice(r+1).trim()===``;return!1},o=new Set,s=!1,c=!1;for(let e=0;e<n.length;e+=1){let t=n[e].trim();if(!t)continue;let r=c,a=r;r&&t.includes(`;`)&&(c=!1),s&&(s=!1,t!==`{`&&(a=!0,!t.includes(`;`)&&!t.includes(`{`)&&!i(t)&&(c=!0))),/^while\s*\(.*\)\s*;$/.test(t)&&(a=!0),a&&o.add(e),i(t)&&(s=!0)}let l=0,u=0,d=0,f=1,p=1,m=new Map,h=new Map,g=new Map,_,v=new Map,y=``,b=[],x=!1;for(let t of e){let e=t;if(x){let t=e.indexOf(`*/`);if(t===-1)continue;e=e.slice(t+2),x=!1}let n=e.indexOf(`/*`);if(n!==-1){let t=e.indexOf(`*/`,n+2);t===-1?(x=!0,e=e.slice(0,n)):e=e.slice(0,n)+e.slice(t+2)}let r=e.indexOf(`//`);r!==-1&&(e=e.slice(0,r));let i=e.trim();if(!y){let e=i.match(/^struct\s+([A-Za-z_]\w*)\s*\{$/);e?.[1]&&(y=e[1],b=[]);continue}if(i===`};`){let e=0,t=1,n=[];for(let r of b){let i=r.kind===`double`?8:r.kind===`bool`||r.kind===`char`?1:4;e%i!==0&&(e+=i-e%i),n.push({name:r.name,kind:r.kind,offset:e}),e+=i,t=Math.max(t,i)}e%t!==0&&(e+=t-e%t),v.set(y,{fields:n,size:Math.max(e,1)}),y=``,b=[];continue}let a=i.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(a)for(let e of a[2].split(`,`)){let t=e.split(`=`)[0]?.trim()||``;if(!t||/[*&\[]/.test(t))continue;let n=t.match(/([A-Za-z_]\w*)\s*$/)?.[1];n&&b.push({name:n,kind:a[1]})}}this.debugVariableMetadata={},this.debugGlobalMetadata=[],this.debugFunctionMetadata={};let S=[],C=a===`CPP`?`extern "C" `:``,w=[`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_enter"))) void __wasm_idle_debug_enter(int functionId, int line);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_leave"))) void __wasm_idle_debug_leave(int functionId);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_num"))) void __wasm_idle_debug_value_num(int functionId, int slot, double value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_bool"))) void __wasm_idle_debug_value_bool(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_addr"))) void __wasm_idle_debug_value_addr(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_text"))) void __wasm_idle_debug_value_text(int functionId, int slot, const char* ptr, int len);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_line"))) void __wasm_idle_debug_line(int functionId, int line);`],T=a===`CPP`?[`#include <cstdio>`,`#include <iostream>`,`#include <map>`,`#include <set>`,`#include <string>`,`#include <type_traits>`,`#include <vector>`,...w,`template <typename T>`,`static inline std::string __wasm_idle_debug_format_value(const T& value) {`,`    if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";`,`    else if constexpr (std::is_same_v<T, char>) return std::string("'") + value + "'";`,`    else if constexpr (std::is_same_v<T, signed char> || std::is_same_v<T, unsigned char>) return std::to_string((int)value);`,`    else if constexpr (std::is_integral_v<T> || std::is_floating_point_v<T>) return std::to_string(value);`,`    else return "?";`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_vector(int functionId, int slot, const std::vector<T>& values) {`,`    std::string text = "[";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "]";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_set(int functionId, int slot, const std::set<T>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename K, typename V>`,`static inline void __wasm_idle_debug_emit_map(int functionId, int slot, const std::map<K, V>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& entry : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(entry.first);`,`        text += ": ";`,`        text += __wasm_idle_debug_format_value(entry.second);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`]:[`#include <stdio.h>`,...w];for(let t=0;t<e.length;t+=1){let r=e[t],i=r.match(/^\s*/)?.[0]||``,s=r,c=n[t],y=c.trim(),b=o.has(t),x=u>0&&l>=u,C=u===0&&l===0&&!y.includes(`(`)&&!y.startsWith(`#`),w=/^(while|if|for)\s*\(/.test(y)&&!y.includes(`{`),E=[],D=[],O=new Set,k=C&&y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(k){let e=k[1]===`bool`?`bool`:`number`,n=[],r=``,i=0;for(let e of k[2]){if(e===`,`&&i===0){r.trim()&&n.push(r.trim()),r=``;continue}e===`{`&&(i+=1),e===`}`&&(i=Math.max(0,i-1)),r+=e}r.trim()&&n.push(r.trim());for(let r of n){let[n]=r.split(`=`),i=n?.trim()||``;if(/[*&\[]/.test(i))continue;let a=i.match(/([A-Za-z_]\w*)\s*$/)?.[1];if(!a)continue;let o=p++;h.set(a,{slot:o,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:o,name:a,kind:e,fromLine:t+1,toLine:2**53-1}],S.push(`${e===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${o}, ${a});`)}}let A=C&&y.match(/^(?:const\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\[(\d+)\]\s*(?:=.*)?;$/);if(A){let e=v.get(A[1]);if(e){let n=p++;this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:n,name:A[2],kind:`array`,length:Number(A[3]),dimensions:[Number(A[3])],structFields:e.fields,structSize:e.size,fromLine:t+1,toLine:2**53-1}],S.push(`__wasm_idle_debug_value_addr(0, ${n}, (int)((unsigned long long)(${A[2]})));`)}}if(x&&!b&&y&&!y.startsWith(`#`)&&y!==`{`&&y!==`}`&&!y.startsWith(`else`)&&!y.startsWith(`case `)&&y!==`case`&&!y.startsWith(`default`)&&!y.startsWith(`catch`)&&!/^(public|private|protected)\s*:/.test(y)&&!y.endsWith(`:`)&&!y.includes(` else `)){E.push(`${i}__wasm_idle_debug_line(${d}, ${t+1});`);let e=y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/),n=y.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map))\s*<(.+)>\s+([A-Za-z_]\w*)\s*(?:=.*)?;$/);if(n&&d){let e=p++,r=n[1],a=n[3];O.add(a),g.set(a,{slot:e,container:r,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:a,kind:`text`,fromLine:t+1,toLine:2**53-1}],D.push(`${i}__wasm_idle_debug_emit_${r}(${d}, ${e}, ${a});`)}if(e&&d){let n=e[1]===`bool`?`bool`:`number`,r=[],a=``,o=0,s=0;for(let t of e[2]){if(t===`,`&&o===0&&s===0){a.trim()&&r.push(a.trim()),a=``;continue}t===`(`&&(o+=1),t===`)`&&(o=Math.max(0,o-1)),t===`{`&&(s+=1),t===`}`&&(s=Math.max(0,s-1)),a+=t}a.trim()&&r.push(a.trim());for(let a of r){let[r]=a.split(`=`),o=r?.trim()||``,s=[];for(let e of o.matchAll(/\[(\d+)\]/g))s.push(Number(e[1]));let c=o.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(s.length&&c){let n=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:n,name:c[1],kind:`array`,elementKind:e[1],length:s[0],dimensions:s,fromLine:t+1,toLine:2**53-1}],D.push(`${i}__wasm_idle_debug_value_addr(${d}, ${n}, (int)((unsigned long long)(${c[1]})));`);continue}if(/[*&]/.test(o))continue;let l=o.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/)?.[1];if(l){if(!m.has(l)){let e=p++;m.set(l,{slot:e,kind:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:l,kind:n,fromLine:t+1,toLine:2**53-1}]}if(a.includes(`=`)){let e=m.get(l);e&&D.push(`${i}${e.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${e.slot}, ${l});`)}}}}let r=y.match(/^for\s*\(\s*(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+([A-Za-z_]\w*)\s*=/);if(r&&d){let e=r[1]===`bool`?`bool`:`number`,n=r[2];if(!m.has(n)){let r=p++;m.set(n,{slot:r,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:r,name:n,kind:e,fromLine:t+1,toLine:2**53-1}]}}if(!w){for(let[e,t]of g){if(O.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`\\b${n}\\b`).test(y)&&D.push(`${i}__wasm_idle_debug_emit_${t.container}(${d}, ${t.slot}, ${e});`)}for(let[e,n]of m){let r=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);y.startsWith(`for`)&&n.toLine===t+1||(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b`).test(y)||RegExp(`\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${r}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${r}\\b`).test(y))&&D.push(`${i}${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${e});`)}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${n}\\b`).test(y))&&D.push(`${i}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}/^return\b/.test(y)&&E.push(`${i}__wasm_idle_debug_leave(${d});`)}if(u>0&&l===u&&y===`}`&&E.push(`${i}__wasm_idle_debug_leave(${d});`),x&&d&&(/^(while|if)\s*\(/.test(y)||/^for\s*\(/.test(y))){let e=y.match(/^(while|if|for)\b/)?.[1],n=r.indexOf(e||``),a=n>=0?r.indexOf(`(`,n):-1;if(a>=0){let n=-1,o=0;for(let e=a;e<r.length;e+=1){let t=r[e];if(t===`(`&&(o+=1),t===`)`&&(--o,o===0)){n=e;break}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);!w&&(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y))&&D.push(`${i}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}if(n>a){let i=r.slice(a+1,n);if(e===`for`){let e=[],o=``,c=0;for(let t of i){if(t===`;`&&c===0){e.push(o),o=``;continue}t===`(`&&(c+=1),t===`)`&&(c=Math.max(0,c-1)),o+=t}if(e.push(o),e.length===3&&e[1]?.trim()){let i=e[0].trim(),o=e[2].trim(),c=[],l=[],u=[],f=/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(?:int|float|double|bool|char)\b/.test(i);for(let[e,t]of m){let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`),r=RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b|\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`);!f&&r.test(i)&&c.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),f&&r.test(i)&&l.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),r.test(o)&&u.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`)}let p=c.length&&i?`(${i}, ${c.join(`, `)})`:e[0],h=u.length&&o?`(${o}, ${u.join(`, `)})`:e[2];s=r.slice(0,a+1)+`${p}; (${l.length?`${l.join(`, `)}, `:``}__wasm_idle_debug_line(${d}, ${t+1}), (${e[1].trim()})); ${h}`+r.slice(n)}}else{let e=[];if(w){for(let[t,n]of m){let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(i)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${t})`)}for(let[t,n]of h){if(m.has(t)||g.has(t))continue;let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(i)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${n.slot}, ${t})`)}}let o=e.length?`((${i.trim()}) ? (${e.join(`, `)}, 1) : (${e.join(`, `)}, 0))`:`(${i.trim()})`;s=r.slice(0,a+1)+`(__wasm_idle_debug_line(${d}, ${t+1}), ${o})`+r.slice(n)}}}}T.push(...E),T.push(s),T.push(...D);let j=u===0&&y.includes(`(`)&&y.includes(`)`)&&y.includes(`{`)&&(c.match(/{/g)||[]).length>(c.match(/}/g)||[]).length&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y),ee=u===0&&!!_&&y===`{`;if(l+=(c.match(/{/g)||[]).length,l-=(c.match(/}/g)||[]).length,j||ee){u=l,d=f++;let e=`anonymous`,n=a===`OBJC`&&j?y.match(/^([-+])\s*\([^)]*\)\s*([A-Za-z_]\w*)/):null;if(j?(e=y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||e,n&&(e=`${n[1]}${n[2]}`)):_&&(e=_.functionName||e),this.debugFunctionMetadata[d]=e,p=1,m=new Map,g=new Map,T.push(`${i}    __wasm_idle_debug_enter(${d}, ${t+1});`),e===`main`){a===`CPP`&&(T.push(`${i}    std::cout.setf(std::ios::unitbuf);`),T.push(`${i}    std::cerr.setf(std::ios::unitbuf);`));let e=a===`CPP`?`nullptr`:`NULL`;T.push(`${i}    setvbuf(stdout, ${e}, _IONBF, 0);`),T.push(`${i}    setvbuf(stderr, ${e}, _IONBF, 0);`)}let r=j?n?``:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`)):_?.parameters||``;for(let e of r.split(`,`).map(e=>e.trim()).filter(Boolean)){let n=e.split(`=`)[0]?.trim()||``,r=n.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map)\s*<.+>)\s*&?\s*([A-Za-z_]\w*)\s*$/);if(r){let e=p++,n=r[1],a=r[2];g.set(a,{slot:e,container:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:a,kind:`text`,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    __wasm_idle_debug_emit_${n}(${d}, ${e}, ${a});`);continue}let a=[];for(let e of n.matchAll(/\[(\d+)\]/g))a.push(Number(e[1]));let o=n.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(a.length&&o&&/\b(int|float|double|bool|char)\b/.test(n)){let e=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:o[1],kind:`array`,elementKind:n.match(/\b(int|float|double|bool|char)\b/)?.[1]||`int`,length:a[0],dimensions:a,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    __wasm_idle_debug_value_addr(${d}, ${e}, (int)((unsigned long long)(${o[1]})));`);continue}if(/[*&\[]/.test(n))continue;let s=n.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);if(!s)continue;let c=s[1],l=/\bbool\b/.test(n)?`bool`:/\b(?:int|float|double|char|short|long)\b/.test(n)?`number`:``;if(!l)continue;let u=p++;m.set(c,{slot:u,kind:l,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:u,name:c,kind:l,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    ${l===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${u}, ${c});`)}_=void 0}else u===0&&y.includes(`(`)&&y.includes(`)`)&&!y.includes(`{`)&&!y.endsWith(`;`)&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y)?_={functionName:y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||`anonymous`,parameters:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`))}:y&&y!==`{`&&(_=void 0);u>0&&l<u&&(u=0,d=0,m=new Map,g=new Map)}S.length&&(a===`CPP`?(T.push(`struct __wasm_idle_debug_globals_init {`),T.push(`    __wasm_idle_debug_globals_init() {`),T.push(...S.map(e=>`        ${e}`)),T.push(`    }`),T.push(`} __wasm_idle_debug_globals_init_instance;`)):(T.push(`__attribute__((constructor)) static void __wasm_idle_debug_globals_init(void) {`),T.push(...S.map(e=>`    ${e}`)),T.push(`}`))),r=T.join(`
`)}else this.debugVariableMetadata={},this.debugGlobalMetadata=[],this.debugFunctionMetadata={};typeof e.transformSource==`function`&&(r=e.transformSource(r));let p=nt(r);await this.ready,e.sourceAlreadyMounted||(this.addWorkspaceFiles(e.workspaceFiles,t),this.addWorkspaceDirectories(t),this.memfs.addFile(t,p)),this.memfs.addFile(i,new Uint8Array);let m=await this.getModule(this.assetUrls.clang),h=this.compilerConfig?.resourceDir||`/lib/clang/8.0.1`,g=[`-cc1`,`-triple`,`wasm32-wasi`,`-emit-obj`,`-disable-free`,`-isysroot`,`/`,`-resource-dir`,h,...we(a,``,h).flatMap(e=>[`-internal-isystem`,e]),...a===`OBJC`?[`-I.`]:[],`-ferror-limit`,`19`,`-fcolor-diagnostics`,...d?[]:[`-O`+f],`-o`,i,c,`-x`,s,...a===`OBJC`?ye:[],t,...o,...d?[`-O0`,`-debug-info-kind=standalone`,`-dwarf-version=4`,`-debugger-tuning=gdb`,`-fdebug-compilation-dir=/workspace`]:[]];this.trace(`compile ${t} -> ${i}`);try{return await this.run(m,!0,`clang`,...g)}catch(e){if(Uint8Array.from(this.memfs.getFileContents(i)).length>0)return this.trace(`recover ${i} after clang output stream exit`),null;throw e}}async link(e,t,r=`none`){let i=typeof e==`string`?[e]:[...e];if(i.length===0||i.some(e=>typeof e!=`string`||e.length===0))throw TypeError(`At least one nonempty object file is required for linking`);let a=n(typeof r==`boolean`?{debug:r}:{debugMode:r}),o=`lib/wasm32-wasi`,s=this.compilerConfig?.compilerRuntimeLibDir||`lib/clang/8.0.1/lib/wasi`,c=`${o}/crt1.o`;await this.ready;let l=await this.getModule(this.assetUrls.lld);return this.trace(`link ${i.join(`, `)} -> ${t}`),await this.run(l,this.log,`wasm-ld`,`--export-dynamic`,...a===`trace`?[`--allow-undefined`]:[],`-z`,`stack-size=1048576`,`-L${o}/noeh`,`-L${o}`,c,...i,`-lc`,`-lc++`,`-lc++abi`,`-lm`,`-L${s}`,`-lclang_rt.builtins-wasm32`,`-o`,t)}async run(e,t,...n){return this.runWithOptions(e,t,n)}async runWithOptions(e,t,n,r={},i,a){this.memfs.out=t,this.hostLog(`${n.join(` `)}\n`),this.trace(`run ${n.join(` `)}`);let o=+new Date,s=new ve(e,this.memfs,n[0],...n.slice(1),{extraImports:i,instanceRef:a});s.environ={...s.environ,...r},s.trace=e=>this.trace(e),s.debugSession={buffer:this.debugBuffer,interruptBuffer:this.debugInterruptBuffer,watchBuffer:this.debugWatchBuffer,watchResultBuffer:this.debugWatchResultBuffer,breakpoints:new Set(this.debugBreakpoints),breakpointVersion:0,pauseOnEntry:this.debugPauseOnEntry,stepArmed:this.debugPauseOnEntry,nextLineArmed:!1,stepOutArmed:!1,callDepth:0,stepOutDepth:0,currentFunctionId:0,currentLine:0,resumeSkipActive:!1,resumeSkipFunctionId:0,resumeSkipLine:0,nextLineFunctionId:0,nextLineLine:0,variableMetadata:this.debugVariableMetadata,globalVariableMetadata:this.debugGlobalMetadata,functionMetadata:this.debugFunctionMetadata,frames:[],globalValues:new Map,onPause:e=>this.onDebugEvent?.(e)};let c=+new Date,l=await s.run(),u=+new Date;return this.log&&this.stdout(`
`),this.showTiming&&this.stdout(`${Be}(${o-c}ms/${u-c}ms)${Ve}\n`),l?s:null}async compileLink(e,t={}){let{language:r=`CPP`,fileName:i,activePath:a,workspaceFiles:o=[],args:s=[],compileArgs:c=s,debugMode:l,debug:u,breakpoints:d=[],pauseOnEntry:f=!1,cppVersion:p,cVersion:m,debugBuffer:h,interruptBuffer:g,watchBuffer:_,watchResultBuffer:v}=t,y=n({debugMode:l,debug:u}),b=y===`lldb`?z:R,x=o.map(e=>({...e,path:b(e.path)})),{input:S,obj:C,wasm:w}=Xe(r,b(a||``)||b(i||``)||void 0),T=new Map;for(let e of x)if(e.path){if(e.path===B||e.path.startsWith(`${B}/`))throw Error(`Workspace path uses reserved build namespace ${JSON.stringify(B)}`);T.set(e.path,e)}if(S===B||S.startsWith(`${B}/`))throw Error(`Active source path uses reserved build namespace ${JSON.stringify(B)}`);T.set(S,{path:S,content:e});let E=[...T.values()].sort((e,t)=>e.path<t.path?-1:+(e.path>t.path)),D=E.filter(e=>e.path===S||$e.test(e.path)),O=y===`trace`;if(O&&D.length>1)throw Error(`Trace debug mode does not support multiple C/C++ translation units`);this.beginTrace(O),this.debugBreakpoints=new Set(O?d:[]),this.debugPauseOnEntry=O&&f,this.debugBuffer=h,this.debugInterruptBuffer=g,this.debugWatchBuffer=_,this.debugWatchResultBuffer=v,this.lastArtifactPath=w;let k=JSON.stringify({code:e,input:S,wasm:w,language:r,compileArgs:c,workspaceFiles:E,cppVersion:p,cVersion:m,debugMode:y});if(this.lastBuildKey===k)return this.trace(`reuse ${w}`),this.wasm;if(D.length===1)await this.compile({input:S,code:e,obj:C,language:r,compileArgs:c,workspaceFiles:x,cppVersion:p,cVersion:m,debugMode:y}),await this.link(C,w,y);else{await this.ready,this.addWorkspaceFiles(E),this.memfs.addDirectory(B),this.memfs.addDirectory(`${B}/objects`);let e=[];for(let[t,n]of D.entries()){let i=`${B}/objects/${t.toString().padStart(4,`0`)}.o`;e.push(i),await this.compile({input:n.path,code:n.content,obj:i,language:n.path===S?r:n.path.endsWith(`.c`)?`C`:`CPP`,compileArgs:c,workspaceFiles:[],cppVersion:p,cVersion:m,debugMode:y,sourceAlreadyMounted:!0})}await this.link(e,w,y)}this.lastBuildKey=k;let A=Uint8Array.from(this.memfs.getFileContents(w));return this.wasm=await this.hostLogAsync(`Compiling ${w}`,WebAssembly.compile(A))}async compileArtifact(e,t={}){let r=n(t),i=await this.compileLink(e,t),a=Uint8Array.from(this.memfs.getFileContents(this.lastArtifactPath)),o=t.language||`CPP`,s={code:e,language:o,fileName:t.fileName,activePath:t.activePath,workspaceFiles:t.workspaceFiles,compileArgs:t.compileArgs,cppVersion:t.cppVersion,cVersion:t.cVersion,debugMode:r};return{bytes:a,wasm:i,target:`wasm32-wasi`,format:`wasi-core-wasm`,fileName:this.lastArtifactPath,language:o,...r===`trace`?{debugMetadata:{variableMetadata:this.debugVariableMetadata,globalVariableMetadata:this.debugGlobalMetadata,functionMetadata:this.debugFunctionMetadata}}:{},...r===`lldb`?{debug:await Qe(s,a,this.compilerConfig?.provenance)}:{}}}async compileLinkRun(e,t={}){let{language:r=`CPP`,fileName:i,activePath:a,workspaceFiles:o=[],args:s=[],compileArgs:c=s,programArgs:l=[],debugMode:u,debug:d,breakpoints:f=[],pauseOnEntry:p=!1,cppVersion:m,cVersion:h,debugBuffer:g,interruptBuffer:_,watchBuffer:v,watchResultBuffer:y}=t,b=n({debugMode:u,debug:d});if(b===`lldb`)throw Error(`compileLinkRun() cannot execute LLDB artifacts in the browser WebAssembly engine. Use compileArtifact() and @wasm-idle/llvm-core/debug instead.`);this.debug=b===`trace`;let{wasm:x}=Xe(r,R(a||``)||R(i||``)||void 0);return await this.run(await this.compileLink(e,{language:r,fileName:i,activePath:a,workspaceFiles:o,compileArgs:c,debugMode:b,breakpoints:f,pauseOnEntry:p,cppVersion:m,cVersion:h,debugBuffer:g,interruptBuffer:_,watchBuffer:v,watchResultBuffer:y}),!0,x,...l)}};function V(e,t){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function H(e,t){if(typeof e!=`string`||e.length===0)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function at(e,t){if(e!==`wasm32-wasi`)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function ot(e){let t=V(e,`root.compiler.provenance`);if(t.name!==`clang`)throw Error(`invalid root.compiler.provenance.name in wasm-clang runtime manifest`);return{name:`clang`,version:H(t.version,`root.compiler.provenance.version`),revision:H(t.revision,`root.compiler.provenance.revision`)}}function st(e){let t=V(e,`root.compiler`),n=V(t.sysroot,`root.compiler.sysroot`);return{memfs:{asset:H(V(t.memfs,`root.compiler.memfs`).asset,`root.compiler.memfs.asset`),argv0:H(V(t.memfs,`root.compiler.memfs`).argv0,`root.compiler.memfs.argv0`)},clang:{asset:H(V(t.clang,`root.compiler.clang`).asset,`root.compiler.clang.asset`),argv0:H(V(t.clang,`root.compiler.clang`).argv0,`root.compiler.clang.argv0`)},lld:{asset:H(V(t.lld,`root.compiler.lld`).asset,`root.compiler.lld.asset`),argv0:H(V(t.lld,`root.compiler.lld`).argv0,`root.compiler.lld.argv0`)},sysroot:{asset:H(n.asset,`root.compiler.sysroot.asset`),...typeof n.runtimeRoot==`string`?{runtimeRoot:n.runtimeRoot}:{}},...t.resourceDir===void 0?{}:{resourceDir:H(t.resourceDir,`root.compiler.resourceDir`)},...t.compilerRuntimeLibDir===void 0?{}:{compilerRuntimeLibDir:H(t.compilerRuntimeLibDir,`root.compiler.compilerRuntimeLibDir`)},...typeof t.defaultCppStandard==`string`?{defaultCppStandard:t.defaultCppStandard}:{},...typeof t.defaultCStandard==`string`?{defaultCStandard:t.defaultCStandard}:{},...t.provenance===void 0?{}:{provenance:ot(t.provenance)}}}function ct(e){let t=V(e,`root.clangd`);return{js:H(t.js,`root.clangd.js`),wasm:H(t.wasm,`root.clangd.wasm`)}}function lt(e,t){let n=V(e,t);if(V(n.execution,`${t}.execution`).kind!==`wasi-preview1`)throw Error(`invalid ${t}.execution.kind in wasm-clang runtime manifest`);if(n.artifactFormat!==`wasi-core-wasm`)throw Error(`invalid ${t}.artifactFormat in wasm-clang runtime manifest`);return{artifactFormat:`wasi-core-wasm`,execution:{kind:`wasi-preview1`}}}function ut(e){return{"wasm32-wasi":lt(V(e,`root.targets`)[`wasm32-wasi`],`root.targets.wasm32-wasi`)}}function dt(e){let t=V(e,`root`);if(t.manifestVersion!==1)throw Error(`invalid root.manifestVersion in wasm-clang runtime manifest`);return{manifestVersion:1,version:H(t.version,`root.version`),defaultTarget:at(t.defaultTarget,`root.defaultTarget`),compiler:st(t.compiler),clangd:ct(t.clangd),targets:ut(t.targets)}}async function ft(e,t=fetch,n,r=f){return dt(await S(We(e,`wasm-clang runtime manifest URL`),{fetchImpl:t,label:`wasm-clang runtime manifest`,maxBytes:Math.min(r,f),signal:n}))}function pt(e){return Je(e)}var mt=t({BrowserClangRuntime:()=>it,loadRuntimeManifest:()=>ft,resolveRuntimeManifestUrl:()=>pt});const ht=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,gt=e=>ht(e?.buffer),_t=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const vt=new TextDecoder,yt=e=>e instanceof Int32Array?e:new Int32Array(e),bt=e=>new Uint8Array(e.buffer,e.byteOffset+_t,e.byteLength-_t),xt=e=>{let t=yt(e),n=Atomics.load(t,1);if(n===-1)return null;let r=bt(t);return vt.decode(r.slice(0,n))},St=(e,t)=>{if(!e||!gt(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return xt(e)},Ct=new TextDecoder,wt=globalThis.fetch.bind(globalThis),Tt=globalThis.XMLHttpRequest;let U=null,W=null,Et=new Map,Dt=!1,Ot=0;const kt=new Map,G=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},At=()=>{if(!U)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(U.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${U.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${U.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${U.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},jt=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},Mt=e=>{let t=At();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},K=e=>{if(!W)return!1;let t;try{t=new URL(e)}catch{return!1}return t.protocol===W.protocol&&t.origin===W.origin&&t.pathname.startsWith(W.pathname)},Nt=e=>{let t=At();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)?null:Et.get(n.href)||(K(n.href)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`)},Pt=e=>Nt(e)!==null,Ft=async e=>{let t=++Ot;return await new Promise((n,r)=>{kt.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},It=async(e,t,n)=>{let r=Mt(e);if(!r||Nt(r)!==t||!U)throw Error(`Untracked runtime asset request`);let i=U.maxAssetBytes??134217728,a=await wt(r,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,...n?{integrity:n}:{}});if(a.url){let e;try{e=new URL(a.url)}catch{let e=Error(`Runtime asset response URL is invalid: ${a.url}`);throw G(a,e),e}if(e.href!==r){let t=Error(`Runtime asset response URL mismatch: expected ${r}, received ${e.href}`);throw G(a,t),t}}if(!a.ok){let e=Error(`Failed to load ${t}: ${a.status}`);throw G(a,e),e}let o=a.headers.get(`content-length`),s;if(o!==null){let e=Number(o);if(!/^\d+$/u.test(o.trim())||!Number.isSafeInteger(e)){let e=Error(`Runtime asset ${t} has an invalid Content-Length`);throw G(a,e),e}s=e||void 0}if(s!==void 0&&s>i){let e=Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw G(a,e),e}let c=a.headers.get(`content-type`)||void 0;if(!a.body){let e=new Uint8Array(await a.arrayBuffer());if(e.byteLength>i)throw Error(`Runtime asset ${t} exceeds the ${i} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:s??e.byteLength}}),{bytes:e,mimeType:c}}let l=a.body.getReader(),u=!1,d=e=>{if(!u){u=!0;try{Promise.resolve(l.cancel(e)).catch(()=>void 0)}catch{}}},f=0,p,m;try{for(p=new Uint8Array(s||Math.min(65536,i));;){let{done:e,value:n}=await l.read();if(e)break;if(!n)continue;let r=f+n.byteLength;if(r>i){let e=Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw d(e),e}if(r>p.byteLength){let e=Math.min(i,Math.max(r,p.byteLength*2)),t=new Uint8Array(e);t.set(p.subarray(0,f)),p=t}p.set(n,f),f=r,self.postMessage({assetProgress:{asset:t,loaded:f,total:s}})}}catch(e){throw d(e),e}finally{try{l.releaseLock()}catch(e){m={error:e}}}if(m)throw m.error;return f!==p.byteLength&&(p=p.slice(0,f)),self.postMessage({assetProgress:{asset:t,loaded:f,total:s??f}}),{bytes:p,mimeType:c}};async function Lt(e,t){let n=Nt(e);if(!n||!U)throw Error(`Untracked runtime asset request`);return U.useAssetBridge?await Ft(n):await It(e,n,t)}function Rt(e){return new Response(jt(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function zt(){if(Tt===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=Mt(t);if(!n||!Pt(n)){if(n&&K(n))throw Error(`Untracked runtime asset request`);let r=n||(t instanceof URL?t.href:String(t));this.native=new Tt,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await Lt(this.url),t=jt(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=Ct.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function Bt(){Dt||(Dt=!0,globalThis.fetch=(async(e,t)=>{let n=Mt(e);if(!n||!Pt(n)){if(n&&K(n))throw Error(`Untracked runtime asset request`);return wt(e,t)}let r=t?.integrity??(typeof Request<`u`&&e instanceof Request?e.integrity:void 0);return Rt(await Lt(n,typeof r==`string`?r:void 0))}),zt())}function Vt(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);W=null,Et=new Map,U=e,Bt()}function Ht(e){let t=e?.assetResponse;if(!t)return!1;let n=kt.get(t.id);return n?(kt.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}self.document={querySelectorAll(){return[]}};let Ut,q,J,Y,X,Z,Q=!1,$=null;function Wt(e,t){postMessage({progress:{percent:e,stage:t}})}async function Gt(e,t,n){let{BrowserClangRuntime:r,loadRuntimeManifest:i,resolveRuntimeManifestUrl:a}=await Promise.resolve().then(()=>mt);Z=new r({stdout:e=>postMessage({output:e}),onDebugEvent:e=>postMessage({debugEvent:e}),stdin:()=>{if(Q){let e=$;return $=null,e??``}return St(Ut,()=>postMessage({buffer:!0}))??``},progress:e=>postMessage({progress:e}),log:t,maxAssetBytes:n,runtimeBaseUrl:e,manifest:await i(a(e),fetch,void 0,n)}),await Z.ready}self.onmessage=async e=>{if(Ht(e.data))return;let{code:t,buffer:n,debugBuffer:r,watchBuffer:i,watchResultBuffer:a,load:o,interrupt:s,log:c,path:l,assets:u,prepare:d,language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:y,debug:b,breakpoints:x,pauseOnEntry:S,stdin:C,maxAssetBytes:w}=e.data,T=y||(b?`trace`:`none`);if(o)try{let e=u;Vt(e||null),await Gt(e?.baseUrl||l||``,c,w),postMessage({load:!0})}catch(e){self.postMessage({error:e.message||`Unable to load the C/C++ runtime.`})}else if(d){if(Ut=new Int32Array(n),q=new Int32Array(r),J=new Int32Array(i),Y=new Int32Array(a),X=new Uint8Array(s),Q=typeof C==`string`,$=Q?C:null,T===`trace`&&!gt(q)){self.postMessage({error:`C/C++ debugging requires SharedArrayBuffer.`});return}try{Wt(5,`Compiling ${f===`C`?`C`:`C++`} source`),await Z.compileArtifact(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:T,breakpoints:x,pauseOnEntry:S,debugBuffer:q,interruptBuffer:X,watchBuffer:J,watchResultBuffer:Y}),Wt(100,`${f===`C`?`C`:`C++`} program ready`),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message})}}else if(t){if(Z.log=c,Ut=new Int32Array(n),q=new Int32Array(r),J=new Int32Array(i),Y=new Int32Array(a),X=new Uint8Array(s),Q=typeof C==`string`,$=Q?C:null,T===`trace`&&!gt(q)){self.postMessage({error:`C/C++ debugging requires SharedArrayBuffer.`});return}try{if(T===`lldb`){let e=await Z.compileArtifact(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:`lldb`});if(!e.debug)throw Error(`wasm-clang did not return an LLDB DWARF descriptor`);let n=z(h||(f===`C`?`main.c`:`main.cc`))||(f===`C`?`main.c`:`main.cc`),r=new Map;for(let e of g||[]){let t=z(e.path);t&&r.set(`/workspace/${t}`,e.content)}r.set(`/workspace/${n}`,t),self.postMessage({lldbArtifact:{bytes:new Uint8Array(e.bytes),descriptor:e.debug,sources:e.debug.files.map(({path:e,contentSha256:t})=>{let n=r.get(e);if(n===void 0)throw Error(`Missing LLDB source content for ${e}`);return{path:e,content:n,contentSha256:t}})}});return}await Z.compileLinkRun(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:T,breakpoints:x,pauseOnEntry:S,debugBuffer:q,interruptBuffer:X,watchBuffer:J,watchResultBuffer:Y}),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message})}}};