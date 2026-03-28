var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,ee=c.length,u;l<ee;l++)u=c[l],!a.call(e,u)&&u!==o&&t(e,u,{get:(e=>i[e]).bind(null,u),enumerable:!(s=n(i,u))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n)),l=(e=>typeof require<`u`?require:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof require<`u`?require:e)[t]}):e)(function(e){if(typeof require<`u`)return require.apply(this,arguments);throw Error('Calling `require` for "'+e+"\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.")}),ee=Object.defineProperty,u=(e,t)=>ee(e,`name`,{value:t,configurable:!0}),d=(e=>typeof l<`u`?l:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof l<`u`?l:e)[t]}):e)(function(e){if(typeof l<`u`)return l.apply(this,arguments);throw Error(`Dynamic require of "`+e+`" is not supported`)}),te=(()=>{for(var e=new Uint8Array(128),t=0;t<64;t++)e[t<26?t+65:t<52?t+71:t<62?t-4:t*4-205]=t;return t=>{for(var n=t.length,r=new Uint8Array((n-(t[n-1]==`=`)-(t[n-2]==`=`))*3/4|0),i=0,a=0;i<n;){var o=e[t.charCodeAt(i++)],s=e[t.charCodeAt(i++)],c=e[t.charCodeAt(i++)],l=e[t.charCodeAt(i++)];r[a++]=o<<2|s>>4,r[a++]=s<<4|c>>2,r[a++]=c<<6|l}return r}})();function ne(e){return!isNaN(parseFloat(e))&&isFinite(e)}u(ne,`_isNumber`);function f(e){return e.charAt(0).toUpperCase()+e.substring(1)}u(f,`_capitalize`);function p(e){return function(){return this[e]}}u(p,`_getter`);var m=[`isConstructor`,`isEval`,`isNative`,`isToplevel`],h=[`columnNumber`,`lineNumber`],g=[`fileName`,`functionName`,`source`],_=m.concat(h,g,[`args`],[`evalOrigin`]);function v(e){if(e)for(var t=0;t<_.length;t++)e[_[t]]!==void 0&&this[`set`+f(_[t])](e[_[t]])}for(u(v,`StackFrame`),v.prototype={getArgs:u(function(){return this.args},`getArgs`),setArgs:u(function(e){if(Object.prototype.toString.call(e)!==`[object Array]`)throw TypeError(`Args must be an Array`);this.args=e},`setArgs`),getEvalOrigin:u(function(){return this.evalOrigin},`getEvalOrigin`),setEvalOrigin:u(function(e){if(e instanceof v)this.evalOrigin=e;else if(e instanceof Object)this.evalOrigin=new v(e);else throw TypeError(`Eval Origin must be an Object or StackFrame`)},`setEvalOrigin`),toString:u(function(){var e=this.getFileName()||``,t=this.getLineNumber()||``,n=this.getColumnNumber()||``,r=this.getFunctionName()||``;return this.getIsEval()?e?`[eval] (`+e+`:`+t+`:`+n+`)`:`[eval]:`+t+`:`+n:r?r+` (`+e+`:`+t+`:`+n+`)`:e+`:`+t+`:`+n},`toString`)},v.fromString=u(function(e){var t=e.indexOf(`(`),n=e.lastIndexOf(`)`),r=e.substring(0,t),i=e.substring(t+1,n).split(`,`),a=e.substring(n+1);if(a.indexOf(`@`)===0)var o=/@(.+?)(?::(\d+))?(?::(\d+))?$/.exec(a,``),s=o[1],c=o[2],l=o[3];return new v({functionName:r,args:i||void 0,fileName:s,lineNumber:c||void 0,columnNumber:l||void 0})},`StackFrame$$fromString`),y=0;y<m.length;y++)v.prototype[`get`+f(m[y])]=p(m[y]),v.prototype[`set`+f(m[y])]=function(e){return function(t){this[e]=!!t}}(m[y]);var y;for(b=0;b<h.length;b++)v.prototype[`get`+f(h[b])]=p(h[b]),v.prototype[`set`+f(h[b])]=function(e){return function(t){if(!ne(t))throw TypeError(e+` must be a Number`);this[e]=Number(t)}}(h[b]);var b;for(x=0;x<g.length;x++)v.prototype[`get`+f(g[x])]=p(g[x]),v.prototype[`set`+f(g[x])]=function(e){return function(t){this[e]=String(t)}}(g[x]);var x,S=v;function C(){var e=/^\s*at .*(\S+:\d+|\(native\))/m,t=/^(eval@)?(\[native code])?$/;return{parse:u(function(t){if(t.stack&&t.stack.match(e))return this.parseV8OrIE(t);if(t.stack)return this.parseFFOrSafari(t);throw Error(`Cannot parse given Error object`)},`ErrorStackParser$$parse`),extractLocation:u(function(e){if(e.indexOf(`:`)===-1)return[e];var t=/(.+?)(?::(\d+))?(?::(\d+))?$/.exec(e.replace(/[()]/g,``));return[t[1],t[2]||void 0,t[3]||void 0]},`ErrorStackParser$$extractLocation`),parseV8OrIE:u(function(t){return t.stack.split(`
`).filter(function(t){return!!t.match(e)},this).map(function(e){e.indexOf(`(eval `)>-1&&(e=e.replace(/eval code/g,`eval`).replace(/(\(eval at [^()]*)|(,.*$)/g,``));var t=e.replace(/^\s+/,``).replace(/\(eval code/g,`(`).replace(/^.*?\s+/,``),n=t.match(/ (\(.+\)$)/);t=n?t.replace(n[0],``):t;var r=this.extractLocation(n?n[1]:t);return new S({functionName:n&&t||void 0,fileName:[`eval`,`<anonymous>`].indexOf(r[0])>-1?void 0:r[0],lineNumber:r[1],columnNumber:r[2],source:e})},this)},`ErrorStackParser$$parseV8OrIE`),parseFFOrSafari:u(function(e){return e.stack.split(`
`).filter(function(e){return!e.match(t)},this).map(function(e){if(e.indexOf(` > eval`)>-1&&(e=e.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g,`:$1`)),e.indexOf(`@`)===-1&&e.indexOf(`:`)===-1)return new S({functionName:e});var t=/((.*".+"[^@]*)?[^@]*)(?:@)/,n=e.match(t),r=n&&n[1]?n[1]:void 0,i=this.extractLocation(e.replace(t,``));return new S({functionName:r,fileName:i[0],lineNumber:i[1],columnNumber:i[2],source:e})},this)},`ErrorStackParser$$parseFFOrSafari`)}}u(C,`ErrorStackParser`);var re=new C;function ie(){return typeof API<`u`&&API!==globalThis.API?API.runtimeEnv:ae({IN_BUN:typeof Bun<`u`,IN_DENO:typeof Deno<`u`,IN_NODE:typeof process==`object`&&typeof process.versions==`object`&&typeof process.versions.node==`string`&&!process.browser,IN_SAFARI:typeof navigator==`object`&&typeof navigator.userAgent==`string`&&navigator.userAgent.indexOf(`Chrome`)===-1&&navigator.userAgent.indexOf(`Safari`)>-1,IN_SHELL:typeof read==`function`&&typeof load==`function`})}u(ie,`getGlobalRuntimeEnv`);var w=ie();function ae(e){let t=e.IN_NODE&&typeof module<`u`&&module.exports&&typeof d==`function`&&typeof __dirname==`string`,n=e.IN_NODE&&!t,r=!e.IN_NODE&&!e.IN_DENO&&!e.IN_BUN,i=r&&typeof window<`u`&&typeof window.document<`u`&&typeof document.createElement==`function`&&`sessionStorage`in window&&typeof globalThis.importScripts!=`function`,a=r&&typeof globalThis.WorkerGlobalScope<`u`&&typeof globalThis.self<`u`&&globalThis.self instanceof globalThis.WorkerGlobalScope;return{...e,IN_BROWSER:r,IN_BROWSER_MAIN_THREAD:i,IN_BROWSER_WEB_WORKER:a,IN_NODE_COMMONJS:t,IN_NODE_ESM:n}}u(ae,`calculateDerivedFlags`);var oe,T,se,ce,E;async function D(){if(!w.IN_NODE||(oe=(await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1))).default,ce=await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1)),E=await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1)),se=(await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1))).default,T=await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1)),j=T.sep,typeof d<`u`))return;let e={fs:ce,crypto:await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1)),ws:await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1)),child_process:await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1))};globalThis.require=function(t){return e[t]}}u(D,`initNodeModules`);function O(e,t){return T.resolve(t||`.`,e)}u(O,`node_resolvePath`);function k(e,t){return t===void 0&&(t=location),new URL(e,t).toString()}u(k,`browser_resolvePath`);var A=w.IN_NODE?O:w.IN_SHELL?u(e=>e,`resolvePath`):k,j;w.IN_NODE||(j=`/`);function M(e,t){return e.startsWith(`file://`)&&(e=e.slice(7)),e.includes(`://`)?{response:fetch(e)}:{binary:E.readFile(e).then(e=>new Uint8Array(e.buffer,e.byteOffset,e.byteLength))}}u(M,`node_getBinaryResponse`);function N(e,t){if(e.startsWith(`file://`)&&(e=e.slice(7)),e.includes(`://`))throw Error(`Shell cannot fetch urls`);return{binary:Promise.resolve(new Uint8Array(readbuffer(e)))}}u(N,`shell_getBinaryResponse`);function P(e,t){let n=new URL(e,location);return{response:fetch(n,t?{integrity:t}:{})}}u(P,`browser_getBinaryResponse`);var F=w.IN_NODE?M:w.IN_SHELL?N:P;async function I(e,t){let{response:n,binary:r}=F(e,t);if(r)return r;let i=await n;if(!i.ok)throw Error(`Failed to load '${e}': request failed.`);return new Uint8Array(await i.arrayBuffer())}u(I,`loadBinaryFile`);var L;if(w.IN_BROWSER_MAIN_THREAD)L=u(async e=>await import(e),`loadScript`);else if(w.IN_BROWSER_WEB_WORKER)L=u(async e=>{try{globalThis.importScripts(e)}catch(t){if(t instanceof TypeError)await import(e);else throw t}},`loadScript`);else if(w.IN_NODE)L=R;else if(w.IN_SHELL)L=load;else throw Error(`Cannot determine runtime environment`);async function R(e){e.startsWith(`file://`)&&(e=e.slice(7)),e.includes(`://`)?se.runInThisContext(await(await fetch(e)).text()):await import(oe.pathToFileURL(e).href)}u(R,`nodeLoadScript`);async function z(e){if(w.IN_NODE){await D();let t=await E.readFile(e,{encoding:`utf8`});return JSON.parse(t)}else if(w.IN_SHELL){let t=read(e);return JSON.parse(t)}else return await(await fetch(e)).json()}u(z,`loadLockFile`);async function B(){if(w.IN_NODE_COMMONJS)return __dirname;let e;try{throw Error()}catch(t){e=t}let t=re.parse(e)[0].fileName;if(w.IN_NODE&&!t.startsWith(`file://`)&&(t=`file://${t}`),w.IN_NODE_ESM){let e=await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1));return(await import(`./chunks/B1WanDny.js`).then(e=>c(e.default,1))).fileURLToPath(e.dirname(t))}let n=t.lastIndexOf(j);if(n===-1)throw Error(`Could not extract indexURL path from pyodide module location. Please pass the indexURL explicitly to loadPyodide.`);return t.slice(0,n)}u(B,`calculateDirname`);function V(e){return e.substring(0,e.lastIndexOf(`/`)+1)||globalThis.location?.toString()||`.`}u(V,`calculateInstallBaseUrl`);function H(e){let t=e.FS,n=e.FS.filesystems.MEMFS,r=e.PATH,i={DIR_MODE:16895,FILE_MODE:33279,mount:u(function(e){if(!e.opts.fileSystemHandle)throw Error(`opts.fileSystemHandle is required`);return n.mount.apply(null,arguments)},`mount`),syncfs:u(async(e,t,n)=>{try{let r=i.getLocalSet(e),a=await i.getRemoteSet(e),o=t?a:r,s=t?r:a;await i.reconcile(e,o,s),n(null)}catch(e){n(e)}},`syncfs`),getLocalSet:u(e=>{let n=Object.create(null);function i(e){return e!==`.`&&e!==`..`}u(i,`isRealDir`);function a(e){return t=>r.join2(e,t)}u(a,`toAbsolute`);let o=t.readdir(e.mountpoint).filter(i).map(a(e.mountpoint));for(;o.length;){let e=o.pop(),r=t.stat(e);t.isDir(r.mode)&&o.push.apply(o,t.readdir(e).filter(i).map(a(e))),n[e]={timestamp:r.mtime,mode:r.mode}}return{type:`local`,entries:n}},`getLocalSet`),getRemoteSet:u(async e=>{let t=Object.create(null),n=await le(e.opts.fileSystemHandle);for(let[a,o]of n)a!==`.`&&(t[r.join2(e.mountpoint,a)]={timestamp:o.kind===`file`?new Date((await o.getFile()).lastModified):new Date,mode:o.kind===`file`?i.FILE_MODE:i.DIR_MODE});return{type:`remote`,entries:t,handles:n}},`getRemoteSet`),loadLocalEntry:u(e=>{let r=t.lookupPath(e,{}).node,i=t.stat(e);if(t.isDir(i.mode))return{timestamp:i.mtime,mode:i.mode};if(t.isFile(i.mode))return r.contents=n.getFileDataAsTypedArray(r),{timestamp:i.mtime,mode:i.mode,contents:r.contents};throw Error(`node type not supported`)},`loadLocalEntry`),storeLocalEntry:u((e,n)=>{if(t.isDir(n.mode))t.mkdirTree(e,n.mode);else if(t.isFile(n.mode))t.writeFile(e,n.contents,{canOwn:!0});else throw Error(`node type not supported`);t.chmod(e,n.mode),t.utime(e,n.timestamp,n.timestamp)},`storeLocalEntry`),removeLocalEntry:u(e=>{var n=t.stat(e);t.isDir(n.mode)?t.rmdir(e):t.isFile(n.mode)&&t.unlink(e)},`removeLocalEntry`),loadRemoteEntry:u(async e=>{if(e.kind===`file`){let t=await e.getFile();return{contents:new Uint8Array(await t.arrayBuffer()),mode:i.FILE_MODE,timestamp:new Date(t.lastModified)}}else{if(e.kind===`directory`)return{mode:i.DIR_MODE,timestamp:new Date};throw Error(`unknown kind: `+e.kind)}},`loadRemoteEntry`),storeRemoteEntry:u(async(e,n,i)=>{let a=e.get(r.dirname(n)),o=t.isFile(i.mode)?await a.getFileHandle(r.basename(n),{create:!0}):await a.getDirectoryHandle(r.basename(n),{create:!0});if(o.kind===`file`){let e=await o.createWritable();await e.write(i.contents),await e.close()}e.set(n,o)},`storeRemoteEntry`),removeRemoteEntry:u(async(e,t)=>{await e.get(r.dirname(t)).removeEntry(r.basename(t)),e.delete(t)},`removeRemoteEntry`),reconcile:u(async(e,n,a)=>{let o=0,s=[];Object.keys(n.entries).forEach(function(e){let r=n.entries[e],i=a.entries[e];(!i||t.isFile(r.mode)&&r.timestamp.getTime()>i.timestamp.getTime())&&(s.push(e),o++)}),s.sort();let c=[];if(Object.keys(a.entries).forEach(function(e){n.entries[e]||(c.push(e),o++)}),c.sort().reverse(),!o)return;let l=n.type===`remote`?n.handles:a.handles;for(let t of s){let n=r.normalize(t.replace(e.mountpoint,`/`)).substring(1);if(a.type===`local`){let e=l.get(n),r=await i.loadRemoteEntry(e);i.storeLocalEntry(t,r)}else{let e=i.loadLocalEntry(t);await i.storeRemoteEntry(l,n,e)}}for(let t of c)if(a.type===`local`)i.removeLocalEntry(t);else{let n=r.normalize(t.replace(e.mountpoint,`/`)).substring(1);await i.removeRemoteEntry(l,n)}},`reconcile`)};e.FS.filesystems.NATIVEFS_ASYNC=i}u(H,`initializeNativeFS`);var le=u(async e=>{let t=[];async function n(e){for await(let r of e.values())t.push(r),r.kind===`directory`&&await n(r)}u(n,`collect`),await n(e);let r=new Map;r.set(`.`,e);for(let n of t){let t=(await e.resolve(n)).join(`/`);r.set(t,n)}return r},`getFsHandles`),ue=te(`AGFzbQEAAAABDANfAGAAAW9gAW8BfwMDAgECByECD2NyZWF0ZV9zZW50aW5lbAAAC2lzX3NlbnRpbmVsAAEKEwIHAPsBAPsbCwkAIAD7GvsUAAs=`),de=async function(){if(!(globalThis.navigator&&(/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform===`MacIntel`&&typeof navigator.maxTouchPoints<`u`&&navigator.maxTouchPoints>1)))try{let e=await WebAssembly.compile(ue);return await WebAssembly.instantiate(e)}catch(e){if(e instanceof WebAssembly.CompileError)return;throw e}}();async function U(){let e=await de;if(e)return e.exports;let t=Symbol(`error marker`);return{create_sentinel:u(()=>t,`create_sentinel`),is_sentinel:u(e=>e===t,`is_sentinel`)}}u(U,`getSentinelImport`);function W(e){let t={config:e,runtimeEnv:w},n={noImageDecoding:!0,noAudioDecoding:!0,noWasmDecoding:!1,preRun:me(e),print:e.stdout,printErr:e.stderr,onExit(e){n.exitCode=e},thisProgram:e._sysExecutable,arguments:e.args,API:t,locateFile:u(t=>e.indexURL+t,`locateFile`),instantiateWasm:he(e.indexURL)};return n}u(W,`createSettings`);function G(e){return function(t){try{t.FS.mkdirTree(e)}catch(t){console.error(`Error occurred while making a home directory '${e}':`),console.error(t),console.error(`Using '/' for a home directory instead`),e=`/`}t.FS.chdir(e)}}u(G,`createHomeDirectory`);function K(e){return function(t){Object.assign(t.ENV,e)}}u(K,`setEnvironment`);function q(e){return e?[async t=>{t.addRunDependency(`fsInitHook`);try{await e(t.FS,{sitePackages:t.API.sitePackages})}finally{t.removeRunDependency(`fsInitHook`)}}]:[]}u(q,`callFsInitHook`);function fe(e){let t=e.HEAPU32[e._Py_Version>>>2];return[t>>>24&255,t>>>16&255,t>>>8&255]}u(fe,`computeVersionTuple`);function pe(e){let t=I(e);return async e=>{e.API.pyVersionTuple=fe(e);let[n,r]=e.API.pyVersionTuple;e.FS.mkdirTree(`/lib`),e.API.sitePackages=`/lib/python${n}.${r}/site-packages`,e.FS.mkdirTree(e.API.sitePackages),e.addRunDependency(`install-stdlib`);try{let i=await t;e.FS.writeFile(`/lib/python${n}${r}.zip`,i)}catch(e){console.error(`Error occurred while installing the standard library:`),console.error(e)}finally{e.removeRunDependency(`install-stdlib`)}}}u(pe,`installStdlib`);function me(e){let t;return t=e.stdLibURL==null?e.indexURL+`python_stdlib.zip`:e.stdLibURL,[pe(t),G(e.env.HOME),K(e.env),H,...q(e.fsInit)]}u(me,`getFileSystemInitializationFuncs`);function he(e){if(typeof WasmOffsetConverter<`u`)return;let{binary:t,response:n}=F(e+`pyodide.asm.wasm`),r=U();return function(e,i){return async function(){e.sentinel=await r;try{let r;r=n?await WebAssembly.instantiateStreaming(n,e):await WebAssembly.instantiate(await t,e);let{instance:a,module:o}=r;i(a,o)}catch(e){console.warn(`wasm instantiation failed!`),console.warn(e)}}(),{}}}u(he,`getInstantiateWasmFunc`);var ge=`0.29.3`;function J(e){return e===void 0||e.endsWith(`/`)?e:e+`/`}u(J,`withTrailingSlash`);var _e=ge;async function ve(e={}){if(await D(),e.lockFileContents&&e.lockFileURL)throw Error(`Can't pass both lockFileContents and lockFileURL`);let t=e.indexURL||await B();if(t=J(A(t)),e.packageBaseUrl=J(e.packageBaseUrl),e.cdnUrl=J(e.packageBaseUrl??`https://cdn.jsdelivr.net/pyodide/v0.29.3/full/`),!e.lockFileContents){let n=e.lockFileURL??t+`pyodide-lock.json`;e.lockFileContents=z(n),e.packageBaseUrl??=V(n)}e.indexURL=t,e.packageCacheDir&&=J(A(e.packageCacheDir));let n={fullStdLib:!1,jsglobals:globalThis,stdin:globalThis.prompt?()=>globalThis.prompt():void 0,args:[],env:{},packages:[],packageCacheDir:e.packageBaseUrl,enableRunUntilComplete:!0,checkAPIVersion:!0,BUILD_ID:`b7b7b0f46eb68e65c029c0dc739270e8a5d35251e9aab6014ee1c2f630e5d1d0`},r=Object.assign(n,e);return r.env.HOME??=`/home/pyodide`,r.env.PYTHONINSPECT??=`1`,r}u(ve,`initializeConfiguration`);function ye(e){let t=W(e),n=t.API;return n.lockFilePromise=Promise.resolve(e.lockFileContents),t}u(ye,`createEmscriptenSettings`);async function be(e){if(typeof _createPyodideModule!=`function`){let t=`${e.indexURL}pyodide.asm.js`;await L(t)}}u(be,`loadWasmScript`);async function Y(e,t){if(!e._loadSnapshot)return;let n=await e._loadSnapshot,r=ArrayBuffer.isView(n)?n:new Uint8Array(n);return t.noInitialRun=!0,t.INITIAL_MEMORY=r.length,r}u(Y,`prepareSnapshot`);async function xe(e){let t=await _createPyodideModule(e);if(e.exitCode!==void 0)throw new t.ExitStatus(e.exitCode);return t}u(xe,`createPyodideModule`);function Se(e,t){let n=e.API;if(t.pyproxyToStringRepr&&n.setPyProxyToStringMethod(!0),t.convertNullToNone&&n.setCompatNullToNone(!0),t.toJsLiteralMap&&n.setCompatToJsLiteralMap(!0),n.version!==`0.29.3`&&t.checkAPIVersion)throw Error(`Pyodide version does not match: '${_e}' <==> '${n.version}'. If you updated the Pyodide version, make sure you also updated the 'indexURL' parameter passed to loadPyodide.`);e.locateFile=e=>{throw e.endsWith(`.so`)?Error(`Failed to find dynamic library "${e}"`):Error(`Unexpected call to locateFile("${e}")`)}}u(Se,`configureAPI`);function Ce(e,t,n){let r=e.API,i;return t&&(i=r.restoreSnapshot(t)),r.finalizeBootstrap(i,n._snapshotDeserializer)}u(Ce,`bootstrapPyodide`);async function we(e,t){let n=e._api;return n.sys.path.insert(0,``),n._pyodide.set_excepthook(),await n.packageIndexReady,n.initializeStreams(t.stdin,t.stdout,t.stderr),e}u(we,`finalizeSetup`);async function Te(e={}){let t=await ve(e),n=ye(t);await be(t);let r=await Y(t,n),i=await xe(n);return Se(i,t),await we(Ce(i,r,t),t)}u(Te,`loadPyodide`);var Ee=`from .server import create_bridge

__all__ = ["create_bridge"]
`,De=`from __future__ import annotations

import ast
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from jedi import Project, Script

from arcturus_lsp_bridge import emit

SERVER_NAME = "arcturus-python-lsp"
SERVER_VERSION = "0.2.0"
WORKSPACE_ROOT = "/workspace"

TEXT_DOCUMENT_SYNC_FULL = 1
DIAGNOSTIC_SEVERITY_ERROR = 1

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


def _path_to_uri(path: Path) -> str:
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
        lines = self.source.splitlines(True)
        return lines or [""]

    def offset_at(self, position: dict) -> int:
        line = max(int(position.get("line", 0)), 0)
        character = max(int(position.get("character", 0)), 0)
        lines = self.lines
        if line >= len(lines):
            return len(self.source)

        offset = sum(len(lines[idx]) for idx in range(line))
        return offset + min(character, len(lines[line]))

    def apply_change(self, change: dict) -> None:
        if "range" not in change or change["range"] is None:
            self.source = change.get("text", "")
            return

        change_range = change["range"]
        start = self.offset_at(change_range["start"])
        end = self.offset_at(change_range["end"])
        self.source = self.source[:start] + change.get("text", "") + self.source[end:]


class ArcturusPythonLsp:
    def __init__(self) -> None:
        self.workspace_root = WORKSPACE_ROOT
        Path(self.workspace_root).mkdir(parents=True, exist_ok=True)
        self.project = Project(
            path=self.workspace_root,
            smart_sys_path=True,
            load_unsafe_extensions=False,
        )
        self.documents: dict[str, Document] = {}
        self.shutdown_requested = False

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
        self.project = Project(
            path=self.workspace_root,
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
        document = self._document(uri)
        return Script(code=document.source, path=document.path, project=self.project)

    def _range_for_name(self, name) -> dict | None:
        if name.line is None or name.column is None:
            return None

        return {
            "start": {"line": name.line - 1, "character": name.column},
            "end": {"line": name.line - 1, "character": name.column + len(name.name)},
        }

    def _location_for_name(self, name, fallback_uri: str) -> dict | None:
        range_value = self._range_for_name(name)
        if range_value is None:
            return None

        module_path = getattr(name, "module_path", None)
        uri = fallback_uri
        if module_path is not None:
            uri = _path_to_uri(Path(module_path))

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
                        "start": {"line": line, "character": column},
                        "end": {"line": line, "character": column + 1},
                    },
                    "severity": DIAGNOSTIC_SEVERITY_ERROR,
                    "source": SERVER_NAME,
                    "message": error.msg or "Syntax error",
                }
            )

        self._notify(
            "textDocument/publishDiagnostics",
            {"uri": uri, "diagnostics": diagnostics},
        )

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
        return {
            "capabilities": {
                "textDocumentSync": TEXT_DOCUMENT_SYNC_FULL,
                "completionProvider": {
                    "triggerCharacters": [".", "(", "[", '"', "'"],
                    "resolveProvider": False,
                },
                "hoverProvider": True,
                "definitionProvider": True,
                "documentSymbolProvider": True,
                "signatureHelpProvider": {"triggerCharacters": ["(", ","]},
            },
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    def _shutdown(self):
        self.shutdown_requested = True
        return None

    def _completion(self, params: dict) -> dict:
        position = params["position"]
        completions = self._script(params["textDocument"]["uri"]).complete(
            line=position["line"] + 1,
            column=position["character"],
        )
        items = []
        for completion in completions:
            item = {
                "label": completion.name_with_symbols or completion.name,
                "kind": self._completion_kind(completion.type),
                "detail": completion.type,
                "insertText": completion.complete or completion.name,
            }
            doc = completion.docstring(raw=False).strip()
            if doc:
                item["documentation"] = doc
            items.append(item)
        return {"isIncomplete": False, "items": items}

    def _signature_help(self, params: dict) -> dict | None:
        position = params["position"]
        signatures = self._script(params["textDocument"]["uri"]).get_signatures(
            line=position["line"] + 1,
            column=position["character"],
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
        definitions = self._script(params["textDocument"]["uri"]).infer(
            line=position["line"] + 1,
            column=position["character"],
        )
        hover_text = self._hover_text(definitions)
        if not hover_text:
            return None
        return {"contents": {"kind": "markdown", "value": hover_text}}

    def _definition(self, params: dict) -> list[dict] | None:
        position = params["position"]
        definitions = self._script(params["textDocument"]["uri"]).goto(
            line=position["line"] + 1,
            column=position["character"],
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
                "textDocument/completion": self._completion,
                "textDocument/signatureHelp": self._signature_help,
                "textDocument/hover": self._hover,
                "textDocument/definition": self._definition,
                "textDocument/documentSymbol": self._document_symbols,
            }
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
            if method == "initialized":
                return
            if method == "exit":
                self.shutdown_requested = True
                return
            if method == "textDocument/didOpen":
                text_document = params["textDocument"]
                self.documents[text_document["uri"]] = Document(
                    uri=text_document["uri"],
                    source=text_document.get("text", ""),
                    version=text_document.get("version"),
                    language_id=text_document.get("languageId"),
                )
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didChange":
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                for change in params.get("contentChanges", []):
                    document.apply_change(change)
                document.version = text_document.get("version")
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didSave":
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                if "text" in params and params["text"] is not None:
                    document.source = params["text"]
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didClose":
                text_document = params["textDocument"]
                self.documents.pop(text_document["uri"], None)
                self._notify(
                    "textDocument/publishDiagnostics",
                    {"uri": text_document["uri"], "diagnostics": []},
                )
        except Exception:
            return


def create_bridge():
    server = ArcturusPythonLsp()
    return server.handle
`;let X=null,Z=null,Q=null,$=`/pyodide/`;function Oe(e){return e instanceof Error?e.message:String(e)}function ke(e){return e.endsWith(`/`)?e:`${e}/`}function Ae(e){try{self.postMessage(JSON.parse(e))}catch(t){console.error(`Failed to emit Python LSP payload`,t,e)}}function je(e){e.FS.mkdirTree(`/arcturus_lsp/arcturus_python_lsp`),e.FS.writeFile(`/arcturus_lsp/arcturus_python_lsp/__init__.py`,Ee),e.FS.writeFile(`/arcturus_lsp/arcturus_python_lsp/server.py`,De)}async function Me(e){if(!Z)return Q||(Q=(async()=>{self.postMessage({type:`progress`,stage:`load-pyodide`}),X=await Te({indexURL:ke(e)}),X.registerJsModule(`arcturus_lsp_bridge`,{emit:Ae}),await X.loadPackage(`jedi`),je(X),await X.runPythonAsync(`
import sys

if "/arcturus_lsp" not in sys.path:
    sys.path.insert(0, "/arcturus_lsp")

from arcturus_python_lsp import create_bridge

_arcturus_python_lsp_bridge = create_bridge()
`);let t=X.globals.get(`_arcturus_python_lsp_bridge`);Z=e=>{t(e)},self.postMessage({type:`ready`})})().catch(e=>{let t=Oe(e);throw console.error(`Python LSP bootstrap failed`,e),self.postMessage({type:`error`,error:t}),Q=null,Z=null,e}),Q)}self.addEventListener(`message`,e=>{let t=e.data;if(!t||typeof t!=`object`)return;if(t.type===`init`){$=typeof t.pyodideBaseUrl==`string`?t.pyodideBaseUrl:`/pyodide/`,Me($).catch(e=>{console.error(`Failed to initialize Python LSP worker`,e)});return}if(`type`in t)return;let n=JSON.stringify(t);if(Z){Z(n);return}Me($).then(()=>{Z?.(n)}).catch(e=>{console.error(`Failed to forward LSP message to Python bridge`,e)})});export{o as t};