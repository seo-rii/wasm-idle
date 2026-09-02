var e=Object.defineProperty,t=(t,n)=>{let r={};for(var i in t)e(r,i,{get:t[i],enumerable:!0});return n||e(r,Symbol.toStringTag,{value:`Module`}),r};function n(e){if(e.debugMode!==void 0){if(e.debugMode===`none`||e.debugMode===`trace`||e.debugMode===`lldb`)return e.debugMode;throw Error(`unsupported wasm-clang debug mode: ${String(e.debugMode)}`)}return e.debug?`trace`:`none`}function r(e,...t){let n={};for(let r of t)n[r]=(e[r]||(()=>0)).bind(e);return n}function i(e,t,n=-1){let r=n===-1?e.length:t+n,i=``;for(let n=t;n<r&&e[n];++n)i+=String.fromCharCode(e[n]);return i}function a(e,t,n=-1){let r=n===-1?e.length:t+n,i=[];for(let n=t;n<r&&e[n];++n)i.push(e[n]);return new TextDecoder().decode(Uint8Array.from(i))}function o(e,t,n){return parseInt(i(e,t,n),8)}var s=class{memory;view;buffer;u8;u32;constructor(e){this.memory=e,this.buffer=e.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer)}check(){this.buffer.byteLength===0&&(this.buffer=this.memory.buffer,this.view=new DataView(this.buffer),this.u8=new Uint8Array(this.buffer),this.u32=new Uint32Array(this.buffer))}read8(e){return this.u8[e]}read32(e){return this.u32[e>>2]}readInt32(e){return this.view.getInt32(e,!0)}readFloat32(e){return this.view.getFloat32(e,!0)}readFloat64(e){return this.view.getFloat64(e,!0)}readStr(e,t){return i(this.u8,e,t)}readStrR(e,t){return a(this.u8,e,t)}write8(e,t){this.u8[e]=t}write32(e,t){this.u32[e>>2]=t}write64(e,t,n=0){this.write32(e,t),this.write32(e+4,n)}writeStr(e,t){return e+=this.write(e,t),this.write8(e,0),t.length+1}writeUint8(e,t){return new Uint8Array(this.buffer,e,t.length).set(t),t.length}write(e,t){return t instanceof ArrayBuffer||t instanceof SharedArrayBuffer?this.writeUint8(e,new Uint8Array(t)):typeof t==`string`?this.writeUint8(e,t.split(``).map(e=>e.charCodeAt(0))):this.writeUint8(e,t)}};const c=new Map,l=new Map,u=e=>e.byteLength>=2&&e[0]===31&&e[1]===139,d=128*1024*1024,f=64*1024;async function p(e,t,n,r){let i=e.getReader(),a=r,o=!1;if(a?.aborted){o=!0;let e=g(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}try{i.releaseLock()}catch{}throw e}let s,c=a?new Promise((e,t)=>{s=()=>{if(o)return;o=!0;let e=g(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}t(e)},a.addEventListener(`abort`,s,{once:!0})}):void 0,l=new Uint8Array(Math.min(f,n)),u=0,d=!1,p,m;try{for(v(a);;){let e=i.read(),{done:r,value:o}=c?await Promise.race([e,c]):await e;if(v(a),r)break;if(!o)continue;let s=u+o.byteLength;if(s>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);if(s>l.byteLength){let e=Math.min(n,Math.max(s,Math.max(l.byteLength*2,1))),t=new Uint8Array(e);t.set(l.subarray(0,u)),l=t}l.set(o,u),u=s}v(a),p=l.subarray(0,u),d=!0}catch(e){if(a?.aborted)throw g(a);if(!o){o=!0;try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}}throw e}finally{s&&a?.removeEventListener(`abort`,s);try{i.releaseLock()}catch(e){d&&(m={error:e})}}if(m)throw m.error;return p}function m(e){let t;try{t=new URL(e,typeof location<`u`?location.href:void 0)}catch{throw Error(`Runtime asset URL must be absolute outside a browser document`)}if(t.protocol!==`http:`&&t.protocol!==`https:`)throw Error(`Runtime assets must use HTTP(S)`);if(t.username||t.password)throw Error(`Runtime asset URLs must not include credentials`);if(t.hash)throw Error(`Runtime asset URLs must not include fragments`);return t}function h(e){let t=e.headers.get(`Content-Length`);if(t===null)return 0;let n=Number(t);if(!/^\d+$/u.test(t)||!Number.isSafeInteger(n))throw Error(`Runtime asset has an invalid Content-Length`);return n}function g(e){return e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`)}function _(e,t,n){return t?new Promise((r,i)=>{let a=!1,o=()=>{a||(a=!0,t.removeEventListener(`abort`,o),i(g(t)))};t.addEventListener(`abort`,o,{once:!0}),e.then(e=>{if(a){n&&Promise.resolve().then(()=>n(e,t.reason)).catch(()=>{});return}a=!0,t.removeEventListener(`abort`,o),r(e)},e=>{a||(a=!0,t.removeEventListener(`abort`,o),i(e))}),t.aborted&&o()}):e}function v(e){if(e?.aborted)throw g(e)}function y(e,t){try{e.body?.cancel(t).catch(()=>{})}catch{}}async function b(e,t,n,r,i){if(i?.aborted){let t=g(i);throw y(e,t),t}let a;try{a=h(e)}catch(t){throw y(e,t),t}if(a>n)throw y(e),Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);if(!e.body){let a=new Uint8Array(await _(e.arrayBuffer(),i));if(i?.aborted)throw g(i);if(a.byteLength>n)throw Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);return r?.set?.(1),a}let o=i,s=e.body.getReader(),c=!1,l=e=>{if(!c){c=!0;try{Promise.resolve(s.cancel(e)).catch(()=>{})}catch{}}};if(o?.aborted){let e=g(o);l(e);try{s.releaseLock()}catch{}throw e}let u,d=o?new Promise((e,t)=>{u=()=>{let e=g(o);l(e),t(e)},o.addEventListener(`abort`,u,{once:!0})}):void 0,p,m=0,b,x;try{for(p=new Uint8Array(Math.min(n,a||f));;){v(o);let e=s.read(),{done:i,value:c}=d?await Promise.race([e,d]):await e;if(v(o),i)break;if(!c)continue;let u=m+c.byteLength;if(u>n){let e=Error(`Runtime asset ${t} size exceeds the ${n} byte limit`);throw l(e),e}if(u>p.byteLength){let e=Math.min(n,Math.max(u,Math.max(p.byteLength*2,1))),t=new Uint8Array(e);t.set(p.subarray(0,m)),p=t}p.set(c,m),m=u,a>0&&r?.set?.(m/a)}v(o),b=p.subarray(0,m)}catch(e){if(o?.aborted){let e=g(o);throw l(e),e}throw l(e),e}finally{u&&o?.removeEventListener(`abort`,u);try{s.releaseLock()}catch(e){o?.aborted||(x={error:e})}}if(o?.aborted){let e=g(o);throw l(e),e}if(x)throw x.error;return b}async function x(e,t={}){let n=t.maxBytes??4194304;if(!Number.isSafeInteger(n)||n<=0)throw Error(`Runtime JSON byte limit must be a positive safe integer`);let r=m(e.toString()),i=t.label?.trim()||`runtime JSON`,a=t.fetchImpl??globalThis.fetch?.bind(globalThis);if(!a)throw Error(`Fetch is unavailable while loading ${i}`);if(t.signal?.aborted)throw g(t.signal);let o={cache:`no-store`,credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`};t.signal&&(o.signal=t.signal);let s=await _(Promise.resolve(a(r.toString(),o)),t.signal,(e,t)=>{y(e,t)});if(t.signal?.aborted){let e=g(t.signal);throw y(s,e),e}if(s.url){let e;try{e=new URL(s.url)}catch{throw y(s),Error(`${i} returned an invalid final URL`)}if(e.href!==r.href)throw y(s),Error(`${i} returned an unexpected final URL`)}if(!s.ok)throw y(s),Error(`Failed to load ${i} from ${r}: ${s.status}`);let c=await b(s,r,n,void 0,t.signal),l;try{l=new TextDecoder(`utf-8`,{fatal:!0}).decode(c)}catch(e){throw Error(`${i} is not valid UTF-8`,{cause:e})}try{return JSON.parse(l)}catch(e){throw Error(`${i} is not valid JSON`,{cause:e})}}async function S(e,t=`runtime asset`,n=d,r){if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset decompression limit must be a non-negative safe integer`);if(v(r),!u(e)){if(e.byteLength>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);return e}if(typeof DecompressionStream!=`function`)throw Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);try{let i=Uint8Array.from(e),a=new ReadableStream({start(e){e.enqueue(i),e.close()}}),o=new DecompressionStream(`gzip`);return await p(a.pipeThrough({readable:o.readable,writable:o.writable}),t,n,r)}catch(e){throw r?.aborted?g(r):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function C(e,t,n,r,i){if(i?.aborted){let t=g(i);throw y(e,t),t}let a;try{a=h(e)}catch(t){throw y(e,t),t}if(a>n)throw y(e),Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);if(!e.body){let a=new Uint8Array(await _(e.arrayBuffer(),i));if(v(i),a.byteLength>n)throw Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);let o=await S(a,t,n,i);return v(i),r?.set?.(1),o}let o=e.body.getReader(),s=[],c=0,l=0,u=!1,d=!1,f=!1,m=()=>{d||(d=!0,o.releaseLock())},b=e=>{if(!(d||f)){f=!0;try{Promise.resolve(o.cancel(e)).catch(()=>{})}catch{}try{m()}catch{}}};if(i?.aborted){let e=g(i);throw b(e),e}let x,C=i?new Promise((e,t)=>{x=()=>{let e=g(i);b(e),t(e)},i.addEventListener(`abort`,x,{once:!0})}):void 0;try{for(v(i);c<2;){let e=o.read(),{done:d,value:f}=C?await Promise.race([e,C]):await e;if(v(i),d){u=!0,m();break}if(!f)continue;let p=l+f.byteLength;if(p>n){let e=Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);throw b(e),e}s.push(f),c+=f.byteLength,l=p,a>0&&r?.set?.(Math.min(l/a,1))}v(i)}catch(e){throw b(e),i?.aborted?g(i):e}finally{x&&i?.removeEventListener(`abort`,x)}let w,T;for(let e of s){for(let t of e)if(w===void 0?w=t:T===void 0&&(T=t),T!==void 0)break;if(T!==void 0)break}let E=0,D=new ReadableStream({async pull(e){if(E<s.length){e.enqueue(s[E++]);return}if(u){e.close();return}try{let{done:s,value:c}=await o.read();if(v(i),s){u=!0,m(),e.close();return}if(!c)return;let d=l+c.byteLength;if(d>n){let r=Error(`Runtime asset ${t} download size exceeds the ${n} byte limit`);b(r),e.error(r);return}l=d,a>0&&r?.set?.(Math.min(l/a,1)),e.enqueue(c)}catch(t){b(t),e.error(t)}},cancel(e){b(e)}}),O=D;if(w===31&&T===139){if(typeof DecompressionStream!=`function`){let e=Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);throw b(e),e}let e=new DecompressionStream(`gzip`);O=D.pipeThrough({readable:e.readable,writable:e.writable})}try{let e=await p(O,t,n,i);return r?.set?.(1),e}catch(e){throw b(e),i?.aborted?g(i):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}async function w(e,t,n,r){v(r);let{unzipSync:i}=await import(`./chunks/BR24SaiU.js`);v(r);let a,o=i(e,{filter(e){if(e.name.endsWith(`/`)||a!==void 0)return!1;if(e.originalSize>n)throw Error(`Runtime asset ${t} extracted size exceeds the ${n} byte limit`);return a=e.name,!0}});v(r);for(let[e,t]of Object.entries(o))if(!e.endsWith(`/`))return t;throw Error(`No entry found`)}const T=async(e,t,n=d,r)=>{if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset byte limit must be a non-negative safe integer`);v(r);let i=`${e}\0${n}`,a=r?void 0:l.get(i);a||(a=(async()=>{let i=m(e),a={credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`};r&&(a.signal=r);let o;try{o=await _(Promise.resolve(fetch(i,a)),r,(e,t)=>{y(e,t)})}catch(e){throw r?.aborted?g(r):e}if(r?.aborted){let e=g(r);throw y(o,e),e}if(o.url){let e;try{e=new URL(o.url)}catch{throw y(o),Error(`Runtime asset returned an invalid final URL`)}if(e.href!==i.href)throw y(o),Error(`Runtime asset returned an unexpected final URL`)}if(!o.ok)throw y(o),Error(`Failed to load runtime asset ${i}: ${o.status}`);if(i.pathname.endsWith(`.gz`))return await C(o,i,n,t,r);let s=await b(o,i,n,t,r);return i.pathname.endsWith(`.zip`)?await w(s,i,n,r):s})(),r||(a=a.catch(e=>{throw l.get(i)===a&&l.delete(i),e}),l.set(i,a)));let o=await a;return v(r),t?.set?.(1),Uint8Array.from(o)};async function E(e,t,n){v(n);let r=n?void 0:c.get(e);if(r)return r;let i=(async()=>{let r=await T(e,t,d,n);v(n);let i=await _(WebAssembly.compile(r),n);return v(n),i})();return n||(i=i.catch(t=>{throw c.get(e)===i&&c.delete(e),t}),c.set(e,i)),i}function D(e,t){return WebAssembly.instantiate(e,t)}var O=class extends Error{code;constructor(e){super(`process exited with code ${e}.`),this.code=e}},k=class extends Error{constructor(e,t){super(`${e}.${t} not implemented.`)}},A=class extends Error{constructor(e=`abort`){super(e)}},j=class extends Error{constructor(e){super(e)}};function M(e){if(!e)throw new j(`assertion failed.`)}const ee=[`&&`,`||`,`==`,`!=`,`<=`,`>=`,`+`,`-`,`*`,`/`,`%`,`<`,`>`,`!`],N=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`array`,te=e=>!!e&&typeof e==`object`&&!Array.isArray(e)&&e.__debugExpressionKind===`object`,P=(e,t)=>{let n=e[t];if(n!==`'`&&n!==`"`)throw Error(`expected quoted string`);let r=t+1,i=``;for(;r<e.length;){let t=e[r];if(!t)break;if(t===`\\`){let t=e[r+1];if(!t)throw Error(`unterminated string literal`);t===`n`?i+=`
`:t===`r`?i+=`\r`:t===`t`?i+=`	`:i+=t,r+=2;continue}if(t===n)return{value:i,next:r+1};i+=t,r+=1}throw Error(`unterminated string literal`)},ne=e=>{let t=[];for(let n=0;n<e.length;){let r=e[n];if(!r)break;if(/\s/.test(r)){n+=1;continue}if(r===`(`||r===`)`){t.push({type:`paren`,value:r}),n+=1;continue}if(r===`[`||r===`]`){t.push({type:`bracket`,value:r}),n+=1;continue}if(r===`.`){t.push({type:`dot`}),n+=1;continue}let i=ee.find(t=>e.startsWith(t,n));if(i){t.push({type:`operator`,value:i}),n+=i.length;continue}if(r===`'`||r===`"`){let r=P(e,n);t.push({type:`string`,value:r.value}),n=r.next;continue}let a=e.slice(n).match(/^\d+(?:\.\d+)?/);if(a?.[0]){t.push({type:`number`,value:a[0]}),n+=a[0].length;continue}let o=e.slice(n).match(/^[A-Za-z_]\w*/);if(o?.[0]){o[0]===`true`||o[0]===`false`||o[0]===`True`||o[0]===`False`?t.push({type:`boolean`,value:o[0]===`true`||o[0]===`True`}):o[0]===`null`||o[0]===`None`?t.push({type:`null`}):o[0]===`and`?t.push({type:`operator`,value:`&&`}):o[0]===`or`?t.push({type:`operator`,value:`||`}):o[0]===`not`?t.push({type:`operator`,value:`!`}):t.push({type:`identifier`,value:o[0]}),n+=o[0].length;continue}throw Error(`unsupported token near "${e.slice(n)}"`)}return t},F=(e,t=0)=>{let n=t;for(;/\s/.test(e[n]||``);)n+=1;let r=e[n];if(r===`[`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}let r=F(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`]`)return{value:t,next:n+1};throw Error(`unsupported array preview`)}}if(r===`(`){n+=1;let t=[];for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};if(e.startsWith(`...`,n)){for(t.truncated=!0,n+=3;/\s/.test(e[n]||``);)n+=1;if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}let r=F(e,n);for(t.push(r.value),n=r.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`)`)return{value:t,next:n+1};throw Error(`unsupported tuple preview`)}}if(r===`{`){n+=1;let t={};for(;;){for(;/\s/.test(e[n]||``);)n+=1;if(e[n]===`}`)return{value:t,next:n+1};if(e.startsWith(`...`,n))throw Error(`unavailable`);let r=``;if(e[n]===`'`||e[n]===`"`){let t=P(e,n);r=t.value,n=t.next}else{let t=e.slice(n).match(/^[A-Za-z_]\w*/)?.[0];if(!t)throw Error(`unsupported object preview`);r=t,n+=t.length}for(;/\s/.test(e[n]||``);)n+=1;if(e[n]!==`:`)throw Error(`unsupported object preview`);n+=1;let i=F(e,n);for(t[r]=i.value,n=i.next;/\s/.test(e[n]||``);)n+=1;if(e[n]===`,`){n+=1;continue}if(e[n]===`}`)return{value:t,next:n+1};throw Error(`unsupported object preview`)}}if(r===`'`||r===`"`)return P(e,n);if(e.startsWith(`true`,n))return{value:!0,next:n+4};if(e.startsWith(`false`,n))return{value:!1,next:n+5};if(e.startsWith(`True`,n))return{value:!0,next:n+4};if(e.startsWith(`False`,n))return{value:!1,next:n+5};if(e.startsWith(`null`,n)||e.startsWith(`None`,n))return{value:null,next:n+4};let i=e.slice(n).match(/^-?\d+(?:\.\d+)?/);if(i?.[0])return{value:Number(i[0]),next:n+i[0].length};throw Error(`unsupported preview`)},re=e=>{let t=e.trim();if(!t||t===`?`)throw Error(`unavailable`);if(t===`true`||t===`false`||t===`True`||t===`False`)return t===`true`||t===`True`;if(t===`null`||t===`None`)return null;let n=Number(t);if(!Number.isNaN(n))return n;if(t.startsWith(`[`)||t.startsWith(`(`)||t.startsWith(`{`)||t.startsWith(`'`)||t.startsWith(`"`)){let e=F(t);if(t.slice(e.next).trim())throw Error(`unsupported preview`);return e.value}throw Error(`unsupported preview`)},ie=e=>`'${e.replaceAll(`\\`,`\\\\`).replaceAll(`'`,`\\'`).replaceAll(`
`,`\\n`).replaceAll(`\r`,`\\r`).replaceAll(`	`,`\\t`)}'`,I=(e,t,n)=>{if(e===null)return`null`;if(typeof e==`number`||typeof e==`boolean`)return`${e}`;if(typeof e==`string`)return t?ie(e):e;if(n>=4)return`...`;if(Array.isArray(e)){let t=Math.min(e.length,8);return`[${e.slice(0,t).map(e=>I(e,!0,n+1)).join(`, `)}${e.truncated||e.length>t?`, ...`:``}]`}if(N(e)){let t=e.keys?.()||[],r=Math.min(t.length||e.length||0,8),i=[];for(let a=0;a<r;a+=1){let r=t[a]??a;i.push(I(e.get(r),!0,n+1))}let a=e.truncated||e.length!=null&&e.length>r;return`[${i.join(`, `)}${a?`, ...`:``}]`}if(te(e)){let t=e.keys?.()||[],r=Math.min(t.length,8);return`{${t.slice(0,r).map(t=>`${t}: ${I(e.get(t),!0,n+1)}`).join(`, `)}${t.length>r?`, ...`:``}}`}let r=Object.keys(e),i=Math.min(r.length,8);return`{${r.slice(0,i).map(t=>`${t}: ${I(e[t],!0,n+1)}`).join(`, `)}${r.length>i?`, ...`:``}}`},ae=e=>I(e,!1,0),oe=(e,t)=>{let n=e.trim();if(!n)throw Error(`empty expression`);let r=ne(n),i=new Map,a=e=>{if(i.has(e))return i.get(e);let n=t(e);return i.set(e,n),n},o=(e,t)=>{if(!Number.isInteger(t))throw Error(`unsupported index access`);if(Array.isArray(e)){if(t<0||t>=e.length)throw Error(`unavailable`);return e[t]}if(N(e)){if(e.length!=null&&(t<0||t>=e.length))throw Error(`unavailable`);return e.get(t)}throw Error(`unsupported index access`)},s=(e,t)=>{if(Array.isArray(e)||N(e)||!e)throw Error(`unsupported member access`);if(te(e)){if(!e.has(t))throw Error(`unavailable`);return e.get(t)}if(typeof e!=`object`||!Object.hasOwn(e,t))throw Error(`unavailable`);return e[t]},c=0,l=!0,u=e=>{let t=l;l=!1;try{return e()}finally{l=t}},d=()=>{let e=r[c];if(!e)throw Error(`unexpected end of expression`);if(e.type===`number`)return c+=1,Number(e.value);if(e.type===`boolean`)return c+=1,e.value;if(e.type===`null`)return c+=1,null;if(e.type===`string`)return c+=1,e.value;if(e.type===`identifier`){c+=1;let t=l?a(e.value):null;for(;;){let e=r[c];if(e?.type===`bracket`&&e.value===`[`){c+=1;let e=Number(v()),n=r[c];if(!n||n.type!==`bracket`||n.value!==`]`)throw Error(`missing closing bracket`);c+=1,t=l?o(t,e):null;continue}if(e?.type===`dot`){c+=1;let e=r[c];if(!e||e.type!==`identifier`)throw Error(`missing property name`);c+=1,t=l?s(t,e.value):null;continue}break}return t}if(e.type===`paren`&&e.value===`(`){c+=1;let e=v(),t=r[c];if(!t||t.type!==`paren`||t.value!==`)`)throw Error(`missing closing parenthesis`);return c+=1,e}throw Error(`expected value`)},f=()=>{let e=r[c];return e?.type===`operator`&&e.value===`!`?(c+=1,!f()):e?.type===`operator`&&e.value===`-`?(c+=1,-Number(f())):e?.type===`operator`&&e.value===`+`?(c+=1,Number(f())):d()},p=()=>{let e=f();for(;;){let t=r[c];if(t?.type!==`operator`||![`*`,`/`,`%`].includes(t.value))return e;c+=1;let n=f();t.value===`*`&&(e=Number(e)*Number(n)),t.value===`/`&&(e=Number(e)/Number(n)),t.value===`%`&&(e=Number(e)%Number(n))}},m=()=>{let e=p();for(;;){let t=r[c];if(t?.type!==`operator`||![`+`,`-`].includes(t.value))return e;c+=1;let n=p();t.value===`+`&&(e=typeof e==`string`||typeof n==`string`?`${e??`null`}${n??`null`}`:Number(e)+Number(n)),t.value===`-`&&(e=Number(e)-Number(n))}},h=()=>{let e=m();for(;;){let t=r[c];if(t?.type!==`operator`||![`<`,`<=`,`>`,`>=`].includes(t.value))return e;c+=1;let n=m(),i=typeof e==`string`&&typeof n==`string`?e:Number(e),a=typeof e==`string`&&typeof n==`string`?n:Number(n);t.value===`<`&&(e=i<a),t.value===`<=`&&(e=i<=a),t.value===`>`&&(e=i>a),t.value===`>=`&&(e=i>=a)}},g=()=>{let e=h();for(;;){let t=r[c];if(t?.type!==`operator`||![`==`,`!=`].includes(t.value))return e;c+=1;let n=h();t.value===`==`&&(e=e===n),t.value===`!=`&&(e=e!==n)}},_=()=>{let e=g();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`&&`)break;c+=1;let n=l&&e?g():u(g);l&&(e=!!e&&!!n)}return e},v=()=>{let e=_();for(;;){let t=r[c];if(!t||t.type!==`operator`||t.value!==`||`)break;c+=1;let n=l&&!e?_():u(_);l&&(e=!!e||!!n)}return e},y=v();if(c!==r.length)throw Error(`unexpected trailing tokens`);return ae(y)},se=Int32Array.BYTES_PER_ELEMENT*2,ce=new TextEncoder,le=new TextDecoder,ue=e=>e instanceof Int32Array?e:new Int32Array(e),de=e=>new Uint8Array(e.buffer,e.byteOffset+se,e.byteLength-se),fe=(e,t)=>{let n=ce.encode(e);if(n.length<=t)return{bytes:n,rest:``};let r=0,i=e.length;for(;r<i;){let n=Math.ceil((r+i)/2);ce.encode(e.slice(0,n)).length<=t?r=n:i=n-1}let a=e.slice(0,r);return{bytes:ce.encode(a),rest:e.slice(r)}},pe=(e,t)=>{if(!e.length)return!1;let n=ue(t),r=de(n),{bytes:i,rest:a}=fe(e[0]||``,r.length);return r.fill(0),r.set(i),Atomics.store(n,1,i.length),Atomics.add(n,0,1),Atomics.notify(n,0),a?e[0]=a:e.shift(),!0},me=e=>{let t=ue(e),n=Atomics.load(t,1);if(n===-1)return null;let r=de(t);return le.decode(r.slice(0,n))};var he=class{ready;mem=null;memfs;instance=null;exports;trace=()=>{};debugSession;useJsReadOverlay=!1;useJsSourceReadOverlay=!1;argv;environ;handles=new Map;nextHandle=1024;syntheticFileHandles=new Set;nextSyntheticInode=1;syntheticInodes=new Map;readFileHandles=new Map;writeFileHandles=new Map;constructor(e,t,n,...i){let a=i.at(-1),o=a&&typeof a==`object`?i.pop():{};this.argv=[n,...i],this.environ={USER:`wasm-clang`},this.memfs=t,this.useJsReadOverlay=n===`wasm-ld`||n===`ld.lld`||n===`lld`,this.useJsSourceReadOverlay=n===`clang`||n===`clang++`||n===`cobc`;let c=r(this,`__wasm_idle_debug_enter`,`__wasm_idle_debug_leave`,`__wasm_idle_debug_line`,`__wasm_idle_debug_value_num`,`__wasm_idle_debug_value_bool`,`__wasm_idle_debug_value_addr`,`__wasm_idle_debug_value_text`),l={...r(this,`proc_exit`,`environ_sizes_get`,`environ_get`,`args_sizes_get`,`args_get`,`random_get`,`clock_time_get`,`poll_oneoff`,`fd_filestat_set_times`,`path_filestat_set_times`,`sock_accept`,`sock_recv`,`sock_send`,`sock_shutdown`,`path_link`,`path_rename`),...this.memfs.exports,...r(this,`path_open`,`path_filestat_get`,`path_readlink`,`path_unlink_file`,`fd_fdstat_get`,`fd_fdstat_set_flags`,`fd_filestat_get`,`fd_filestat_set_size`,`fd_datasync`,`fd_read`,`fd_pread`,`fd_seek`,`fd_tell`,`fd_write`,`fd_close`)},u=o.extraImports?.env||{};this.ready=D(e,{...o.extraImports,wasi_unstable:l,wasi_snapshot_preview1:l,env:{...u,...c}}).then(e=>{this.instance=e,o.instanceRef&&(o.instanceRef.current=e),this.exports=this.instance.exports,this.mem=new s(this.exports.memory),this.memfs.hostMem=this.mem})}async run(){await this.ready,this.trace(`start(argv=${JSON.stringify(this.argv)}, exports=${JSON.stringify(Object.keys(this.exports||{}))})`);try{this.exports._start()}catch(e){let t=!0;if(e instanceof O){if(this.trace(`proc_exit(code=${e.code})`),e.code===789514)return this.trace(`allow_rAF_after_exit`),!0;if(this.trace(`disallow_rAF_after_exit(code=${e.code})`),e.code==0)return!1;t=!1}e instanceof k&&this.trace(`not_implemented(${e.message})`);let n=`\x1b[91mError: ${e.message}`;throw t&&(n+=`\n${e.stack}`),n+=`\x1B[0m
`,this.memfs.stdout(n),e}this.trace(`start() returned without proc_exit`)}proc_exit(e){throw this.trace(`proc_exit_throw(code=${e})`),new O(e)}toNumber(e){return typeof e==`bigint`?Number(e):e}writeU32(e,t){this.mem.view.setUint32(e,t>>>0,!0)}writeU64(e,t){let n=BigInt(t);this.mem.view.setUint32(e,Number(n&4294967295n),!0),this.mem.view.setUint32(e+4,Number(n>>32n&4294967295n),!0)}readMemfsFile(e){let t=[e,e.replace(/^\/+/,``),e.replace(/^\.\//,``),e.replace(/^\/+/,``).replace(/^\.\//,``)];for(let e of t)if(this.memfs.hasFile(e))try{return Uint8Array.from(this.memfs.getFileContents(e))}catch{}return null}shouldUseJsReadForPath(e){return this.useJsReadOverlay?!0:this.useJsSourceReadOverlay}syntheticInodeForPath(e){let t=e.replace(/^\/+/,``).replace(/^\.\//,``)||e,n=this.syntheticInodes.get(t);return n||(n=this.nextSyntheticInode++,this.syntheticInodes.set(t,n)),n}copyFileToIovs(e,t,n,r,i){this.mem.check();let a=0;for(let i=0;i<r;i+=1){let r=this.mem.read32(n);n+=4;let i=this.mem.read32(n);if(n+=4,i<=0)continue;let o=Math.max(0,e.length-t),s=Math.min(i,o);if(s>0&&(this.mem.write(r,e.subarray(t,t+s)),t+=s,a+=s),s<i)break}return this.writeU32(i,a),{copied:a,position:t}}writeRegularFileStat(e,t,n){this.mem.check(),this.writeU64(e,1),this.writeU64(e+8,this.syntheticInodeForPath(n)),this.mem.write8(e+16,4),this.writeU64(e+24,1),this.writeU64(e+32,t),this.writeU64(e+40,0),this.writeU64(e+48,0),this.writeU64(e+56,0)}seekPosition(e,t,n,r){let i=this.toNumber(n);return r===0?Math.max(0,i):r===1?Math.max(0,e+i):r===2?Math.max(0,t+i):null}ensureWriteCapacity(e,t){if(e.contents.length>=t)return;let n=Math.max(1024,e.contents.length);for(;n<t;)n*=2;let r=new Uint8Array(n);r.set(e.contents.subarray(0,e.size)),e.contents=r}atomicOutputTarget(e){let t=e.match(/^(.+)-[0-9a-f]+(\.[^.]+)\.tmp$/);return t?`${t[1]}${t[2]}`:null}storeFileContents(e,t){if(this.useJsReadOverlay||this.useJsSourceReadOverlay){this.memfs.setFile(e,t);return}this.memfs.addFile(e,t)}path_open(e,t,n,r,i,a,o,s,c){this.mem.check();let l=this.mem.readStr(n,r),u=this.toNumber(a),d=(u&64)!=0||(i&9)!=0;this.trace(`path_open_request(path=${JSON.stringify(l)}, rights=${u}, oflags=${i}, write=${d})`);let f=!d&&this.shouldUseJsReadForPath(l)&&u&2?this.readMemfsFile(l):null;if(!d&&this.shouldUseJsReadForPath(l)&&u&2&&!f)return this.trace(`path_open_read_missing(path=${JSON.stringify(l)})`),44;let p=0,m;if(this.useJsReadOverlay&&(d||f))m=this.nextHandle++,this.syntheticFileHandles.add(m),this.writeU32(c,m),this.trace(`path_open_overlay(fd=${m}, path=${JSON.stringify(l)})`);else{if(p=this.memfs.exports.path_open(e,t,n,r,i,a,o,s,c),p!==0)return p;m=this.mem.read32(c)}if(d){let e=i&8?null:this.readMemfsFile(l),t=e?Uint8Array.from(e):new Uint8Array;return this.writeFileHandles.set(m,{path:l,contents:t,position:0,size:t.length}),this.readFileHandles.delete(m),this.trace(`path_open_write(fd=${m}, path=${JSON.stringify(l)}, size=${t.length})`),p}if(!this.shouldUseJsReadForPath(l)||!(u&2))return p;let h=f||this.readMemfsFile(l);return h?(this.readFileHandles.set(m,{path:l,contents:h,position:0}),this.trace(`path_open_read(fd=${m}, path=${JSON.stringify(l)}, size=${h.length})`),p):p}path_filestat_get(e,t,n,r,i){this.mem.check();let a=this.mem.readStr(n,r);if(!this.shouldUseJsReadForPath(a))return this.memfs.exports.path_filestat_get(e,t,n,r,i);let o=this.readMemfsFile(a);return o?(this.writeRegularFileStat(i,o.length,a),this.trace(`path_filestat_get(path=${JSON.stringify(a)}, size=${o.length})`),0):this.memfs.exports.path_filestat_get(e,t,n,r,i)}fd_fdstat_get(e,t){let n=this.readFileHandles.get(e)||this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_fdstat_get(e,t);let r=this.writeFileHandles.has(e)?6291572:2097190;return this.mem.check(),this.mem.write8(t,4),this.mem.write8(t+1,0),this.mem.write8(t+2,0),this.mem.write8(t+3,0),this.writeU64(t+8,r),this.writeU64(t+16,0),this.trace(`fd_fdstat_get(fd=${e}, path=${JSON.stringify(n.path)})`),0}fd_filestat_get(e,t){let n=this.writeFileHandles.get(e),r=this.readFileHandles.get(e),i=n||r;if(!i)return this.memfs.exports.fd_filestat_get(e,t);let a=n?n.size:r?.contents.length||0;return this.writeRegularFileStat(t,a,i.path),this.trace(`fd_filestat_get(fd=${e}, path=${JSON.stringify(i.path)}, size=${a})`),0}fd_filestat_set_size(e,t){let n=this.writeFileHandles.get(e);if(!n)return this.memfs.exports.fd_filestat_set_size(e,t);let r=this.toNumber(t);return this.ensureWriteCapacity(n,r),r>n.size&&n.contents.fill(0,n.size,r),n.size=r,n.position>r&&(n.position=r),this.trace(`fd_filestat_set_size(fd=${e}, size=${r})`),0}fd_read(e,t,n,r){let i=this.readFileHandles.get(e);if(!i)return this.memfs.exports.fd_read(e,t,n,r);let a=this.copyFileToIovs(i.contents,i.position,t,n,r);return i.position=a.position,this.trace(`fd_read(fd=${e}, bytes=${a.copied})`),0}fd_pread(e,t,n,r,i){let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_pread(e,t,n,r,i);let o=this.copyFileToIovs(a.contents,this.toNumber(r),t,n,i);return this.trace(`fd_pread(fd=${e}, offset=${this.toNumber(r)}, bytes=${o.copied})`),0}fd_seek(e,t,n,r){let i=this.writeFileHandles.get(e);if(i){let a=this.seekPosition(i.position,i.size,t,n);return a==null?this.memfs.exports.fd_seek(e,t,n,r):(i.position=a,this.mem.check(),this.writeU64(r,i.position),this.trace(`fd_seek_write(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}let a=this.readFileHandles.get(e);if(!a)return this.memfs.exports.fd_seek(e,t,n,r);let o=this.seekPosition(a.position,a.contents.length,t,n);return o==null?this.memfs.exports.fd_seek(e,t,n,r):(a.position=o,this.mem.check(),this.writeU64(r,a.position),this.trace(`fd_seek(fd=${e}, offset=${this.toNumber(t)}, whence=${n})`),0)}fd_tell(e,t){let n=this.writeFileHandles.get(e)?.position??this.readFileHandles.get(e)?.position;if(n==null){let n=this.memfs.exports.fd_tell;return typeof n==`function`?n(e,t):44}return this.mem.check(),this.writeU64(t,n),this.trace(`fd_tell(fd=${e}, offset=${n})`),0}fd_datasync(e){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let t=this.memfs.exports.fd_datasync;return typeof t==`function`?t(e):0}fd_fdstat_set_flags(e,t){if(this.writeFileHandles.has(e)||this.readFileHandles.has(e))return 0;let n=this.memfs.exports.fd_fdstat_set_flags;return typeof n==`function`?n(e,t):0}path_readlink(e,t,n,r,i,a){return this.mem.check(),this.writeU32(a,0),this.trace(`path_readlink(path=${JSON.stringify(this.mem.readStr(t,n))})`),44}path_unlink_file(e,t,n){this.mem.check();let r=this.mem.readStr(t,n);return this.trace(`path_unlink_file(path=${JSON.stringify(r)})`),0}fd_write(e,t,n,r){let i=this.writeFileHandles.get(e);if(!i)return this.memfs.exports.fd_write(e,t,n,r);this.mem.check();let a=0;for(let e=0;e<n;e+=1){let e=this.mem.read32(t);t+=4;let n=this.mem.read32(t);t+=4,!(n<=0)&&(this.ensureWriteCapacity(i,i.position+n),i.contents.set(new Uint8Array(this.mem.buffer,e,n),i.position),i.position+=n,i.size=Math.max(i.size,i.position),a+=n)}return this.writeU32(r,a),this.trace(`fd_write(fd=${e}, bytes=${a})`),0}fd_close(e){let t=this.syntheticFileHandles.delete(e);if(this.readFileHandles.has(e)){this.readFileHandles.delete(e);let n=t?0:this.memfs.exports.fd_close(e);return this.trace(`fd_close_read(fd=${e}, close=${n})`),n}let n=this.writeFileHandles.get(e);if(n){this.writeFileHandles.delete(e);let r=t?0:this.memfs.exports.fd_close(e),i=n.contents.subarray(0,n.size);this.storeFileContents(n.path,i);let a=this.atomicOutputTarget(n.path);return a&&this.storeFileContents(a,i),this.trace(`fd_close_write(fd=${e}, path=${JSON.stringify(n.path)}, size=${n.size}, close=${r}, target=${JSON.stringify(a)})`),0}return t?0:this.memfs.exports.fd_close(e)}debugEvaluate(e){let t=this.debugSession;if(!t)throw Error(`unavailable`);let n=[...t.frames].reverse().find(e=>e.functionId===t.currentFunctionId),r=t.currentLine,i=[...t.variableMetadata[t.currentFunctionId]||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine),a=[...t.globalVariableMetadata||[]].reverse().filter(e=>r>=e.fromLine&&r<=e.toLine);return oe(e,e=>{let r=(e,t)=>{let n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[],r=Number(t);if(!Number.isFinite(r)||r<=0||!n.length||!e.elementKind&&!e.structFields?.length)throw Error(`unavailable`);this.mem?.check?.();let i=e.structFields?.length&&e.structSize?e.structSize:e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4,a=(e,t)=>{if(e===`bool`)return!!this.mem.read8(t);if(e===`char`){let e=this.mem.read8(t);return e>=32&&e<=126?String.fromCharCode(e):e}return e===`float`?this.mem.readFloat32(t):e===`double`?this.mem.readFloat64(t):this.mem.readInt32(t)},o=t=>({__debugExpressionKind:`object`,has:t=>!!e.structFields?.some(e=>e.name===t),get:n=>{let r=e.structFields?.find(e=>e.name===n);if(!r)throw Error(`unavailable`);return a(r.kind,t+r.offset)},keys:()=>e.structFields?.map(e=>e.name)||[]}),s=(t,n)=>({__debugExpressionKind:`array`,length:n[0],truncated:n[0]>8,get:r=>{if(!Number.isInteger(r)||r<0||r>=n[0])throw Error(`unavailable`);if(n.length>1)return s(t+r*(n.slice(1).reduce((e,t)=>e*t,1)*i),n.slice(1));if(e.structFields?.length&&e.structSize)return o(t+r*e.structSize);if(!e.elementKind)throw Error(`unavailable`);return a(e.elementKind,t+r*i)},keys:()=>Array.from({length:Math.min(n[0],8)},(e,t)=>t)});return s(r,n)},o=(e,t)=>{if(t==null||t===`?`)throw Error(`unavailable`);return e.kind===`array`?r(e,t):re(t)},s=i.find(t=>t.name===e);if(s)return o(s,n?.values.get(s.slot));let c=a.find(t=>t.name===e);if(c)return o(c,t.globalValues.get(c.slot));throw Error(`unavailable`)})}pauseDebugSession(e,t,n,r){let i=e.buffer;if(!i)return 0;e.currentFunctionId=t,e.currentLine=n;let a=[...e.frames].reverse().find(e=>e.functionId===t);a&&(a.line=n),e.pauseOnEntry=!1,e.stepArmed=!1,e.nextLineArmed=!1,e.nextLineDepth=0,e.stepOutArmed=!1,this.trace(`pause(function=${t}, line=${n}, reason=${r})`);let o=e.variableMetadata[t]?.flatMap(e=>{if(n<e.fromLine||n>e.toLine)return[];if(e.kind===`array`){this.mem?.check?.();let t=Number(a?.values.get(e.slot)??NaN),n=e.dimensions?.length?e.dimensions:e.length?[e.length]:[];if(!Number.isFinite(t)||t<=0||!n.length||!e.elementKind&&!e.structFields?.length)return[{name:e.name,value:`?`}];if(e.structFields?.length&&e.structSize){let r=Math.min(n[0],8),i=[];for(let n=0;n<r;n+=1){let r=[];for(let i of e.structFields){let a=t+n*e.structSize+i.offset;if(i.kind===`bool`){r.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let e=this.mem.read8(a);r.push(`${i.name}: ${e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`}`);continue}if(i.kind===`float`){r.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){r.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}r.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${r.join(`, `)}}`)}return[{name:e.name,value:`[${i.join(`, `)}${n[0]>r?`, ...`:``}]`}]}if(!e.elementKind)return[{name:e.name,value:`?`}];let r=e.elementKind===`double`?8:e.elementKind===`bool`||e.elementKind===`char`?1:4;if(n.length===2){let i=Math.min(n[0],4),a=Math.min(n[1],8),o=[];for(let s=0;s<i;s+=1){let i=[];for(let o=0;o<a;o+=1){let a=t+(s*n[1]+o)*r;if(e.elementKind===`bool`){i.push(this.mem.read8(a)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(a);i.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){i.push(`${this.mem.readFloat32(a)}`);continue}if(e.elementKind===`double`){i.push(`${this.mem.readFloat64(a)}`);continue}i.push(`${this.mem.readInt32(a)}`)}o.push(`[${i.join(`, `)}${n[1]>a?`, ...`:``}]`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let i=Math.min(n[0],8),o=[];for(let n=0;n<i;n+=1){let i=t+n*r;if(e.elementKind===`bool`){o.push(this.mem.read8(i)?`true`:`false`);continue}if(e.elementKind===`char`){let e=this.mem.read8(i);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(e.elementKind===`float`){o.push(`${this.mem.readFloat32(i)}`);continue}if(e.elementKind===`double`){o.push(`${this.mem.readFloat64(i)}`);continue}o.push(`${this.mem.readInt32(i)}`)}return[{name:e.name,value:`[${o.join(`, `)}${n[0]>i?`, ...`:``}]`}]}let t=a?.values.get(e.slot)??`?`;return[{name:e.name,value:t}]})||[],s=new Set(o.map(e=>e.name)),c=(e.globalVariableMetadata||[]).flatMap(t=>{if(s.has(t.name)||n<t.fromLine||n>t.toLine)return[];if(t.kind===`array`){this.mem?.check?.();let n=Number(e.globalValues?.get(t.slot)??NaN),r=t.dimensions?.length?t.dimensions:t.length?[t.length]:[];if(!Number.isFinite(n)||n<=0||!r.length||!t.elementKind&&!t.structFields?.length)return[{name:t.name,value:`?`}];if(t.structFields?.length&&t.structSize){let e=Math.min(r[0],8),i=[];for(let r=0;r<e;r+=1){let e=[];for(let i of t.structFields){let a=n+r*t.structSize+i.offset;if(i.kind===`bool`){e.push(`${i.name}: ${this.mem.read8(a)?`true`:`false`}`);continue}if(i.kind===`char`){let t=this.mem.read8(a);e.push(`${i.name}: ${t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`}`);continue}if(i.kind===`float`){e.push(`${i.name}: ${this.mem.readFloat32(a)}`);continue}if(i.kind===`double`){e.push(`${i.name}: ${this.mem.readFloat64(a)}`);continue}e.push(`${i.name}: ${this.mem.readInt32(a)}`)}i.push(`{${e.join(`, `)}}`)}return[{name:t.name,value:`[${i.join(`, `)}${r[0]>e?`, ...`:``}]`}]}if(!t.elementKind)return[{name:t.name,value:`?`}];let i=t.elementKind===`double`?8:t.elementKind===`bool`||t.elementKind===`char`?1:4;if(r.length===2){let e=Math.min(r[0],4),a=Math.min(r[1],8),o=[];for(let s=0;s<e;s+=1){let e=[];for(let o=0;o<a;o+=1){let a=n+(s*r[1]+o)*i;if(t.elementKind===`bool`){e.push(this.mem.read8(a)?`true`:`false`);continue}if(t.elementKind===`char`){let t=this.mem.read8(a);e.push(t>=32&&t<=126?`'${String.fromCharCode(t)}'`:`${t}`);continue}if(t.elementKind===`float`){e.push(`${this.mem.readFloat32(a)}`);continue}if(t.elementKind===`double`){e.push(`${this.mem.readFloat64(a)}`);continue}e.push(`${this.mem.readInt32(a)}`)}o.push(`[${e.join(`, `)}${r[1]>a?`, ...`:``}]`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>e?`, ...`:``}]`}]}let a=Math.min(r[0],8),o=[];for(let e=0;e<a;e+=1){let r=n+e*i;if(t.elementKind===`bool`){o.push(this.mem.read8(r)?`true`:`false`);continue}if(t.elementKind===`char`){let e=this.mem.read8(r);o.push(e>=32&&e<=126?`'${String.fromCharCode(e)}'`:`${e}`);continue}if(t.elementKind===`float`){o.push(`${this.mem.readFloat32(r)}`);continue}if(t.elementKind===`double`){o.push(`${this.mem.readFloat64(r)}`);continue}o.push(`${this.mem.readInt32(r)}`)}return[{name:t.name,value:`[${o.join(`, `)}${r[0]>a?`, ...`:``}]`}]}let r=e.globalValues?.get(t.slot)??`?`;return[{name:t.name,value:r}]})||[],l=new Map(o.map(e=>[e.name,e])),u=new Map(c.map(e=>[e.name,e]));for(let e of l.keys())u.delete(e);e.onPause?.({type:`pause`,line:n,reason:r,locals:[...l.values(),...u.values()],callStack:[...e.frames].reverse().map(e=>({functionName:e.functionName,line:e.line}))});let d=Atomics.load(i,0);for(;;){if(e.interruptBuffer?.[0]===2||(Atomics.wait(i,0,d,100),e.interruptBuffer?.[0]===2))throw new A;let t=Atomics.exchange(i,1,0);if(t===1)return e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===2)return e.stepArmed=!0,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===3)return e.nextLineArmed=!0,e.nextLineFunctionId=e.currentFunctionId,e.nextLineLine=e.currentLine,e.nextLineDepth=e.callDepth,e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===4)return e.stepOutArmed=!0,e.stepOutDepth=Math.max(0,e.callDepth-1),e.resumeSkipActive=!0,e.resumeSkipFunctionId=e.currentFunctionId,e.resumeSkipLine=e.currentLine,0;if(t===5){let t=e.watchBuffer?me(e.watchBuffer):``,n=`?`;try{n=t?this.debugEvaluate(t):`?`}catch(e){n=e instanceof Error&&e.message===`unavailable`?`?`:`error`}e.watchResultBuffer&&pe([n],e.watchResultBuffer)}}}__wasm_idle_debug_enter(e,t){let n=this.debugSession;return n?.buffer?(n.callDepth+=1,n.currentFunctionId=e,n.currentLine=t,n.frames.push({functionId:e,functionName:n.functionMetadata[e]||`fn_${e}`,line:t,values:new Map}),this.trace(`enter(function=${e}, line=${t}, depth=${n.callDepth})`),n.pauseOnEntry?this.pauseDebugSession(n,e,t,`entry`):n.stepArmed?this.pauseDebugSession(n,e,t,`step`):0):0}__wasm_idle_debug_leave(e){let t=this.debugSession;if(!t?.buffer)return 0;this.trace(`leave(function=${e}, depth=${t.callDepth})`),t.nextLineArmed&&e===t.nextLineFunctionId&&t.callDepth<=(t.nextLineDepth??t.callDepth)&&(t.nextLineArmed=!1,t.nextLineDepth=0,t.stepArmed=!0),t.callDepth=Math.max(0,t.callDepth-1),t.currentFunctionId===e&&(t.currentFunctionId=0);for(let n=t.frames.length-1;n>=0;--n)if(t.frames[n]?.functionId===e){t.frames.splice(n,1);break}return 0}__wasm_idle_debug_value_num(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,Number.isInteger(n)?String(n):`${n}`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,Number.isInteger(n)?String(n):`${n}`);break}}return 0}__wasm_idle_debug_value_bool(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,n?`true`:`false`),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,n?`true`:`false`);break}}return 0}__wasm_idle_debug_value_addr(e,t,n){let r=this.debugSession;if(!r?.buffer)return 0;if(e===0)return r.globalValues.set(t,String(n>>>0)),0;for(let i=r.frames.length-1;i>=0;--i){let a=r.frames[i];if(a?.functionId===e){a.values.set(t,String(n>>>0));break}}return 0}__wasm_idle_debug_value_text(e,t,n,r){let i=this.debugSession;if(!i?.buffer)return 0;this.mem?.check?.();let a=this.mem?.readStr?this.mem.readStr(n,r):`?`;if(e===0)return i.globalValues.set(t,a),0;for(let n=i.frames.length-1;n>=0;--n){let r=i.frames[n];if(r?.functionId===e){r.values.set(t,a);break}}return 0}__wasm_idle_debug_line(e,t){let n=this.debugSession;if(!n?.buffer)return 0;let r=Atomics.load(n.buffer,2);if(r!==n.breakpointVersion){let e=Math.max(0,Atomics.load(n.buffer,3)),t=new Set;for(let r=0;r<e&&r+4<n.buffer.length;r+=1){let e=Atomics.load(n.buffer,r+4);e>0&&t.add(e)}n.breakpoints=t,n.breakpointVersion=r}if(n.resumeSkipActive){if(e===n.resumeSkipFunctionId&&t===n.resumeSkipLine)return 0;n.resumeSkipActive=!1,n.resumeSkipFunctionId=0,n.resumeSkipLine=0}let i=``;return n.pauseOnEntry?i=`entry`:n.breakpoints.has(t)?i=`breakpoint`:n.stepArmed?i=`step`:n.nextLineArmed&&n.callDepth<=(n.nextLineDepth??n.callDepth)&&e===n.nextLineFunctionId&&t!==n.nextLineLine?i=`nextLine`:n.stepOutArmed&&n.callDepth<=n.stepOutDepth&&(i=`stepOut`),i?this.pauseDebugSession(n,e,t,i):0}environ_sizes_get(e,t){this.mem.check();let n=0,r=Object.getOwnPropertyNames(this.environ);for(let e of r){let t=this.environ[e];n+=e.length+t.length+2}return this.mem.write32(e,r.length),this.mem.write32(t,n),this.trace(`environ_sizes_get(count=${r.length}, bytes=${n})`),0}environ_get(e,t){this.mem.check();let n=Object.getOwnPropertyNames(this.environ);this.trace(`environ_get(entries=${JSON.stringify(n)})`);for(let r of n)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,`${r}=${this.environ[r]}`);return 0}args_sizes_get(e,t){this.mem.check();let n=0;for(let e of this.argv)n+=e.length+1;return this.mem.write32(e,this.argv.length),this.mem.write32(t,n),this.trace(`args_sizes_get(count=${this.argv.length}, bytes=${n})`),0}args_get(e,t){this.mem.check(),this.trace(`args_get(argv=${JSON.stringify(this.argv)})`);for(let n of this.argv)this.mem.write32(e,t),e+=4,t+=this.mem.writeStr(t,n);return 0}random_get(e,t){let n=new Uint8Array(this.mem.buffer,e,t);for(let e=0;e<t;++e)n[e]=Math.random()*256|0}clock_time_get(e,t,n){this.mem.check();let r=e===1&&typeof performance<`u`?performance.now():Date.now(),i=BigInt(Math.floor(r*1e6));return this.mem.view.setBigUint64(n,i,!0),this.trace(`clock_time_get(clock=${e}, ns=${i})`),0}poll_oneoff(){throw new k(`wasi_unstable`,`poll_oneoff`)}fd_filestat_set_times(){return this.trace(`fd_filestat_set_times()`),0}path_filestat_set_times(){return this.trace(`path_filestat_set_times()`),0}sock_accept(){return this.trace(`sock_accept() unsupported`),58}sock_recv(){return this.trace(`sock_recv() unsupported`),58}sock_send(){return this.trace(`sock_send() unsupported`),58}sock_shutdown(){return this.trace(`sock_shutdown() unsupported`),58}path_link(e,t,n,r,i,a,o){this.mem.check();let s=this.mem.readStr(n,r).replace(/^\/+/,``),c=this.mem.readStr(a,o).replace(/^\/+/,``);return this.trace(`path_link(source=${JSON.stringify(s)}, target=${JSON.stringify(c)})`),this.storeFileContents(c,new Uint8Array(this.memfs.getFileContents(s))),0}path_rename(e,t,n,r,i,a){this.mem.check();let o=this.mem.readStr(t,n).replace(/^\/+/,``),s=this.mem.readStr(i,a).replace(/^\/+/,``);return this.trace(`path_rename(source=${JSON.stringify(o)}, target=${JSON.stringify(s)})`),this.storeFileContents(s,new Uint8Array(this.memfs.getFileContents(o))),0}};const ge=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_TREE_POLICY_HPP
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
`,_e=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_ASSOC_CONTAINER_HPP
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
`,ve=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_HASH_POLICY_HPP
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
`,ye=String.raw`#ifndef WASM_CLANG_EXT_PB_DS_PRIORITY_QUEUE_HPP
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
`,be=String.raw`#ifndef WASM_CLANG_EXT_ROPE
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
`,xe=String.raw`#ifndef WASM_CLANG_SETJMP_H
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
`,Se=String.raw`#ifndef WASM_CLANG_BITS_STDCPP_H
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
`,Ce=String.raw`#ifndef WASM_CLANG_BITS_EXTCXX_H
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
`,we=[{path:`include/setjmp.h`,contents:xe},{path:`include/bits/stdc++.h`,contents:Se},{path:`include/bits/extc++.h`,contents:Ce},{path:`include/c++/v1/ext/rope`,contents:be},{path:`include/c++/v1/ext/pb_ds/tree_policy.hpp`,contents:ge},{path:`include/c++/v1/ext/pb_ds/assoc_container.hpp`,contents:_e},{path:`include/c++/v1/ext/pb_ds/hash_policy.hpp`,contents:ve},{path:`include/c++/v1/ext/pb_ds/priority_queue.hpp`,contents:ye}];function Te(e){e.addDirectory(`include/c++/v1/ext/pb_ds`),e.addDirectory(`include/bits`);for(let t of we)e.addFile(t.path,t.contents)}const Ee=e=>JSON.stringify(e.length>96?e.slice(0,93)+`...`:e);var De=class{ready;mem=null;hostMem_=null;stdinStr;stdin;stdout;trace;instance=null;exports;out=!0;filePaths=new Set;fileOverlays=new Map;constructor(e){this.stdin=e.stdin,this.stdout=e.stdout,this.stdinStr=e.stdinStr||``,this.trace=e.trace||(()=>{});let t=r(this,`abort`,`host_write`,`host_read`,`memfs_log`,`copy_in`,`copy_out`);this.ready=(e.signal?E(e.moduleUrl,e.progress,e.signal):E(e.moduleUrl,e.progress)).then(e=>WebAssembly.instantiate(e,{env:t})).then(e=>{this.instance=e,this.exports=e.exports,this.mem=new s(this.exports.memory),this.exports.init()})}set hostMem(e){this.hostMem_=e}setStdinStr(e){this.stdinStr=e}addDirectory(e){this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e),this.exports.AddDirectoryNode(e.length)}addFile(e,t){let n=t instanceof ArrayBuffer?t.byteLength:t.length;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let r=this.exports.AddFileNode(e.length,n),i=this.exports.GetFileNodeAddress(r);this.mem.check(),this.mem.write(i,t),this.filePaths.add(this.normalizePath(e))}setFile(e,t){let n=this.normalizePath(e);this.filePaths.add(n),this.fileOverlays.set(n,Uint8Array.from(t))}hasFile(e){return this.filePaths.has(this.normalizePath(e))}normalizePath(e){return e.replaceAll(`\\`,`/`).replace(/^\.\//,``).replace(/^\/+/,``)}getFileContents(e){let t=this.fileOverlays.get(this.normalizePath(e));if(t)return t;this.mem.check(),this.mem.write(this.exports.GetPathBuf(),e);let n=this.exports.FindNode(e.length),r=this.exports.GetFileNodeAddress(n),i=this.exports.GetFileNodeSize(n);return new Uint8Array(this.mem.buffer,r,i)}abort(){throw this.trace(`abort()`),new A}host_write(e,t,n,r){this.hostMem_.check(),M(e<=2);let i=0,a=``;for(let e=0;e<n;++e){let e=this.hostMem_.read32(t);t+=4;let n=this.hostMem_.read32(t);t+=4,a+=this.hostMem_.readStrR(e,n),i+=n}return this.hostMem_.write32(r,i),this.trace(`host_write(fd=${e}, bytes=${i}, data=${Ee(a)})`),this.out&&this.stdout(a),0}host_read(e,t,n,r){this.hostMem_.check(),M(e===0);let i=0;for(let r=0;r<n;++r){let n=this.hostMem_.read32(t);t+=4;let r=this.hostMem_.read32(t);t+=4,this.stdinStr.length||(this.stdinStr=this.stdin());let a=Math.min(r,this.stdinStr.length);if(a===0)break;let o=this.stdinStr.substring(0,a);if(this.hostMem_.write(n,this.stdinStr.substring(0,a)),this.stdinStr=this.stdinStr.substring(a),i+=a,this.trace(`host_read(fd=${e}, bytes=${a}, data=${Ee(o)})`),a!==r)break}return this.hostMem_.write32(r,i),i===0&&this.trace(`host_read(fd=${e}, bytes=0)`),0}memfs_log(e,t){this.mem.check();let n=this.mem.readStr(e,t);this.trace(`memfs_log(${Ee(n)})`)}copy_out(e,t,n){this.hostMem_.check();let r=new Uint8Array(this.hostMem_.buffer,e,n);this.mem.check();let i=new Uint8Array(this.mem.buffer,t,n);r.set(i)}copy_in(e,t,n){this.mem.check();let r=new Uint8Array(this.mem.buffer,e,n);this.hostMem_.check();let i=new Uint8Array(this.hostMem_.buffer,t,n);r.set(i)}};function*Oe(e){let t=e instanceof Uint8Array?e:new Uint8Array(e),n=0,r=``,a=e=>(n+=e,i(t,n-e,e)),s=e=>(n+=e,o(t,n-e,e)),c=()=>n=n+511&-512;for(;n+512<=t.length;){let e={filename:a(100),mode:s(8),owner:s(8),group:s(8),size:s(12),mtime:s(12),checksum:s(8),type:a(1),linkname:a(100),ustar:a(8)};if(!e.ustar)return;let o={...e,ownerName:a(32),groupName:a(32),devMajor:a(8),devMinor:a(8),filenamePrefix:a(155)};if(c(),(o.size>0||o.type===`0`||o.type===``||o.type===`L`)&&(o.contents=t.subarray(n,n+o.size),n+=o.size,c()),o.type===`L`){o.contents&&(r=i(o.contents,0,o.size));continue}o.filename=r||(o.filenamePrefix?`${o.filenamePrefix}/${o.filename}`:o.filename),r=``,yield o}}function ke(e,t){for(let n of Oe(e))switch(n.type){case``:case`0`:t.addFile(n.filename,n.contents);break;case`5`:t.addDirectory(n.filename);break;default:throw Error(`unsupported tar entry type: ${n.type}`)}}const Ae=`\x1B[92m`,je=`\x1B[0m`,Me=e=>Math.max(0,Math.min(1,Number.isFinite(e)?e:0));function Ne(e){let t={clang:0,lld:0,memfs:0},n=()=>{e((t.clang+t.lld+t.memfs)/3)},r=e=>({set(r){t[e]=Me(r),n()}});return{clang:r(`clang`),lld:r(`lld`),memfs:r(`memfs`)}}const Pe=(e,t)=>{let n=e?.toString().trim();if(!n)throw Error(`${t} is required`);let r;try{r=new URL(n,typeof location<`u`?location.href:void 0)}catch{throw Error(`${t} must be an absolute HTTP(S) URL`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`${t} must use HTTP(S)`);return r},Fe=e=>{let t=Pe(e,`wasm-clang runtime base URL`);return t.pathname.endsWith(`/`)||(t.pathname+=`/`),t.hash=``,t},L=(e,t)=>new URL(t,Fe(e)).toString(),Ie=(e,t)=>L(e,t),Le=e=>Fe(e).toString(),Re=e=>Ie(e,`runtime-manifest.v1.json`);function ze(e,t){let n=Le(e);return{manifest:Re(n).toString(),memfs:L(n,t?.compiler.memfs.asset||`bin/memfs.wasm.gz`).toString(),clang:L(n,t?.compiler.clang.asset||`bin/clang.wasm.gz`).toString(),lld:L(n,t?.compiler.lld.asset||`bin/lld.wasm.gz`).toString(),sysroot:L(n,t?.compiler.sysroot.asset||`bin/sysroot.tar.gz`).toString(),clangdJs:L(n,t?.clangd.js||`clangd/clangd.js`).toString(),clangdWasm:L(n,t?.clangd.wasm||`clangd/clangd.wasm.gz`).toString()}}const R=e=>e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`),z=e=>{let t=R(e);return t.startsWith(`workspace/`)?t.slice(10):t};function B(e,t){let n=R(t||``),r=`main`,i=n&&/\.[A-Za-z0-9_-]+$/.test(n)?n:`${n||r}.${e===`C`?`c`:e===`OBJC`?`m`:`cc`}`,a=(i.split(`/`).pop()||i).replace(/\.[^.]+$/,``)||r;return{input:i,obj:`${a}.o`,wasm:`${a}.wasm`}}async function Be(e){let t=typeof e==`string`?new TextEncoder().encode(e):(e instanceof Uint8Array,new Uint8Array(e)),n=await globalThis.crypto.subtle.digest(`SHA-256`,t);return Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``)}async function Ve(e,t,n){if(!n)throw Error(`LLDB debug compilation requires compiler provenance in the wasm-clang runtime manifest`);let{input:r}=B(e.language||`CPP`,z(e.activePath||``)||z(e.fileName||``)||void 0),i=new Map;for(let t of e.workspaceFiles||[]){let e=z(t.path);e&&i.set(e,t.content)}i.set(r,e.code);let a=[...i.entries()].sort(([e],[t])=>e<t?-1:+(e>t));return{kind:`dwarf`,sourceRoot:`/workspace`,moduleSha256:await Be(t),files:await Promise.all(a.map(async([e,t])=>({path:`/workspace/${e}`,contentSha256:await Be(t)}))),compiler:n}}globalThis.document===void 0&&(globalThis.document={querySelectorAll:(()=>[])});const He=`-std=gnu++2a`;function Ue(e){return(e||``).trim().toUpperCase().replaceAll(/\s+/g,``)}function We(e){switch(Ue(e)){case`03`:case`CPP03`:case`C++03`:case`GNU++03`:case`GNUC++03`:return`-std=gnu++03`;case`11`:case`CPP11`:case`C++11`:case`GNU++11`:case`GNUC++11`:return`-std=gnu++11`;case`14`:case`CPP14`:case`C++14`:case`GNU++14`:case`GNUC++14`:return`-std=gnu++14`;case`17`:case`CPP17`:case`C++17`:case`GNU++17`:case`GNUC++17`:return`-std=gnu++17`;case`20`:case`23`:case`26`:case`CPP20`:case`CPP23`:case`CPP26`:case`C++20`:case`C++23`:case`C++26`:case`GNU++20`:case`GNU++23`:case`GNU++26`:case`GNUC++20`:case`GNUC++23`:case`GNUC++26`:return He;default:return He}}function Ge(e){switch(Ue(e)){case`99`:case`C99`:case`GNU99`:case`GNUC99`:return`-std=gnu99`;case`11`:case`C11`:case`GNU11`:case`GNUC11`:return`-std=gnu11`;case`17`:case`18`:case`C17`:case`C18`:case`GNU17`:case`GNU18`:case`GNUC17`:case`GNUC18`:return`-std=gnu17`;default:return`-std=gnu11`}}function Ke(e,t){return e===`C`?{languageArg:`c`,standardArg:Ge(t.cVersion)}:e===`OBJC`?{languageArg:`objective-c`,standardArg:Ge(t.cVersion)}:{languageArg:`c++`,standardArg:We(t.cppVersion)}}const qe=e=>{let t=encodeURIComponent(e),n=``;for(let e=0;e<t.length;){let r=t[e];if(e+=1,r==`%`){let r=t.substring(e,e+=2);r&&(n+=String.fromCharCode(parseInt(r,16)))}else n+=r}return n};function Je(e,t){let n=[...e],r=t,i,a=!1;for(let t=0;t<e.length;t+=1){let o=e[t],s=e[t+1];if(r){n[t]=` `,o===`*`&&s===`/`&&(n[t+1]=` `,t+=1,r=!1);continue}if(i){n[t]=` `,a?a=!1:o===`\\`?a=!0:o===i&&(i=void 0);continue}if(o===`/`&&s===`*`){n[t]=` `,n[t+1]=` `,t+=1,r=!0;continue}if(o===`/`&&s===`/`){for(let r=t;r<e.length;r+=1)n[r]=` `;break}(o===`"`||o===`'`)&&(n[t]=` `,i=o)}return{line:n.join(``),inBlockComment:r}}var Ye=class{ready;memfs;stdout;moduleCache;showTiming;log;debug=!1;debugBreakpoints=new Set;debugPauseOnEntry=!1;debugBuffer;debugInterruptBuffer;debugWatchBuffer;debugWatchResultBuffer;onDebugEvent;debugVariableMetadata={};debugGlobalMetadata=[];debugFunctionMetadata={};lastBuildKey=``;path;assetUrls;compilerConfig;wasm;lastArtifactPath=`main.wasm`;traceStartedAt=0;progress;constructor(e){this.moduleCache={},this.stdout=e.stdout||(()=>{}),this.showTiming=e.showTiming||!1,this.log=e.log||!1,this.path=e.runtimeBaseUrl.toString(),this.assetUrls=ze(this.path,e.manifest),this.compilerConfig=e.manifest?.compiler,this.onDebugEvent=e.onDebugEvent,this.progress=Ne(t=>e.progress?.(t)),this.memfs=new De({stdout:this.stdout,stdin:e.stdin||(()=>``),moduleUrl:this.assetUrls.memfs,progress:this.progress.memfs,signal:e.signal,trace:e=>this.trace(e)});let t=this.getModule(this.assetUrls.clang,this.progress.clang,e.signal),n=this.getModule(this.assetUrls.lld,this.progress.lld,e.signal),r=this.memfs.ready.then(async()=>{let t=e.signal?T(this.assetUrls.sysroot,void 0,void 0,e.signal):T(this.assetUrls.sysroot);await this.hostLogAsync(`Untarring ${this.assetUrls.sysroot}`,t.then(e=>ke(e,this.memfs))),Te(this.memfs)});this.ready=Promise.all([t,n,r]).then(()=>void 0)}hostLog(e){if(!this.log)return;let t=`[1;93m>${je} `;this.stdout(`${t}${e}`)}beginTrace(e){this.debug=e,this.traceStartedAt=Date.now()}trace(e){if(!this.debug||!this.log)return;let t=Date.now()-this.traceStartedAt;this.stdout(`\x1b[2m[debug +${t}ms] ${e}\x1b[0m\n`)}async hostLogAsync(e,t){let n=+new Date;this.hostLog(`${e}...`);let r=await t,i=+new Date;return this.log&&this.stdout(` done.`),this.showTiming&&this.stdout(` ${Ae}(${i-n}ms)${je}\n`),this.log&&this.stdout(`
`),r}async getModule(e,t,n){if(this.moduleCache[e])return this.moduleCache[e];let r=await this.hostLogAsync(`Fetching and compiling ${e}`,n?E(e,t,n):E(e,t));return this.moduleCache[e]=r,r}addWorkspaceDirectories(e,t=new Set){let n=R(e).split(`/`).slice(0,-1),r=``;for(let e of n)r=r?`${r}/${e}`:e,t.has(r)||(this.memfs.addDirectory(r),t.add(r))}addWorkspaceFiles(e=[],t=``){let n=new Set,r=R(t);for(let t of e){let e=R(t.path);!e||e===r||(this.addWorkspaceDirectories(e,n),this.memfs.addFile(e,qe(t.content)))}}async compile(e){let t=R(e.input||`main.cc`)||`main.cc`,r=e.code,i=e.obj,a=e.language===`C`?`C`:e.language===`OBJC`?`OBJC`:`CPP`,o=e.compileArgs??e.args??[],{languageArg:s,standardArg:c}=Ke(a,e),l=n(e),u=l===`trace`,d=l===`lldb`,f=l===`none`?e.opt||`2`:`0`;if(u){let e=r.split(`
`),t=!1,n=e.map(e=>{let n=Je(e,t);return t=n.inBlockComment,n.line}),i=e=>{if(/^(?:do|else)$/.test(e))return!0;if(!/^(?:else\s+)?(?:if|for|while)\s*\(/.test(e))return!1;let t=e.indexOf(`(`),n=0;for(let r=t;r<e.length;r+=1)if(e[r]===`(`&&(n+=1),e[r]===`)`&&(--n,n===0))return e.slice(r+1).trim()===``;return!1},o=new Set,s=!1,c=!1;for(let e=0;e<n.length;e+=1){let t=n[e].trim();if(!t)continue;let r=c,a=r;r&&t.includes(`;`)&&(c=!1),s&&(s=!1,t!==`{`&&(a=!0,!t.includes(`;`)&&!t.includes(`{`)&&!i(t)&&(c=!0))),/^while\s*\(.*\)\s*;$/.test(t)&&(a=!0),a&&o.add(e),i(t)&&(s=!0)}let l=0,u=0,d=0,f=1,p=1,m=new Map,h=new Map,g=new Map,_,v=new Map,y=``,b=[],x=!1;for(let t of e){let e=t;if(x){let t=e.indexOf(`*/`);if(t===-1)continue;e=e.slice(t+2),x=!1}let n=e.indexOf(`/*`);if(n!==-1){let t=e.indexOf(`*/`,n+2);t===-1?(x=!0,e=e.slice(0,n)):e=e.slice(0,n)+e.slice(t+2)}let r=e.indexOf(`//`);r!==-1&&(e=e.slice(0,r));let i=e.trim();if(!y){let e=i.match(/^struct\s+([A-Za-z_]\w*)\s*\{$/);e?.[1]&&(y=e[1],b=[]);continue}if(i===`};`){let e=0,t=1,n=[];for(let r of b){let i=r.kind===`double`?8:r.kind===`bool`||r.kind===`char`?1:4;e%i!==0&&(e+=i-e%i),n.push({name:r.name,kind:r.kind,offset:e}),e+=i,t=Math.max(t,i)}e%t!==0&&(e+=t-e%t),v.set(y,{fields:n,size:Math.max(e,1)}),y=``,b=[];continue}let a=i.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(a)for(let e of a[2].split(`,`)){let t=e.split(`=`)[0]?.trim()||``;if(!t||/[*&\[]/.test(t))continue;let n=t.match(/([A-Za-z_]\w*)\s*$/)?.[1];n&&b.push({name:n,kind:a[1]})}}this.debugVariableMetadata={},this.debugGlobalMetadata=[],this.debugFunctionMetadata={};let S=[],C=a===`CPP`?`extern "C" `:``,w=[`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_enter"))) void __wasm_idle_debug_enter(int functionId, int line);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_leave"))) void __wasm_idle_debug_leave(int functionId);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_num"))) void __wasm_idle_debug_value_num(int functionId, int slot, double value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_bool"))) void __wasm_idle_debug_value_bool(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_addr"))) void __wasm_idle_debug_value_addr(int functionId, int slot, int value);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_value_text"))) void __wasm_idle_debug_value_text(int functionId, int slot, const char* ptr, int len);`,`${C}__attribute__((import_module("env"), import_name("__wasm_idle_debug_line"))) void __wasm_idle_debug_line(int functionId, int line);`],T=a===`CPP`?[`#include <cstdio>`,`#include <iostream>`,`#include <map>`,`#include <set>`,`#include <string>`,`#include <type_traits>`,`#include <vector>`,...w,`template <typename T>`,`static inline std::string __wasm_idle_debug_format_value(const T& value) {`,`    if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";`,`    else if constexpr (std::is_same_v<T, char>) return std::string("'") + value + "'";`,`    else if constexpr (std::is_same_v<T, signed char> || std::is_same_v<T, unsigned char>) return std::to_string((int)value);`,`    else if constexpr (std::is_integral_v<T> || std::is_floating_point_v<T>) return std::to_string(value);`,`    else return "?";`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_vector(int functionId, int slot, const std::vector<T>& values) {`,`    std::string text = "[";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "]";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename T>`,`static inline void __wasm_idle_debug_emit_set(int functionId, int slot, const std::set<T>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& value : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(value);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`,`template <typename K, typename V>`,`static inline void __wasm_idle_debug_emit_map(int functionId, int slot, const std::map<K, V>& values) {`,`    std::string text = "{";`,`    int count = 0;`,`    for (const auto& entry : values) {`,`        if (count > 0) text += ", ";`,`        if (count >= 8) { text += "..."; break; }`,`        text += __wasm_idle_debug_format_value(entry.first);`,`        text += ": ";`,`        text += __wasm_idle_debug_format_value(entry.second);`,`        count += 1;`,`    }`,`    text += "}";`,`    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());`,`}`]:[`#include <stdio.h>`,...w];for(let t=0;t<e.length;t+=1){let r=e[t],i=r.match(/^\s*/)?.[0]||``,s=r,c=n[t],y=c.trim(),b=o.has(t),x=u>0&&l>=u,C=u===0&&l===0&&!y.includes(`(`)&&!y.startsWith(`#`),w=/^(while|if|for)\s*\(/.test(y)&&!y.includes(`{`),E=[],D=[],O=new Set,k=C&&y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/);if(k){let e=k[1]===`bool`?`bool`:`number`,n=[],r=``,i=0;for(let e of k[2]){if(e===`,`&&i===0){r.trim()&&n.push(r.trim()),r=``;continue}e===`{`&&(i+=1),e===`}`&&(i=Math.max(0,i-1)),r+=e}r.trim()&&n.push(r.trim());for(let r of n){let[n]=r.split(`=`),i=n?.trim()||``;if(/[*&\[]/.test(i))continue;let a=i.match(/([A-Za-z_]\w*)\s*$/)?.[1];if(!a)continue;let o=p++;h.set(a,{slot:o,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:o,name:a,kind:e,fromLine:t+1,toLine:2**53-1}],S.push(`${e===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${o}, ${a});`)}}let A=C&&y.match(/^(?:const\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\[(\d+)\]\s*(?:=.*)?;$/);if(A){let e=v.get(A[1]);if(e){let n=p++;this.debugGlobalMetadata=[...this.debugGlobalMetadata,{slot:n,name:A[2],kind:`array`,length:Number(A[3]),dimensions:[Number(A[3])],structFields:e.fields,structSize:e.size,fromLine:t+1,toLine:2**53-1}],S.push(`__wasm_idle_debug_value_addr(0, ${n}, (int)((unsigned long long)(${A[2]})));`)}}if(x&&!b&&y&&!y.startsWith(`#`)&&y!==`{`&&y!==`}`&&!y.startsWith(`else`)&&!y.startsWith(`case `)&&y!==`case`&&!y.startsWith(`default`)&&!y.startsWith(`catch`)&&!/^(public|private|protected)\s*:/.test(y)&&!y.endsWith(`:`)&&!y.includes(` else `)){E.push(`${i}__wasm_idle_debug_line(${d}, ${t+1});`);let e=y.match(/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/),n=y.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map))\s*<(.+)>\s+([A-Za-z_]\w*)\s*(?:=.*)?;$/);if(n&&d){let e=p++,r=n[1],a=n[3];O.add(a),g.set(a,{slot:e,container:r,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:a,kind:`text`,fromLine:t+1,toLine:2**53-1}],D.push(`${i}__wasm_idle_debug_emit_${r}(${d}, ${e}, ${a});`)}if(e&&d){let n=e[1]===`bool`?`bool`:`number`,r=[],a=``,o=0,s=0;for(let t of e[2]){if(t===`,`&&o===0&&s===0){a.trim()&&r.push(a.trim()),a=``;continue}t===`(`&&(o+=1),t===`)`&&(o=Math.max(0,o-1)),t===`{`&&(s+=1),t===`}`&&(s=Math.max(0,s-1)),a+=t}a.trim()&&r.push(a.trim());for(let a of r){let[r]=a.split(`=`),o=r?.trim()||``,s=[];for(let e of o.matchAll(/\[(\d+)\]/g))s.push(Number(e[1]));let c=o.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(s.length&&c){let n=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:n,name:c[1],kind:`array`,elementKind:e[1],length:s[0],dimensions:s,fromLine:t+1,toLine:2**53-1}],D.push(`${i}__wasm_idle_debug_value_addr(${d}, ${n}, (int)((unsigned long long)(${c[1]})));`);continue}if(/[*&]/.test(o))continue;let l=o.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/)?.[1];if(l){if(!m.has(l)){let e=p++;m.set(l,{slot:e,kind:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:l,kind:n,fromLine:t+1,toLine:2**53-1}]}if(a.includes(`=`)){let e=m.get(l);e&&D.push(`${i}${e.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${e.slot}, ${l});`)}}}}let r=y.match(/^for\s*\(\s*(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+([A-Za-z_]\w*)\s*=/);if(r&&d){let e=r[1]===`bool`?`bool`:`number`,n=r[2];if(!m.has(n)){let r=p++;m.set(n,{slot:r,kind:e,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:r,name:n,kind:e,fromLine:t+1,toLine:2**53-1}]}}if(!w){for(let[e,t]of g){if(O.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`\\b${n}\\b`).test(y)&&D.push(`${i}__wasm_idle_debug_emit_${t.container}(${d}, ${t.slot}, ${e});`)}for(let[e,n]of m){let r=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);y.startsWith(`for`)&&n.toLine===t+1||(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b`).test(y)||RegExp(`\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${r}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${r}\\b`).test(y))&&D.push(`${i}${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${e});`)}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y)||RegExp(`\\b(?:cin|std::cin)\\b[^;]*>>\\s*${n}\\b`).test(y))&&D.push(`${i}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}/^return\b/.test(y)&&E.push(`${i}__wasm_idle_debug_leave(${d});`)}if(u>0&&l===u&&y===`}`&&E.push(`${i}__wasm_idle_debug_leave(${d});`),x&&d&&(/^(while|if)\s*\(/.test(y)||/^for\s*\(/.test(y))){let e=y.match(/^(while|if|for)\b/)?.[1],n=r.indexOf(e||``),a=n>=0?r.indexOf(`(`,n):-1;if(a>=0){let n=-1,o=0;for(let e=a;e<r.length;e+=1){let t=r[e];if(t===`(`&&(o+=1),t===`)`&&(--o,o===0)){n=e;break}for(let[e,t]of h){if(m.has(e)||g.has(e))continue;let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);!w&&(RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b`).test(y)||RegExp(`\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(y)||RegExp(`&\\s*${n}\\b`).test(y))&&D.push(`${i}${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${t.slot}, ${e});`)}}if(n>a){let i=r.slice(a+1,n);if(e===`for`){let e=[],o=``,c=0;for(let t of i){if(t===`;`&&c===0){e.push(o),o=``;continue}t===`(`&&(c+=1),t===`)`&&(c=Math.max(0,c-1)),o+=t}if(e.push(o),e.length===3&&e[1]?.trim()){let i=e[0].trim(),o=e[2].trim(),c=[],l=[],u=[],f=/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(?:int|float|double|bool|char)\b/.test(i);for(let[e,t]of m){let n=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`),r=RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${n}\\b|\\b${n}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`);!f&&r.test(i)&&c.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),f&&r.test(i)&&l.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`),r.test(o)&&u.push(`${t.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${t.slot}, ${e})`)}let p=c.length&&i?`(${i}, ${c.join(`, `)})`:e[0],h=u.length&&o?`(${o}, ${u.join(`, `)})`:e[2];s=r.slice(0,a+1)+`${p}; (${l.length?`${l.join(`, `)}, `:``}__wasm_idle_debug_line(${d}, ${t+1}), (${e[1].trim()})); ${h}`+r.slice(n)}}else{let e=[];if(w){for(let[t,n]of m){let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(i)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${n.slot}, ${t})`)}for(let[t,n]of h){if(m.has(t)||g.has(t))continue;let r=t.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`);RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${r}\\b|\\b${r}\\s*(?:(?:<<|>>|[+\\-*/%&|^])?=|\\+\\+|--)`).test(i)&&e.push(`${n.kind===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(0, ${n.slot}, ${t})`)}}let o=e.length?`((${i.trim()}) ? (${e.join(`, `)}, 1) : (${e.join(`, `)}, 0))`:`(${i.trim()})`;s=r.slice(0,a+1)+`(__wasm_idle_debug_line(${d}, ${t+1}), ${o})`+r.slice(n)}}}}T.push(...E),T.push(s),T.push(...D);let j=u===0&&y.includes(`(`)&&y.includes(`)`)&&y.includes(`{`)&&(c.match(/{/g)||[]).length>(c.match(/}/g)||[]).length&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y),M=u===0&&!!_&&y===`{`;if(l+=(c.match(/{/g)||[]).length,l-=(c.match(/}/g)||[]).length,j||M){u=l,d=f++;let e=`anonymous`,n=a===`OBJC`&&j?y.match(/^([-+])\s*\([^)]*\)\s*([A-Za-z_]\w*)/):null;if(j?(e=y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||e,n&&(e=`${n[1]}${n[2]}`)):_&&(e=_.functionName||e),this.debugFunctionMetadata[d]=e,p=1,m=new Map,g=new Map,T.push(`${i}    __wasm_idle_debug_enter(${d}, ${t+1});`),e===`main`){a===`CPP`&&(T.push(`${i}    std::cout.setf(std::ios::unitbuf);`),T.push(`${i}    std::cerr.setf(std::ios::unitbuf);`));let e=a===`CPP`?`nullptr`:`NULL`;T.push(`${i}    setvbuf(stdout, ${e}, _IONBF, 0);`),T.push(`${i}    setvbuf(stderr, ${e}, _IONBF, 0);`)}let r=j?n?``:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`)):_?.parameters||``;for(let e of r.split(`,`).map(e=>e.trim()).filter(Boolean)){let n=e.split(`=`)[0]?.trim()||``,r=n.match(/^(?:const\s+)?(?:(?:std::)?(vector|set|map)\s*<.+>)\s*&?\s*([A-Za-z_]\w*)\s*$/);if(r){let e=p++,n=r[1],a=r[2];g.set(a,{slot:e,container:n,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:a,kind:`text`,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    __wasm_idle_debug_emit_${n}(${d}, ${e}, ${a});`);continue}let a=[];for(let e of n.matchAll(/\[(\d+)\]/g))a.push(Number(e[1]));let o=n.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);if(a.length&&o&&/\b(int|float|double|bool|char)\b/.test(n)){let e=p++;this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:e,name:o[1],kind:`array`,elementKind:n.match(/\b(int|float|double|bool|char)\b/)?.[1]||`int`,length:a[0],dimensions:a,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    __wasm_idle_debug_value_addr(${d}, ${e}, (int)((unsigned long long)(${o[1]})));`);continue}if(/[*&\[]/.test(n))continue;let s=n.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);if(!s)continue;let c=s[1],l=/\bbool\b/.test(n)?`bool`:/\b(?:int|float|double|char|short|long)\b/.test(n)?`number`:``;if(!l)continue;let u=p++;m.set(c,{slot:u,kind:l,fromLine:t+1,toLine:2**53-1}),this.debugVariableMetadata[d]=[...this.debugVariableMetadata[d]||[],{slot:u,name:c,kind:l,fromLine:t+1,toLine:2**53-1}],T.push(`${i}    ${l===`bool`?`__wasm_idle_debug_value_bool`:`__wasm_idle_debug_value_num`}(${d}, ${u}, ${c});`)}_=void 0}else u===0&&y.includes(`(`)&&y.includes(`)`)&&!y.includes(`{`)&&!y.endsWith(`;`)&&!/^(if|for|while|switch|catch)\b/.test(y)&&!/^(class|struct|namespace|enum|union)\b/.test(y)?_={functionName:y.slice(0,y.indexOf(`(`)).trim().split(/\s+/).pop()||`anonymous`,parameters:y.slice(y.indexOf(`(`)+1,y.lastIndexOf(`)`))}:y&&y!==`{`&&(_=void 0);u>0&&l<u&&(u=0,d=0,m=new Map,g=new Map)}S.length&&(a===`CPP`?(T.push(`struct __wasm_idle_debug_globals_init {`),T.push(`    __wasm_idle_debug_globals_init() {`),T.push(...S.map(e=>`        ${e}`)),T.push(`    }`),T.push(`} __wasm_idle_debug_globals_init_instance;`)):(T.push(`__attribute__((constructor)) static void __wasm_idle_debug_globals_init(void) {`),T.push(...S.map(e=>`    ${e}`)),T.push(`}`))),r=T.join(`
`)}else this.debugVariableMetadata={},this.debugGlobalMetadata=[],this.debugFunctionMetadata={};typeof e.transformSource==`function`&&(r=e.transformSource(r));let p=qe(r);await this.ready,this.addWorkspaceFiles(e.workspaceFiles,t),this.addWorkspaceDirectories(t),this.memfs.addFile(t,p),this.memfs.addFile(i,new Uint8Array);let m=await this.getModule(this.assetUrls.clang),h=this.compilerConfig?.resourceDir||`/lib/clang/8.0.1`,g=`${h.replace(/\/+$/,``)}/include`,_=[`-cc1`,`-triple`,`wasm32-wasi`,`-emit-obj`,`-disable-free`,`-isysroot`,`/`,`-resource-dir`,h,...a===`CPP`?[`-internal-isystem`,`/include/c++/v1`,`-internal-isystem`,g,`-internal-isystem`,`/include/wasm32-wasi`,`-internal-isystem`,`/include`]:[`-internal-isystem`,g,`-internal-isystem`,`/include/wasm32-wasi`,`-internal-isystem`,`/include`],...a===`OBJC`?[`-I.`]:[],`-ferror-limit`,`19`,`-fcolor-diagnostics`,...d?[]:[`-O`+f],`-o`,i,c,`-x`,s,...a===`OBJC`?[`-fobjc-runtime=gnustep-2.0`,`-fblocks`]:[],t,...o,...d?[`-O0`,`-debug-info-kind=standalone`,`-dwarf-version=4`,`-debugger-tuning=gdb`,`-fdebug-compilation-dir=/workspace`]:[]];this.trace(`compile ${t} -> ${i}`);try{return await this.run(m,!0,`clang`,..._)}catch(e){if(Uint8Array.from(this.memfs.getFileContents(i)).length>0)return this.trace(`recover ${i} after clang output stream exit`),null;throw e}}async link(e,t,r=`none`){let i=n(typeof r==`boolean`?{debug:r}:{debugMode:r}),a=`lib/wasm32-wasi`,o=this.compilerConfig?.compilerRuntimeLibDir||`lib/clang/8.0.1/lib/wasi`,s=`${a}/crt1.o`;await this.ready;let c=await this.getModule(this.assetUrls.lld);return this.trace(`link ${e} -> ${t}`),await this.run(c,this.log,`wasm-ld`,`--export-dynamic`,...i===`trace`?[`--allow-undefined`]:[],`-z`,`stack-size=1048576`,`-L${a}/noeh`,`-L${a}`,s,e,`-lc`,`-lc++`,`-lc++abi`,`-lm`,`-L${o}`,`-lclang_rt.builtins-wasm32`,`-o`,t)}async run(e,t,...n){return this.runWithOptions(e,t,n)}async runWithOptions(e,t,n,r={},i,a){this.memfs.out=t,this.hostLog(`${n.join(` `)}\n`),this.trace(`run ${n.join(` `)}`);let o=+new Date,s=new he(e,this.memfs,n[0],...n.slice(1),{extraImports:i,instanceRef:a});s.environ={...s.environ,...r},s.trace=e=>this.trace(e),s.debugSession={buffer:this.debugBuffer,interruptBuffer:this.debugInterruptBuffer,watchBuffer:this.debugWatchBuffer,watchResultBuffer:this.debugWatchResultBuffer,breakpoints:new Set(this.debugBreakpoints),breakpointVersion:0,pauseOnEntry:this.debugPauseOnEntry,stepArmed:this.debugPauseOnEntry,nextLineArmed:!1,stepOutArmed:!1,callDepth:0,stepOutDepth:0,currentFunctionId:0,currentLine:0,resumeSkipActive:!1,resumeSkipFunctionId:0,resumeSkipLine:0,nextLineFunctionId:0,nextLineLine:0,variableMetadata:this.debugVariableMetadata,globalVariableMetadata:this.debugGlobalMetadata,functionMetadata:this.debugFunctionMetadata,frames:[],globalValues:new Map,onPause:e=>this.onDebugEvent?.(e)};let c=+new Date,l=await s.run(),u=+new Date;return this.log&&this.stdout(`
`),this.showTiming&&this.stdout(`${Ae}(${o-c}ms/${u-c}ms)${je}\n`),l?s:null}async compileLink(e,t={}){let{language:r=`CPP`,fileName:i,activePath:a,workspaceFiles:o=[],args:s=[],compileArgs:c=s,debugMode:l,debug:u,breakpoints:d=[],pauseOnEntry:f=!1,cppVersion:p,cVersion:m,debugBuffer:h,interruptBuffer:g,watchBuffer:_,watchResultBuffer:v}=t,y=n({debugMode:l,debug:u}),b=y===`lldb`?o.map(e=>({...e,path:z(e.path)})):o,x=y===`lldb`?z:R,{input:S,obj:C,wasm:w}=B(r,x(a||``)||x(i||``)||void 0),T=y===`trace`;this.beginTrace(T),this.debugBreakpoints=new Set(T?d:[]),this.debugPauseOnEntry=T&&f,this.debugBuffer=h,this.debugInterruptBuffer=g,this.debugWatchBuffer=_,this.debugWatchResultBuffer=v,this.lastArtifactPath=w;let E=JSON.stringify({code:e,input:S,wasm:w,language:r,compileArgs:c,workspaceFiles:b,cppVersion:p,cVersion:m,debugMode:y});if(this.lastBuildKey===E)return this.trace(`reuse ${w}`),this.wasm;await this.compile({input:S,code:e,obj:C,language:r,compileArgs:c,workspaceFiles:b,cppVersion:p,cVersion:m,debugMode:y}),await this.link(C,w,y),this.lastBuildKey=E;let D=Uint8Array.from(this.memfs.getFileContents(w));return this.wasm=await this.hostLogAsync(`Compiling ${w}`,WebAssembly.compile(D))}async compileArtifact(e,t={}){let r=n(t),i=await this.compileLink(e,t),a=Uint8Array.from(this.memfs.getFileContents(this.lastArtifactPath)),o=t.language||`CPP`,s={code:e,language:o,fileName:t.fileName,activePath:t.activePath,workspaceFiles:t.workspaceFiles,compileArgs:t.compileArgs,cppVersion:t.cppVersion,cVersion:t.cVersion,debugMode:r};return{bytes:a,wasm:i,target:`wasm32-wasi`,format:`wasi-core-wasm`,fileName:this.lastArtifactPath,language:o,...r===`trace`?{debugMetadata:{variableMetadata:this.debugVariableMetadata,globalVariableMetadata:this.debugGlobalMetadata,functionMetadata:this.debugFunctionMetadata}}:{},...r===`lldb`?{debug:await Ve(s,a,this.compilerConfig?.provenance)}:{}}}async compileLinkRun(e,t={}){let{language:r=`CPP`,fileName:i,activePath:a,workspaceFiles:o=[],args:s=[],compileArgs:c=s,programArgs:l=[],debugMode:u,debug:d,breakpoints:f=[],pauseOnEntry:p=!1,cppVersion:m,cVersion:h,debugBuffer:g,interruptBuffer:_,watchBuffer:v,watchResultBuffer:y}=t,b=n({debugMode:u,debug:d});if(b===`lldb`)throw Error(`compileLinkRun() cannot execute LLDB artifacts in the browser WebAssembly engine. Use compileArtifact() and @wasm-idle/llvm-core/debug instead.`);this.debug=b===`trace`;let{wasm:x}=B(r,R(a||``)||R(i||``)||void 0);return await this.run(await this.compileLink(e,{language:r,fileName:i,activePath:a,workspaceFiles:o,compileArgs:c,debugMode:b,breakpoints:f,pauseOnEntry:p,cppVersion:m,cVersion:h,debugBuffer:g,interruptBuffer:_,watchBuffer:v,watchResultBuffer:y}),!0,x,...l)}};function V(e,t){if(!e||typeof e!=`object`||Array.isArray(e))throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function H(e,t){if(typeof e!=`string`||e.length===0)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function Xe(e,t){if(e!==`wasm32-wasi`)throw Error(`invalid ${t} in wasm-clang runtime manifest`);return e}function Ze(e){let t=V(e,`root.compiler.provenance`);if(t.name!==`clang`)throw Error(`invalid root.compiler.provenance.name in wasm-clang runtime manifest`);return{name:`clang`,version:H(t.version,`root.compiler.provenance.version`),revision:H(t.revision,`root.compiler.provenance.revision`)}}function Qe(e){let t=V(e,`root.compiler`),n=V(t.sysroot,`root.compiler.sysroot`);return{memfs:{asset:H(V(t.memfs,`root.compiler.memfs`).asset,`root.compiler.memfs.asset`),argv0:H(V(t.memfs,`root.compiler.memfs`).argv0,`root.compiler.memfs.argv0`)},clang:{asset:H(V(t.clang,`root.compiler.clang`).asset,`root.compiler.clang.asset`),argv0:H(V(t.clang,`root.compiler.clang`).argv0,`root.compiler.clang.argv0`)},lld:{asset:H(V(t.lld,`root.compiler.lld`).asset,`root.compiler.lld.asset`),argv0:H(V(t.lld,`root.compiler.lld`).argv0,`root.compiler.lld.argv0`)},sysroot:{asset:H(n.asset,`root.compiler.sysroot.asset`),...typeof n.runtimeRoot==`string`?{runtimeRoot:n.runtimeRoot}:{}},...t.resourceDir===void 0?{}:{resourceDir:H(t.resourceDir,`root.compiler.resourceDir`)},...t.compilerRuntimeLibDir===void 0?{}:{compilerRuntimeLibDir:H(t.compilerRuntimeLibDir,`root.compiler.compilerRuntimeLibDir`)},...typeof t.defaultCppStandard==`string`?{defaultCppStandard:t.defaultCppStandard}:{},...typeof t.defaultCStandard==`string`?{defaultCStandard:t.defaultCStandard}:{},...t.provenance===void 0?{}:{provenance:Ze(t.provenance)}}}function $e(e){let t=V(e,`root.clangd`);return{js:H(t.js,`root.clangd.js`),wasm:H(t.wasm,`root.clangd.wasm`)}}function et(e,t){let n=V(e,t);if(V(n.execution,`${t}.execution`).kind!==`wasi-preview1`)throw Error(`invalid ${t}.execution.kind in wasm-clang runtime manifest`);if(n.artifactFormat!==`wasi-core-wasm`)throw Error(`invalid ${t}.artifactFormat in wasm-clang runtime manifest`);return{artifactFormat:`wasi-core-wasm`,execution:{kind:`wasi-preview1`}}}function tt(e){return{"wasm32-wasi":et(V(e,`root.targets`)[`wasm32-wasi`],`root.targets.wasm32-wasi`)}}function nt(e){let t=V(e,`root`);if(t.manifestVersion!==1)throw Error(`invalid root.manifestVersion in wasm-clang runtime manifest`);return{manifestVersion:1,version:H(t.version,`root.version`),defaultTarget:Xe(t.defaultTarget,`root.defaultTarget`),compiler:Qe(t.compiler),clangd:$e(t.clangd),targets:tt(t.targets)}}async function rt(e,t=fetch,n){return nt(await x(Pe(e,`wasm-clang runtime manifest URL`),{fetchImpl:t,label:`wasm-clang runtime manifest`,signal:n}))}function it(e){return Re(e)}var at=t({BrowserClangRuntime:()=>Ye,loadRuntimeManifest:()=>rt,resolveRuntimeManifestUrl:()=>it});const ot=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,U=e=>ot(e?.buffer),st=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const ct=new TextDecoder,lt=e=>e instanceof Int32Array?e:new Int32Array(e),ut=e=>new Uint8Array(e.buffer,e.byteOffset+st,e.byteLength-st),dt=e=>{let t=lt(e),n=Atomics.load(t,1);if(n===-1)return null;let r=ut(t);return ct.decode(r.slice(0,n))},ft=(e,t)=>{if(!e||!U(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return dt(e)},pt=new TextDecoder,mt=globalThis.fetch.bind(globalThis),ht=globalThis.XMLHttpRequest;let W=null,gt=!1,_t=0;const G=new Map,K=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},vt=()=>{if(!W)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(W.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${W.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${W.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${W.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},yt=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},bt=e=>{let t=vt();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},xt=e=>{let t=vt();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`},St=e=>xt(e)!==null,Ct=async e=>{let t=++_t;return await new Promise((n,r)=>{G.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},wt=async(e,t)=>{let n=bt(e);if(!n||xt(n)!==t||!W)throw Error(`Untracked runtime asset request`);let r=W.maxAssetBytes??134217728,i=await mt(n,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`});if(i.url){let e;try{e=new URL(i.url)}catch{let e=Error(`Runtime asset response URL is invalid: ${i.url}`);throw K(i,e),e}if(e.href!==n){let t=Error(`Runtime asset response URL mismatch: expected ${n}, received ${e.href}`);throw K(i,t),t}}if(!i.ok){let e=Error(`Failed to load ${t}: ${i.status}`);throw K(i,e),e}let a=i.headers.get(`content-length`),o;if(a!==null){let e=Number(a);if(!/^\d+$/u.test(a.trim())||!Number.isSafeInteger(e)){let e=Error(`Runtime asset ${t} has an invalid Content-Length`);throw K(i,e),e}o=e||void 0}if(o!==void 0&&o>r){let e=Error(`Runtime asset ${t} exceeds the ${r} byte limit`);throw K(i,e),e}let s=i.headers.get(`content-type`)||void 0;if(!i.body){let e=new Uint8Array(await i.arrayBuffer());if(e.byteLength>r)throw Error(`Runtime asset ${t} exceeds the ${r} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:o??e.byteLength}}),{bytes:e,mimeType:s}}let c=i.body.getReader(),l=!1,u=e=>{if(!l){l=!0;try{Promise.resolve(c.cancel(e)).catch(()=>void 0)}catch{}}},d=0,f,p;try{for(f=new Uint8Array(o||Math.min(65536,r));;){let{done:e,value:n}=await c.read();if(e)break;if(!n)continue;let i=d+n.byteLength;if(i>r){let e=Error(`Runtime asset ${t} exceeds the ${r} byte limit`);throw u(e),e}if(i>f.byteLength){let e=Math.min(r,Math.max(i,f.byteLength*2)),t=new Uint8Array(e);t.set(f.subarray(0,d)),f=t}f.set(n,d),d=i,self.postMessage({assetProgress:{asset:t,loaded:d,total:o}})}}catch(e){throw u(e),e}finally{try{c.releaseLock()}catch(e){p={error:e}}}if(p)throw p.error;return d!==f.byteLength&&(f=f.slice(0,d)),self.postMessage({assetProgress:{asset:t,loaded:d,total:o??d}}),{bytes:f,mimeType:s}};async function Tt(e){let t=xt(e);if(!t||!W)throw Error(`Untracked runtime asset request`);return W.useAssetBridge?await Ct(t):await wt(e,t)}function Et(e){return new Response(yt(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function Dt(){if(ht===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=bt(t);if(!n||!St(n)){let r=n||(t instanceof URL?t.href:String(t));this.native=new ht,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await Tt(this.url),t=yt(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=pt.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function Ot(){gt||(gt=!0,globalThis.fetch=(async(e,t)=>{let n=bt(e);return!n||!St(n)?mt(e,t):Et(await Tt(n))}),Dt())}function kt(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);W=e,Ot()}function At(e){let t=e?.assetResponse;if(!t)return!1;let n=G.get(t.id);return n?(G.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}self.document={querySelectorAll(){return[]}};let jt,q,J,Y,X,Z,Q=!1,$=null;function Mt(e,t){postMessage({progress:{percent:e,stage:t}})}async function Nt(e,t){let{BrowserClangRuntime:n,loadRuntimeManifest:r,resolveRuntimeManifestUrl:i}=await Promise.resolve().then(()=>at);Z=new n({stdout:e=>postMessage({output:e}),onDebugEvent:e=>postMessage({debugEvent:e}),stdin:()=>{if(Q){let e=$;return $=null,e??``}return ft(jt,()=>postMessage({buffer:!0}))??``},progress:e=>postMessage({progress:e}),log:t,runtimeBaseUrl:e,manifest:await r(i(e))}),await Z.ready}self.onmessage=async e=>{if(At(e.data))return;let{code:t,buffer:n,debugBuffer:r,watchBuffer:i,watchResultBuffer:a,load:o,interrupt:s,log:c,path:l,assets:u,prepare:d,language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:y,debug:b,breakpoints:x,pauseOnEntry:S,stdin:C}=e.data,w=y||(b?`trace`:`none`);if(o)try{let e=u;kt(e||null),await Nt(e?.baseUrl||l||``,c),postMessage({load:!0})}catch(e){self.postMessage({error:e.message||`Unable to load the C/C++ runtime.`})}else if(d){if(jt=new Int32Array(n),q=new Int32Array(r),J=new Int32Array(i),Y=new Int32Array(a),X=new Uint8Array(s),Q=typeof C==`string`,$=Q?C:null,w===`trace`&&!U(q)){self.postMessage({error:`C/C++ debugging requires SharedArrayBuffer.`});return}try{Mt(5,`Compiling ${f===`C`?`C`:`C++`} source`),await Z.compileArtifact(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:w,breakpoints:x,pauseOnEntry:S,debugBuffer:q,interruptBuffer:X,watchBuffer:J,watchResultBuffer:Y}),Mt(100,`${f===`C`?`C`:`C++`} program ready`),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message})}}else if(t){if(Z.log=c,jt=new Int32Array(n),q=new Int32Array(r),J=new Int32Array(i),Y=new Int32Array(a),X=new Uint8Array(s),Q=typeof C==`string`,$=Q?C:null,w===`trace`&&!U(q)){self.postMessage({error:`C/C++ debugging requires SharedArrayBuffer.`});return}try{if(w===`lldb`){let e=await Z.compileArtifact(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:`lldb`});if(!e.debug)throw Error(`wasm-clang did not return an LLDB DWARF descriptor`);let n=z(h||(f===`C`?`main.c`:`main.cc`))||(f===`C`?`main.c`:`main.cc`),r=new Map;for(let e of g||[]){let t=z(e.path);t&&r.set(`/workspace/${t}`,e.content)}r.set(`/workspace/${n}`,t),self.postMessage({lldbArtifact:{bytes:new Uint8Array(e.bytes),descriptor:e.debug,sources:e.debug.files.map(({path:e,contentSha256:t})=>{let n=r.get(e);if(n===void 0)throw Error(`Missing LLDB source content for ${e}`);return{path:e,content:n,contentSha256:t}})}});return}await Z.compileLinkRun(t,{language:f,compileArgs:p,programArgs:m,activePath:h,workspaceFiles:g,cppVersion:_,cVersion:v,debugMode:w,breakpoints:x,pauseOnEntry:S,debugBuffer:q,interruptBuffer:X,watchBuffer:J,watchResultBuffer:Y}),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message})}}};