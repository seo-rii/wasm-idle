const e=Int32Array.BYTES_PER_ELEMENT*2,t=new TextEncoder,n=new TextDecoder,r=e=>e instanceof Int32Array?e:new Int32Array(e),i=t=>new Uint8Array(t.buffer,t.byteOffset+e,t.byteLength-e),a=(e,n)=>{let r=t.encode(e);if(r.length<=n)return{chunk:e,bytes:r,rest:``};let i=0,a=e.length;for(;i<a;){let r=Math.ceil((i+a)/2);t.encode(e.slice(0,r)).length<=n?i=r:a=r-1}let o=e.slice(0,i);return{chunk:o,bytes:t.encode(o),rest:e.slice(i)}},o=(e,t)=>{if(!e.length)return!1;let n=r(t),o=i(n),s=e[0],{bytes:c,rest:l}=a(s,o.length);return o.fill(0),o.set(c),Atomics.store(n,1,c.length),Atomics.add(n,0,1),Atomics.notify(n,0),l?e[0]=l:e.shift(),!0},s=e=>{let t=r(e),a=Atomics.load(t,1);if(a===-1)return null;let o=i(t);return n.decode(o.slice(0,a))},c=(e,t)=>{let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return s(e)},l=new TextDecoder,u=globalThis.fetch.bind(globalThis),d=globalThis.XMLHttpRequest;let f=null,p=!1,m=0;const h=new Map,g=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},_=e=>f?typeof e==`string`?new URL(e,f.baseUrl).href:e instanceof URL?e.href:e.url:null,v=e=>!f||!e.startsWith(f.baseUrl)?null:e.slice(f.baseUrl.length),y=e=>v(e)!==null,b=async e=>{let t=++m;return await new Promise((n,r)=>{h.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},x=async(e,t)=>{let n=await u(e);if(!n.ok)throw Error(`Failed to load ${t}: ${n.status}`);let r=Number(n.headers.get(`content-length`)||0)||void 0,i=n.headers.get(`content-type`)||void 0;if(!n.body){let e=new Uint8Array(await n.arrayBuffer());return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:r??e.byteLength}}),{bytes:e,mimeType:i}}let a=n.body.getReader(),o=0,s=[];for(;;){let{done:e,value:n}=await a.read();if(e)break;if(!n)continue;let i=Uint8Array.from(n);s.push(i),o+=i.byteLength,self.postMessage({assetProgress:{asset:t,loaded:o,total:r}})}let c=new Uint8Array(o),l=0;for(let e of s)c.set(e,l),l+=e.byteLength;return self.postMessage({assetProgress:{asset:t,loaded:o,total:r??o}}),{bytes:c,mimeType:i}};async function S(e){let t=v(e);if(!t||!f)throw Error(`Untracked runtime asset request`);return f.useAssetBridge?await b(t):await x(e,t)}function C(e){return new Response(g(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function w(){if(d===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=_(t);if(!n||!y(n)){let r=n||(t instanceof URL?t.href:String(t));this.native=new d,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await S(this.url),t=g(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=l.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function T(){p||(p=!0,globalThis.fetch=(async(e,t)=>{let n=_(e);return!n||!y(n)?u(e,t):C(await S(n))}),w())}function E(e){f=e,T()}function D(e){let t=e?.assetResponse;if(!t)return!1;let n=h.get(t.id);return n?(h.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}self.document={querySelector(){return null},querySelectorAll(){return[]}};let O,k,A,j,M,N,P=``,F=``;const I=e=>e?`https://cdn.jsdelivr.net/pyodide/v${e}/full/`:``;async function L(e){if(N)return;let{loadPyodide:t}=await import(`./chunks/CoHpAP-8.js`);N=await t({indexURL:e}),F=e;let n=N?.setCdnUrl;typeof n==`function`&&n(F)}async function R(e){if(e)try{await N.loadPackagesFromImports(e)}catch(t){let n=I(N?.version||``),r=N?.setCdnUrl;if(n&&n!==F&&typeof r==`function`){r(n),F=n,await N.loadPackagesFromImports(e);return}throw t}}self.onmessage=async e=>{if(D(e.data))return;let{code:t,buffer:n,debugBuffer:r,watchBuffer:i,watchResultBuffer:a,load:l,interrupt:u,assets:d,prepare:f,debug:p=!1,breakpoints:m=[],pauseOnEntry:h=!1}=e.data;if(l){let e=d;P=e?.baseUrl||P,E(e||null),postMessage({output:`Loading Pyodide...`}),await L(P),postMessage({output:` Done.
\r`}),postMessage({load:!0})}else if(f){postMessage({output:`Loading packages...`});try{await L(P),await R(t),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}}else if(t){await L(P),await R(t);let e=Date.now();O=new Int32Array(n),k=new Int32Array(r),A=new Int32Array(i),j=new Int32Array(a),M=new Uint8Array(u),N.setInterruptBuffer(M);let l=e=>e===!0?`True`:e===!1?`False`:e==null?`None`:e.toString();self.prompt=self[`__pyodide__input_`+e]=e=>(e&&postMessage({output:e}),c(O,()=>postMessage({buffer:!0}))),self[`__pyodide__output_`+e]=(...e)=>{let t=` `,n=`\r
`,r=``,i=[];for(let r of e)r?.end===void 0?r?.sep===void 0?i.push(r):t=l(r.sep):n=l(r.end);for(let e=0;e<i.length;e++)(typeof i[e]==`string`||!i[e]?.end&&!i[e]?.sep)&&(r+=l(i[e]),e<i.length-1&&(r+=t));r+=n,postMessage({output:r})};let d=`__wasm_idle_python_debug_pause_${e}`,f=`__wasm_idle_python_debug_wait_${e}`,g=`__wasm_idle_python_debug_watch_read_${e}`,_=`__wasm_idle_python_debug_watch_write_${e}`;self[d]=(e,t,n,r)=>{let i=[],a=[];try{i=JSON.parse(n)}catch{i=[]}try{a=JSON.parse(r)}catch{a=[]}postMessage({debugEvent:{type:`pause`,line:Number(e),reason:t,locals:i,callStack:a}})},self[f]=()=>{let e=Atomics.load(k,0);for(;;){if(M?.[0]===2||(Atomics.wait(k,0,e,100),M?.[0]===2))return-1;let t=Atomics.exchange(k,1,0);if(t)return t}},self[g]=()=>s(A)||``,self[_]=e=>{o([e],j)};let v=`__wasm_idle_user__.py`,y=JSON.stringify([...Array.isArray(m)?m:[]].map(e=>Number(e)).filter(e=>Number.isInteger(e)&&e>0));try{await N.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import __pyodide__input_${e}, __pyodide__output_${e}
${p?`from js import ${d}, ${f}`:``}
${p?`from js import ${g}, ${_}`:``}

__wasm_idle_input = __pyodide__input_${e}
def __wasm_idle_input_wrapper(prompt = ""):
    value = __wasm_idle_input(prompt)
    if value is None:
        raise EOFError
    return value
__wasm_idle_output = __pyodide__output_${e}
builtins.input = __wasm_idle_input_wrapper
builtins.print = __wasm_idle_output


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


${p?`
__wasm_idle_debug_breakpoints = set(${y})
__wasm_idle_debug_pause_on_entry = ${h?`True`:`False`}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${v}":
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
        if current.f_code.co_filename == "${v}":
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

    if frame.f_code.co_filename != "${v}":
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

    ${d}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = ${f}()
        if command < 0:
            raise KeyboardInterrupt()
        if command != 5:
            break
        try:
            expression = ${g}()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        ${_}(result)
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
`:``}

try:
    __wasm_idle_globals = {"__name__": "__main__"}
    __wasm_idle_result = eval(
        compile(${JSON.stringify(t)}, "${v}", "exec", flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
        __wasm_idle_globals,
        __wasm_idle_globals,
    )
    if inspect.isawaitable(__wasm_idle_result):
        await __wasm_idle_result
finally:
    sys.settrace(None)
    ${p?`
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_resume_skip = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None
`:``}
`),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}finally{delete self[d],delete self[f],delete self[g],delete self[_]}}};