var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,a)=>(a=n==null?{}:e(i(n)),s(r||!n||!n.__esModule?t(a,`default`,{value:n,enumerable:!0}):a,n)),l=(e=>typeof require<`u`?require:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof require<`u`?require:e)[t]}):e)(function(e){if(typeof require<`u`)return require.apply(this,arguments);throw Error('Calling `require` for "'+e+"\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.")}),u=Object.defineProperty,d=(e,t)=>u(e,`name`,{value:t,configurable:!0}),ee=(e=>typeof l<`u`?l:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof l<`u`?l:e)[t]}):e)(function(e){if(typeof l<`u`)return l.apply(this,arguments);throw Error(`Dynamic require of "`+e+`" is not supported`)});function f(e){return!isNaN(parseFloat(e))&&isFinite(e)}d(f,`_isNumber`);function p(e){return e.charAt(0).toUpperCase()+e.substring(1)}d(p,`_capitalize`);function m(e){return function(){return this[e]}}d(m,`_getter`);var h=[`isConstructor`,`isEval`,`isNative`,`isToplevel`],g=[`columnNumber`,`lineNumber`],_=[`fileName`,`functionName`,`source`],v=h.concat(g,_,[`args`],[`evalOrigin`]);function y(e){if(e)for(var t=0;t<v.length;t++)e[v[t]]!==void 0&&this[`set`+p(v[t])](e[v[t]])}for(d(y,`StackFrame`),y.prototype={getArgs:function(){return this.args},setArgs:function(e){if(Object.prototype.toString.call(e)!==`[object Array]`)throw TypeError(`Args must be an Array`);this.args=e},getEvalOrigin:function(){return this.evalOrigin},setEvalOrigin:function(e){if(e instanceof y)this.evalOrigin=e;else if(e instanceof Object)this.evalOrigin=new y(e);else throw TypeError(`Eval Origin must be an Object or StackFrame`)},toString:function(){var e=this.getFileName()||``,t=this.getLineNumber()||``,n=this.getColumnNumber()||``,r=this.getFunctionName()||``;return this.getIsEval()?e?`[eval] (`+e+`:`+t+`:`+n+`)`:`[eval]:`+t+`:`+n:r?r+` (`+e+`:`+t+`:`+n+`)`:e+`:`+t+`:`+n}},y.fromString=d(function(e){var t=e.indexOf(`(`),n=e.lastIndexOf(`)`),r=e.substring(0,t),i=e.substring(t+1,n).split(`,`),a=e.substring(n+1);if(a.indexOf(`@`)===0)var o=/@(.+?)(?::(\d+))?(?::(\d+))?$/.exec(a,``),s=o[1],c=o[2],l=o[3];return new y({functionName:r,args:i||void 0,fileName:s,lineNumber:c||void 0,columnNumber:l||void 0})},`StackFrame$$fromString`),b=0;b<h.length;b++)y.prototype[`get`+p(h[b])]=m(h[b]),y.prototype[`set`+p(h[b])]=function(e){return function(t){this[e]=!!t}}(h[b]);var b;for(x=0;x<g.length;x++)y.prototype[`get`+p(g[x])]=m(g[x]),y.prototype[`set`+p(g[x])]=function(e){return function(t){if(!f(t))throw TypeError(e+` must be a Number`);this[e]=Number(t)}}(g[x]);var x;for(S=0;S<_.length;S++)y.prototype[`get`+p(_[S])]=m(_[S]),y.prototype[`set`+p(_[S])]=function(e){return function(t){this[e]=String(t)}}(_[S]);var S,C=y;function w(){var e=/^\s*at .*(\S+:\d+|\(native\))/m,t=/^(eval@)?(\[native code])?$/;return{parse:d(function(t){if(t.stack&&t.stack.match(e))return this.parseV8OrIE(t);if(t.stack)return this.parseFFOrSafari(t);throw Error(`Cannot parse given Error object`)},`ErrorStackParser$$parse`),extractLocation:d(function(e){if(e.indexOf(`:`)===-1)return[e];var t=/(.+?)(?::(\d+))?(?::(\d+))?$/.exec(e.replace(/[()]/g,``));return[t[1],t[2]||void 0,t[3]||void 0]},`ErrorStackParser$$extractLocation`),parseV8OrIE:d(function(t){return t.stack.split(`
`).filter(function(t){return!!t.match(e)},this).map(function(e){e.indexOf(`(eval `)>-1&&(e=e.replace(/eval code/g,`eval`).replace(/(\(eval at [^()]*)|(,.*$)/g,``));var t=e.replace(/^\s+/,``).replace(/\(eval code/g,`(`).replace(/^.*?\s+/,``),n=t.match(/ (\(.+\)$)/);t=n?t.replace(n[0],``):t;var r=this.extractLocation(n?n[1]:t);return new C({functionName:n&&t||void 0,fileName:[`eval`,`<anonymous>`].indexOf(r[0])>-1?void 0:r[0],lineNumber:r[1],columnNumber:r[2],source:e})},this)},`ErrorStackParser$$parseV8OrIE`),parseFFOrSafari:d(function(e){return e.stack.split(`
`).filter(function(e){return!e.match(t)},this).map(function(e){if(e.indexOf(` > eval`)>-1&&(e=e.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g,`:$1`)),e.indexOf(`@`)===-1&&e.indexOf(`:`)===-1)return new C({functionName:e});var t=/((.*".+"[^@]*)?[^@]*)(?:@)/,n=e.match(t),r=n&&n[1]?n[1]:void 0,i=this.extractLocation(e.replace(t,``));return new C({functionName:r,fileName:i[0],lineNumber:i[1],columnNumber:i[2],source:e})},this)},`ErrorStackParser$$parseFFOrSafari`)}}d(w,`ErrorStackParser`);var te=new w,T=typeof process==`object`&&typeof process.versions==`object`&&typeof process.versions.node==`string`&&!process.browser,E=T&&typeof module<`u`&&typeof module.exports<`u`&&typeof ee<`u`&&typeof __dirname<`u`,ne=T&&!E;globalThis.Bun;var re=!T&&!(typeof Deno<`u`),ie=re&&typeof window==`object`&&typeof document==`object`&&typeof document.createElement==`function`&&typeof sessionStorage==`object`&&typeof importScripts!=`function`,ae=re&&typeof importScripts==`function`&&typeof self==`object`;typeof navigator==`object`&&typeof navigator.userAgent==`string`&&navigator.userAgent.indexOf(`Chrome`)==-1&&navigator.userAgent.indexOf(`Safari`);var oe,D,O,k,A;async function j(){if(!T||(oe=(await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1))).default,k=await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1)),A=await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1)),O=(await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1))).default,D=await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1)),P=D.sep,typeof ee<`u`))return;let e={fs:k,crypto:await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1)),ws:await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1)),child_process:await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1))};globalThis.require=function(t){return e[t]}}d(j,`initNodeModules`);function M(e,t){return D.resolve(t||`.`,e)}d(M,`node_resolvePath`);function N(e,t){return t===void 0&&(t=location),new URL(e,t).toString()}d(N,`browser_resolvePath`);var se=T?M:N,P;T||(P=`/`);function F(e,t){return e.startsWith(`file://`)&&(e=e.slice(7)),e.includes(`://`)?{response:fetch(e)}:{binary:A.readFile(e).then(e=>new Uint8Array(e.buffer,e.byteOffset,e.byteLength))}}d(F,`node_getBinaryResponse`);function I(e,t){let n=new URL(e,location);return{response:fetch(n,t?{integrity:t}:{})}}d(I,`browser_getBinaryResponse`);var L=T?F:I;async function R(e,t){let{response:n,binary:r}=L(e,t);if(r)return r;let i=await n;if(!i.ok)throw Error(`Failed to load '${e}': request failed.`);return new Uint8Array(await i.arrayBuffer())}d(R,`loadBinaryFile`);var z;if(ie)z=d(async e=>await import(e),`loadScript`);else if(ae)z=d(async e=>{try{globalThis.importScripts(e)}catch(t){if(t instanceof TypeError)await import(e);else throw t}},`loadScript`);else if(T)z=B;else throw Error(`Cannot determine runtime environment`);async function B(e){e.startsWith(`file://`)&&(e=e.slice(7)),e.includes(`://`)?O.runInThisContext(await(await fetch(e)).text()):await import(oe.pathToFileURL(e).href)}d(B,`nodeLoadScript`);async function V(e){if(T){await j();let t=await A.readFile(e,{encoding:`utf8`});return JSON.parse(t)}else return await(await fetch(e)).json()}d(V,`loadLockFile`);async function H(){if(E)return __dirname;let e;try{throw Error()}catch(t){e=t}let t=te.parse(e)[0].fileName;if(T&&!t.startsWith(`file://`)&&(t=`file://${t}`),ne){let e=await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1));return(await import(`./chunks/BW88wk3Z.js`).then(e=>c(e.default,1))).fileURLToPath(e.dirname(t))}let n=t.lastIndexOf(P);if(n===-1)throw Error(`Could not extract indexURL path from pyodide module location`);return t.slice(0,n)}d(H,`calculateDirname`);function U(e){let t=e.FS,n=e.FS.filesystems.MEMFS,r=e.PATH,i={DIR_MODE:16895,FILE_MODE:33279,mount:function(e){if(!e.opts.fileSystemHandle)throw Error(`opts.fileSystemHandle is required`);return n.mount.apply(null,arguments)},syncfs:async(e,t,n)=>{try{let r=i.getLocalSet(e),a=await i.getRemoteSet(e),o=t?a:r,s=t?r:a;await i.reconcile(e,o,s),n(null)}catch(e){n(e)}},getLocalSet:e=>{let n=Object.create(null);function i(e){return e!==`.`&&e!==`..`}d(i,`isRealDir`);function a(e){return t=>r.join2(e,t)}d(a,`toAbsolute`);let o=t.readdir(e.mountpoint).filter(i).map(a(e.mountpoint));for(;o.length;){let e=o.pop(),r=t.stat(e);t.isDir(r.mode)&&o.push.apply(o,t.readdir(e).filter(i).map(a(e))),n[e]={timestamp:r.mtime,mode:r.mode}}return{type:`local`,entries:n}},getRemoteSet:async e=>{let t=Object.create(null),n=await ce(e.opts.fileSystemHandle);for(let[a,o]of n)a!==`.`&&(t[r.join2(e.mountpoint,a)]={timestamp:o.kind===`file`?(await o.getFile()).lastModifiedDate:new Date,mode:o.kind===`file`?i.FILE_MODE:i.DIR_MODE});return{type:`remote`,entries:t,handles:n}},loadLocalEntry:e=>{let r=t.lookupPath(e).node,i=t.stat(e);if(t.isDir(i.mode))return{timestamp:i.mtime,mode:i.mode};if(t.isFile(i.mode))return r.contents=n.getFileDataAsTypedArray(r),{timestamp:i.mtime,mode:i.mode,contents:r.contents};throw Error(`node type not supported`)},storeLocalEntry:(e,n)=>{if(t.isDir(n.mode))t.mkdirTree(e,n.mode);else if(t.isFile(n.mode))t.writeFile(e,n.contents,{canOwn:!0});else throw Error(`node type not supported`);t.chmod(e,n.mode),t.utime(e,n.timestamp,n.timestamp)},removeLocalEntry:e=>{var n=t.stat(e);t.isDir(n.mode)?t.rmdir(e):t.isFile(n.mode)&&t.unlink(e)},loadRemoteEntry:async e=>{if(e.kind===`file`){let t=await e.getFile();return{contents:new Uint8Array(await t.arrayBuffer()),mode:i.FILE_MODE,timestamp:t.lastModifiedDate}}else{if(e.kind===`directory`)return{mode:i.DIR_MODE,timestamp:new Date};throw Error(`unknown kind: `+e.kind)}},storeRemoteEntry:async(e,n,i)=>{let a=e.get(r.dirname(n)),o=t.isFile(i.mode)?await a.getFileHandle(r.basename(n),{create:!0}):await a.getDirectoryHandle(r.basename(n),{create:!0});if(o.kind===`file`){let e=await o.createWritable();await e.write(i.contents),await e.close()}e.set(n,o)},removeRemoteEntry:async(e,t)=>{await e.get(r.dirname(t)).removeEntry(r.basename(t)),e.delete(t)},reconcile:async(e,n,a)=>{let o=0,s=[];Object.keys(n.entries).forEach(function(e){let r=n.entries[e],i=a.entries[e];(!i||t.isFile(r.mode)&&r.timestamp.getTime()>i.timestamp.getTime())&&(s.push(e),o++)}),s.sort();let c=[];if(Object.keys(a.entries).forEach(function(e){n.entries[e]||(c.push(e),o++)}),c.sort().reverse(),!o)return;let l=n.type===`remote`?n.handles:a.handles;for(let t of s){let n=r.normalize(t.replace(e.mountpoint,`/`)).substring(1);if(a.type===`local`){let e=l.get(n),r=await i.loadRemoteEntry(e);i.storeLocalEntry(t,r)}else{let e=i.loadLocalEntry(t);await i.storeRemoteEntry(l,n,e)}}for(let t of c)if(a.type===`local`)i.removeLocalEntry(t);else{let n=r.normalize(t.replace(e.mountpoint,`/`)).substring(1);await i.removeRemoteEntry(l,n)}}};e.FS.filesystems.NATIVEFS_ASYNC=i}d(U,`initializeNativeFS`);var ce=d(async e=>{let t=[];async function n(e){for await(let r of e.values())t.push(r),r.kind===`directory`&&await n(r)}d(n,`collect`),await n(e);let r=new Map;r.set(`.`,e);for(let n of t){let t=(await e.resolve(n)).join(`/`);r.set(t,n)}return r},`getFsHandles`);function W(e){let t={noImageDecoding:!0,noAudioDecoding:!0,noWasmDecoding:!1,preRun:Y(e),quit(e,n){throw t.exited={status:e,toThrow:n},n},print:e.stdout,printErr:e.stderr,arguments:e.args,API:{config:e},locateFile:t=>e.indexURL+t,instantiateWasm:le(e.indexURL)};return t}d(W,`createSettings`);function G(e){return function(t){try{t.FS.mkdirTree(e)}catch(t){console.error(`Error occurred while making a home directory '${e}':`),console.error(t),console.error(`Using '/' for a home directory instead`),e=`/`}t.FS.chdir(e)}}d(G,`createHomeDirectory`);function K(e){return function(t){Object.assign(t.ENV,e)}}d(K,`setEnvironment`);function q(e){return t=>{for(let n of e)t.FS.mkdirTree(n),t.FS.mount(t.FS.filesystems.NODEFS,{root:n},n)}}d(q,`mountLocalDirectories`);function J(e){let t=R(e);return e=>{let n=e._py_version_major(),r=e._py_version_minor();e.FS.mkdirTree(`/lib`),e.FS.mkdirTree(`/lib/python${n}.${r}/site-packages`),e.addRunDependency(`install-stdlib`),t.then(t=>{e.FS.writeFile(`/lib/python${n}${r}.zip`,t)}).catch(e=>{console.error(`Error occurred while installing the standard library:`),console.error(e)}).finally(()=>{e.removeRunDependency(`install-stdlib`)})}}d(J,`installStdlib`);function Y(e){let t;return t=e.stdLibURL==null?e.indexURL+`python_stdlib.zip`:e.stdLibURL,[J(t),G(e.env.HOME),K(e.env),q(e._node_mounts),U]}d(Y,`getFileSystemInitializationFuncs`);function le(e){let{binary:t,response:n}=L(e+`pyodide.asm.wasm`);return function(e,r){return async function(){try{let i;i=n?await WebAssembly.instantiateStreaming(n,e):await WebAssembly.instantiate(await t,e);let{instance:a,module:o}=i;typeof WasmOffsetConverter<`u`&&(wasmOffsetConverter=new WasmOffsetConverter(wasmBinary,o)),r(a,o)}catch(e){console.warn(`wasm instantiation failed!`),console.warn(e)}}(),{}}}d(le,`getInstantiateWasmFunc`);var ue=`0.26.2`;async function de(e={}){var t,n;await j();let r=e.indexURL||await H();r=se(r),r.endsWith(`/`)||(r+=`/`),e.indexURL=r;let i={fullStdLib:!1,jsglobals:globalThis,stdin:globalThis.prompt?globalThis.prompt:void 0,lockFileURL:r+`pyodide-lock.json`,args:[],_node_mounts:[],env:{},packageCacheDir:r,packages:[],enableRunUntilComplete:!1,checkAPIVersion:!0},a=Object.assign(i,e);(t=a.env).HOME??(t.HOME=`/home/pyodide`),(n=a.env).PYTHONINSPECT??(n.PYTHONINSPECT=`1`);let o=W(a),s=o.API;if(s.lockFilePromise=V(a.lockFileURL),typeof _createPyodideModule!=`function`){let e=`${a.indexURL}pyodide.asm.js`;await z(e)}let c;if(e._loadSnapshot){let t=await e._loadSnapshot;c=ArrayBuffer.isView(t)?t:new Uint8Array(t),o.noInitialRun=!0,o.INITIAL_MEMORY=c.length}let l=await _createPyodideModule(o);if(o.exited)throw o.exited.toThrow;if(e.pyproxyToStringRepr&&s.setPyProxyToStringMethod(!0),s.version!==`0.26.2`&&a.checkAPIVersion)throw Error(`Pyodide version does not match: '${ue}' <==> '${s.version}'. If you updated the Pyodide version, make sure you also updated the 'indexURL' parameter passed to loadPyodide.`);l.locateFile=e=>{throw Error(`Didn't expect to load any more file_packager files!`)};let u;c&&(u=s.restoreSnapshot(c));let d=s.finalizeBootstrap(u);return s.sys.path.insert(0,s.config.env.HOME),d.version.includes(`dev`)||s.setCdnUrl(`https://cdn.jsdelivr.net/pyodide/v${d.version}/full/`),s._pyodide.set_excepthook(),await s.packageIndexReady,s.initializeStreams(a.stdin,a.stdout,a.stderr),d}d(de,`loadPyodide`);var fe=`from .server import create_bridge

__all__ = ["create_bridge"]
`,pe=`from __future__ import annotations

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
`;let X=null,Z=null,Q=null,$=`/pyodide/`;function me(e){return e instanceof Error?e.message:String(e)}function he(e){return e.endsWith(`/`)?e:`${e}/`}function ge(e){try{self.postMessage(JSON.parse(e))}catch(t){console.error(`Failed to emit Python LSP payload`,t,e)}}function _e(e){e.FS.mkdirTree(`/arcturus_lsp/arcturus_python_lsp`),e.FS.writeFile(`/arcturus_lsp/arcturus_python_lsp/__init__.py`,fe),e.FS.writeFile(`/arcturus_lsp/arcturus_python_lsp/server.py`,pe)}async function ve(e){if(!Z)return Q||(Q=(async()=>{self.postMessage({type:`progress`,stage:`load-pyodide`}),X=await de({indexURL:he(e)}),X.registerJsModule(`arcturus_lsp_bridge`,{emit:ge}),await X.loadPackage(`jedi`),_e(X),await X.runPythonAsync(`
import sys

if "/arcturus_lsp" not in sys.path:
    sys.path.insert(0, "/arcturus_lsp")

from arcturus_python_lsp import create_bridge

_arcturus_python_lsp_bridge = create_bridge()
`);let t=X.globals.get(`_arcturus_python_lsp_bridge`);Z=e=>{t(e)},self.postMessage({type:`ready`})})().catch(e=>{let t=me(e);throw console.error(`Python LSP bootstrap failed`,e),self.postMessage({type:`error`,error:t}),Q=null,Z=null,e}),Q)}self.addEventListener(`message`,e=>{let t=e.data;if(!t||typeof t!=`object`)return;if(t.type===`init`){$=typeof t.pyodideBaseUrl==`string`?t.pyodideBaseUrl:`/pyodide/`,ve($).catch(e=>{console.error(`Failed to initialize Python LSP worker`,e)});return}if(`type`in t)return;let n=JSON.stringify(t);if(Z){Z(n);return}ve($).then(()=>{Z?.(n)}).catch(e=>{console.error(`Failed to forward LSP message to Python bridge`,e)})});export{o as t};