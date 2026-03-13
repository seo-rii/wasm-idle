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
	debugBufferPyodide: Int32Array,
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
		if (typeof unpackArchive !== 'function')
			throw new Error('pyodide.unpackArchive unavailable');
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
	const {
		code,
		buffer,
		debugBuffer,
		load,
		interrupt,
		path: _p,
		prepare,
		debug = false,
		breakpoints = [],
		pauseOnEntry = false
	} = event.data;
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
		debugBufferPyodide = new Int32Array(debugBuffer);
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
		const debugPauseName = `__wasm_idle_python_debug_pause_${ts}`;
		const debugWaitName = `__wasm_idle_python_debug_wait_${ts}`;
		self[debugPauseName] = (
			line: number,
			reason: string,
			localsJson: string,
			callStackJson: string
		) => {
			let locals = [];
			let callStack = [];
			try {
				locals = JSON.parse(localsJson);
			} catch {
				locals = [];
			}
			try {
				callStack = JSON.parse(callStackJson);
			} catch {
				callStack = [];
			}
			postMessage({
				debugEvent: {
					type: 'pause',
					line: Number(line),
					reason,
					locals,
					callStack
				}
			});
		};
		self[debugWaitName] = () => {
			const sequence = Atomics.load(debugBufferPyodide, 0);
			while (true) {
				if (interruptBufferPyodide?.[0] === 2) return -1;
				Atomics.wait(debugBufferPyodide, 0, sequence, 100);
				if (interruptBufferPyodide?.[0] === 2) return -1;
				const command = Atomics.exchange(debugBufferPyodide, 1, 0);
				if (command) return command;
			}
		};
		const userFilename = '__wasm_idle_user__.py';
		const normalizedBreakpoints = JSON.stringify(
			[...(Array.isArray(breakpoints) ? breakpoints : [])]
				.map((value) => Number(value))
				.filter((value) => Number.isInteger(value) && value > 0)
		);

		try {
			await pyodide.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import __pyodide__input_${ts}, __pyodide__output_${ts}
${debug ? `from js import ${debugPauseName}, ${debugWaitName}` : ''}

__wasm_idle_input = __pyodide__input_${ts}
__wasm_idle_output = __pyodide__output_${ts}
builtins.input = __wasm_idle_input
builtins.print = __wasm_idle_output

${imageHook}

${
	debug
		? `
__wasm_idle_debug_breakpoints = set(${normalizedBreakpoints})
__wasm_idle_debug_pause_on_entry = ${pauseOnEntry ? 'True' : 'False'}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == "${userFilename}":
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
        if current.f_code.co_filename == "${userFilename}":
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

    if frame.f_code.co_filename != "${userFilename}":
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

    ${debugPauseName}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    command = ${debugWaitName}()
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
`
		: ''
}

__wasm_idle_globals = {"__name__": "__main__"}
__wasm_idle_result = eval(
    compile(${JSON.stringify(code)}, "${userFilename}", "exec", flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT),
    __wasm_idle_globals,
    __wasm_idle_globals,
)
if inspect.isawaitable(__wasm_idle_result):
    await __wasm_idle_result
`);
			self.postMessage({ results: true });
		} catch (e: any) {
			self.postMessage({ error: e.message || 'Unknown error' });
		} finally {
			delete self[debugPauseName];
			delete self[debugWaitName];
		}
	}
};
