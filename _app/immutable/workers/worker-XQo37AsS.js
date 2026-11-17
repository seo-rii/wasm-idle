var e=class extends Error{code;phase;runtimeId;profileId;recoverable;constructor(e,t){super(e,{cause:t.cause}),this.name=`WasmIdleError`,this.code=t.code,this.phase=t.phase,this.runtimeId=t.runtimeId,this.profileId=t.profileId,this.recoverable=t.recoverable??!1}},t=class extends e{constructor(e,t={}){super(e,{...t,code:`asset-integrity`,phase:t.phase??`asset`,recoverable:t.recoverable??!1}),this.name=`AssetIntegrityError`}};const n=/* @__PURE__ */ new Set([`application/javascript`,`text/javascript`]);async function r(e){let r=e.stage??`compressed`,i={runtimeId:e.runtimeId,profileId:e.profileId};if(!e.asset||e.asset.includes(`\0`))throw new t(`Runtime asset identity must be a non-empty safe string`,i);if(!ArrayBuffer.isView(e.bytes)||Object.prototype.toString.call(e.bytes)!==`[object Uint8Array]`)throw new t(`Runtime asset ${e.asset} did not provide byte data`,i);let a,o,s;if(typeof e.expected==`string`){if(r===`uncompressed`)throw new t(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,i);a=e.expected}else if(e.expected&&typeof e.expected==`object`){if(r===`compressed`)a=e.expected.sha256,o=e.expected.bytes,e.expected.uncompressedSha256===void 0&&e.expected.uncompressedBytes===void 0&&(s=e.expected.mediaType);else{if(e.expected.uncompressedSha256===void 0||e.expected.uncompressedBytes===void 0)throw new t(`Runtime asset ${e.asset} is missing uncompressed integrity metadata`,i);a=e.expected.uncompressedSha256,o=e.expected.uncompressedBytes,s=e.expected.mediaType}}else throw new t(`Runtime asset ${e.asset} has invalid integrity metadata`,i);if(!/^[a-f0-9]{64}$/u.test(a))throw new t(`Runtime asset ${e.asset} has an invalid expected ${r} SHA-256 digest`,i);if(o!==void 0&&(!Number.isSafeInteger(o)||o<0))throw new t(`Runtime asset ${e.asset} has an invalid expected ${r} byte size`,i);if(o!==void 0&&e.bytes.byteLength!==o)throw new t(`Runtime asset ${e.asset} ${r} size mismatch: expected ${o} bytes, received ${e.bytes.byteLength}`,i);if(s!==void 0){if(!s.includes(`/`))throw new t(`Runtime asset ${e.asset} has an invalid expected MIME type`,i);let r=e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase()||`missing`,a=s.trim().toLowerCase();if(r!==a&&!(n.has(r)&&n.has(a)))throw new t(`Runtime asset ${e.asset} MIME type mismatch: expected ${a}, received ${r}`,i)}if(!globalThis.crypto?.subtle)throw new t(`Web Crypto SHA-256 is unavailable`,i);let c=e.bytes.byteOffset===0&&e.bytes.byteLength===e.bytes.buffer.byteLength&&e.bytes.buffer instanceof ArrayBuffer?e.bytes.buffer:Uint8Array.from(e.bytes).buffer,l=new Uint8Array(await globalThis.crypto.subtle.digest(`SHA-256`,c)),u=Array.from(l,e=>e.toString(16).padStart(2,`0`)).join(``);if(u!==a)throw new t(`Runtime asset ${e.asset} ${r} SHA-256 mismatch: expected ${a}, received ${u}`,i);return Object.freeze({asset:e.asset,stage:r,sha256:u,bytes:e.bytes.byteLength,mediaType:s?e.mimeType?.split(`;`,1)[0]?.trim().toLowerCase():void 0})}const i=Object.freeze({enabled:!0,maxBytes:536870912,maxEntryBytes:536870912,maxEntries:4096,storageReserveBytes:67108864,eviction:`lru`,namespace:`wasm-idle`,version:`1.4.0`}),a=3e3,o=/* @__PURE__ */ new Set;let s={};function c(e){let t=e!==!1&&{...e};u([t]),s=t}function l(...e){return u([s,...e])}function u(e){let t={...i};for(let n of e)if(n===!1)t.enabled=!1;else if(n)for(let[e,r]of Object.entries(n))r!==void 0&&Object.hasOwn(i,e)&&(t[e]=r);for(let e of[`maxBytes`,`maxEntryBytes`,`maxEntries`,`storageReserveBytes`])if(!Number.isSafeInteger(t[e])||t[e]<0)throw TypeError(`Invalid asset cache ${e}`);if(typeof t.enabled!=`boolean`||![`lru`,`none`].includes(t.eviction))throw TypeError(`Invalid asset cache policy`);if(typeof t.namespace!=`string`||!/^[a-zA-Z0-9._-]{1,100}$/u.test(t.namespace))throw TypeError(`Invalid asset cache namespace`);if(typeof t.version!=`string`||!t.version||t.version.length>256)throw TypeError(`Invalid asset cache version`);return t}function d(e){if(e?.aborted)throw e.reason===void 0?new DOMException(`Aborted`,`AbortError`):e.reason}function f(e){return typeof e.url==`string`&&e.url.length>0&&e.url.length<=8192&&!e.url.includes(`\0`)&&typeof e.sha256==`string`&&/^[a-f0-9]{64}$/u.test(e.sha256)&&(e.bytes===void 0||Number.isSafeInteger(e.bytes)&&e.bytes>=0)&&(e.validationKey===void 0||typeof e.validationKey==`string`&&e.validationKey.length<=8192)&&(e.version===void 0||typeof e.version==`string`&&e.version.length>0&&e.version.length<=256)}function p(e){let t={...e};if(!f(t))throw TypeError(`Invalid runtime asset integrity identity`);return t}function m(e){return`wasm-idle-assets-v1:${e.namespace}`}function h(e,t){return`https://wasm-idle.invalid/.runtime-assets/${e.namespace}/${t}`}function g(e){try{return e.enabled&&e.maxBytes>0&&e.maxEntryBytes>0&&e.maxEntries>0&&globalThis.caches!==void 0&&globalThis.indexedDB!==void 0&&typeof globalThis.navigator?.locks?.request==`function`}catch{return!1}}function _(e,t){return new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason)};e.then(e=>{t.removeEventListener(`abort`,i),t.aborted?r(t.reason):n(e)},e=>{t.removeEventListener(`abort`,i),r(e)}),t.aborted?i():t.addEventListener(`abort`,i,{once:!0})})}function v(e,t){return d(t),new Promise((n,r)=>{let i=!1,a=indexedDB.open(e,1),o=()=>{i=!0,t.removeEventListener(`abort`,o),r(t.reason)};t.addEventListener(`abort`,o,{once:!0}),a.onupgradeneeded=()=>{i?a.transaction?.abort():a.result.createObjectStore(`assets`,{keyPath:`sha256`})},a.onsuccess=()=>{t.removeEventListener(`abort`,o),i?a.result.close():(i=!0,n(a.result))},a.onerror=()=>{t.removeEventListener(`abort`,o),i=!0,r(a.error)}})}function y(e,t,n){return d(e.signal),new Promise((r,i)=>{let o=e.connection.transaction(`assets`,t),s=()=>{try{o.abort()}catch{}},c=setTimeout(s,a);e.signal.addEventListener(`abort`,s,{once:!0});let l=()=>{clearTimeout(c),e.signal.removeEventListener(`abort`,s)},u;try{u=n(o.objectStore(`assets`))}catch(e){l();try{o.abort()}catch{}i(e);return}o.oncomplete=()=>{l(),e.signal.aborted?i(e.signal.reason):r(u.result)},o.onabort=()=>{l(),i(e.signal.aborted?e.signal.reason:o.error??/* @__PURE__ */ Error(`Asset cache database transaction failed`))}})}async function b(e,t,n,r=`exclusive`){if(d(t),!g(e))return;let i=new AbortController,s=()=>i.abort(t?.reason);t?.addEventListener(`abort`,s,{once:!0});let c=m(e),l=setTimeout(()=>{o.add(c),i.abort(/* @__PURE__ */ Error(`Asset cache lock timed out`))},o.has(c)?a:3e4);try{return await _(navigator.locks.request(c,{signal:i.signal,mode:r},async()=>{let t=i.signal;o.delete(c),d(t),clearTimeout(l),l=setTimeout(()=>i.abort(/* @__PURE__ */ Error(`Asset cache operation timed out`)),a);let r=await v(m(e),t);try{d(t);let i=await _(caches.open(m(e)),t);d(t);let a=await n({match:(...e)=>(d(t),_(i.match(...e),t)),keys:(...e)=>(d(t),_(i.keys(...e),t)),put:async(...e)=>{d(t),await i.put(...e),d(t)},delete:async(...e)=>{d(t);let n=await i.delete(...e);return d(t),n}},{connection:r,signal:t},t);return d(t),a}finally{r.close()}}),i.signal)}catch{d(t);return}finally{clearTimeout(l),t?.removeEventListener(`abort`,s)}}function x(e,t,n){let r=t.version??n.version;if(!e.references.some(e=>e.version===r&&e.url===t.url&&e.validationKey===t.validationKey)){if(e.references.length>=4096)throw Error(`Asset cache reference limit reached`);e.references.push({version:r,url:t.url,validationKey:t.validationKey})}e.lastUsed=Date.now()}function S(e){return!!e&&/^[a-f0-9]{64}$/u.test(e.sha256)&&Number.isSafeInteger(e.bytes)&&e.bytes>=0&&Number.isFinite(e.lastUsed)&&Array.isArray(e.references)&&e.references.length<=4096&&e.references.every(e=>typeof e?.version==`string`&&typeof e.url==`string`&&(e.validationKey===void 0||typeof e.validationKey==`string`))}async function C(e){let t=await y(e,`readonly`,e=>e.getAll());for(let n of t)S(n)||await y(e,`readwrite`,e=>e.delete(n.sha256));return t.filter(S)}async function w(e,t,n,r){await e.delete(h(n,r.sha256)),await y(t,`readwrite`,e=>e.delete(r.sha256))}async function ee(e){try{return d(e),await _(Promise.resolve(navigator.storage?.estimate?.()),e)}catch{d(e);return}}async function te(e,t,n){d(n);let r=e.body?.getReader();if(!r)return/* @__PURE__ */ new Uint8Array;let i=[],a=0;try{for(;;){d(n);let{done:e,value:o}=await _(r.read(),n);if(e)break;if(a+=o.byteLength,a>t)throw Error(`Cached asset exceeds expected size`);i.push(o)}}catch(e){throw r.cancel().catch(()=>{}),e}finally{r.releaseLock()}let o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.byteLength;return o}async function T(e,t,n){let r=await ee(n);return typeof r?.quota!=`number`||typeof r.usage!=`number`||!Number.isFinite(r.quota)||!Number.isFinite(r.usage)?e.maxBytes:Math.max(0,Math.min(e.maxBytes,r.quota-r.usage+t-e.storageReserveBytes))}async function E(e,t,n,r,i,a,o){let s=r.reduce((e,t)=>e+t.bytes,0),c=r.length,l=await T(n,s,t.signal);if(i>l||a>n.maxEntries)return!1;let u=()=>s+i<=l&&c+a<=n.maxEntries;if(u())return!0;if(n.eviction===`none`)return!1;for(let i of[...r].sort((e,t)=>e.lastUsed-t.lastUsed||e.sha256.localeCompare(t.sha256)))if(i.sha256!==o&&(await w(e,t,n,i),s-=i.bytes,c--,u()))return!0;return u()}async function ne(e){e={...e,identity:p(e.identity)};let t=l(e.cache);if(d(e.signal),!t.enabled||e.identity.bytes!==void 0&&e.identity.bytes>Math.min(t.maxBytes,t.maxEntryBytes))return;let n=Symbol(`invalid cached asset body`),i=i=>async(a,o,s)=>{let c=await y(o,`readonly`,t=>t.get(e.identity.sha256));if(!c||!S(c)||c.sha256!==e.identity.sha256||c.bytes>Math.min(t.maxBytes,t.maxEntryBytes)||e.identity.bytes!==void 0&&e.identity.bytes!==c.bytes||e.identity.validationKey!==void 0&&!c.references.some(t=>t.url===e.identity.url&&t.validationKey===e.identity.validationKey))return;let l=await a.match(h(t,e.identity.sha256));if(!l){if(!i)return n;await y(o,`readwrite`,e=>e.delete(c.sha256));return}let u;try{u=await te(l,Math.min(c.bytes,t.maxBytes,t.maxEntryBytes),s),await _(r({asset:e.identity.url,bytes:u,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes??c.bytes}}),s)}catch{if(d(s),!i)return n;await w(a,o,t,c);return}d(e.signal);try{await y(o,`readwrite`,n=>{let r=n.get(c.sha256);return r.onsuccess=()=>{try{let i=r.result;if(!i||!S(i))return;x(i,e.identity,t),n.put(i)}catch{try{n.transaction.abort()}catch{}}},r})}catch{}return u},a=await b(t,e.signal,i(!1),`shared`);if(a!==n)return a;let o=await b(t,e.signal,i(!0));return o===n?void 0:o}async function D(e){e={...e,identity:p(e.identity)};let t=l(e.cache);if(d(e.signal),!t.enabled||!g(t)||e.bytes.byteLength>Math.min(t.maxBytes,t.maxEntryBytes))return!1;let n=Uint8Array.from(e.bytes);return await r({asset:e.identity.url,bytes:n,expected:{sha256:e.identity.sha256,bytes:e.identity.bytes}}),d(e.signal),await b(t,e.signal,async(r,i)=>{let a=await C(i),o=new Set(a.map(e=>h(t,e.sha256)));for(let e of await r.keys())o.has(e.url)||await r.delete(e);let s=a.find(t=>t.sha256===e.identity.sha256),c=s??{sha256:e.identity.sha256,bytes:n.byteLength,lastUsed:0,references:[]};if(c.bytes!==n.byteLength||(x(c,e.identity,t),!await E(r,i,t,a,s?0:n.byteLength,+!s,c.sha256)))return!1;d(e.signal),await r.put(h(t,c.sha256),new Response(n,{headers:{"Content-Type":`application/octet-stream`,"Content-Length":String(n.byteLength)}}));try{await y(i,`readwrite`,e=>e.put(c))}catch(e){throw s||await r.delete(h(t,c.sha256)),e}return!0})??!1}function O(e,t){try{let n=new URL(t.assetRoot);if(!/^https?:$/u.test(n.protocol)||n.username||n.password||n.search||n.hash)return;n.pathname.endsWith(`/`)||(n.pathname+=`/`);let r=new URL(e,n);if(r.origin!==n.origin||r.username||r.password||r.search||r.hash||!r.pathname.startsWith(n.pathname))return;let i=r.pathname.slice(n.pathname.length);if(!i||/[%\\\0]/u.test(i))return;let a=t.assetPrefix?.replace(/\/$/u,``)??``;return a&&(a.startsWith(`/`)||/[%\\\0]/u.test(a)||a.split(`/`).some(e=>!e||e===`.`||e===`..`))?void 0:a?`${a}/${i}`:i}catch{return}}function re(e,t){return t?new Promise((n,r)=>{let i=()=>{t.removeEventListener(`abort`,i),r(t.reason??new DOMException(`Runtime asset lock load aborted`,`AbortError`))};t.addEventListener(`abort`,i,{once:!0}),e.then(e=>{t.removeEventListener(`abort`,i),n(e)},e=>{t.removeEventListener(`abort`,i),r(e)}),t.aborted&&i()}):e}function ie(e=()=>import(`./chunks/ChjEbCYj.js`).then(e=>e.RUNTIME_ASSET_LOCK)){let t;return async(n,r)=>{let i=r.signal;i?.throwIfAborted();let a=O(n,r);if(a===void 0)return;let o=r.manifest;if(!o){if(!t){let n=Promise.resolve().then(e);t=n,n.catch(()=>{t===n&&(t=void 0)})}o=await re(t,i)}return i?.throwIfAborted(),Object.prototype.hasOwnProperty.call(o.assets,a)?o.assets[a]:void 0}}const ae=/* @__PURE__ */ ie();let k;function A(e){k={persistentCache:l(e.persistentCache),assetRoot:e.assetRoot},c(k.persistentCache)}function j(e={}){return{persistentCache:l(k?.persistentCache,e.persistentCache),assetRoot:e.assetRoot??k?.assetRoot}}async function M(e,t,n,r){if(r?.throwIfAborted(),n!==void 0)return typeof n==`string`?{sha256:n}:n;let i=j(t).assetRoot;return i?ae(e,{assetRoot:i,signal:r}):void 0}const N=/^[a-zA-Z][a-zA-Z\d+\-.]*:/u;function P(e){let t=e instanceof URL?e.href:e,n=globalThis.location?.href,r;try{r=new URL(t,n||`https://wasm-idle.invalid/`)}catch{throw Error(`Invalid external runtime asset URL: ${t}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Unsupported external runtime asset URL scheme: ${r.protocol}`);if(r.hash)throw Error(`External runtime asset URLs must not include fragments`);if(r.username||r.password)throw Error(`External runtime asset URLs must not include credentials`);let i=e instanceof URL||N.test(t)||!!n;return{requestUrl:i?r.href:t,expectedFinalUrl:i?r.href:void 0}}function F(e){return e.reason??/* @__PURE__ */ Error(`External runtime asset load was aborted`)}async function I(e){let t=e.maxBytes??134217728;if(!Number.isSafeInteger(t)||t<0)throw Error(`External runtime asset maxBytes must be a non-negative safe integer`);if(e.signal?.aborted)throw F(e.signal);let{requestUrl:n,expectedFinalUrl:i}=P(e.url),a=await M(n,e,e.integrity,e.signal);if(!a?.sha256||!i)return L(e);let o=[{sha256:a.sha256,bytes:a.bytes}];a.uncompressedSha256!==void 0&&a.uncompressedBytes!==void 0&&o.push({sha256:a.uncompressedSha256,bytes:a.uncompressedBytes});let s=j(e).persistentCache,c=JSON.stringify([`lsp-external-exact-v1`,t]);for(let n of o){if(n.bytes!==void 0&&n.bytes>t)continue;let r=await ne({identity:{url:i,...n,validationKey:c},cache:s,signal:e.signal});if(r){if(r.byteLength>t)throw Error(`${e.label} exceeds the ${t} byte download limit`);if(e.signal?.aborted)throw F(e.signal);return e.reportProgress?.(r.byteLength,r.byteLength),Uint8Array.from(r)}}let l=await L(e),u,d;for(let t of o)try{await r({asset:n,bytes:l,expected:t,runtimeId:e.runtimeId,profileId:e.profileId}),u=t;break}catch(e){d??=e}if(!u)throw d;if(e.signal?.aborted||(await D({identity:{url:i,...u,validationKey:c},cache:s,signal:e.signal,bytes:l}),e.signal?.aborted))throw F(e.signal);return e.reportProgress?.(l.byteLength,l.byteLength),Uint8Array.from(l)}async function L(e){let t=e.maxBytes??134217728;if(!Number.isSafeInteger(t)||t<0)throw Error(`External runtime asset maxBytes must be a non-negative safe integer`);if(e.signal?.aborted)throw F(e.signal);let n=e.fetch??globalThis.fetch?.bind(globalThis);if(!n)throw Error(`fetch is required to load ${e.label}`);let{requestUrl:r,expectedFinalUrl:i}=P(e.url),a;try{let t=Promise.resolve(n(r,{cache:e.cache,credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,signal:e.signal}));if(!e.signal)a=await t;else{let n=e.signal;a=await new Promise((e,r)=>{let i=!1,a=()=>{i||(i=!0,n.removeEventListener(`abort`,a),r(F(n)))};n.addEventListener(`abort`,a,{once:!0}),t.then(t=>{if(i){let e=F(n);Promise.resolve().then(()=>t.body?.cancel(e)).catch(()=>{});return}i=!0,n.removeEventListener(`abort`,a),e(t)},e=>{i||(i=!0,n.removeEventListener(`abort`,a),r(e))}),n.aborted&&a()})}}catch(t){throw e.signal?.aborted?F(e.signal):Error(`Failed to load ${e.label} from ${r}: ${t instanceof Error?t.message:String(t)}`)}if(e.signal?.aborted){let t=F(e.signal);throw await a.body?.cancel(t).catch(()=>{}),t}if(i&&a.url){let t;try{t=new URL(a.url)}catch{throw await a.body?.cancel().catch(()=>{}),Error(`${e.label} returned an invalid final URL`)}if(t.href!==i)throw await a.body?.cancel().catch(()=>{}),Error(`${e.label} returned an unexpected final URL`)}if(!a.ok)throw await a.body?.cancel().catch(()=>{}),Error(`Failed to load ${e.label} from ${r}: ${a.status}`);let o=a.headers.get(`content-length`),s;if(o!==null&&(s=Number(o),!/^\d+$/u.test(o)||!Number.isSafeInteger(s)))throw await a.body?.cancel().catch(()=>{}),Error(`${e.label} has an invalid Content-Length`);if(s!==void 0&&s>t)throw await a.body?.cancel().catch(()=>{}),Error(`${e.label} exceeds the ${t} byte download limit`);if(!a.body){let n,r=e.signal?new Promise((t,r)=>{n=()=>r(F(e.signal)),e.signal.addEventListener(`abort`,n,{once:!0})}):void 0;try{if(e.signal?.aborted)throw F(e.signal);let n=a.arrayBuffer(),i=new Uint8Array(r?await Promise.race([n,r]):await n);if(e.signal?.aborted)throw F(e.signal);if(i.byteLength>t)throw Error(`${e.label} exceeds the ${t} byte download limit`);return e.reportProgress?.(i.byteLength,s??i.byteLength),i}finally{n&&e.signal?.removeEventListener(`abort`,n)}}let c=a.body.getReader(),l=!1,u=e=>{if(!l){l=!0;try{c.cancel(e).catch(()=>{})}catch{}}};if(e.signal?.aborted){let t=F(e.signal);u(t);try{c.releaseLock()}catch{}throw t}let d,f=e.signal?new Promise((t,n)=>{d=()=>{let t=F(e.signal);u(t),n(t)},e.signal.addEventListener(`abort`,d,{once:!0})}):void 0,p=new Uint8Array(Math.min(t,s??65536)),m=0,h,g;try{for(;;){if(e.signal?.aborted)throw F(e.signal);let n=c.read(),{done:r,value:i}=f?await Promise.race([n,f]):await n;if(e.signal?.aborted)throw F(e.signal);if(r)break;if(!i)continue;let a=m+i.byteLength;if(a>t){let n=/* @__PURE__ */ Error(`${e.label} exceeds the ${t} byte download limit`);throw u(n),n}if(a>p.byteLength){let e=Math.min(t,Math.max(a,Math.max(p.byteLength*2,1))),n=new Uint8Array(e);n.set(p.subarray(0,m)),p=n}p.set(i,m),m=a,e.reportProgress?.(m,s)}if(e.signal?.aborted)throw F(e.signal);e.reportProgress?.(m,s??m),h=p.subarray(0,m)}catch(t){if(e.signal?.aborted){let t=F(e.signal);throw u(t),t}throw u(t),t}finally{d&&e.signal?.removeEventListener(`abort`,d);try{c.releaseLock()}catch(t){e.signal?.aborted||(g=t)}}if(g)throw g;return h}async function R(e,t){let n=globalThis.fetch;if(!n||!e.assetRoot||!l(e.persistentCache).enabled)return t();let r=async(t,r)=>{let i=t instanceof Request?t:void 0,a=r?.method??i?.method??`GET`,o=new Headers(r?.headers??i?.headers),s=!1;if(o.forEach(()=>{s=!0}),a.toUpperCase()!==`GET`||s||r?.body||(r?.credentials??i?.credentials)===`include`||(r?.cache??i?.cache)===`only-if-cached`)return n.call(globalThis,t,r);let c=new URL(i?.url??String(t),globalThis.location?.href).href,l=new URL(c).pathname.split(`/`).at(-1);if(l!==`pyodide.asm.wasm`&&l!==`python_stdlib.zip`)return n.call(globalThis,t,r);let u=await M(c,e,void 0,r?.signal??i?.signal??void 0);if(!u?.sha256)return n.call(globalThis,t,r);let d=await I({...e,url:c,integrity:u,label:`Python LSP bootstrap asset`,maxBytes:u.bytes,signal:r?.signal??i?.signal??void 0,cache:r?.cache??i?.cache,fetch:n.bind(globalThis)});return new Response(d,{headers:{"content-type":u.mediaType??(c.endsWith(`.wasm`)?`application/wasm`:`application/octet-stream`)}})};globalThis.fetch=r;try{return await t()}finally{globalThis.fetch===r&&(globalThis.fetch=n)}}const z=/* @__PURE__ */ new Set([`textDocument/completion`,`completionItem/resolve`,`textDocument/hover`,`textDocument/signatureHelp`,`textDocument/definition`,`textDocument/documentSymbol`]);function B(e,t){let n=[],r,i=!1,a=e=>{e.id!==void 0&&t({jsonrpc:`2.0`,id:e.id,result:e.method?.endsWith(`/resolve`)?e.params:null})},o=e=>{for(let t=n.length-1;t>=0;t--)e(n[t])&&a(n.splice(t,1)[0])};function s(){r===void 0&&!i&&n.length&&(r=setTimeout(()=>{r=void 0;let t=n.shift();try{t&&e(t)}finally{s()}},0))}return{push(e){if(i){a(e);return}if(e.method===`$/cancelRequest`){e.params?.id!==void 0&&o(t=>t.id===e.params.id);return}let t=e.method??``,r=e.params?.textDocument?.uri;if([`textDocument/didOpen`,`textDocument/didChange`,`textDocument/didClose`,`workspace/didChangeWatchedFiles`].includes(t)&&o(e=>z.has(e.method??``)),t===`textDocument/didChange`&&e.params?.contentChanges?.length===1&&!e.params.contentChanges[0].range){let e=n.at(-1);e?.method===t&&e.params?.textDocument?.uri===r&&e.params?.contentChanges?.length===1&&!e.params.contentChanges[0].range&&n.pop()}z.has(t)&&o(e=>e.method===t&&e.params?.textDocument?.uri===r&&t!==`completionItem/resolve`),n.push(e),s()},dispose(){i=!0,r!==void 0&&clearTimeout(r),r=void 0;for(let e of n.splice(0))a(e)}}}async function V(e,t,n){if(!t)return n();let r=new URL(`pyodide.asm.wasm`,e).href,i=globalThis.fetch,a=WebAssembly.instantiateStreaming,o=/* @__PURE__ */ new WeakSet,s=async(t,n)=>{if((t instanceof Request?t.url:new URL(String(t),e).href)!==r)return i(t,n);let a=new Response(null,{headers:{"content-type":`application/wasm`}});return o.add(a),a},c=async(e,n)=>{let r=await e;return o.has(r)?{module:t,instance:await WebAssembly.instantiate(t,n)}:a(r,n)};globalThis.fetch=s,WebAssembly.instantiateStreaming=c;try{return await n()}finally{globalThis.fetch===s&&(globalThis.fetch=i),WebAssembly.instantiateStreaming===c&&(WebAssembly.instantiateStreaming=a)}}let H=null,U=null,W=null,G=null,K={},q=Promise.resolve(void 0),J,Y;const X=/* @__PURE__ */ new Map,Z=B(e=>U?.(JSON.stringify(e)),e=>self.postMessage(e));function oe(e,t,n=!1){let r=X.get(e);if(r!==void 0&&clearTimeout(r),n){X.delete(e);return}X.set(e,setTimeout(()=>{X.delete(e),Z.push({jsonrpc:`2.0`,method:`wasmIdle/publishDiagnostics`,params:{uri:e,version:t}})},120))}function se(e){return e instanceof Error?e.message:String(e)}function Q(e){return e.endsWith(`/`)?e:`${e}/`}function ce(e){try{self.postMessage(JSON.parse(e))}catch(t){console.error(`Failed to emit Python LSP payload`,t,e)}}function le(e){e.FS.mkdirTree(`/wasm_idle_lsp/wasm_idle_python_lsp`),e.FS.writeFile(`/wasm_idle_lsp/wasm_idle_python_lsp/__init__.py`,`from .server import create_bridge

__all__ = ["create_bridge"]
`),e.FS.writeFile(`/wasm_idle_lsp/wasm_idle_python_lsp/server.py`,`from __future__ import annotations

import ast
import json
import re
from collections import OrderedDict
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from jedi import Project, Script
except Exception:
    Project = None
    Script = None

from wasm_idle_lsp_bridge import emit
try:
    from wasm_idle_lsp_bridge import schedule_diagnostics
except ImportError:
    schedule_diagnostics = None

SERVER_NAME = "wasm-idle-python-lsp"
SERVER_VERSION = "0.2.0"
WORKSPACE_ROOT = "/workspace"

TEXT_DOCUMENT_SYNC_FULL = 1
DIAGNOSTIC_SEVERITY_ERROR = 1
MAX_CACHED_SCRIPTS = 8
MAX_COMPLETION_RESULTS = 2
MAX_COMPLETION_ITEMS = 2048

COMPLETION_ITEM_KIND = {
    "text": 1,
    "method": 2,
    "function": 3,
    "constructor": 4,
    "field": 5,
    "variable": 6,
    "class": 7,
    "interface": 8,
    "module": 9,
    "property": 10,
    "unit": 11,
    "value": 12,
    "enum": 13,
    "keyword": 14,
    "snippet": 15,
    "color": 16,
    "file": 17,
    "reference": 18,
    "folder": 19,
    "enumMember": 20,
    "constant": 21,
    "struct": 22,
    "event": 23,
    "operator": 24,
    "typeParameter": 25,
}

SYMBOL_KIND = {
    "file": 1,
    "module": 2,
    "namespace": 3,
    "package": 4,
    "class": 5,
    "method": 6,
    "property": 7,
    "field": 8,
    "constructor": 9,
    "enum": 10,
    "interface": 11,
    "function": 12,
    "variable": 13,
    "constant": 14,
}

COMPLETION_KIND_MAP = {
    "module": COMPLETION_ITEM_KIND["module"],
    "class": COMPLETION_ITEM_KIND["class"],
    "instance": COMPLETION_ITEM_KIND["variable"],
    "function": COMPLETION_ITEM_KIND["function"],
    "param": COMPLETION_ITEM_KIND["variable"],
    "path": COMPLETION_ITEM_KIND["file"],
    "keyword": COMPLETION_ITEM_KIND["keyword"],
    "statement": COMPLETION_ITEM_KIND["keyword"],
    "property": COMPLETION_ITEM_KIND["property"],
}

SYMBOL_KIND_MAP = {
    "module": SYMBOL_KIND["module"],
    "class": SYMBOL_KIND["class"],
    "function": SYMBOL_KIND["function"],
    "statement": SYMBOL_KIND["variable"],
    "instance": SYMBOL_KIND["variable"],
    "param": SYMBOL_KIND["variable"],
}


def _uri_to_path(uri: str) -> str:
    if uri.startswith("file://"):
        return unquote(urlparse(uri).path)

    parsed = urlparse(uri)
    if parsed.scheme and parsed.path:
        return unquote(parsed.path)

    return uri


def _path_to_uri(path: Path, document_uri: str) -> str:
    resolved_path = path.resolve()
    if resolved_path == Path(_uri_to_path(document_uri)).resolve():
        return document_uri
    if urlparse(document_uri).scheme == "file":
        return resolved_path.as_uri()
    return path.as_posix()


class Document:
    def __init__(
        self,
        uri: str,
        source: str,
        version: int | None = None,
        language_id: str | None = None,
    ) -> None:
        self.uri = uri
        self.source = source
        self.version = version
        self.language_id = language_id
        self.path = _uri_to_path(uri)

    @property
    def lines(self) -> list[str]:
        # LSP and Jedi only recognize CR/LF boundaries. str.splitlines also splits
        # valid string contents such as U+2028 and form feed, shifting all positions.
        return re.split(r"(?<=\\n)|(?<=\\r)(?!\\n)", self.source)

    def python_column(self, position: dict) -> int:
        line = max(int(position.get("line", 0)), 0)
        remaining = max(int(position.get("character", 0)), 0)
        lines = self.lines
        text = lines[line].rstrip("\\r\\n") if line < len(lines) else ""
        column = 0
        for character in text:
            width = 2 if ord(character) > 0xFFFF else 1
            if remaining < width:
                break
            remaining -= width
            column += 1
        return column

    def lsp_position(self, line: int, column: int) -> dict:
        lines = self.lines
        text = lines[line].rstrip("\\r\\n") if 0 <= line < len(lines) else ""
        prefix = text[:max(column, 0)]
        return {
            "line": line,
            "character": len(prefix.encode("utf-16-le", errors="surrogatepass")) // 2,
        }

    def offset_at(self, position: dict) -> int:
        line = max(int(position.get("line", 0)), 0)
        lines = self.lines
        if line >= len(lines):
            return len(self.source)

        offset = sum(len(lines[idx]) for idx in range(line))
        return offset + self.python_column(position)

    def apply_change(self, change: dict) -> None:
        if "range" not in change or change["range"] is None:
            self.source = change.get("text", "")
            return

        change_range = change["range"]
        start = self.offset_at(change_range["start"])
        end = self.offset_at(change_range["end"])
        self.source = self.source[:start] + change.get("text", "") + self.source[end:]


class WasmIdlePythonLsp:
    def __init__(self) -> None:
        self.workspace_root = WORKSPACE_ROOT
        Path(self.workspace_root).mkdir(parents=True, exist_ok=True)
        self.project = self._create_project(self.workspace_root)
        self.documents: dict[str, Document] = {}
        self.shutdown_requested = False
        self._script_cache: OrderedDict = OrderedDict()
        self._completion_results: OrderedDict = OrderedDict()
        self._completion_sequence = 0

    def _invalidate_analysis(self) -> None:
        # Imported documents affect other files too: invalidate the entire workspace epoch.
        self._script_cache.clear()
        self._completion_results.clear()

    def handle(self, payload: str) -> None:
        message = json.loads(payload)
        if message.get("jsonrpc") != "2.0":
            return

        method = message.get("method")
        if not method:
            return

        if "id" in message:
            self._handle_request(message["id"], method, message.get("params") or {})
        else:
            self._handle_notification(method, message.get("params") or {})

    def _emit(self, body: dict) -> None:
        emit(json.dumps(body))

    def _respond(self, msg_id, result=None, error: dict | None = None) -> None:
        response = {"jsonrpc": "2.0", "id": msg_id}
        if error is not None:
            response["error"] = error
        else:
            response["result"] = result
        self._emit(response)

    def _notify(self, method: str, params: dict) -> None:
        self._emit({"jsonrpc": "2.0", "method": method, "params": params})

    def _refresh_project(self, root_uri: str | None) -> None:
        if root_uri:
            self.workspace_root = _uri_to_path(root_uri)

        Path(self.workspace_root).mkdir(parents=True, exist_ok=True)
        self.project = self._create_project(self.workspace_root)
        self._invalidate_analysis()

    def _create_project(self, path: str):
        if Project is None:
            return None
        return Project(
            path=path,
            smart_sys_path=True,
            load_unsafe_extensions=False,
        )

    def _document(self, uri: str) -> Document:
        return self.documents[uri]

    def _mirror_document(self, uri: str) -> None:
        document = self._document(uri)
        path = Path(document.path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(document.source, encoding="utf-8")

    def _script(self, uri: str) -> Script:
        if Script is None:
            raise RuntimeError("Python semantic LSP features require jedi")
        document = self._document(uri)
        cached = self._script_cache.get(uri)
        if cached is not None and cached[:2] == (document.source, document.version):
            self._script_cache.move_to_end(uri)
            return cached[2]
        script = Script(code=document.source, path=document.path, project=self.project)
        self._script_cache[uri] = (document.source, document.version, script)
        self._script_cache.move_to_end(uri)
        while len(self._script_cache) > MAX_CACHED_SCRIPTS:
            self._script_cache.popitem(last=False)
        return script

    def _range_for_name(self, name, document: Document | None) -> dict | None:
        if name.line is None or name.column is None:
            return None

        if document is not None:
            return {
                "start": document.lsp_position(name.line - 1, name.column),
                "end": document.lsp_position(name.line - 1, name.column + len(name.name)),
            }
        return {
            "start": {"line": name.line - 1, "character": name.column},
            "end": {"line": name.line - 1, "character": name.column + len(name.name)},
        }

    def _location_for_name(self, name, fallback_uri: str) -> dict | None:
        module_path = getattr(name, "module_path", None)
        uri = fallback_uri
        if module_path is not None:
            uri = _path_to_uri(Path(module_path), fallback_uri)

        path = Path(_uri_to_path(uri)).resolve()
        document = next(
            (document for document in self.documents.values()
             if Path(document.path).resolve() == path),
            None,
        )
        if document is None:
            try:
                document = Document(uri, path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError):
                pass
        range_value = self._range_for_name(name, document)
        if range_value is None:
            return None
        return {"uri": uri, "range": range_value}

    def _completion_kind(self, name_type: str) -> int:
        return COMPLETION_KIND_MAP.get(name_type, COMPLETION_ITEM_KIND["text"])

    def _symbol_kind(self, name_type: str) -> int:
        return SYMBOL_KIND_MAP.get(name_type, SYMBOL_KIND["variable"])

    def _publish_diagnostics(self, uri: str) -> None:
        document = self._document(uri)
        diagnostics: list[dict] = []

        try:
            ast.parse(document.source, filename=document.path)
        except SyntaxError as error:
            line = max((error.lineno or 1) - 1, 0)
            column = max((error.offset or 1) - 1, 0)
            diagnostics.append(
                {
                    "range": {
                        "start": document.lsp_position(line, column),
                        "end": document.lsp_position(line, column + 1),
                    },
                    "severity": DIAGNOSTIC_SEVERITY_ERROR,
                    "source": SERVER_NAME,
                    "message": error.msg or "Syntax error",
                }
            )

        self._notify(
            "textDocument/publishDiagnostics",
            {"uri": uri, "version": document.version, "diagnostics": diagnostics},
        )

    def _queue_diagnostics(self, uri: str) -> None:
        if schedule_diagnostics is None:
            self._publish_diagnostics(uri)
        else:
            schedule_diagnostics(uri, self._document(uri).version)

    def _hover_text(self, definitions) -> str | None:
        chunks: list[str] = []
        for definition in definitions:
            description = getattr(definition, "description", "") or definition.name
            doc = definition.docstring(raw=False).strip()
            block = description if not doc else f"{description}\\n\\n{doc}"
            if block and block not in chunks:
                chunks.append(block)

        if not chunks:
            return None

        return "\\n\\n---\\n\\n".join(chunks)

    def _initialize(self, params: dict) -> dict:
        root_uri = params.get("rootUri")
        if not root_uri and params.get("workspaceFolders"):
            root_uri = params["workspaceFolders"][0].get("uri")
        self._refresh_project(root_uri)
        capabilities = {
            "textDocumentSync": TEXT_DOCUMENT_SYNC_FULL,
            "positionEncoding": "utf-16",
        }
        if Script is not None:
            capabilities.update(
                {
                    "completionProvider": {
                        "triggerCharacters": [".", "(", "[", '"', "'"],
                        "resolveProvider": True,
                    },
                    "hoverProvider": True,
                    "definitionProvider": True,
                    "documentSymbolProvider": True,
                    "signatureHelpProvider": {"triggerCharacters": ["(", ","]},
                }
            )
        return {
            "capabilities": capabilities,
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    def _shutdown(self, _params: dict | None = None):
        self.shutdown_requested = True
        self._invalidate_analysis()
        return None

    def _completion(self, params: dict) -> dict:
        position = params["position"]
        uri = params["textDocument"]["uri"]
        document = self._document(uri)
        completions = self._script(uri).complete(
            line=position["line"] + 1,
            column=document.python_column(position),
        )
        incomplete = len(completions) > MAX_COMPLETION_ITEMS
        completions = completions[:MAX_COMPLETION_ITEMS]
        self._completion_sequence += 1
        token = self._completion_sequence
        self._completion_results[token] = (uri, document.version, completions, {})
        while len(self._completion_results) > MAX_COMPLETION_RESULTS:
            self._completion_results.popitem(last=False)
        items = []
        for index, completion in enumerate(completions):
            items.append({
                "label": completion.name_with_symbols or completion.name,
                "kind": self._completion_kind(completion.type),
                "detail": completion.type,
                "insertText": completion.complete or completion.name,
                "data": {"wasmIdleCompletion": token, "index": index},
            })
        return {"isIncomplete": incomplete, "items": items}

    def _completion_resolve(self, params: dict) -> dict:
        # Never reinterpret a stale token against a new source or a different completion list.
        data = params.get("data")
        if not isinstance(data, dict):
            return params
        token, index = data.get("wasmIdleCompletion"), data.get("index")
        if type(token) is not int or type(index) is not int:
            return params
        cached = self._completion_results.get(token)
        if cached is None:
            return params
        uri, version, completions, docs = cached
        document = self.documents.get(uri)
        if document is None or document.version != version or not 0 <= index < len(completions):
            return params
        completion = completions[index]
        if params.get("label") != (completion.name_with_symbols or completion.name):
            return params
        try:
            if index not in docs:
                docs[index] = completion.docstring(raw=False).strip()
            doc = docs[index]
        except Exception:
            return params
        if not doc:
            return params
        return {**params, "documentation": doc}

    def _signature_help(self, params: dict) -> dict | None:
        position = params["position"]
        uri = params["textDocument"]["uri"]
        signatures = self._script(uri).get_signatures(
            line=position["line"] + 1,
            column=self._document(uri).python_column(position),
        )
        if not signatures:
            return None

        items = []
        for signature in signatures:
            items.append(
                {
                    "label": signature.to_string(),
                    "documentation": signature.docstring(raw=False).strip() or None,
                    "parameters": [
                        {"label": parameter.to_string()} for parameter in signature.params
                    ],
                }
            )

        return {"signatures": items, "activeSignature": 0, "activeParameter": 0}

    def _hover(self, params: dict) -> dict | None:
        position = params["position"]
        uri = params["textDocument"]["uri"]
        definitions = self._script(uri).infer(
            line=position["line"] + 1,
            column=self._document(uri).python_column(position),
        )
        hover_text = self._hover_text(definitions)
        if not hover_text:
            return None
        return {"contents": {"kind": "markdown", "value": hover_text}}

    def _definition(self, params: dict) -> list[dict] | None:
        position = params["position"]
        uri = params["textDocument"]["uri"]
        definitions = self._script(uri).goto(
            line=position["line"] + 1,
            column=self._document(uri).python_column(position),
            follow_imports=True,
            follow_builtin_imports=True,
        )
        locations = [
            location
            for location in (
                self._location_for_name(definition, params["textDocument"]["uri"])
                for definition in definitions
            )
            if location is not None
        ]
        return locations or None

    def _document_symbols(self, params: dict) -> list[dict]:
        names = self._script(params["textDocument"]["uri"]).get_names(
            all_scopes=True,
            definitions=True,
            references=False,
        )
        symbols = []
        for name in names:
            location = self._location_for_name(name, params["textDocument"]["uri"])
            if location is None:
                continue
            symbols.append(
                {
                    "name": name.name,
                    "kind": self._symbol_kind(name.type),
                    "location": location,
                    "containerName": getattr(name, "full_name", None) or name.name,
                }
            )
        return symbols

    def _handle_request(self, msg_id, method: str, params: dict) -> None:
        try:
            handlers = {
                "initialize": self._initialize,
                "shutdown": self._shutdown,
            }
            if Script is not None:
                handlers.update(
                    {
                        "textDocument/completion": self._completion,
                        "completionItem/resolve": self._completion_resolve,
                        "textDocument/signatureHelp": self._signature_help,
                        "textDocument/hover": self._hover,
                        "textDocument/definition": self._definition,
                        "textDocument/documentSymbol": self._document_symbols,
                    }
                )
            handler = handlers.get(method)
            if handler is None:
                self._respond(
                    msg_id,
                    error={"code": -32601, "message": f"Method not found: {method}"},
                )
                return
            self._respond(msg_id, result=handler(params))
        except Exception as error:
            self._respond(
                msg_id,
                error={"code": -32603, "message": str(error) or "Internal server error"},
            )

    def _handle_notification(self, method: str, params: dict) -> None:
        try:
            if method == "wasmIdle/publishDiagnostics":
                document = self.documents.get(params.get("uri"))
                if not self.shutdown_requested and document is not None and document.version == params.get("version"):
                    self._publish_diagnostics(document.uri)
                return
            if method == "initialized":
                return
            if method == "exit":
                self.shutdown_requested = True
                self._invalidate_analysis()
                return
            if method == "workspace/didChangeWatchedFiles":
                self._invalidate_analysis()
                return
            if method == "textDocument/didOpen":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                self.documents[text_document["uri"]] = Document(
                    uri=text_document["uri"],
                    source=text_document.get("text", ""),
                    version=text_document.get("version"),
                    language_id=text_document.get("languageId"),
                )
                self._mirror_document(text_document["uri"])
                self._queue_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didChange":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                for change in params.get("contentChanges", []):
                    document.apply_change(change)
                document.version = text_document.get("version")
                self._mirror_document(text_document["uri"])
                self._queue_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didSave":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                if "text" in params and params["text"] is not None:
                    document.source = params["text"]
                self._mirror_document(text_document["uri"])
                self._queue_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didClose":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                self.documents.pop(text_document["uri"], None)
                if schedule_diagnostics is not None:
                    schedule_diagnostics(text_document["uri"], None, True)
                self._notify(
                    "textDocument/publishDiagnostics",
                    {"uri": text_document["uri"], "diagnostics": []},
                )
        except Exception:
            return


def create_bridge():
    server = WasmIdlePythonLsp()
    return server.handle
`)}async function $(e){if(!U)return W||(W=R(K,async()=>{self.postMessage({type:`progress`,stage:`load-pyodide`});let{loadPyodide:t}=await import(
/* @vite-ignore */
`${Q(e)}pyodide.mjs`);H=await V(Q(e),await q,()=>t({indexURL:Q(e)})),H.registerJsModule(`wasm_idle_lsp_bridge`,{emit:ce,schedule_diagnostics:oe}),self.postMessage({type:`progress`,stage:`load-jedi`});try{await H.loadPackage(`jedi`)}catch(e){console.warn(`Python LSP semantic features disabled because jedi failed to load`,e)}le(H),await H.runPythonAsync(`
import sys

if "/wasm_idle_lsp" not in sys.path:
    sys.path.insert(0, "/wasm_idle_lsp")

from wasm_idle_python_lsp import create_bridge

_wasm_idle_python_lsp_bridge = create_bridge()
`);let n=H.globals.get(`_wasm_idle_python_lsp_bridge`);U=e=>{n(e)},self.postMessage({type:`ready`})}).catch(e=>{let t=se(e);throw console.error(`Python LSP bootstrap failed`,e),self.postMessage({type:`error`,error:t}),W=null,U=null,e}),W)}self.addEventListener(`message`,e=>{let t=e.data;if(t&&typeof t==`object`){if(t.type===`runtime-module`){t.module instanceof WebAssembly.Module?J?.(t.module):Y?.(Error(String(t.error||`Python runtime module unavailable`))),J=void 0,Y=void 0;return}if(t.type===`init`){if(typeof t.pyodideBaseUrl!=`string`||!t.pyodideBaseUrl.trim()){self.postMessage({type:`error`,error:`Python LSP init requires an explicit pyodideBaseUrl`});return}G=t.pyodideBaseUrl.trim(),t.runtimeModuleBridge===!0&&(q=new Promise((e,t)=>{J=e,Y=t}),q.catch(()=>{}),self.postMessage({type:`runtime-module-request`})),t.persistentAssets&&typeof t.persistentAssets==`object`&&(K=t.persistentAssets,A(K)),$(G).catch(e=>{console.error(`Failed to initialize Python LSP worker`,e)});return}if(!(`type`in t)){if(!G){self.postMessage({type:`error`,error:`Python LSP worker requires init before JSON-RPC messages`});return}if(U){Z.push(t);return}$(G).then(()=>{Z.push(t)}).catch(e=>{console.error(`Failed to forward LSP message to Python bridge`,e)})}}});