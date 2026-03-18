const $=Int32Array.BYTES_PER_ELEMENT*2,K=-1,P=new TextEncoder,Z=new TextDecoder,j=e=>e instanceof Int32Array?e:new Int32Array(e),D=e=>new Uint8Array(e.buffer,e.byteOffset+$,e.byteLength-$),ee=(e,s)=>{const t=P.encode(e);if(t.length<=s)return{chunk:e,bytes:t,rest:""};let i=0,n=e.length;for(;i<n;){const r=Math.ceil((i+n)/2);P.encode(e.slice(0,r)).length<=s?i=r:n=r-1}const l=e.slice(0,i);return{chunk:l,bytes:P.encode(l),rest:e.slice(i)}},te=(e,s)=>{if(!e.length)return!1;const t=j(s),i=D(t),n=e[0],{bytes:l,rest:r}=ee(n,i.length);return i.fill(0),i.set(l),Atomics.store(t,1,l.length),Atomics.add(t,0,1),Atomics.notify(t,0),r?e[0]=r:e.shift(),!0},W=e=>{const s=j(e),t=Atomics.load(s,1);if(t===K)return null;const i=D(s);return Z.decode(i.slice(0,t))},se=(e,s)=>{const t=Atomics.load(e,0);for(s();;)if(Atomics.wait(e,0,t,100)==="not-equal")return W(e)},ie=new TextDecoder,q=globalThis.fetch.bind(globalThis),B=globalThis.XMLHttpRequest;let m=null,H=!1,re=0;const U=new Map,G=e=>{const s=e.buffer;return e.byteOffset===0&&e.byteLength===s.byteLength?s:s.slice(e.byteOffset,e.byteOffset+e.byteLength)},Q=e=>m?typeof e=="string"?new URL(e,m.baseUrl).href:e instanceof URL?e.href:e.url:null,J=e=>!m||!e.startsWith(m.baseUrl)?null:e.slice(m.baseUrl.length),Y=e=>J(e)!==null,ae=async e=>{const s=++re;return await new Promise((t,i)=>{U.set(s,{resolve:t,reject:i}),self.postMessage({assetRequest:{id:s,asset:e}})})},ne=async(e,s)=>{const t=await q(e);if(!t.ok)throw new Error(`Failed to load ${s}: ${t.status}`);const i=Number(t.headers.get("content-length")||0)||void 0,n=t.headers.get("content-type")||void 0;if(!t.body){const d=new Uint8Array(await t.arrayBuffer());return self.postMessage({assetProgress:{asset:s,loaded:d.byteLength,total:i??d.byteLength}}),{bytes:d,mimeType:n}}const l=t.body.getReader();let r=0;const w=[];for(;;){const{done:d,value:g}=await l.read();if(d)break;if(!g)continue;const v=Uint8Array.from(g);w.push(v),r+=v.byteLength,self.postMessage({assetProgress:{asset:s,loaded:r,total:i}})}const b=new Uint8Array(r);let y=0;for(const d of w)b.set(d,y),y+=d.byteLength;return self.postMessage({assetProgress:{asset:s,loaded:r,total:i??r}}),{bytes:b,mimeType:n}};async function z(e){const s=J(e);if(!s||!m)throw new Error("Untracked runtime asset request");return m.useAssetBridge?await ae(s):await ne(e,s)}function _e(e){return new Response(G(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function oe(){if(typeof B>"u")return;class e{responseType="";response=null;responseText="";readyState=0;status=0;statusText="";timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url="";open(t,i){const n=Q(i);if(!n||!Y(n)){const l=n||(i instanceof URL?i.href:String(i));this.native=new B,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=r=>{this.response=this.native?.response,this.responseText=this.native?.responseText||"",this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||"",this.onreadystatechange?.call(this,r),this.onload?.call(this,r)},this.native.onerror=r=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||"",this.onreadystatechange?.call(this,r),this.onerror?.call(this,r)},this.native.onprogress=r=>{this.onprogress?.call(this,r)},this.native.onreadystatechange=r=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,r)},this.native.open(t,l);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent("readystatechange"))}setRequestHeader(t,i){this.native?.setRequestHeader(t,i)}async send(t){if(this.native){this.native.send(t);return}try{const i=await z(this.url),n=G(i.bytes);if(this.status=200,this.statusText="OK",this.readyState=4,this.responseType==="arraybuffer")this.response=n;else if(this.responseType==="blob")this.response=new Blob([n],{type:i.mimeType||"application/octet-stream"});else{const r=ie.decode(i.bytes);this.responseText=r,this.response=r}const l=new ProgressEvent("progress",{lengthComputable:!0,loaded:i.bytes.byteLength,total:i.bytes.byteLength});this.onprogress?.call(this,l),this.onreadystatechange?.call(this,new ProgressEvent("readystatechange")),this.onload?.call(this,new ProgressEvent("load"))}catch(i){this.readyState=4,this.status=0,this.statusText=i instanceof Error?i.message:String(i),this.onreadystatechange?.call(this,new ProgressEvent("readystatechange")),this.onerror?.call(this,new ProgressEvent("error"))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||""}getResponseHeader(t){return this.native?.getResponseHeader(t)||null}}globalThis.XMLHttpRequest=e}function le(){H||(H=!0,globalThis.fetch=(async(e,s)=>{const t=Q(e);return!t||!Y(t)?q(e,s):_e(await z(t))}),oe())}function de(e){m=e,le()}function ue(e){const s=e?.assetResponse;if(!s)return!1;const t=U.get(s.id);return t?(U.delete(s.id),s.ok?(t.resolve({bytes:new Uint8Array(s.bytes),mimeType:s.mimeType||void 0}),!0):(t.reject(new Error(s.error||"Runtime asset request failed")),!0)):!0}self.document={querySelector(){return null},querySelectorAll(){return[]}};let O,I,F,C,L,p,h="",R="";const pe=`
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
`,me=e=>e?`https://cdn.jsdelivr.net/pyodide/v${e}/full/`:"";async function S(e){if(p)return;const{loadPyodide:s}=await import("./chunks/DRGcZAZG.js");p=await s({indexURL:e}),R=e;const t=p?.setCdnUrl;typeof t=="function"&&t(R)}async function X(e){if(e)try{await p.loadPackagesFromImports(e)}catch(s){const t=me(p?.version||""),i=p?.setCdnUrl;if(t&&t!==R&&typeof i=="function"){i(t),R=t,await p.loadPackagesFromImports(e);return}throw s}}self.onmessage=async e=>{if(ue(e.data))return;const{code:s,buffer:t,debugBuffer:i,watchBuffer:n,watchResultBuffer:l,load:r,interrupt:w,assets:b,prepare:y,debug:d=!1,breakpoints:g=[],pauseOnEntry:v=!1}=e.data;if(r){const o=b;h=o?.baseUrl||h,de(o||null),postMessage({output:"Loading Pyodide..."}),await S(h),postMessage({output:` Done.
\r`}),postMessage({load:!0})}else if(y){postMessage({output:"Loading packages..."});try{await S(h),await X(s),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(o){self.postMessage({error:o.message||"Unknown error"})}}else if(s){await S(h),await X(s);const o=Date.now();O=new Int32Array(t),I=new Int32Array(i),F=new Int32Array(n),C=new Int32Array(l),L=new Uint8Array(w),p.setInterruptBuffer(L);const M=a=>a===!0?"True":a===!1?"False":a===null||a===void 0?"None":a.toString();self.prompt=self["__pyodide__input_"+o]=a=>(a&&postMessage({output:a}),se(O,()=>postMessage({buffer:!0}))),self["__pyodide__output_"+o]=(...a)=>{let c=" ",T=`\r
`,f="",u=[];for(const _ of a)_?.end!==void 0?T=M(_.end):_?.sep!==void 0?c=M(_.sep):u.push(_);for(let _=0;_<u.length;_++)(typeof u[_]=="string"||!u[_]?.end&&!u[_]?.sep)&&(f+=M(u[_]),_<u.length-1&&(f+=c));f+=T,postMessage({output:f})};const x=`__wasm_idle_python_debug_pause_${o}`,E=`__wasm_idle_python_debug_wait_${o}`,N=`__wasm_idle_python_debug_watch_read_${o}`,A=`__wasm_idle_python_debug_watch_write_${o}`;self[x]=(a,c,T,f)=>{let u=[],_=[];try{u=JSON.parse(T)}catch{u=[]}try{_=JSON.parse(f)}catch{_=[]}postMessage({debugEvent:{type:"pause",line:Number(a),reason:c,locals:u,callStack:_}})},self[E]=()=>{const a=Atomics.load(I,0);for(;;){if(L?.[0]===2||(Atomics.wait(I,0,a,100),L?.[0]===2))return-1;const c=Atomics.exchange(I,1,0);if(c)return c}},self[N]=()=>W(F)||"",self[A]=a=>{te([a],C)};const k="__wasm_idle_user__.py",V=JSON.stringify([...Array.isArray(g)?g:[]].map(a=>Number(a)).filter(a=>Number.isInteger(a)&&a>0));try{await p.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import __pyodide__input_${o}, __pyodide__output_${o}
${d?`from js import ${x}, ${E}`:""}
${d?`from js import ${N}, ${A}`:""}

__wasm_idle_input = __pyodide__input_${o}
def __wasm_idle_input_wrapper(prompt = ""):
    value = __wasm_idle_input(prompt)
    if value is None:
        raise EOFError
    return value
__wasm_idle_output = __pyodide__output_${o}
builtins.input = __wasm_idle_input_wrapper
builtins.print = __wasm_idle_output

${pe}

${d?`
__wasm_idle_debug_breakpoints = set(${V})
__wasm_idle_debug_pause_on_entry = ${v?"True":"False"}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${k}":
            depth += 1
        current = current.f_back
    return depth

def __wasm_idle_debug_preview(value, depth = 0):
    if depth >= 2:
        return "..."
    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (bytes, bytearray)):
        text = repr(bytes(value))
        return text if len(text) <= 80 else text[:77] + "..."
    if isinstance(value, str):
        text = repr(value)
        return text if len(text) <= 80 else text[:77] + "..."
    if isinstance(value, list):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        return "[" + ", ".join(items) + "]"
    if isinstance(value, tuple):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        if len(value) == 1 and items:
            return "(" + items[0] + ",)"
        return "(" + ", ".join(items) + ")"
    if isinstance(value, dict):
        items = []
        for index, (key, item) in enumerate(value.items()):
            if index >= 6:
                items.append("...")
                break
            items.append(__wasm_idle_debug_preview(key, depth + 1) + ": " + __wasm_idle_debug_preview(item, depth + 1))
        return "{" + ", ".join(items) + "}"
    if isinstance(value, set):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in sorted(list(value), key = repr)[:6]]
        if len(value) > 6:
            items.append("...")
        return "{" + ", ".join(items) + "}"
    try:
        text = repr(value)
        return text if len(text) <= 80 else text[:77] + "..."
    except Exception:
        return "?"

def __wasm_idle_debug_locals(frame):
    locals_preview = []
    for name, value in frame.f_locals.items():
        if name == "__builtins__" or name.startswith("__wasm_idle_") or name.startswith("."):
            continue
        locals_preview.append({"name": name, "value": __wasm_idle_debug_preview(value)})
    locals_preview.sort(key = lambda item: item["name"])
    return locals_preview

def __wasm_idle_debug_stack(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${k}":
            stack.append({"functionName": current.f_code.co_name, "line": current.f_lineno})
        current = current.f_back
    return stack

def __wasm_idle_debug_trace(frame, event, arg):
    global __wasm_idle_debug_pause_on_entry
    global __wasm_idle_debug_step_mode
    global __wasm_idle_debug_resume_skip
    global __wasm_idle_debug_next_depth
    global __wasm_idle_debug_next_line
    global __wasm_idle_debug_step_out_depth

    if frame.f_code.co_filename != "${k}":
        return None
    if event != "line":
        return __wasm_idle_debug_trace

    depth = __wasm_idle_debug_depth(frame)
    line = frame.f_lineno
    if __wasm_idle_debug_resume_skip == (depth, line):
        return __wasm_idle_debug_trace
    if __wasm_idle_debug_resume_skip is not None:
        __wasm_idle_debug_resume_skip = None

    reason = None
    if __wasm_idle_debug_pause_on_entry:
        reason = "entry"
    elif line in __wasm_idle_debug_breakpoints:
        reason = "breakpoint"
    elif __wasm_idle_debug_step_mode == "step":
        reason = "step"
    elif __wasm_idle_debug_step_mode == "next" and __wasm_idle_debug_next_depth is not None and depth <= __wasm_idle_debug_next_depth and line != __wasm_idle_debug_next_line:
        reason = "nextLine"
    elif __wasm_idle_debug_step_mode == "out" and __wasm_idle_debug_step_out_depth is not None and depth <= __wasm_idle_debug_step_out_depth:
        reason = "stepOut"

    if reason is None:
        return __wasm_idle_debug_trace

    __wasm_idle_debug_pause_on_entry = False
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None

    ${x}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = ${E}()
        if command < 0:
            raise KeyboardInterrupt()
        if command != 5:
            break
        try:
            expression = ${N}()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        ${A}(result)
    __wasm_idle_debug_resume_skip = (depth, line)
    if command == 2:
        __wasm_idle_debug_step_mode = "step"
    elif command == 3:
        __wasm_idle_debug_step_mode = "next"
        __wasm_idle_debug_next_depth = depth
        __wasm_idle_debug_next_line = line
    elif command == 4:
        __wasm_idle_debug_step_mode = "out"
        __wasm_idle_debug_step_out_depth = max(0, depth - 1)
    return __wasm_idle_debug_trace

sys.settrace(__wasm_idle_debug_trace)
`:""}

try:
    __wasm_idle_globals = {"__name__": "__main__"}
    __wasm_idle_result = eval(
        compile(${JSON.stringify(s)}, "${k}", "exec", flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
        __wasm_idle_globals,
        __wasm_idle_globals,
    )
    if inspect.isawaitable(__wasm_idle_result):
        await __wasm_idle_result
finally:
    sys.settrace(None)
    ${d?`
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_resume_skip = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None
`:""}
`),self.postMessage({results:!0})}catch(a){self.postMessage({error:a.message||"Unknown error"})}finally{delete self[x],delete self[E],delete self[N],delete self[A]}}};
