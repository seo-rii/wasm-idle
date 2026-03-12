import type { PyodideInterface } from 'pyodide';

declare const self: {
	document: any;
	onmessage: (event: MessageEvent) => void;
	postMessage: (message: any) => void;
	prompt?: (output?: string) => string;
	[key: string]: any;
};

self.document = {
	querySelector() {
		return null;
	},
	querySelectorAll() {
		return [];
	}
};

let stdinBufferPyodide: Int32Array,
	interruptBufferPyodide: Uint8Array,
	pyodide: PyodideInterface,
	path = '',
	packageBaseUrl = '';

let jungolRobotReady = false;

const imageHook = `
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
`;

const cdnFallbackUrl = (version: string) =>
	version ? `https://cdn.jsdelivr.net/pyodide/v${version}/full/` : '';

async function loadPyodide(path: string) {
	if (pyodide) return;
	const { loadPyodide } = await import('pyodide');
	pyodide = await loadPyodide({ indexURL: path + '/pyodide' });
	packageBaseUrl = path + '/pyodide';
	const setCdnUrl = (pyodide as any)?.setCdnUrl;
	if (typeof setCdnUrl === 'function') setCdnUrl(packageBaseUrl);
}

async function ensureRobotJungol() {
	if (jungolRobotReady || !pyodide) return;
	try {
		const res = await fetch(path + '/jungol-robot/jungol_robot.zip');
		if (!res.ok) throw new Error('jungol-robot zip not found');
		const data = await res.arrayBuffer();
		const siteRaw = pyodide.runPython('import site; site.getsitepackages()[0]');
		const sitePath = typeof siteRaw === 'string' ? siteRaw : siteRaw.toString();
		const unpackArchive = (pyodide as any)?.unpackArchive;
		if (typeof unpackArchive !== 'function') throw new Error('pyodide.unpackArchive unavailable');
		unpackArchive(data, 'zip', sitePath);
		pyodide.runPython('import importlib; importlib.invalidate_caches()');
		jungolRobotReady = true;
	} catch (e) {
		console.warn('jungol-robot preload failed', e);
	}
}

async function loadPackages(code: string) {
	if (!code) return;
	try {
		await pyodide.loadPackagesFromImports(code);
	} catch (e) {
		const fallback = cdnFallbackUrl((pyodide as any)?.version || '');
		const setCdnUrl = (pyodide as any)?.setCdnUrl;
		if (fallback && fallback !== packageBaseUrl && typeof setCdnUrl === 'function') {
			setCdnUrl(fallback);
			packageBaseUrl = fallback;
			await pyodide.loadPackagesFromImports(code);
			return;
		}
		throw e;
	}
}

self.onmessage = async (event: any) => {
	const { code, buffer, load, interrupt, path: _p, prepare } = event.data;
	if (load) {
		path = _p;
		postMessage({ output: 'Loading Pyodide...' });
		await loadPyodide(path);
		await ensureRobotJungol();
		postMessage({ output: ' Done.\n\r' });
		postMessage({ load: true });
	} else if (prepare) {
		postMessage({ output: 'Loading packages...' });
		try {
			await loadPyodide(path);
			await ensureRobotJungol();
			await loadPackages(code);
			postMessage({ output: ' Done.\n\r' });
			self.postMessage({ results: true });
		} catch (e: any) {
			self.postMessage({ error: e.message || 'Unknown error' });
		}
	} else if (code) {
		await loadPyodide(path);
		await ensureRobotJungol();
		await loadPackages(code);
		const ts = Date.now();
		stdinBufferPyodide = new Int32Array(buffer);
		interruptBufferPyodide = new Uint8Array(interrupt);
		pyodide.setInterruptBuffer(interruptBufferPyodide);
		const toPythonStr = (obj: any) => {
			if (obj === true) return 'True';
			if (obj === false) return 'False';
			if (obj === null) return 'None';
			if (obj === undefined) return 'None';
			return obj.toString();
		};
		self.prompt = self['__pyodide__input_' + ts] = (output?: string) => {
			if (output) postMessage({ output });
			while (true) {
				postMessage({ buffer: true });
				const res = Atomics.wait(stdinBufferPyodide, 0, 0, 100);
				if (res === 'not-equal') {
					try {
						const cpy = new Int32Array(stdinBufferPyodide.byteLength);
						cpy.set(stdinBufferPyodide);
						stdinBufferPyodide.fill(0);
						const dec = new TextDecoder();
						const strInfo = dec.decode(cpy).replace(/\x00/g, ''),
							padding = parseInt(strInfo.slice(-1));
						return strInfo.slice(0, -padding);
					} catch (e) {
						postMessage({ log: { e } });
					}
				}
			}
		};
		self['__pyodide__output_' + ts] = (...data: any[]) => {
			let sep = ' ',
				end = '\r\n',
				output = '',
				clear = [];
			for (const i of data) {
				if (i?.end !== undefined) end = toPythonStr(i.end);
				else if (i?.sep !== undefined) sep = toPythonStr(i.sep);
				else clear.push(i);
			}
			for (let i = 0; i < clear.length; i++) {
				if (typeof clear[i] === 'string' || (!clear[i]?.end && !clear[i]?.sep)) {
					output += toPythonStr(clear[i]);
					if (i < clear.length - 1) output += sep;
				}
			}
			output += end;
			postMessage({ output });
		};

		try {
			await pyodide.runPythonAsync(`import asyncio
from js import __pyodide__input_${ts}, __pyodide__output_${ts}

input = __pyodide__input_${ts}
print = __pyodide__output_${ts}

__builtins__.input = __pyodide__input_${ts}
__builtins__.print = __pyodide__output_${ts}

${imageHook}

${code}`);
			self.postMessage({ results: true });
		} catch (e: any) {
			self.postMessage({ error: e.message || 'Unknown error' });
		}
	}
};
