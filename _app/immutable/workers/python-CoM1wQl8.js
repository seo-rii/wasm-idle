const e=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,t=t=>e(t?.buffer),n=Int32Array.BYTES_PER_ELEMENT*2,r=new TextEncoder,i=new TextDecoder,a=e=>e instanceof Int32Array?e:new Int32Array(e),o=e=>new Uint8Array(e.buffer,e.byteOffset+n,e.byteLength-n),s=(e,t)=>{let n=new Uint8Array(t),{read:i,written:a}=r.encodeInto(e,n);if(e.length>0&&i===0)throw RangeError(`Stdin buffer payload cannot fit the next UTF-8 character`);return{bytes:n.subarray(0,a),rest:e.slice(i)}},c=(e,t)=>{if(!e.length)return!1;let n=a(t),r=o(n),i=e[0],{bytes:c,rest:l}=s(i,r.length);return r.fill(0),r.set(c),Atomics.store(n,1,c.length),Atomics.add(n,0,1),Atomics.notify(n,0),l?e[0]=l:e.shift(),!0},l=e=>{let t=a(e),n=Atomics.load(t,1);if(n===-1)return null;let r=o(t);return i.decode(r.slice(0,n))},u=(e,n)=>{if(!e||!t(e))return null;let r=Atomics.load(e,0);for(n();;)if(Atomics.wait(e,0,r,100)===`not-equal`)return l(e)};var d=class extends Error{code;phase;runtimeId;profileId;recoverable;constructor(e,t){super(e,{cause:t.cause}),this.name=`WasmIdleError`,this.code=t.code,this.phase=t.phase,this.runtimeId=t.runtimeId,this.profileId=t.profileId,this.recoverable=t.recoverable??!1}},f=class extends d{constructor(e,t={}){super(e,{...t,code:`runtime-configuration`,phase:t.phase??`configuration`,recoverable:t.recoverable??!1}),this.name=`RuntimeConfigurationError`}},p=class extends d{constructor(e,t={}){super(e,{...t,code:`asset-integrity`,phase:t.phase??`asset`,recoverable:t.recoverable??!1}),this.name=`AssetIntegrityError`}},m=class extends d{limit;actual;constructor(e,t){super(e,{...t,code:`output-limit`,phase:t.phase??`execute`,recoverable:t.recoverable??!0}),this.name=`OutputLimitError`,this.limit=t.limit,this.actual=t.actual}},h=class extends d{constructor(e,t={}){super(e,{...t,code:`protocol`,phase:t.phase??`protocol`,recoverable:t.recoverable??!1}),this.name=`ProtocolError`}};const g=/* @__PURE__ */ new Set([`application/javascript`,`text/javascript`]);async function _(e){let t=e.stage??`compressed`,n={runtimeId:e.runtimeId,profileId:e.profileId};if(!e.asset||e.asset.includes(`\0`))throw new p(`Runtime asset identity must be a non-empty safe string`,n);if(!ArrayBuffer.isView(e.bytes)||Object.prototype.toString.call(e.bytes)!==`[object Uint8Array]`)throw new p(`Runtime asset ${e.asset} did not provide byte data`,n);let r,i,a;if(typeof e.expected==`string`){if(t===`uncompressed`)throw new p(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected}else if(e.expected&&typeof e.expected==`object`){if(t===`compressed`)r=e.expected.sha256,i=e.expected.bytes,e.expected.uncompressedSha256===void 0&&e.expected.uncompressedBytes===void 0&&(a=e.expected.mediaType);else{if(e.expected.uncompressedSha256===void 0||e.expected.uncompressedBytes===void 0)throw new p(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,n);r=e.expected.uncompressedSha256,i=e.expected.uncompressedBytes,a=e.expected.mediaType}}else throw new p(`Runtime asset ${e.asset} has invalid integrity metadata`,n);if(!/^[a-f0-9]{64}$/u.test(r))throw new p(`Runtime asset ${e.asset} has an invalid expected ${t} SHA-256 digest`,n);if(i!==void 0&&(!Number.isSafeInteger(i)||i<0))throw new p(`Runtime asset ${e.asset} has an invalid expected ${t} byte size`,n);if(i!==void 0&&e.bytes.byteLength!==i)throw new p(`Runtime asset ${e.asset} ${t} size mismatch: expected ${i} bytes, received ${e.bytes.byteLength}`,n);if(a!==void 0){if(!a.includes(`/`))throw new p(`Runtime asset ${e.asset} has an invalid expected MIME type`,n);let t=e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase()||`missing`,r=a.trim().toLowerCase();if(t!==r&&!(g.has(t)&&g.has(r)))throw new p(`Runtime asset ${e.asset} MIME type mismatch: expected ${r}, received ${t}`,n)}if(!globalThis.crypto?.subtle)throw new p(`Web Crypto SHA-256 is unavailable`,n);let o=e.bytes.byteOffset===0&&e.bytes.byteLength===e.bytes.buffer.byteLength&&e.bytes.buffer instanceof ArrayBuffer?e.bytes.buffer:Uint8Array.from(e.bytes).buffer,s=new Uint8Array(await globalThis.crypto.subtle.digest(`SHA-256`,o)),c=Array.from(s,e=>e.toString(16).padStart(2,`0`)).join(``);if(c!==r)throw new p(`Runtime asset ${e.asset} ${t} SHA-256 mismatch: expected ${r}, received ${c}`,n);return Object.freeze({asset:e.asset,stage:t,sha256:c,bytes:e.bytes.byteLength,mediaType:a?e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase():void 0})}const v=67108864;function y(e){let t=Object.freeze(w(e)),n=async e=>{if(!(!t.enabled||typeof e!=`string`||!e||e.length>65536))try{let n=await crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e)),r=Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``);return{url:`https://wasm-idle.invalid/.generated-assets/${t.namespace}/${r}`,validationKey:`generated-v1:${r}`}}catch{return}},r=(e,t)=>e.references.some(e=>e.url===t.url&&e.validationKey===t.validationKey);return Object.freeze({async read(e,i){E(i);let a=await n(e);if(a)return F(t,i,async(e,n,i)=>{let o=(await R(n)).find(e=>r(e,a));if(!o||o.bytes>Math.min(t.maxEntryBytes,t.maxBytes,v))return;let s=await e.match(A(t,o.sha256));try{if(!s)throw Error(`Generated artifact body is missing`);let e=await B(s,o.bytes,i);await M(_({asset:a.url,bytes:e,expected:o}),i),E(i);try{I(o,{...a,sha256:o.sha256,bytes:o.bytes},t),await P(n,`readwrite`,e=>e.put(o))}catch{}return e}catch{E(i),await z(e,n,t,o);return}})},async write(e,i,a){if(E(a),!j(t)||!i.byteLength||i.byteLength>Math.min(t.maxBytes,t.maxEntryBytes,v))return!1;let o=await n(e);if(!o)return!1;let s=Uint8Array.from(i),c;try{c=Array.from(new Uint8Array(await crypto.subtle.digest(`SHA-256`,s)),e=>e.toString(16).padStart(2,`0`)).join(``)}catch{return!1}return await F(t,a,async(e,n)=>{let i=await R(n),l=new Set(i.map(e=>A(t,e.sha256)));for(let t of await e.keys())l.has(t.url)||await e.delete(t);for(let a of i)a.sha256!==c&&r(a,o)&&(a.references=a.references.filter(e=>e.url!==o.url||e.validationKey!==o.validationKey),a.references.length?await P(n,`readwrite`,e=>e.put(a)):await z(e,n,t,a));i=await R(n);let u=i.find(e=>e.sha256===c),d=u??{sha256:c,bytes:s.byteLength,lastUsed:0,references:[]};if(d.bytes!==s.byteLength||(I(d,{...o,sha256:c,bytes:s.byteLength},t),!await ne(e,n,t,i,u?0:s.byteLength,+!u,c)))return!1;E(a),await e.put(A(t,c),new Response(s,{headers:{"Content-Type":`application/octet-stream`,"Content-Length":String(s.byteLength)}}));try{await P(n,`readwrite`,e=>e.put(d))}catch(n){throw u||await e.delete(A(t,c)),n}return!0})??!1},async remove(e,i){let a=await n(e);a&&await F(t,i,async(e,n)=>{for(let i of await R(n))r(i,a)&&(i.references=i.references.filter(e=>e.url!==a.url||e.validationKey!==a.validationKey),i.references.length?await P(n,`readwrite`,e=>e.put(i)):await z(e,n,t,i))})}})}const b=Object.freeze({enabled:!0,maxBytes:536870912,maxEntryBytes:536870912,maxEntries:4096,storageReserveBytes:67108864,eviction:`lru`,namespace:`wasm-idle`,version:`1.4.0`}),x=3e3,S=/* @__PURE__ */ new Set;let C={};function w(...e){return T([C,...e])}function T(e){let t={...b};for(let n of e)if(n===!1)t.enabled=!1;else if(n)for(let[e,r]of Object.entries(n))r!==void 0&&Object.hasOwn(b,e)&&(t[e]=r);for(let e of[`maxBytes`,`maxEntryBytes`,`maxEntries`,`storageReserveBytes`])if(!Number.isSafeInteger(t[e])||t[e]<0)throw TypeError(`Invalid asset cache ${e}`);if(typeof t.enabled!=`boolean`||![`lru`,`none`].includes(t.eviction))throw TypeError(`Invalid asset cache policy`);if(typeof t.namespace!=`string`||!/^[a-zA-Z0-9._-]{1,100}$/u.test(t.namespace))throw TypeError(`Invalid asset cache namespace`);if(typeof t.version!=`string`||!t.version||t.version.length>256)throw TypeError(`Invalid asset cache version`);return t}function E(e){if(e?.aborted)throw e.reason===void 0?new DOMException(`Aborted`,`AbortError`):e.reason}function D(e){return typeof e.url==`string`&&e.url.length>0&&e.url.length<=8192&&!e.url.includes(`\0`)&&typeof e.sha256==`string`&&/^[a-f0-9]{64}$/u.test(e.sha256)&&(e.bytes===void 0||Number.isSafeInteger(e.bytes)&&e.bytes>=0)&&(e.validationKey===void 0||typeof e.validationKey==`string`&&e.validationKey.length<=8192)&&(e.version===void 0||typeof e.version==`string`&&e.version.length>0&&e.version.length<=256)}function O(e){let t={...e};if(!D(t))throw TypeError(`Invalid runtime asset integrity identity`);return t}function k(e){return`wasm-idle-assets-v1:${e.namespace}`}function A(e,t){return`https://wasm-idle.invalid/.runtime-assets/${e.namespace}/${t}`}function j(e){try{return e.enabled&&e.maxBytes>0&&e.maxEntryBytes>0&&e.maxEntries>0&&globalThis.caches!==void 0&&globalThis.indexedDB!==void 0&&typeof globalThis.navigator?.locks?.request==`function`}catch{return!1}}function M(e,t){return new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason)};e.then(e=>{t.removeEventListener(`abort`,i),t.aborted?r(t.reason):n(e)},e=>{t.removeEventListener(`abort`,i),r(e)}),t.aborted?i():t.addEventListener(`abort`,i,{once:!0})})}function N(e,t){return E(t),new Promise((n,r)=>{let i=!1,a=indexedDB.open(e,1),o=()=>{i=!0,t.removeEventListener(`abort`,o),r(t.reason)};t.addEventListener(`abort`,o,{once:!0}),a.onupgradeneeded=()=>{i?a.transaction?.abort():a.result.createObjectStore(`assets`,{keyPath:`sha256`})},a.onsuccess=()=>{t.removeEventListener(`abort`,o),i?a.result.close():(i=!0,n(a.result))},a.onerror=()=>{t.removeEventListener(`abort`,o),i=!0,r(a.error)}})}function P(e,t,n){return E(e.signal),new Promise((r,i)=>{let a=e.connection.transaction(`assets`,t),o=()=>{try{a.abort()}catch{}},s=setTimeout(o,x);e.signal.addEventListener(`abort`,o,{once:!0});let c=()=>{clearTimeout(s),e.signal.removeEventListener(`abort`,o)},l;try{l=n(a.objectStore(`assets`))}catch(e){c();try{a.abort()}catch{}i(e);return}a.oncomplete=()=>{c(),e.signal.aborted?i(e.signal.reason):r(l.result)},a.onabort=()=>{c(),i(e.signal.aborted?e.signal.reason:a.error??/* @__PURE__ */ Error(`Asset cache database transaction failed`))}})}async function F(e,t,n,r=`exclusive`){if(E(t),!j(e))return;let i=new AbortController,a=()=>i.abort(t?.reason);t?.addEventListener(`abort`,a,{once:!0});let o=k(e),s=setTimeout(()=>{S.add(o),i.abort(/* @__PURE__ */ Error(`Asset cache lock timed out`))},S.has(o)?x:3e4);try{return await M(navigator.locks.request(o,{signal:i.signal,mode:r},async()=>{let t=i.signal;S.delete(o),E(t),clearTimeout(s),s=setTimeout(()=>i.abort(/* @__PURE__ */ Error(`Asset cache operation timed out`)),x);let r=await N(k(e),t);try{E(t);let i=await M(caches.open(k(e)),t);E(t);let a=await n({match:(...e)=>(E(t),M(i.match(...e),t)),keys:(...e)=>(E(t),M(i.keys(...e),t)),put:async(...e)=>{E(t),await i.put(...e),E(t)},delete:async(...e)=>{E(t);let n=await i.delete(...e);return E(t),n}},{connection:r,signal:t},t);return E(t),a}finally{r.close()}}),i.signal)}catch{E(t);return}finally{clearTimeout(s),t?.removeEventListener(`abort`,a)}}function I(e,t,n){let r=t.version??n.version;if(!e.references.some(e=>e.version===r&&e.url===t.url&&e.validationKey===t.validationKey)){if(e.references.length>=4096)throw Error(`Asset cache reference limit reached`);e.references.push({version:r,url:t.url,validationKey:t.validationKey})}e.lastUsed=Date.now()}function L(e){return!!e&&/^[a-f0-9]{64}$/u.test(e.sha256)&&Number.isSafeInteger(e.bytes)&&e.bytes>=0&&Number.isFinite(e.lastUsed)&&Array.isArray(e.references)&&e.references.length<=4096&&e.references.every(e=>typeof e?.version==`string`&&typeof e.url==`string`&&(e.validationKey===void 0||typeof e.validationKey==`string`))}async function R(e){let t=await P(e,`readonly`,e=>e.getAll());for(let n of t)L(n)||await P(e,`readwrite`,e=>e.delete(n.sha256));return t.filter(L)}async function z(e,t,n,r){await e.delete(A(n,r.sha256)),await P(t,`readwrite`,e=>e.delete(r.sha256))}async function ee(e){try{return E(e),await M(Promise.resolve(navigator.storage?.estimate?.()),e)}catch{E(e);return}}async function B(e,t,n){E(n);let r=e.body?.getReader();if(!r)return/* @__PURE__ */ new Uint8Array;let i=[],a=0;try{for(;;){E(n);let{done:e,value:o}=await M(r.read(),n);if(e)break;if(a+=o.byteLength,a>t)throw Error(`Cached asset exceeds expected size`);i.push(o)}}catch(e){throw r.cancel().catch(()=>{}),e}finally{r.releaseLock()}let o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.byteLength;return o}async function te(e,t,n){let r=await ee(n);return typeof r?.quota!=`number`||typeof r.usage!=`number`||!Number.isFinite(r.quota)||!Number.isFinite(r.usage)?e.maxBytes:Math.max(0,Math.min(e.maxBytes,r.quota-r.usage+t-e.storageReserveBytes))}async function ne(e,t,n,r,i,a,o){let s=r.reduce((e,t)=>e+t.bytes,0),c=r.length,l=await te(n,s,t.signal);if(i>l||a>n.maxEntries)return!1;let u=()=>s+i<=l&&c+a<=n.maxEntries;if(u())return!0;if(n.eviction===`none`)return!1;for(let i of[...r].sort((e,t)=>e.lastUsed-t.lastUsed||e.sha256.localeCompare(t.sha256)))if(i.sha256!==o&&(await z(e,t,n,i),s-=i.bytes,c--,u()))return!0;return u()}async function re(e){e={...e,identity:O(e.identity)};let t=w(e.cache);if(E(e.signal),!t.enabled||e.identity.bytes!==void 0&&e.identity.bytes>Math.min(t.maxBytes,t.maxEntryBytes))return;let n=Symbol(`invalid cached asset body`),r=r=>async(i,a,o)=>{let s=await P(a,`readonly`,t=>t.get(e.identity.sha256));if(!s||!L(s)||s.sha256!==e.identity.sha256||s.bytes>Math.min(t.maxBytes,t.maxEntryBytes)||e.identity.bytes!==void 0&&e.identity.bytes!==s.bytes||e.identity.validationKey!==void 0&&!s.references.some(t=>t.url===e.identity.url&&t.validationKey===e.identity.validationKey))return;let c=await i.match(A(t,e.identity.sha256));if(!c){if(!r)return n;await P(a,`readwrite`,e=>e.delete(s.sha256));return}let l;try{l=await B(c,Math.min(s.bytes,t.maxBytes,t.maxEntryBytes),o),await M(_({asset:e.identity.url,bytes:l,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes??s.bytes}}),o)}catch{if(E(o),!r)return n;await z(i,a,t,s);return}E(e.signal);try{await P(a,`readwrite`,n=>{let r=n.get(s.sha256);return r.onsuccess=()=>{try{let i=r.result;if(!i||!L(i))return;I(i,e.identity,t),n.put(i)}catch{try{n.transaction.abort()}catch{}}},r})}catch{}return l},i=await F(t,e.signal,r(!1),`shared`);if(i!==n)return i;let a=await F(t,e.signal,r(!0));return a===n?void 0:a}async function ie(e){e={...e,identity:O(e.identity)};let t=w(e.cache);if(E(e.signal),!t.enabled||!j(t)||e.bytes.byteLength>Math.min(t.maxBytes,t.maxEntryBytes))return!1;let n=Uint8Array.from(e.bytes);return await _({asset:e.identity.url,bytes:n,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes}}),E(e.signal),await F(t,e.signal,async(r,i)=>{let a=await R(i),o=new Set(a.map(e=>A(t,e.sha256)));for(let e of await r.keys())o.has(e.url)||await r.delete(e);let s=a.find(t=>t.sha256===e.identity.sha256),c=s??{sha256:e.identity.sha256,bytes:n.byteLength,lastUsed:0,references:[]};if(c.bytes!==n.byteLength||(I(c,e.identity,t),!await ne(r,i,t,a,s?0:n.byteLength,+!s,c.sha256)))return!1;E(e.signal),await r.put(A(t,c.sha256),new Response(n,{headers:{"Content-Type":`application/octet-stream`,"Content-Length":String(n.byteLength)}}));try{await P(i,`readwrite`,e=>e.put(c))}catch(e){throw s||await r.delete(A(t,c.sha256)),e}return!0})??!1}const ae=new TextDecoder(`utf-8`,{fatal:!0}),oe=/^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:whl|tar|zip)$/u;function se(e){let t;try{t=JSON.parse(ae.decode(e))}catch{throw new h(`Python runtime lock file is not valid UTF-8 JSON`,{phase:`asset`,runtimeId:`python`})}if(typeof t!=`object`||!t||!(`packages`in t)||typeof t.packages!=`object`||t.packages===null||Array.isArray(t.packages))throw new h(`Python runtime lock file has an invalid packages map`,{phase:`asset`,runtimeId:`python`});let n=Object.values(t.packages);if(n.length>4096)throw new h(`Python runtime lock file has too many package assets`,{phase:`asset`,runtimeId:`python`});let r=/* @__PURE__ */ new Set;for(let e of n){if(typeof e!=`object`||!e||!(`file_name`in e))throw new h(`Python runtime lock file has an invalid package entry`,{phase:`asset`,runtimeId:`python`});let t=e.file_name;if(typeof t!=`string`||t.length>1024||!oe.test(t))throw new h(`Python runtime lock file has an unsafe package asset name`,{phase:`asset`,runtimeId:`python`});r.add(t)}return{lock:t,packageAssets:r}}const ce=Object.freeze([Object.freeze({fileName:`apecode-0.1.0-py3-none-any.whl`,bytes:7484,sha256:`30aecb8eeff9a40cd55bb5fe5c18104f6c8308bdba9e71ac0b95d077badae30c`})]),le=e=>e.byteLength>=2&&e[0]===31&&e[1]===139;async function ue(e,t,n,r){let i=e.getReader(),a=r,o=!1;if(a?.aborted){o=!0;let e=de(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}try{i.releaseLock()}catch{}throw e}let s,c=a?new Promise((e,t)=>{s=()=>{if(o)return;o=!0;let e=de(a);try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}t(e)},a.addEventListener(`abort`,s,{once:!0})}):void 0,l=new Uint8Array(Math.min(65536,n)),u=0,d=!1,f,p;try{for(fe(a);;){let e=i.read(),{done:r,value:o}=c?await Promise.race([e,c]):await e;if(fe(a),r)break;if(!o)continue;let s=u+o.byteLength;if(s>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);if(s>l.byteLength){let e=Math.min(n,Math.max(s,Math.max(l.byteLength*2,1))),t=new Uint8Array(e);t.set(l.subarray(0,u)),l=t}l.set(o,u),u=s}fe(a),f=l.subarray(0,u),d=!0}catch(e){if(a?.aborted)throw de(a);if(!o){o=!0;try{Promise.resolve(i.cancel(e)).catch(()=>{})}catch{}}throw e}finally{s&&a?.removeEventListener(`abort`,s);try{i.releaseLock()}catch(e){d&&(p={error:e})}}if(p)throw p.error;return f}function de(e){return e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`)}function fe(e){if(e?.aborted)throw de(e)}async function pe(e,t=`runtime asset`,n=134217728,r){if(!Number.isSafeInteger(n)||n<0)throw Error(`Runtime asset decompression limit must be a non-negative safe integer`);if(fe(r),!le(e)){if(e.byteLength>n)throw Error(`Runtime asset ${t} decompressed size exceeds the ${n} byte limit`);return e}if(typeof DecompressionStream!=`function`)throw Error(`Failed to decompress runtime asset ${t}: DecompressionStream('gzip') is unavailable`);try{let i=Uint8Array.from(e),a=new ReadableStream({start(e){e.enqueue(i),e.close()}}),o=new DecompressionStream(`gzip`);return await ue(a.pipeThrough({readable:o.readable,writable:o.writable}),t,n,r)}catch(e){throw r?.aborted?de(r):Error(`Failed to decompress runtime asset ${t}: ${e instanceof Error?e.message:String(e)}`)}}const V=e=>e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`),me=(e,t)=>{try{Promise.resolve(e.cancel(t)).catch(()=>void 0)}catch{}};async function he(e,{asset:t,maxAssetBytes:n,total:r,signal:i,onProgress:a}){let o=()=>/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${n} byte limit`);try{if(!Number.isSafeInteger(n)||n<=0)throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);if(r!==void 0&&(!Number.isSafeInteger(r)||r<0))throw TypeError(`Runtime asset total must be a non-negative safe integer`);if(r!==void 0&&r>n)throw o();if(i?.aborted)throw V(i)}catch(t){throw e.body&&me(e.body,t),t}let s=e.headers.get(`content-type`),c={status:200,headers:s?{"Content-Type":s}:void 0};if(!e.body){let t,s=i?new Promise((e,n)=>{t=()=>n(V(i)),i.addEventListener(`abort`,t,{once:!0})}):void 0;try{let t=e.arrayBuffer(),l=s?await Promise.race([t,s]):await t;if(i?.aborted)throw V(i);if(l.byteLength>n)throw o();if(a?.(l.byteLength,r??l.byteLength),i?.aborted)throw V(i);return new Response(l,c)}finally{t&&i?.removeEventListener(`abort`,t)}}let l=e.body.getReader(),u=!1,d=!1,f=0,p,m=()=>{d||(d=!0,l.releaseLock())},h=()=>i?.removeEventListener(`abort`,v),g=e=>{if(!u){u=!0,h(),me(l,e);try{m()}catch{}}},_=e=>{u||(g(e),p.error(e))},v=()=>{i&&_(V(i))},y=new ReadableStream({start(e){p=e,i?.addEventListener(`abort`,v,{once:!0}),i?.aborted&&v()},async pull(e){if(!u)try{let{done:t,value:s}=await l.read();if(u)return;if(i?.aborted)throw V(i);if(t){if(m(),a?.(f,r??f),u)return;u=!0,h(),e.close();return}if(!s)return;let c=f+s.byteLength;if(!Number.isSafeInteger(c)||c>n)throw o();f=c,a?.(f,r),u||e.enqueue(s)}catch(e){_(i?.aborted?V(i):e)}},cancel(e){g(e)}},{highWaterMark:0});return new Response(y,c)}const ge=new TextDecoder,_e=/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u,ve=globalThis.fetch.bind(globalThis),ye=globalThis.XMLHttpRequest;let H=null,U=null,be=/* @__PURE__ */ new Map,xe=!1,Se=0;const Ce=/* @__PURE__ */ new Map,W=/* @__PURE__ */ new Map,G=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},we=()=>{if(!H)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(H.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${H.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${H.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${H.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},Te=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},K=e=>{let t=we();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},Ee=e=>{if(!U)return!1;let t;try{t=new URL(e)}catch{return!1}return t.protocol===U.protocol&&t.origin===U.origin&&t.pathname.startsWith(U.pathname)},De=e=>{let t=we();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)?null:be.get(n.href)||(Ee(n.href)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`)},Oe=e=>De(e)!==null,ke=async e=>{let t=++Se;return await new Promise((n,r)=>{Ce.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},Ae=async(e,t,n,r)=>{let i=K(e);if(!i||De(i)!==t||!H)throw Error(`Untracked runtime asset request`);let a=H.maxAssetBytes??134217728;r?.throwIfAborted();let o=await ve(i,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,...n?{integrity:n}:{},...r?{signal:r}:{}});if(r?.aborted&&(G(o,r.reason),r.throwIfAborted()),o.url){let e;try{e=new URL(o.url)}catch{let e=/* @__PURE__ */ Error(`Runtime asset response URL is invalid: ${o.url}`);throw G(o,e),e}if(e.href!==i){let t=/* @__PURE__ */ Error(`Runtime asset response URL mismatch: expected ${i}, received ${e.href}`);throw G(o,t),t}}if(!o.ok){let e=/* @__PURE__ */ Error(`Failed to load ${t}: ${o.status}`);throw G(o,e),e}let s=o.headers.get(`content-length`),c;if(s!==null){let e=Number(s);if(!/^\d+$/u.test(s.trim())||!Number.isSafeInteger(e)){let e=/* @__PURE__ */ Error(`Runtime asset ${t} has an invalid Content-Length`);throw G(o,e),e}c=e||void 0}if(c!==void 0&&c>a){let e=/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${a} byte limit`);throw G(o,e),e}let l=o.headers.get(`content-type`)||void 0;return{response:o,maxAssetBytes:a,total:c,mimeType:l}},je=async(e,t,n)=>{let{response:r,maxAssetBytes:i,total:a,mimeType:o}=await Ae(e,t,n);if(!r.body){let e=new Uint8Array(await r.arrayBuffer());if(e.byteLength>i)throw Error(`Runtime asset ${t} exceeds the ${i} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:a??e.byteLength}}),{bytes:e,mimeType:o}}let s=r.body.getReader(),c=!1,l=e=>{if(!c){c=!0;try{Promise.resolve(s.cancel(e)).catch(()=>void 0)}catch{}}},u=0,d,f;try{for(d=new Uint8Array(a||Math.min(65536,i));;){let{done:e,value:n}=await s.read();if(e)break;if(!n)continue;let r=u+n.byteLength;if(r>i){let e=/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw l(e),e}if(r>d.byteLength){let e=Math.min(i,Math.max(r,d.byteLength*2)),t=new Uint8Array(e);t.set(d.subarray(0,u)),d=t}d.set(n,u),u=r,self.postMessage({assetProgress:{asset:t,loaded:u,total:a}})}}catch(e){throw l(e),e}finally{try{s.releaseLock()}catch(e){f={error:e}}}if(f)throw f.error;return u!==d.byteLength&&(d=d.slice(0,u)),self.postMessage({assetProgress:{asset:t,loaded:u,total:a??u}}),{bytes:d,mimeType:o}};async function Me(e,t){let n=De(e);if(!n||!H)throw Error(`Untracked runtime asset request`);return H.useAssetBridge?await ke(n):await je(e,n,t)}function Ne(e){return new Response(Te(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function Pe(){if(ye===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=K(t);if(!n||!Oe(n)){if(n&&Ee(n))throw Error(`Untracked runtime asset request`);let r=n||(t instanceof URL?t.href:String(t));this.native=new ye,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await Me(this.url),t=Te(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=ge.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function Fe(){xe||(xe=!0,globalThis.fetch=(async(e,t)=>{let n=K(e);if(!n||!Oe(n)){if(n&&Ee(n))throw Error(`Untracked runtime asset request`);return ve(e,t)}let r=typeof Request<`u`&&e instanceof Request?e:void 0,i=t?.integrity??r?.integrity,a=typeof i==`string`?i:void 0,o=(t?.method??r?.method??`GET`).toUpperCase();if(H?.useAssetBridge===!1&&o===`GET`&&new URL(n).pathname.endsWith(`.wasm`)){let e=De(n),i=(t?.signal===void 0?r?.signal:t.signal)??void 0,{response:o,maxAssetBytes:s,total:c}=await Ae(n,e,a,i);return he(o,{asset:e,maxAssetBytes:s,total:c,signal:i,onProgress:(t,n)=>self.postMessage({assetProgress:{asset:e,loaded:t,total:n}})})}return Ne(await Me(n,a))}),Pe())}function Ie(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);for(let e of W.values())e.reject(/* @__PURE__ */ Error(`Runtime module configuration changed`));W.clear(),U=null,be=/* @__PURE__ */ new Map,H=e,Fe()}function Le(e){if(!H)throw Error(`Runtime asset config unavailable`);if(H.useAssetBridge)throw Error(`Direct runtime asset allowlists require direct asset loading`);if(e===null){U=null,be=/* @__PURE__ */ new Map;return}if(!Array.isArray(e.assets))throw TypeError(`Direct runtime asset allowlist must be an array`);if(e.assets.length>4096)throw Error(`Direct runtime asset allowlist has too many entries`);let t=e.runtimeAssets??[];if(!Array.isArray(t))throw TypeError(`Direct core runtime asset allowlist must be an array`);if(t.length>64)throw Error(`Direct core runtime asset allowlist has too many entries`);let n;try{n=new URL(e.baseUrl)}catch{throw Error(`Direct runtime asset base URL is invalid: ${e.baseUrl}`)}if(n.protocol!==`http:`&&n.protocol!==`https:`)throw Error(`Direct runtime asset base URL must use HTTP(S): ${e.baseUrl}`);if(n.username||n.password||n.hash||n.search)throw Error(`Direct runtime asset base URL must not include credentials, a query, or a fragment: ${e.baseUrl}`);n.pathname.endsWith(`/`)||(n.pathname+=`/`);let r=(e,t,n)=>{for(let r of t){if(typeof r!=`string`||r.length>1024||!_e.test(r))throw Error(`Direct runtime asset name is unsafe: ${String(r)}`);e.set(new URL(r,n).href,r)}},i=/* @__PURE__ */ new Map;r(i,e.assets,n);let a=we();if(!a)throw Error(`Runtime asset config unavailable`);r(i,t,a),U=n,be=i}function Re(e){let t=e?.assetResponse;if(!t)return!1;let n=W.get(t.id);if(n)return W.delete(t.id),t.ok?t.module instanceof WebAssembly.Module?n.resolve(t.module):n.reject(/* @__PURE__ */ Error(`Runtime module response is invalid`)):n.reject(Error(t.error||`Runtime module request failed`)),!0;let r=Ce.get(t.id);return!r||(Ce.delete(t.id),t.ok?(r.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(r.reject(Error(t.error||`Runtime asset request failed`)),!0))}async function ze(e){if(!H)throw Error(`Runtime asset config unavailable`);let t=K(e);if(!t||!Oe(t))throw Error(`Untracked runtime asset request`);return await Me(t)}function Be(){return H?.useAssetBridge===!0||H?.useModuleBridge===!0}async function Ve(e){if(!Be())throw Error(`Runtime module bridge unavailable`);let t=K(e);if(!t||!Oe(t))throw Error(`Untracked runtime module request`);let n=++Se;return await new Promise((t,r)=>{W.set(n,{resolve:t,reject:r});try{self.postMessage({assetRequest:{id:n,asset:e,module:!0}})}catch(e){W.delete(n),r(e)}})}async function He(e){if(Be())return await Ve(e);let{bytes:t}=await ze(e),n=t[0]===31&&t[1]===139?await pe(t):t;return await WebAssembly.compile(n.slice().buffer)}async function Ue(e,t,n={}){let r=new URL(`pyodide.asm.wasm`,e).href,i=new URL(`python_stdlib.zip`,e).href,a=n.module??He(`pyodide.asm.wasm`),o=a.then(()=>new Promise(()=>{}));o.catch(()=>void 0);let s=n.standardLibrary,c=globalThis.fetch,l=WebAssembly.instantiateStreaming,u=/* @__PURE__ */ new WeakSet,d=async(t,n)=>{let a=t instanceof Request?t.url:new URL(String(t),e).href;if(s&&a===i)return new Response(s,{headers:{"content-type":`application/zip`}});if(a!==r)return await c(t,n);let o=new Response(null,{headers:{"content-type":`application/wasm`}});return u.add(o),o},f=async(e,t)=>{let n=await e;if(!u.has(n))return await l(n,t);let r=await a;return{module:r,instance:await WebAssembly.instantiate(r,t)}};globalThis.fetch=d,WebAssembly.instantiateStreaming=f;try{let e=t();return e.catch(()=>void 0),await Promise.race([e,o])}finally{globalThis.fetch===d&&(globalThis.fetch=c),WebAssembly.instantiateStreaming===f&&(WebAssembly.instantiateStreaming=l)}}const We=268435456,Ge=e=>Array.from(new Uint8Array(e),e=>e.toString(16).padStart(2,`0`)).join(``);async function Ke(e,t){let n=async e=>Ge(await crypto.subtle.digest(`SHA-256`,Uint8Array.from(e)));return JSON.stringify([`wasm-idle-pyodide-memory-snapshot-v1`,e,await n(t.entry),await n(t.emscripten),await n(t.standardLibrary)])}async function qe(e,t){let n=e.getReader(),r=[],i=0;try{for(;;){let{done:e,value:a}=await n.read();if(e)break;if(i+=a.byteLength,i>t)throw Error(`Python snapshot exceeds its size limit`);r.push(a)}}catch(e){throw n.cancel(e).catch(()=>void 0),e}let a=new Uint8Array(i),o=0;for(let e of r)a.set(e,o),o+=e.byteLength;return a}async function Je(e,t){if(typeof DecompressionStream!=`function`)return;let n=await e.read(t).catch(()=>void 0);if(n?.byteLength)try{let e=await qe(new Response(n).body.pipeThrough(new DecompressionStream(`gzip`)),We);return e.byteLength?e:void 0}catch{await e.remove(t).catch(()=>void 0);return}}async function Ye(e,t,n){if(typeof CompressionStream!=`function`||!n.byteLength||n.byteLength>268435456)return!1;let r=await qe(new Response(n).body.pipeThrough(new CompressionStream(`gzip`)),We);return await e.write(t,r).catch(()=>!1)}const Xe=String.raw`
def __wasm_idle_make_execution_helpers(image_source, max_entries=8, max_bytes=4194304,
                                        max_import_entries=32, max_import_bytes=2097152):
    import ast
    import builtins
    import inspect
    import marshal
    import os
    import sys
    import types
    from collections import OrderedDict
    from pyodide.code import find_imports

    compile_source = builtins.compile
    evaluate = builtins.eval
    execute = builtins.exec
    image_scope = globals()
    image_code = compile_source(image_source, "<wasm-idle-image-hook>", "exec", dont_inherit=True)
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT

    class BoundedCache:
        def __init__(self, entries, budget):
            self.entries, self.budget = max(0, entries), max(0, budget)
            self.values = OrderedDict()
            self.bytes = self.hits = self.misses = 0

        def get(self, key):
            entry = self.values.get(key)
            if entry is None:
                self.misses += 1
                return None
            self.values.move_to_end(key)
            self.hits += 1
            return entry[0]

        def put(self, key, value, weight):
            old = self.values.pop(key, None)
            if old is not None:
                self.bytes -= old[1]
            if self.entries == 0 or weight > self.budget:
                return
            while self.values and (len(self.values) >= self.entries or self.bytes + weight > self.budget):
                _, (_, size) = self.values.popitem(last=False)
                self.bytes -= size
            self.values[key] = (value, weight)
            self.bytes += weight

        def info(self):
            return {"entries": len(self.values), "accountedBytes": self.bytes,
                    "hits": self.hits, "misses": self.misses}

    code_cache = BoundedCache(max_entries, max_bytes)
    import_cache = BoundedCache(max_import_entries, max_import_bytes)

    def imports(source):
        cached = import_cache.get(source)
        if cached is not None:
            return cached
        # Use Pyodide's parser, including its syntax-error and dotted-import behavior.
        stub = "\n".join("import " + name for name in find_imports(source))
        import_cache.put(source, stub, sys.getsizeof(source) + sys.getsizeof(stub))
        return stub

    async def run(source, filename, ready, input_bridge=None, output_bridge=None):
        previous_input, previous_print = builtins.input, builtins.print
        missing_main = object()
        previous_main = sys.modules.get("__main__", missing_main)
        previous_path = sys.path
        def input_wrapper(prompt=""):
            value = input_bridge(prompt)
            if value is None:
                raise EOFError
            if value.endswith("\r\n"):
                return value[:-2]
            if value.endswith("\n") or value.endswith("\r"):
                return value[:-1]
            return value
        # Native streams remain installed by the worker. Explicit bridges are
        # retained for callers that supply them, without overriding native I/O.
        if input_bridge is not None:
            builtins.input = input_wrapper
        if output_bridge is not None:
            builtins.print = output_bridge
        try:
            # Execute the original guard in the same namespace as the legacy debug/Hy path.
            # The fixed image hook is compiled only once, not parsed with every user run.
            execute(image_code, image_scope, image_scope)
            key = (source, filename, flags, -1)
            compiled = code_cache.get(key)
            if compiled is None:
                compiled = compile_source(source, filename, "exec", flags=flags, dont_inherit=True)
                # This budget accounts source strings and serialized code, not total Wasm heap.
                weight = sys.getsizeof(source) + sys.getsizeof(filename) + len(marshal.dumps(compiled))
                code_cache.put(key, compiled, weight)
            main_module = types.ModuleType("__main__")
            main_module.__file__ = filename
            scope = main_module.__dict__
            sys.modules["__main__"] = main_module
            # Script siblings take precedence; shared workspace-root modules follow.
            run_paths = list(dict.fromkeys((os.path.dirname(os.path.abspath(filename)), os.getcwd())))
            sys.path = run_paths + [path for path in previous_path if path not in run_paths]
            ready()
            result = evaluate(compiled, scope, scope)
            if inspect.isawaitable(result):
                await result
        finally:
            sys.path = previous_path
            if previous_main is missing_main:
                sys.modules.pop("__main__", None)
            else:
                sys.modules["__main__"] = previous_main
            sys.settrace(None)
            builtins.input, builtins.print = previous_input, previous_print

    return {"run": run, "imports": imports,
            "info": lambda: {"code": code_cache.info(), "imports": import_cache.info()}}

__wasm_idle_make_execution_helpers
`;function Ze(e,t){let n=e.runPython(Xe),r;try{r=n(t)}finally{n.destroy()}let i,a,o;try{i=r.get(`run`),a=r.get(`imports`),o=e.runPython(`dict`)}catch(e){throw i?.destroy(),a?.destroy(),o?.destroy(),e}finally{r.destroy()}let s=!1,c=()=>{if(s)throw Error(`Python execution helpers are disposed`)};return{importSource(e){return c(),String(a(e))},async run(t,n,r,a,s){c();let l=o();try{l.set(`runner`,i),l.set(`source`,t),l.set(`filename`,n),l.set(`ready`,r),a&&l.set(`input_bridge`,a),s&&l.set(`output_bridge`,s);let o=a||s?`await runner(source, filename, ready, ${a?`input_bridge`:`None`}, ${s?`output_bridge`:`None`})`:`await runner(source, filename, ready)`;await e.runPythonAsync(o,{globals:l})}finally{l.destroy()}},dispose(){s||(s=!0,i.destroy(),a.destroy(),o.destroy())}}}function Qe(e){let t=e.invalidationMode===void 0?`checked-hash`:e.invalidationMode;if(![`checked-hash`,`unchecked-hash`,`timestamp`,`normalized`].includes(t))throw new f(`Python invalidationMode must be checked-hash, unchecked-hash, timestamp, or normalized`);if(t!==`timestamp`){if(e.timestamp!==void 0)throw new f(`Python timestamp requires timestamp invalidation mode`);return{invalidationMode:t,timestamp:void 0}}let n=e.timestamp===void 0?0:e.timestamp;if(!Number.isInteger(n)||n<0||n>4294967295)throw new f(`Python timestamp must be an integer Unix time from 0 to 4294967295 seconds`);return{invalidationMode:t,timestamp:n}}const $e=String.raw`
def compile_bytecode(source, filename, optimization, byte_limit, invalidation_mode, timestamp):
    import codecs
    import importlib.util
    import io
    import os
    import platform
    import py_compile
    import sys
    import tempfile
    import tokenize

    source_text = source.removeprefix("\ufeff")
    encoding = "utf-8"
    # Read only the coding-cookie metadata. detect_encoding also validates
    # header bytes, which do not yet exist in the declared encoding.
    # Universal newlines apply only to this scan, preserving the source hash.
    with io.StringIO(source_text, newline=None) as lines:
        for _ in range(2):
            header = lines.readline().encode("ascii", "replace")
            cookie = tokenize.cookie_re.match(header)
            if cookie:
                encoding = tokenize._get_normal_name(cookie.group(1).decode("ascii"))
                try:
                    codecs.lookup(encoding)
                except LookupError:
                    raise SyntaxError("unknown encoding: " + encoding) from None
                break
            if not tokenize.blank_re.match(header):
                break
    if source.startswith("\ufeff"):
        if encoding != "utf-8":
            raise SyntaxError("encoding problem: utf-8")
        encoding = "utf-8-sig"
    # Encode the original text; py_compile validates the actual source bytes.
    encoded_source = source_text.encode(encoding)
    mode = {
        "checked-hash": py_compile.PycInvalidationMode.CHECKED_HASH,
        "unchecked-hash": py_compile.PycInvalidationMode.UNCHECKED_HASH,
        "timestamp": py_compile.PycInvalidationMode.TIMESTAMP,
        "normalized": py_compile.PycInvalidationMode.CHECKED_HASH,
    }[invalidation_mode]

    with tempfile.TemporaryDirectory(prefix="wasm-idle-pyc-") as directory:
        source_path = os.path.join(directory, "main.py")
        output_path = os.path.join(directory, "output.pyc")
        with open(source_path, "wb") as source_file:
            source_file.write(encoded_source)
        if invalidation_mode == "timestamp":
            os.utime(source_path, (timestamp, timestamp))
        py_compile.compile(
            source_path,
            cfile=output_path,
            dfile=filename,
            doraise=True,
            optimize=optimization,
            invalidation_mode=mode,
        )
        size = os.path.getsize(output_path)
        if size > byte_limit:
            return {"byteLimitExceeded": size}
        with open(output_path, "rb") as output_file:
            data = output_file.read()
    if invalidation_mode == "normalized":
        # Preserve the runtime magic and complete code object, but remove the
        # source hash, flags, timestamp and source size for source-free artifacts.
        data = data[:4] + bytes(12) + data[16:]
    return {
        "data": data,
        "pythonVersion": platform.python_version(),
        "cacheTag": sys.implementation.cache_tag,
        "magicNumber": importlib.util.MAGIC_NUMBER.hex(),
    }

compile_bytecode(source, filename, optimization, byte_limit, invalidation_mode, timestamp)
`;function et(e,t,n,r,i,a={}){if(typeof t!=`string`)throw TypeError(`Python source must be a string`);if(typeof n!=`string`||!/\.py$/i.test(n))throw TypeError(`Python source file name must end in .py`);if(![0,1,2].includes(r))throw TypeError(`Python optimization must be 0, 1, or 2`);if(!Number.isSafeInteger(i)||i<=0)throw TypeError(`Python artifact byte limit must be a positive safe integer`);let{invalidationMode:o,timestamp:s}=Qe(a),c=e.toPy({source:t,filename:n,optimization:r,byte_limit:i,invalidation_mode:o,timestamp:s??0});try{let t=e.runPython($e,{globals:c});try{let e=t.toJs({dict_converter:Object.fromEntries,create_pyproxies:!1});if(`byteLimitExceeded`in e)throw new m(`Python bytecode is ${e.byteLimitExceeded} bytes; limit is ${i}`,{runtimeId:`PYTHON3`,phase:`compile`,actual:e.byteLimitExceeded,limit:i});return{...e,path:n.replace(/\.py$/i,`.pyc`),data:Uint8Array.from(e.data)}}finally{t.destroy()}}finally{c.destroy()}}const tt=String.raw`
def __wasm_idle_make_workspace_imports():
    import importlib
    import importlib.machinery
    import importlib.util
    import json
    import os
    import sys

    previous_sources = set()
    previous_paths = set()
    imported_modules = {}
    imported_cache_paths = set()

    class WorkspaceLoader:
        def __init__(self, loader, cache_path):
            self.loader = loader
            self.cache_path = cache_path

        def create_module(self, spec):
            return self.loader.create_module(spec)

        def exec_module(self, module):
            # Remember ownership before user code can remove or retarget its
            # alias, including code executing inside the imported module.
            imported_modules[id(module)] = module
            if self.cache_path is not None:
                imported_cache_paths.add(self.cache_path)
            return self.loader.exec_module(module)

        def __getattr__(self, name):
            return getattr(self.loader, name)

    class WorkspaceFinder:
        def find_spec(self, fullname, path=None, target=None):
            spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
            if spec is None or not isinstance(spec.loader, (
                importlib.machinery.SourceFileLoader,
                importlib.machinery.SourcelessFileLoader,
            )):
                return spec
            filename = spec.origin
            if not isinstance(filename, str):
                return spec
            if filename.endswith(".pyc"):
                try:
                    filename = importlib.util.source_from_cache(filename)
                except ValueError:
                    return spec
            filename = os.path.abspath(filename)
            if filename in previous_sources or os.path.realpath(filename) in previous_paths:
                # Resolve the cache while the alias still names this source.
                # Resolving it at cleanup could delete another directory's cache.
                cache_path = os.path.realpath(spec.cached) if spec.cached else None
                spec.loader = WorkspaceLoader(spec.loader, cache_path)
            return spec

    # Preserve custom finders ahead of normal filesystem imports. The wrapper
    # delegates the standard file loader's resource and source APIs unchanged.
    for index, finder in enumerate(sys.meta_path):
        if finder is importlib.machinery.PathFinder:
            sys.meta_path.insert(index, WorkspaceFinder())
            break

    def invalidate(paths_json):
        nonlocal previous_sources, previous_paths
        current_sources = {os.path.abspath(path) for path in json.loads(paths_json)}
        current_paths = {os.path.realpath(path) for path in current_sources}
        # Retain both identities so a removed or renamed supplied symlink still
        # owns its lexical imports and the physical source it pointed to.
        workspace_sources = previous_sources | current_sources
        workspace_paths = previous_paths | current_paths
        cache_sources = workspace_sources | workspace_paths
        # Only modules backed by supplied workspace files belong to this run.
        # Keep interpreter, standard-library and installed-package state intact.
        for name, module in list(sys.modules.items()):
            if module is None or imported_modules.get(id(module)) is not module:
                filename = getattr(module, "__file__", None)
                if not isinstance(filename, str):
                    continue
                if filename.endswith(".pyc"):
                    try:
                        filename = importlib.util.source_from_cache(filename)
                    except ValueError:
                        continue
                filename = os.path.abspath(filename)
                if filename not in workspace_sources and os.path.realpath(filename) not in workspace_paths:
                    continue
                # Handle modules loaded before this workspace boundary as well.
                cache_sources.add(filename)
            sys.modules.pop(name, None)
            parent_name, _, child_name = name.rpartition(".")
            parent = sys.modules.get(parent_name)
            if parent is not None and getattr(parent, child_name, None) is module:
                delattr(parent, child_name)
        # Rewrites can have the same size and timestamp; invalidate their bytecode,
        # too, so removing sys.modules cannot reload an obsolete cached source.
        cache_paths = imported_cache_paths | {
            importlib.util.cache_from_source(filename)
            for filename in cache_sources if filename.endswith(".py")
        }
        for cache_path in cache_paths:
            try:
                os.unlink(cache_path)
            except (FileNotFoundError, NotADirectoryError):
                # Python imports also tolerate an unavailable cache parent.
                pass
        importlib.invalidate_caches()
        imported_modules.clear()
        imported_cache_paths.clear()
        previous_sources = current_sources
        previous_paths = current_paths

    return invalidate

__wasm_idle_make_workspace_imports
`;function nt(e){let t=e.runPython(tt),n;try{n=t()}finally{t.destroy()}return e=>n(JSON.stringify(e))}function rt(e){let t=e,n=/* @__PURE__ */ new Set;return r=>{let i=e.cwd().replace(/\/$/,``),a=new Set(r.map(e=>`${i}/${e.path}`));for(let r of n)a.has(r)||(t.analyzePath(r).exists&&!e.isDir(e.lstat(r).mode)&&e.unlink(r),n.delete(r));for(let a of r){let r=a.path.split(`/`).slice(0,-1).join(`/`);r&&t.mkdirTree(r),e.writeFile(a.path,a.content),n.add(`${i}/${a.path}`)}}}const it=String.raw`
def __wasm_idle_debug_preview(value, depth = 0):
    if depth >= 2:
        return "..."
    kind = type(value)
    if value is None:
        return "None"
    if kind is bool:
        return "True" if value else "False"
    if kind is int:
        bits = value.bit_length()
        return repr(value) if bits <= 256 else "<int: " + str(bits) + " bits>"
    if kind in (float, complex):
        return repr(value)
    if kind in (bytes, bytearray, str):
        prefix = value[:32]
        text = repr(bytes(prefix) if kind is bytearray else prefix)
        if len(value) > 32:
            text += "..."
        return text if len(text) <= 80 else text[:77] + "..."
    if kind in (list, tuple):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        if kind is tuple:
            if len(value) == 1:
                return "(" + items[0] + ",)"
            return "(" + ", ".join(items) + ")"
        return "[" + ", ".join(items) + "]"
    if kind is dict:
        from itertools import islice
        items = [__wasm_idle_debug_preview(key, depth + 1) + ": " + __wasm_idle_debug_preview(item, depth + 1)
                 for key, item in islice(value.items(), 6)]
        if len(value) > 6:
            items.append("...")
        return "{" + ", ".join(items) + "}"
    if kind in (set, frozenset):
        from itertools import islice
        if not value:
            return "set()" if kind is set else "frozenset()"
        # Set iteration order is intentionally retained: sorting would inspect every element.
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in islice(value, 6)]
        if len(value) > 6:
            items.append("...")
        text = "{" + ", ".join(items) + "}"
        return text if kind is set else "frozenset(" + text + ")"
    # Automatic locals must not execute arbitrary user __repr__/container overrides.
    # Explicit watch expressions remain available for user-requested evaluation.
    try:
        name = type.__getattribute__(kind, "__name__")[:64]
        return "<" + name + " object>"
    except Exception:
        return "<object>"
`,at=String.raw`
import os as __wasm_idle_debug_os

__wasm_idle_debug_breakpoint_state = __wasm_idle_debug_bridge.state

# Direct compilation uses relative paths; imported modules use absolute paths.
# Capture both identities before user code can change the working directory.
__wasm_idle_debug_source_filenames = {
    __wasm_idle_debug_filename,
    __wasm_idle_debug_os.path.abspath(__wasm_idle_debug_filename),
}
__wasm_idle_debug_breakpoints = set(json.loads(__wasm_idle_debug_breakpoints_json))
__wasm_idle_debug_breakpoint_version = -1
__wasm_idle_debug_pause_on_entry = __wasm_idle_debug_initial_pause
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_refresh_breakpoints():
    global __wasm_idle_debug_breakpoints
    global __wasm_idle_debug_breakpoint_version
    if __wasm_idle_debug_breakpoint_state.version == __wasm_idle_debug_breakpoint_version:
        return
    payload = __wasm_idle_debug_bridge.readBreakpoints(__wasm_idle_debug_breakpoint_version)
    # JavaScript null crosses Pyodide as JsNull rather than Python None.
    if not isinstance(payload, str):
        return
    snapshot = json.loads(payload)
    version = int(snapshot.get("version", -1))
    if version == __wasm_idle_debug_breakpoint_version:
        return
    __wasm_idle_debug_breakpoint_version = version
    __wasm_idle_debug_breakpoints = set(int(line) for line in snapshot.get("lines", []) if int(line) > 0)

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename in __wasm_idle_debug_source_filenames:
            depth += 1
        current = current.f_back
    return depth

${it}

def __wasm_idle_debug_locals(frame, start=0, count=50):
    locals_preview = []
    index = 0
    for name, value in frame.f_locals.items():
        if name == "__builtins__" or name.startswith("__wasm_idle_") or name.startswith("."):
            continue
        if index >= start:
            preview = __wasm_idle_debug_preview(value)
            if len(preview) > 200:
                preview = preview[:197] + "..."
            suffix = "… [" + str(index) + "]"
            display_name = name if len(name) <= 256 else name[:256-len(suffix)] + suffix
            locals_preview.append({"name": display_name, "value": preview})
            if len(locals_preview) >= count:
                break
        index += 1
    return locals_preview

def __wasm_idle_debug_stack(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename in __wasm_idle_debug_source_filenames:
            stack.append({"functionName": current.f_code.co_name, "line": current.f_lineno})
        current = current.f_back
    return stack

def __wasm_idle_debug_trace(frame, event, arg):
    global __wasm_idle_debug_pause_on_entry
    global __wasm_idle_debug_step_mode
    global __wasm_idle_debug_next_depth
    global __wasm_idle_debug_step_out_depth

    if frame.f_code.co_filename not in __wasm_idle_debug_source_filenames:
        return None
    if event != "line":
        return __wasm_idle_debug_trace

    # Poll atomically on every user line, but enter the snapshot helper only on change.
    if __wasm_idle_debug_breakpoint_state.version != __wasm_idle_debug_breakpoint_version:
        __wasm_idle_debug_refresh_breakpoints()
    # Returning from a trace callback executes this event; a later event on the same
    # line is another loop iteration, not a replay of the previous stop.
    needs_depth = __wasm_idle_debug_step_mode in ("next", "out")
    depth = __wasm_idle_debug_depth(frame) if needs_depth else None
    line = frame.f_lineno

    reason = None
    if __wasm_idle_debug_pause_on_entry:
        reason = "entry"
    elif line in __wasm_idle_debug_breakpoints:
        reason = "breakpoint"
    elif __wasm_idle_debug_step_mode == "step":
        reason = "step"
    elif __wasm_idle_debug_step_mode == "next" and __wasm_idle_debug_next_depth is not None and depth <= __wasm_idle_debug_next_depth:
        reason = "nextLine"
    elif __wasm_idle_debug_step_mode == "out" and __wasm_idle_debug_step_out_depth is not None and depth <= __wasm_idle_debug_step_out_depth:
        reason = "stepOut"

    if reason is None:
        return __wasm_idle_debug_trace

    if depth is None:
        depth = __wasm_idle_debug_depth(frame)
    __wasm_idle_debug_pause_on_entry = False
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_step_out_depth = None

    sys.stdout.flush()
    sys.stderr.flush()
    pause_reference = __wasm_idle_debug_bridge.pause(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = __wasm_idle_debug_bridge.wait()
        if command < 0:
            raise KeyboardInterrupt()
        if command == 6:
            try:
                request = json.loads(__wasm_idle_debug_bridge.readWatch())
                start = max(0, int(request.get("start", 0)))
                count = max(1, min(50, int(request.get("count", 50))))
                page = __wasm_idle_debug_locals(frame, start, count) if request.get("reference") == pause_reference else []
                __wasm_idle_debug_bridge.writeWatch(json.dumps(page))
            except Exception:
                __wasm_idle_debug_bridge.writeWatch("[]")
            continue
        if command != 5:
            break
        try:
            expression = __wasm_idle_debug_bridge.readWatch()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        __wasm_idle_debug_bridge.writeWatch(result)
    if command == 2:
        __wasm_idle_debug_step_mode = "step"
    elif command == 3:
        __wasm_idle_debug_step_mode = "next"
        __wasm_idle_debug_next_depth = depth
    elif command == 4:
        __wasm_idle_debug_step_mode = "out"
        __wasm_idle_debug_step_out_depth = max(0, depth - 1)
    return __wasm_idle_debug_trace

`,ot=String.raw`
def __wasm_idle_compile_debug_helpers(trace_source, image_source):
    import builtins
    import json
    import sys

    compile_source, execute = builtins.compile, builtins.exec
    trace_code = compile_source(trace_source, "<wasm-idle-debug-trace>", "exec", dont_inherit=True)
    image_code = compile_source(image_source, "<wasm-idle-image-hook>", "exec", dont_inherit=True)
    image_scope = globals()

    def make_trace(filename, breakpoints_json, pause_on_entry, bridge):
        # Keep the existing image-hook guard and namespace shared with ordinary runs.
        execute(image_code, image_scope, image_scope)
        scope = {
            "sys": sys, "json": json,
            "__wasm_idle_debug_filename": filename,
            "__wasm_idle_debug_breakpoints_json": breakpoints_json,
            "__wasm_idle_debug_initial_pause": pause_on_entry,
            "__wasm_idle_debug_bridge": bridge,
        }
        execute(trace_code, scope, scope)
        return scope["__wasm_idle_debug_trace"]

    return make_trace

__wasm_idle_compile_debug_helpers
`;function st(e,t){let n=e.runPython(ot),r;try{r=n(at,t)}finally{n.destroy()}let i=!1;return{createTrace(e,t,n,a){if(i)throw Error(`Python debug helpers are disposed`);return r(e,t,n,a)},dispose(){i||(i=!0,r.destroy())}}}function ct(e,t){let n=t.maxChars??16384,r=t.maxDelayMs??16;if(!Number.isSafeInteger(n)||n<2||!Number.isFinite(r)||r<0)throw RangeError(`Invalid Python output batch limits`);let i=t.now??(()=>performance.now()),a=[new TextDecoder(`utf-8`,{ignoreBOM:!0}),new TextDecoder(`utf-8`,{ignoreBOM:!0})],o=new TextEncoder,s=[],c=0,l=!1,u=i(),d,f=!1,p=!0,m=t.initialInput,h=typeof m==`string`,g=!1,_=/* @__PURE__ */ new Uint8Array,v=0;function y(){if(d!==void 0&&clearTimeout(d),d=void 0,u=i(),!c)return;let e=s.join(``);s.length=0,c=0,l=!0,t.emit(e)}function b(e){let t=0;for(;t<e.length;){let r=Math.min(n-c,e.length-t),i=e.charCodeAt(t+r-1),a=e.charCodeAt(t+r);if(i>=55296&&i<=56319&&a>=56320&&a<=57343&&r--,!r){y();continue}s.push(e.slice(t,t+r)),c+=r,t+=r,(c===n||s.length>=256)&&y()}c&&(!l||!p||i()-u>=r?y():d===void 0&&(d=setTimeout(y,r)))}function x(e,t){if(f)return t.length;for(let n=0;n<t.length;n+=16384)b(a[e].decode(t.subarray(n,n+16384),{stream:!0}));return t.length}function S(){if(y(),g)return null;let e;return h?(e=m??null,m=void 0):e=t.readInput(),e===null&&(g=!0),e}return e.setStdin({read:e=>{if(!e.length)return 0;for(;v===_.length;){let e=S();if(e===null)return 0;_=o.encode(e),v=0}let t=Math.min(e.length,_.length-v);return e.set(_.subarray(v,v+t)),v+=t,t},isatty:!1}),e.setStdout({write:e=>x(0,e)}),e.setStderr({write:e=>x(1,e)}),{flush:y,prompt(e=``){return b(e),S()},disableBatching(){p=!1,y()},close(){if(!f)try{b(a[0].decode()),b(a[1].decode()),y()}finally{f=!0,d!==void 0&&clearTimeout(d),d=void 0,e.setStdin({error:!0}),e.setStdout({write:e=>e.length}),e.setStderr({write:e=>e.length})}}}}const lt=String.raw`
def __wasm_idle_make_flush_installer():
    import builtins
    import sys
    original_input, original_print = builtins.input, builtins.print
    original_open = builtins.open
    stdin, stdout, stderr = sys.stdin, sys.stdout, sys.stderr
    output_configurations = [
        {name: getattr(stream, name) for name in
         ("encoding", "errors", "line_buffering", "write_through") if hasattr(stream, name)}
        for stream in (stdout, stderr)
    ]

    def recover_output(stream, descriptor, configuration):
        # Native stdio descriptors belong to the runtime. A closed Python wrapper
        # can be replaced without closing or replacing the underlying descriptor.
        if stream.closed:
            stream = original_open(descriptor, "w", buffering=1, closefd=False,
                                   encoding=configuration.get("encoding", "utf-8"),
                                   errors=configuration.get("errors", "strict"))
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            # Native runtime text streams start with the platform newline policy.
            reconfigure(newline=None, **configuration)
        return stream

    def install(drain):
        builtins.input, builtins.print = original_input, original_print
        # setStdin changes the device callback, but Python's buffered reader can
        # still contain bytes from the previous run. Give each run its own reader.
        run_stdin = original_open(0, "r", encoding=stdin.encoding, errors=stdin.errors, closefd=False)
        sys.stdin, sys.stdout, sys.stderr = run_stdin, stdout, stderr
        patches = []
        writing = [0]
        restored = [False]

        def patch(stream, name, replacement):
            namespace = vars(stream)
            patches.append((stream, name, name in namespace, namespace.get(name)))
            setattr(stream, name, replacement)

        def undo():
            nonlocal stdout, stderr
            for stream, name, existed, value in reversed(patches):
                if existed:
                    setattr(stream, name, value)
                else:
                    try:
                        delattr(stream, name)
                    except AttributeError:
                        pass
            try:
                run_stdin.close()
            finally:
                try:
                    previous_stdout, previous_stderr = stdout, stderr
                    stdout = recover_output(stdout, 1, output_configurations[0])
                    stderr = recover_output(stderr, 2, output_configurations[1])
                    if sys.__stdout__ is previous_stdout:
                        sys.__stdout__ = stdout
                    if sys.__stderr__ is previous_stderr:
                        sys.__stderr__ = stderr
                finally:
                    sys.stdin, sys.stdout, sys.stderr = stdin, stdout, stderr
                    builtins.input, builtins.print = original_input, original_print

        def guarded_write(original):
            def write(*args, **kwargs):
                writing[0] += 1
                try:
                    return original(*args, **kwargs)
                finally:
                    writing[0] -= 1
            return write

        def observed_flush(original):
            def flush():
                try:
                    return original()
                finally:
                    # TextIO's implicit line-buffer flush is not an explicit user flush.
                    if writing[0] == 0:
                        drain()
            return flush

        try:
            seen = set()
            for stream in (stdout, stderr):
                patch(stream, "write", guarded_write(stream.write))
                patch(stream, "writelines", guarded_write(stream.writelines))
                current = stream
                while current is not None and id(current) not in seen:
                    seen.add(id(current))
                    patch(current, "flush", observed_flush(current.flush))
                    current = getattr(current, "buffer", getattr(current, "raw", None))
        except BaseException:
            undo()
            raise

        def restore():
            if restored[0]:
                return
            restored[0] = True
            try:
                try:
                    if not stdout.closed:
                        stdout.flush()
                finally:
                    if not stderr.closed:
                        stderr.flush()
            finally:
                undo()
        return restore
    return install

__wasm_idle_flush_installer = __wasm_idle_make_flush_installer()
del __wasm_idle_make_flush_installer
__wasm_idle_flush_installer
`;function ut(e,t){let n;try{n=new URL(e)}catch{throw Error(`${t} URL is invalid: ${e}`)}if(n.protocol!==`http:`&&n.protocol!==`https:`)throw Error(`${t} URL must use HTTP(S): ${e}`);if(n.username||n.password||n.hash)throw Error(`${t} URL must not include credentials or a fragment: ${e}`);if(/%2f|%5c/iu.test(n.pathname))throw Error(`${t} URL must not include encoded path separators: ${e}`);return n}function dt(e,t){try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}}function ft(e){let t=e.reason;return t===void 0?new DOMException(`The runtime asset download was aborted`,`AbortError`):t}async function pt(e){if(!e.expected)return mt(e);let t=e.maxAssetBytes??134217728;if(!Number.isSafeInteger(t)||t<=0)throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);let n=ut(e.url,e.label).href,r=w(e.persistentCache),i={...e.expected},a=[{sha256:i.sha256,bytes:i.bytes}];i.uncompressedSha256!==void 0&&i.uncompressedBytes!==void 0&&a.push({sha256:i.uncompressedSha256,bytes:i.uncompressedBytes});let o=JSON.stringify([`worker-asset-fetch-v1`,`exact-url`,`redirect-error`,`mime-unchecked`,t]);for(let i of a){if(i.bytes!==void 0&&i.bytes>t)continue;let a=await re({identity:{url:n,...i,validationKey:o},cache:r,signal:e.signal});if(a){if(a.byteLength>t)throw Error(`${e.label} exceeds the ${t} byte limit`);if(await e.verify?.(a),e.onProgress?.({loaded:a.byteLength,total:a.byteLength}),e.signal?.aborted)throw ft(e.signal);return Uint8Array.from(a)}}let s=await mt(e),c=(s[0]!==31||s[1]!==139)&&a.length>1?a[1]:a[0];if(e.verify?await e.verify(s):await _({asset:n,...e.integrityContext,bytes:s,expected:c}),await ie({identity:{url:n,...c,validationKey:o},cache:r,signal:e.signal,bytes:s}),e.signal?.aborted)throw ft(e.signal);return s}async function mt({url:e,label:t,cache:n,maxAssetBytes:r=134217728,onProgress:i,signal:a}){if(!Number.isSafeInteger(r)||r<=0)throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);let o,s,c,l=!1,u=!1,d,f,p=a?new Promise((e,t)=>{d=t}):void 0;p&&p.catch(()=>void 0);let m=e=>{if(l)return;l=!0,o=e,s={reason:e};let t=f;f=void 0;try{t?.(e)}catch{}d?.(s)},h=()=>{if(l||u||!a)return;u=!0;let e;try{e=ft(a)}catch(t){e=t}finally{u=!1}m(e)},g=()=>{if(l)throw s;if(!a)return;let e;try{e=a.aborted}catch(e){throw l||m(e),s}if(e&&h(),l)throw s},_=!1;try{if(a){_=!0;try{a.addEventListener(`abort`,h,{once:!0})}catch(e){throw g(),e}g()}let u=ut(e,t),d={credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`};n&&(d.cache=n),a&&(d.signal=a);let m;try{m=Promise.resolve(fetch(u.href,d))}catch(e){throw g(),e}let v;try{g(),v=p?await Promise.race([m,p]):await m}catch(e){if(l&&e===s){let e=o;m.then(t=>dt(t,e),()=>void 0)}throw e}f=e=>dt(v,e),g();let y,b;try{if(v.url){let e;try{e=new URL(v.url)}catch{throw Error(`${t} response URL is invalid: ${v.url}`)}if(e.href!==u.href)throw Error(`${t} response URL mismatch: expected ${u.href}, received ${e.href}`)}if(!v.ok)throw Error(`failed to load ${t} from ${u.href}: ${v.status}`);let e=v.headers.get(`content-length`);if(e!==null){let n=e.trim(),r=Number(n);if(!/^\d+$/u.test(n)||!Number.isSafeInteger(r))throw Error(`${t} has an invalid Content-Length`);y=r}if(y!==void 0&&y>r)throw Error(`${t} exceeds the ${r} byte limit`);b=v.body}catch(e){throw g(),e}if(g(),!b){g();let e;try{e=v.arrayBuffer()}catch(e){throw g(),e}e.catch(()=>void 0),g();let n=p?await Promise.race([e,p]):await e;g();let o=new Uint8Array(n);if(o.byteLength>r)throw Error(`${t} exceeds the ${r} byte limit`);try{i?.({loaded:o.byteLength,total:y??o.byteLength})}catch(e){throw g(),e}if(g(),f=void 0,a&&_){_=!1;try{a.removeEventListener(`abort`,h)}catch{}g()}return o}let x;try{x=b.getReader()}catch(e){throw g(),e}let S=!1;f=e=>{if(!S){S=!0;try{Promise.resolve(x.cancel(e)).catch(()=>void 0)}catch{}}};let C=0,w,T;try{for(g(),w=new Uint8Array(Math.min(r,y??65536));;){g();let e;try{e=x.read()}catch(e){throw g(),e}e.catch(()=>void 0),g();let{done:n,value:a}=p?await Promise.race([e,p]):await e;if(g(),n)break;if(!a)continue;let o=C+a.byteLength;if(o>r)throw Error(`${t} exceeds the ${r} byte limit`);if(o>w.byteLength){let e=Math.min(r,Math.max(o,w.byteLength*2)),t=new Uint8Array(e);t.set(w.subarray(0,C)),w=t}w.set(a,C),C=o;try{i?.({loaded:C,total:y})}catch(e){throw g(),e}g()}}catch(e){let t=l&&e===s?o:e,n=f;f=void 0;try{n?.(t)}catch{}c={reason:t}}finally{try{x.releaseLock()}catch(e){l||(T={error:e})}}if(c)throw c;if(g(),T)throw T.error;C!==w.byteLength&&(w=w.slice(0,C));try{i?.({loaded:C,total:y??C})}catch(e){throw g(),e}if(g(),f=void 0,a&&_){_=!1;try{a.removeEventListener(`abort`,h)}catch{}g()}return w}catch(e){let t=c&&e===c?c.reason:l&&e===s?o:e,n=f;f=void 0;try{n?.(t)}catch{}throw t}finally{if(a&&_)try{a.removeEventListener(`abort`,h)}catch{}}}self.document={querySelector(){return null},querySelectorAll(){return[]}};let ht,q,gt,_t,vt,J,Y=``,yt=!1,X,Z,Q,bt,xt,St,Ct,wt,Tt,Et,Dt,Ot=0,kt;const At={hy:{label:`Hy`,readyLabel:`Compiling Hy core`,importSource:`import importlib
importlib.invalidate_caches()
import hy
import hy.compiler
hy.__version__`},aheui:{label:`Aheui`,readyLabel:`Loading Aheui interpreter`,importSource:`import importlib
importlib.invalidate_caches()
from aheui.version import VERSION
VERSION`},apecode:{label:`APECode`,readyLabel:`Loading APECode interpreter`,importSource:`import importlib
importlib.invalidate_caches()
import apecode
from apecode.cli import run_source
apecode.__version__`}},jt=/^[A-Za-z0-9][A-Za-z0-9._+-]*\.whl$/u,Mt=/^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/u;function Nt(e,t){let{label:n}=At[t],r=e;if(!r||r.language!==t||typeof r.version!=`string`||!Mt.test(r.version)||t===`apecode`&&r.version!==`0.1.0`||!Array.isArray(r.wheels)||r.wheels.length===0||r.wheels.length>8)throw Error(`${n} runtime configuration is invalid`);if(t===`apecode`&&r.wheels.length!==ce.length)throw Error(`${n} runtime wheel receipt is invalid`);let i=r.wheels.map((e,r)=>{let i=t===`apecode`?ce[r]:void 0;if(!e||typeof e.url!=`string`||typeof e.fileName!=`string`||!jt.test(e.fileName)||!Number.isSafeInteger(e.bytes)||e.bytes<=0||typeof e.sha256!=`string`||!/^[a-f0-9]{64}$/u.test(e.sha256)||i!==void 0&&(e.fileName!==i.fileName||e.bytes!==i.bytes||e.sha256!==i.sha256))throw Error(`${n} runtime wheel receipt is invalid`);return e});return{version:r.version,wheels:i}}async function Pt(e,t){let{label:n,readyLabel:r,importSource:i}=At[t],{version:a,wheels:o}=Nt(e,t),s={hy:xt,aheui:St,apecode:Ct},c=s[t];if(c===a)return;if(c!==void 0)throw Error(`${n} runtime version changed`);if(Object.entries(s).some(([e,n])=>e!==t&&n!==void 0))throw Error(`Python runtime extension language changed`);let l=String(J.runPython(`import sysconfig
sysconfig.get_path("purelib")`));for(let[e,r]of o.entries()){$(60+Math.floor(e*30/o.length),`Loading ${r.fileName}`);let i=await pt({url:new URL(r.url,globalThis.location?.href).href,label:`${n} wheel ${r.fileName}`,cache:`force-cache`,expected:{bytes:r.bytes,sha256:r.sha256},maxAssetBytes:Math.min(bt??r.bytes,r.bytes),integrityContext:{asset:r.fileName,runtimeId:t.toUpperCase()}});J.unpackArchive(i,`whl`,{extractDir:l})}$(92,r);let u=String(J.runPython(i));if(u!==a)throw Error(`${n} runtime version mismatch: expected ${a}, loaded ${u}`);t===`hy`?xt=a:t===`aheui`?St=a:Ct=a}const Ft=`
if not globals().get("__wasm_idle_img_inited__", False):
    globals()["__wasm_idle_img_inited__"] = True
    import base64, io, time
    try:
        from js import postMessage
    except Exception:
        postMessage = None
    _MAX_WIDTH = 1280
    _MAX_HEIGHT = 720
    _WEBP_QUALITY = 85
    try:
        from PIL import Image
        _RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
    except Exception:
        Image = None
        _RESAMPLE = None

    def __wasm_idle_rasterize_svg(raw):
        try:
            import cairosvg
            return cairosvg.svg2png(bytestring=raw)
        except Exception:
            return None

    def __wasm_idle_to_webp(raw):
        if Image is None or _RESAMPLE is None:
            return None
        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
            if _MAX_WIDTH > 0 and _MAX_HEIGHT > 0:
                img.thumbnail((_MAX_WIDTH, _MAX_HEIGHT), _RESAMPLE)
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "A" in img.mode else "RGB")
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=_WEBP_QUALITY, method=6)
            return buf.getvalue()
        except Exception:
            return None

    def __wasm_idle_send_img(mime, raw):
        try:
            if postMessage is None:
                return
            if raw is None:
                return
            if isinstance(raw, str):
                raw_bytes = raw.encode("utf-8")
            else:
                raw_bytes = raw
            if mime == "image/svg+xml":
                raster = __wasm_idle_rasterize_svg(raw_bytes)
                if raster:
                    raw_bytes = raster
                    mime = "image/png"
            webp = __wasm_idle_to_webp(raw_bytes)
            if webp:
                raw_bytes = webp
                mime = "image/webp"
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            ts = int(time.time() * 1000)
            postMessage({"type": "img", "data": {"mime": mime, "b64": b64, "ts": ts}})
        except Exception:
            pass

    def __wasm_idle_capture_fig(fig):
        try:
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight")
            __wasm_idle_send_img("image/png", buf.getvalue())
            buf.close()
        except Exception:
            pass

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.figure import Figure
        _orig_show = plt.show

        def _show(*args, **kwargs):
            try:
                figs = [plt.figure(num) for num in plt.get_fignums()]
                if not figs:
                    figs = [plt.gcf()]
                for fig in figs:
                    __wasm_idle_capture_fig(fig)
                plt.close("all")
            except Exception:
                pass
            try:
                return _orig_show(*args, **kwargs)
            except Exception:
                return None

        plt.show = _show

        _orig_fig_show = Figure.show

        def _fig_show(self, *args, **kwargs):
            try:
                __wasm_idle_capture_fig(self)
            except Exception:
                pass
            try:
                return _orig_fig_show(self, *args, **kwargs)
            except Exception:
                return None

        Figure.show = _fig_show
    except Exception:
        pass

    try:
        from IPython import display as _ip_display
        _orig_display = _ip_display.display

        def _display(*objs, **kwargs):
            for obj in objs:
                try:
                    if hasattr(obj, "_repr_png_"):
                        data = obj._repr_png_()
                        if data:
                            __wasm_idle_send_img("image/png", data)
                            continue
                    if hasattr(obj, "_repr_svg_"):
                        data = obj._repr_svg_()
                        if data:
                            __wasm_idle_send_img("image/svg+xml", data)
                            continue
                except Exception:
                    pass
            try:
                return _orig_display(*objs, **kwargs)
            except Exception:
                return None

        _ip_display.display = _display
    except Exception:
        pass
`,It=/^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:[A-Za-z0-9._+-]{0,64})?$/u,Lt=[`pyodide.mjs`,`pyodide.asm.mjs`,`pyodide-lock.json`,`pyodide.asm.wasm`,`python_stdlib.zip`],Rt=e=>{if(typeof e!=`string`||!It.test(e))throw Error(`Pyodide runtime version is invalid`);return new URL(`v${encodeURIComponent(e)}/full/`,`https://cdn.jsdelivr.net/pyodide/`).href};function $(e,t){self.postMessage({progress:{percent:e,stage:t}})}async function zt(e){let t=URL.createObjectURL(new Blob([e.bytes.slice().buffer],{type:e.mimeType||`text/javascript`}));try{return await import(
/* @vite-ignore */
t)}finally{URL.revokeObjectURL(t)}}async function Bt(e,t=`run`){if(J)return;let n=e.endsWith(`/`)?e:`${e}/`,r=He(`pyodide.asm.wasm`);r.catch(()=>void 0);let[i,a,o,s]=await Promise.all([ze(`pyodide.asm.mjs`),ze(`pyodide.mjs`),yt?void 0:ze(`pyodide-lock.json`),ze(`python_stdlib.zip`)]),{default:c}=await zt(i);if(typeof c!=`function`)throw Error(`Pyodide module factory is unavailable`);let l=await zt(a),u=n,d;if(!yt){if(u=Rt(l.version),!o)throw Error(`Python runtime lock file is unavailable`);let e=se(o.bytes);Le({baseUrl:u,assets:[...e.packageAssets],runtimeAssets:Lt}),d=e.lock}let{loadPyodide:f}=l,p=(t={})=>Ue(n,()=>f({indexURL:e,createPyodideModule:c,packageBaseUrl:u,...d?{lockFileContents:d}:{},...t}),{module:r,standardLibrary:s.bytes}),m=Z?await Ke(l.version,{entry:a.bytes,emscripten:i.bytes,standardLibrary:s.bytes}).catch(()=>void 0):void 0;if(t===`snapshot`){if(!m)throw Error(`Python snapshots require the persistent runtime cache`);J=await p({_makeSnapshot:!0}),Q={key:m,restored:!1};return}let h=m&&Z?await Je(Z,m):void 0,g=!1;if(m&&h)try{let e=await p({_loadSnapshot:h});if(e.runPython(`def __wasm_idle_snapshot_restored():
    globals().pop("__wasm_idle_snapshot_restored", None)
    import sys
    random = sys.modules.get("random")
    if random is not None:
        random.seed()
    time = sys.modules.get("time")
    if time is not None and hasattr(time, "tzset"):
        time.tzset()
    return 1 + 1
__wasm_idle_snapshot_restored()
`)!==2)throw Error(`Restored Python snapshot failed its self-check`);J=e,g=!0}catch{await Z?.remove(m).catch(()=>void 0)}J||=await p(),Q=m?{key:m,restored:g}:void 0,kt=J.runPython(lt)}function Vt(e){Z=e&&typeof e==`object`&&e.enabled===!0&&typeof crypto?.subtle?.digest==`function`?y(e):void 0}function Ht(){return wt??=Ze(J,Ft)}async function Ut(e,t=[]){let n=Ht(),r=[...new Set([e,...t.map(e=>e.content)].map(e=>n.importSource(e)))].filter(Boolean).join(`
`);r&&await J.loadPackagesFromImports(r)}function Wt(e,t,n=[]){return JSON.stringify([e,t??null,n.map(({path:e,content:t})=>[e,t])])}function Gt(e){return e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`)}function Kt(e=[],t=!1){let n=J.FS;if(t){let t=e.map(e=>({...e,path:Gt(e.path)})).filter(e=>e.path);Tt??=nt(J),Tt(t.map(e=>e.path)),Et??=rt(n),Et(t);return}for(let t of e){let e=Gt(t.path);if(!e)continue;let r=e.split(`/`).slice(0,-1).join(`/`);r&&n.mkdirTree(r),n.writeFile(e,t.content,{encoding:`utf8`})}}async function qt(e,t,n,r,i){let a=J.FS,o=r===`aheui`?`main.aheui`:`main.ape`,s=`/tmp/__wasm_idle_${r}__/${Gt(t||``)||o}`,c=new TextEncoder,l=new TextDecoder(`utf-8`,{ignoreBOM:!0}),d=new TextDecoder(`utf-8`,{ignoreBOM:!0}),f=typeof n==`string`,p=f?n:null,m=!1,h=e=>{e&&postMessage({output:e})};J.setStdin({stdin:()=>{if(m)return null;let e;return f?(e=p,p=null):e=u(ht,()=>postMessage({buffer:!0})),e===null?(m=!0,null):c.encode(e)},autoEOF:!1,isatty:!1}),J.setStdout({write:e=>(h(l.decode(e,{stream:!0})),e.length)}),J.setStderr({write:e=>(h(d.decode(e,{stream:!0})),e.length)});try{a.mkdirTree(s.slice(0,s.lastIndexOf(`/`))),a.writeFile(s,e,{encoding:`utf8`}),postMessage({progress:{kind:`ready`,state:`running`,reason:`started`,label:`${At[r].label} program started`}}),await i(s)}finally{h(l.decode()),h(d.decode()),J.setStdin({error:!0}),J.setStdout({write:e=>e.length}),J.setStderr({write:e=>e.length}),a.analyzePath(s).exists&&a.unlink(s)}}async function Jt(e,t,n){await qt(e,t,n,`aheui`,e=>J.runPythonAsync(`import importlib
import aheui.aheui as __wasm_idle_aheui
__wasm_idle_aheui = importlib.reload(__wasm_idle_aheui)
__wasm_idle_aheui.entry_point(["aheui", "--no-c", "--warning-limit=0", ${JSON.stringify(e)}])
None
`))}async function Yt(e,t,n){await qt(e,t,n,`apecode`,e=>J.runPythonAsync(`import sys
from apecode.cli import run_source as __wasm_idle_apecode_run_source
with open(${JSON.stringify(e)}, "r", encoding="utf-8") as __wasm_idle_apecode_source:
    try:
        __wasm_idle_apecode_status = __wasm_idle_apecode_run_source(
            __wasm_idle_apecode_source.read(), sys.stdin, sys.stdout, sys.stderr)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
if __wasm_idle_apecode_status != 0:
    raise RuntimeError(f"APECode interpreter exited with status {__wasm_idle_apecode_status}")
None
`))}self.onmessage=async e=>{if(Re(e.data))return;let{code:n,buffer:r,debugBuffer:i,watchBuffer:a,watchResultBuffer:o,load:s,interrupt:d,assets:f,compile:p,fileName:m,optimize:h,invalidationMode:g,timestamp:_,maxArtifactBytes:v,prepare:y,stdin:b,debug:x=!1,breakpoints:S=[],pauseOnEntry:C=!1,activePath:w,debugPath:T,workspaceFiles:E,language:D=`python`,extension:O}=e.data,k=D===`hy`,A=D===`aheui`,j=D===`apecode`,M=A||j,N=!k&&!M,P=j?`APECode`:`Aheui`;if(s){X=void 0;try{let t=f;Y=t?.baseUrl||Y,yt=t?.useAssetBridge===!0,bt=t?.maxAssetBytes,Ie(t||null),Vt(e.data.persistentCache),$(2,`Loading Pyodide module`),await Bt(Y);let n=Q&&!Q.restored?Q.key:void 0;O!==void 0&&await Pt(O,O?.language===`aheui`?`aheui`:O?.language===`apecode`?`apecode`:`hy`),$(100,`Pyodide runtime ready`),postMessage(n?{load:!0,pythonSnapshotKey:n}:{load:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}}else if(e.data.buildSnapshot)try{let t=f;Y=t?.baseUrl||Y,yt=t?.useAssetBridge===!0,bt=t?.maxAssetBytes,Ie(t||null),Vt(e.data.persistentCache),await Bt(Y,`snapshot`);let n=Q?.key;if(!n||n!==e.data.buildSnapshot||!Z)throw Error(`Python snapshot runtime does not match the request`);let r=J.makeMemorySnapshot(),i=await Ye(Z,n,r);self.postMessage({pythonSnapshot:{stored:i}})}catch(e){self.postMessage({pythonSnapshot:{stored:!1,error:e?.message||`Unknown error`}})}else if(p)try{if(D!==`python`)throw Error(`Bytecode compilation is supported only for Python`);await Bt(Y),$(10,`Compiling Python bytecode`);let e=et(J,n,m,h,v,{invalidationMode:g,timestamp:_});$(100,`Python bytecode ready`),self.postMessage({compiled:e},[e.data.buffer])}catch(e){self.postMessage({error:e.message||`Unknown error`,...e.code===`output-limit`?{outputLimit:{actual:e.actual,limit:e.limit}}:{}})}else if(y){X=void 0;try{if(A&&St===void 0)throw Error(`Aheui runtime is not installed`);if(j&&Ct===void 0)throw Error(`APECode runtime is not installed`);if(M&&x)throw Error(`${P} debugging is not supported`);$(5,M?`Preparing ${P} source`:`Preparing Python workspace`);let e=Wt(n,w,E);await Bt(Y),M||Kt(E,N),N&&($(15,`Resolving Python imports`),await Ut(n,E)),X=e,M?$(100,`${P} source ready`):$(100,`Python packages ready`),self.postMessage({results:!0})}catch(e){X=void 0,self.postMessage({error:e.message||`Unknown error`})}}else if(typeof n==`string`){let e=X;X=void 0;try{if(await Bt(Y),M||Kt(E,N),k&&xt===void 0)throw Error(`Hy runtime is not installed`);if(A&&St===void 0)throw Error(`Aheui runtime is not installed`);if(j&&Ct===void 0)throw Error(`APECode runtime is not installed`);if(k&&x)throw Error(`Hy debugging is not supported`);if(M&&x)throw Error(`${P} debugging is not supported`);N&&e!==Wt(n,w,E)&&await Ut(n,E)}catch(e){self.postMessage({error:e.message||`Unknown error`});return}let s=Date.now();if(ht=new Int32Array(r),q=new Int32Array(i),gt=new Int32Array(a),_t=new Int32Array(o),vt=new Uint8Array(d),x&&!t(q)){self.postMessage({error:`Python debugging requires SharedArrayBuffer.`});return}if(t(vt)&&J.setInterruptBuffer(vt),M){try{A?await Jt(n,w,b):await Yt(n,w,b),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}return}let f=ct(J,{initialInput:typeof b==`string`?b:void 0,readInput:()=>u(ht,()=>postMessage({buffer:!0})),emit:e=>postMessage({output:e})});self.prompt=f.prompt;let p,m=!1,h=()=>{if(!m){m=!0;try{p?.()}finally{try{p?.destroy()}finally{f.close(),delete self.prompt}}}},g,_=`__wasm_idle_python_debug_trace_${s}`,v=`__wasm_idle_python_debug_pause_${s}`,y=`__wasm_idle_python_debug_wait_${s}`,D=`__wasm_idle_python_debug_watch_read_${s}`,O=`__wasm_idle_python_debug_watch_write_${s}`,F=`__wasm_idle_python_debug_breakpoints_${s}`,I=`__wasm_idle_python_debug_breakpoint_state_${s}`,L=`__wasm_idle_python_execution_ready_${s}`,R=!1;self[L]=()=>{R||(R=!0,delete self[L],postMessage({progress:{kind:`ready`,state:`running`,reason:`started`,label:`Python program started`}}))},self[v]=(e,t,n,r)=>{f.flush();let i,a;try{i=JSON.parse(n)}catch{i=[]}try{a=JSON.parse(r)}catch{a=[]}return postMessage({debugEvent:{type:`pause`,line:Number(e),reason:t,locals:i,callStack:a,scopes:[{name:`Locals`,presentationHint:`locals`,variablesReference:++Ot,expensive:!1,variables:i}]}}),Ot},self[y]=()=>{let e=Atomics.load(q,0);for(;;){if(vt?.[0]===2||(Atomics.wait(q,0,e,100),vt?.[0]===2))return-1;let t=Atomics.exchange(q,1,0);if(t)return t}},self[D]=()=>l(gt)||``,self[O]=e=>{c([e],_t)},self[F]=e=>{let t=Atomics.load(q,2);if(t===e)return null;let n=Math.max(0,Math.min(Atomics.load(q,3),q.length-4)),r=[];for(let e=0;e<n;e+=1){let t=Atomics.load(q,4+e);Number.isInteger(t)&&t>0&&r.push(t)}return JSON.stringify({version:t,lines:r})},self[I]={get version(){return Atomics.load(q,2)}};let z=Gt(w||``)||(k?`__wasm_idle_user__.hy`:`__wasm_idle_user__.py`),ee=Gt(T||``)||z,B=JSON.stringify(z),te=JSON.stringify([...Array.isArray(S)?S:[]].map(e=>Number(e)).filter(e=>Number.isInteger(e)&&e>0));try{try{if(!kt)throw Error(`Python flush hooks are unavailable`);p=kt(f.flush)}catch{f.disableBatching()}N&&!x?await Ht().run(n,z,self[L]):(x&&(Dt??=st(J,Ft),g=Dt.createTrace(ee,te,!!C,{state:self[I],readBreakpoints:self[F],pause:self[v],wait:self[y],readWatch:self[D],writeWatch:self[O]}),self[_]=g),await J.runPythonAsync(`import ast
import builtins
import inspect
import json
import os
import sys
import types
from js import ${L} as __wasm_idle_execution_ready
${x?`from js import ${_} as __wasm_idle_debug_trace`:``}

${x?`sys.settrace(__wasm_idle_debug_trace)`:Ft}

${k?`
try:
    import types
    import hy
    import hy.compiler
    __wasm_idle_module = types.ModuleType("__main__")
    __wasm_idle_module.__file__ = ${B}
    __wasm_idle_source = ${JSON.stringify(n)}
    __wasm_idle_compiled = compile(
        hy.compiler.hy_compile(
            hy.read_many(__wasm_idle_source, filename = ${B}),
            __wasm_idle_module,
            filename = ${B},
            source = __wasm_idle_source,
        ),
        ${B},
        "exec",
    )
    __wasm_idle_execution_ready()
    exec(__wasm_idle_compiled, __wasm_idle_module.__dict__)
finally:
    del __wasm_idle_execution_ready
`:`
__wasm_idle_missing_main = object()
__wasm_idle_previous_main = sys.modules.get("__main__", __wasm_idle_missing_main)
__wasm_idle_previous_path = sys.path
try:
    __wasm_idle_module = types.ModuleType("__main__")
    __wasm_idle_module.__file__ = ${B}
    __wasm_idle_globals = __wasm_idle_module.__dict__
    __wasm_idle_globals.update({
        ${JSON.stringify(L)}: __wasm_idle_execution_ready,
    })
    __wasm_idle_compiled = compile(
        ${JSON.stringify(n)},
        ${B},
        "exec",
        flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
    )
    sys.modules["__main__"] = __wasm_idle_module
    __wasm_idle_run_paths = list(dict.fromkeys((
        os.path.dirname(os.path.abspath(${B})), os.getcwd()
    )))
    sys.path = __wasm_idle_run_paths + [path for path in __wasm_idle_previous_path if path not in __wasm_idle_run_paths]
    __wasm_idle_globals.pop(${JSON.stringify(L)})()
    __wasm_idle_result = eval(
        __wasm_idle_compiled,
        __wasm_idle_globals,
        __wasm_idle_globals,
    )
    if inspect.isawaitable(__wasm_idle_result):
        await __wasm_idle_result
finally:
    sys.path = __wasm_idle_previous_path
    if __wasm_idle_previous_main is __wasm_idle_missing_main:
        sys.modules.pop("__main__", None)
    else:
        sys.modules["__main__"] = __wasm_idle_previous_main
    __wasm_idle_globals.pop(${JSON.stringify(L)}, None)
    del __wasm_idle_execution_ready
    sys.settrace(None)
    ${x?`del __wasm_idle_debug_trace`:``}
`}
`)),h(),self.postMessage({results:!0})}catch(e){try{h()}catch{}self.postMessage({error:e.message||`Unknown error`})}finally{delete self[`__pyodide__input_`+s],delete self[`__pyodide__output_`+s],delete self.prompt,delete self[L],delete self[v],delete self[y],delete self[D],delete self[O],delete self[F],delete self[I],delete self[_],g?.destroy()}}};