self.document={querySelector(){return null},querySelectorAll(){return[]}};let u,b,y,a,m="",h="",E=!1;const L=`
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
`,S=_=>_?`https://cdn.jsdelivr.net/pyodide/v${_}/full/`:"";async function v(_){if(a)return;const{loadPyodide:r}=await import("./chunks/DRGcZAZG.js");a=await r({indexURL:_+"/pyodide"}),h=_+"/pyodide";const s=a?.setCdnUrl;typeof s=="function"&&s(h)}async function N(){if(!(E||!a))try{const _=await fetch(m+"/jungol-robot/jungol_robot.zip");if(!_.ok)throw new Error("jungol-robot zip not found");const r=await _.arrayBuffer(),s=a.runPython("import site; site.getsitepackages()[0]"),p=typeof s=="string"?s:s.toString(),g=a?.unpackArchive;if(typeof g!="function")throw new Error("pyodide.unpackArchive unavailable");g(r,"zip",p),a.runPython("import importlib; importlib.invalidate_caches()"),E=!0}catch(_){console.warn("jungol-robot preload failed",_)}}async function I(_){if(_)try{await a.loadPackagesFromImports(_)}catch(r){const s=S(a?.version||""),p=a?.setCdnUrl;if(s&&s!==h&&typeof p=="function"){p(s),h=s,await a.loadPackagesFromImports(_);return}throw r}}self.onmessage=async _=>{const{code:r,buffer:s,debugBuffer:p,load:g,interrupt:M,path:P,prepare:$,debug:k=!1,breakpoints:A=[],pauseOnEntry:j=!1}=_.data;if(g)m=P,postMessage({output:"Loading Pyodide..."}),await v(m),await N(),postMessage({output:` Done.
\r`}),postMessage({load:!0});else if($){postMessage({output:"Loading packages..."});try{await v(m),await N(),await I(r),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(n){self.postMessage({error:n.message||"Unknown error"})}}else if(r){await v(m),await N(),await I(r);const n=Date.now();u=new Int32Array(s),b=new Int32Array(p),y=new Uint8Array(M),a.setInterruptBuffer(y);const x=e=>e===!0?"True":e===!1?"False":e===null||e===void 0?"None":e.toString();self.prompt=self["__pyodide__input_"+n]=e=>{for(e&&postMessage({output:e});;)if(postMessage({buffer:!0}),Atomics.wait(u,0,0,100)==="not-equal")try{const o=new Int32Array(u.byteLength);o.set(u),u.fill(0);const i=new TextDecoder().decode(o).replace(/\x00/g,""),t=parseInt(i.slice(-1));return i.slice(0,-t)}catch(o){postMessage({log:{e:o}})}},self["__pyodide__output_"+n]=(...e)=>{let d=" ",o=`\r
`,l="",i=[];for(const t of e)t?.end!==void 0?o=x(t.end):t?.sep!==void 0?d=x(t.sep):i.push(t);for(let t=0;t<i.length;t++)(typeof i[t]=="string"||!i[t]?.end&&!i[t]?.sep)&&(l+=x(i[t]),t<i.length-1&&(l+=d));l+=o,postMessage({output:l})};const f=`__wasm_idle_python_debug_pause_${n}`,c=`__wasm_idle_python_debug_wait_${n}`;self[f]=(e,d,o,l)=>{let i=[],t=[];try{i=JSON.parse(o)}catch{i=[]}try{t=JSON.parse(l)}catch{t=[]}postMessage({debugEvent:{type:"pause",line:Number(e),reason:d,locals:i,callStack:t}})},self[c]=()=>{const e=Atomics.load(b,0);for(;;){if(y?.[0]===2||(Atomics.wait(b,0,e,100),y?.[0]===2))return-1;const d=Atomics.exchange(b,1,0);if(d)return d}};const w="__wasm_idle_user__.py",B=JSON.stringify([...Array.isArray(A)?A:[]].map(e=>Number(e)).filter(e=>Number.isInteger(e)&&e>0));try{await a.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import __pyodide__input_${n}, __pyodide__output_${n}
${k?`from js import ${f}, ${c}`:""}

__wasm_idle_input = __pyodide__input_${n}
__wasm_idle_output = __pyodide__output_${n}
builtins.input = __wasm_idle_input
builtins.print = __wasm_idle_output

${L}

${k?`
__wasm_idle_debug_breakpoints = set(${B})
__wasm_idle_debug_pause_on_entry = ${j?"True":"False"}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${w}":
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
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in list(value)[:6]]
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
        if name == "__builtins__" or name.startswith("__wasm_idle_"):
            continue
        locals_preview.append({"name": name, "value": __wasm_idle_debug_preview(value)})
    locals_preview.sort(key = lambda item: item["name"])
    return locals_preview

def __wasm_idle_debug_stack(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${w}":
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

    if frame.f_code.co_filename != "${w}":
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

    ${f}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    command = ${c}()
    if command < 0:
        raise KeyboardInterrupt()
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

__wasm_idle_globals = {"__name__": "__main__"}
__wasm_idle_result = eval(
    compile(${JSON.stringify(r)}, "${w}", "exec", flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
    __wasm_idle_globals,
    __wasm_idle_globals,
)
if inspect.isawaitable(__wasm_idle_result):
    await __wasm_idle_result
`),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||"Unknown error"})}finally{delete self[f],delete self[c]}}};
