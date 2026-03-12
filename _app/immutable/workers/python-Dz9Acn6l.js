self.document={querySelector(){return null},querySelectorAll(){return[]}};let l,b,s,d="",u="",h=!1;const I=`
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
`,M=e=>e?`https://cdn.jsdelivr.net/pyodide/v${e}/full/`:"";async function y(e){if(s)return;const{loadPyodide:o}=await import("./chunks/DRGcZAZG.js");s=await o({indexURL:e+"/pyodide"}),u=e+"/pyodide";const i=s?.setCdnUrl;typeof i=="function"&&i(u)}async function w(){if(!(h||!s))try{const e=await fetch(d+"/jungol-robot/jungol_robot.zip");if(!e.ok)throw new Error("jungol-robot zip not found");const o=await e.arrayBuffer(),i=s.runPython("import site; site.getsitepackages()[0]"),p=typeof i=="string"?i:i.toString(),f=s?.unpackArchive;if(typeof f!="function")throw new Error("pyodide.unpackArchive unavailable");f(o,"zip",p),s.runPython("import importlib; importlib.invalidate_caches()"),h=!0}catch(e){console.warn("jungol-robot preload failed",e)}}async function x(e){if(e)try{await s.loadPackagesFromImports(e)}catch(o){const i=M(s?.version||""),p=s?.setCdnUrl;if(i&&i!==u&&typeof p=="function"){p(i),u=i,await s.loadPackagesFromImports(e);return}throw o}}self.onmessage=async e=>{const{code:o,buffer:i,load:p,interrupt:f,path:E,prepare:A}=e.data;if(p)d=E,postMessage({output:"Loading Pyodide..."}),await y(d),await w(),postMessage({output:` Done.
\r`}),postMessage({load:!0});else if(A){postMessage({output:"Loading packages..."});try{await y(d),await w(),await x(o),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(a){self.postMessage({error:a.message||"Unknown error"})}}else if(o){await y(d),await w(),await x(o);const a=Date.now();l=new Int32Array(i),b=new Uint8Array(f),s.setInterruptBuffer(b);const c=r=>r===!0?"True":r===!1?"False":r===null||r===void 0?"None":r.toString();self.prompt=self["__pyodide__input_"+a]=r=>{for(r&&postMessage({output:r});;)if(postMessage({buffer:!0}),Atomics.wait(l,0,0,100)==="not-equal")try{const _=new Int32Array(l.byteLength);_.set(l),l.fill(0);const n=new TextDecoder().decode(_).replace(/\x00/g,""),t=parseInt(n.slice(-1));return n.slice(0,-t)}catch(_){postMessage({log:{e:_}})}},self["__pyodide__output_"+a]=(...r)=>{let m=" ",_=`\r
`,g="",n=[];for(const t of r)t?.end!==void 0?_=c(t.end):t?.sep!==void 0?m=c(t.sep):n.push(t);for(let t=0;t<n.length;t++)(typeof n[t]=="string"||!n[t]?.end&&!n[t]?.sep)&&(g+=c(n[t]),t<n.length-1&&(g+=m));g+=_,postMessage({output:g})};try{await s.runPythonAsync(`import asyncio
from js import __pyodide__input_${a}, __pyodide__output_${a}

input = __pyodide__input_${a}
print = __pyodide__output_${a}

__builtins__.input = __pyodide__input_${a}
__builtins__.print = __pyodide__output_${a}

${I}

${o}`),self.postMessage({results:!0})}catch(r){self.postMessage({error:r.message||"Unknown error"})}}};
