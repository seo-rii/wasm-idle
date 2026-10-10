import type { Lockfile, PyodideConfig, PyodideInterface } from 'pyodide';
import {
	flushQueuedStdin,
	readBufferedStdin,
	waitForBufferedStdin
} from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import { parsePythonPackageLock } from '$lib/playground/pythonPackageLock';
import { WASM_APECODE_VERSION, WASM_APECODE_WHEELS } from '$lib/playground/wasmApecodeVersion';
import { withCachedPyodideModule } from './runtimeModule';
import { createPythonExecutionHelpers } from './pythonExecution';
import { PYTHON_DEBUG_PREVIEW } from './pythonDebugPreview';
import { createPythonStdio, PYTHON_FLUSH_HOOK_FACTORY } from './pythonStdio';
import { fetchRuntimeAssetBytes } from './runtimeAssetFetch';
import {
	configureWorkerRuntimeAssetAllowlist,
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	loadWorkerRuntimeAsset,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';

declare const self: {
	document: any;
	onmessage: (event: MessageEvent) => void;
	postMessage: (message: any) => void;
	prompt?: (output?: string) => string | null;
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
	watchBufferPyodide: Int32Array,
	watchResultBufferPyodide: Int32Array,
	interruptBufferPyodide: Uint8Array,
	pyodide: PyodideInterface,
	baseUrl = '',
	useAssetBridge = false;

// Only the next matching run may reuse a successful package preparation.
let preparedPackagesKey: string | undefined;
let maxRuntimeAssetBytes: number | undefined;
let installedHyVersion: string | undefined;
let installedAheuiVersion: string | undefined;
let installedApecodeVersion: string | undefined;
let executionHelpers: ReturnType<typeof createPythonExecutionHelpers> | undefined;
type PythonStdioRestore = (() => void) & { destroy(): void };
let installPythonFlushHooks: ((drain: () => void) => PythonStdioRestore) | undefined;

type PythonExtensionLanguage = 'hy' | 'aheui' | 'apecode';
const PYTHON_EXTENSIONS = {
	hy: {
		label: 'Hy',
		readyLabel: 'Compiling Hy core',
		importSource:
			'import importlib\nimportlib.invalidate_caches()\nimport hy\nimport hy.compiler\nhy.__version__'
	},
	aheui: {
		label: 'Aheui',
		readyLabel: 'Loading Aheui interpreter',
		importSource:
			'import importlib\nimportlib.invalidate_caches()\nfrom aheui.version import VERSION\nVERSION'
	},
	apecode: {
		label: 'APECode',
		readyLabel: 'Loading APECode interpreter',
		importSource:
			'import importlib\nimportlib.invalidate_caches()\nimport apecode\nfrom apecode.cli import run_source\napecode.__version__'
	}
} as const;

const PYTHON_WHEEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.whl$/u;
const PYTHON_EXTENSION_VERSION_PATTERN = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/u;
const MAX_PYTHON_EXTENSION_WHEELS = 8;

interface PythonWheelConfig {
	url: string;
	fileName: string;
	bytes: number;
	sha256: string;
}

function parsePythonExtension(extension: unknown, language: PythonExtensionLanguage) {
	const { label } = PYTHON_EXTENSIONS[language];
	const candidate = extension as { language?: unknown; version?: unknown; wheels?: unknown };
	if (
		!candidate ||
		candidate.language !== language ||
		typeof candidate.version !== 'string' ||
		!PYTHON_EXTENSION_VERSION_PATTERN.test(candidate.version) ||
		(language === 'apecode' && candidate.version !== WASM_APECODE_VERSION) ||
		!Array.isArray(candidate.wheels) ||
		candidate.wheels.length === 0 ||
		candidate.wheels.length > MAX_PYTHON_EXTENSION_WHEELS
	) {
		throw new Error(`${label} runtime configuration is invalid`);
	}
	if (language === 'apecode' && candidate.wheels.length !== WASM_APECODE_WHEELS.length) {
		throw new Error(`${label} runtime wheel receipt is invalid`);
	}
	const wheels = candidate.wheels.map((wheel: Partial<PythonWheelConfig>, index: number) => {
		const pinnedWheel = language === 'apecode' ? WASM_APECODE_WHEELS[index] : undefined;
		if (
			!wheel ||
			typeof wheel.url !== 'string' ||
			typeof wheel.fileName !== 'string' ||
			!PYTHON_WHEEL_NAME_PATTERN.test(wheel.fileName) ||
			!Number.isSafeInteger(wheel.bytes) ||
			(wheel.bytes as number) <= 0 ||
			typeof wheel.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(wheel.sha256) ||
			(pinnedWheel !== undefined &&
				(wheel.fileName !== pinnedWheel.fileName ||
					wheel.bytes !== pinnedWheel.bytes ||
					wheel.sha256 !== pinnedWheel.sha256))
		) {
			throw new Error(`${label} runtime wheel receipt is invalid`);
		}
		return wheel as PythonWheelConfig;
	});
	return { version: candidate.version, wheels };
}

/** Install receipt-verified original Python packages once per dedicated language worker. */
async function installPythonExtension(extension: unknown, language: PythonExtensionLanguage) {
	const { label, readyLabel, importSource } = PYTHON_EXTENSIONS[language];
	const { version, wheels } = parsePythonExtension(extension, language);
	const installedVersions = {
		hy: installedHyVersion,
		aheui: installedAheuiVersion,
		apecode: installedApecodeVersion
	};
	const installedVersion = installedVersions[language];
	if (installedVersion === version) return;
	if (installedVersion !== undefined) throw new Error(`${label} runtime version changed`);
	if (
		Object.entries(installedVersions).some(
			([installedLanguage, installed]) =>
				installedLanguage !== language && installed !== undefined
		)
	) {
		throw new Error('Python runtime extension language changed');
	}
	const sitePackages = String(
		pyodide.runPython('import sysconfig\nsysconfig.get_path("purelib")')
	);
	for (const [index, wheel] of wheels.entries()) {
		postProgress(60 + Math.floor((index * 30) / wheels.length), `Loading ${wheel.fileName}`);
		const bytes = await fetchRuntimeAssetBytes({
			url: new URL(wheel.url, globalThis.location?.href).href,
			label: `${label} wheel ${wheel.fileName}`,
			cache: 'force-cache',
			expected: { bytes: wheel.bytes, sha256: wheel.sha256 },
			maxAssetBytes: Math.min(maxRuntimeAssetBytes ?? wheel.bytes, wheel.bytes),
			integrityContext: {
				asset: wheel.fileName,
				runtimeId: language.toUpperCase()
			}
		});
		pyodide.unpackArchive(bytes, 'whl', { extractDir: sitePackages });
	}
	postProgress(92, readyLabel);
	const loadedVersion = String(pyodide.runPython(importSource));
	if (loadedVersion !== version) {
		throw new Error(
			`${label} runtime version mismatch: expected ${version}, loaded ${loadedVersion}`
		);
	}
	if (language === 'hy') installedHyVersion = version;
	else if (language === 'aheui') installedAheuiVersion = version;
	else installedApecodeVersion = version;
}

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

const pyodideVersionPattern = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:[A-Za-z0-9._+-]{0,64})?$/u;
const directPyodideRuntimeAssets = [
	'pyodide.mjs',
	'pyodide.asm.mjs',
	'pyodide-lock.json',
	'pyodide.asm.wasm',
	'python_stdlib.zip'
] as const;

const resolvePinnedPackageBaseUrl = (version: string) => {
	if (typeof version !== 'string' || !pyodideVersionPattern.test(version)) {
		throw new Error('Pyodide runtime version is invalid');
	}
	return new URL(`v${encodeURIComponent(version)}/full/`, 'https://cdn.jsdelivr.net/pyodide/')
		.href;
};

function postProgress(percent: number, stage: string) {
	self.postMessage({ progress: { percent, stage } });
}

async function importRuntimeAssetModule(
	loaded: Awaited<ReturnType<typeof loadWorkerRuntimeAsset>>
) {
	const moduleUrl = URL.createObjectURL(
		new Blob([loaded.bytes.slice().buffer], {
			type: loaded.mimeType || 'text/javascript'
		})
	);
	try {
		return await import(/* @vite-ignore */ moduleUrl);
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}
}

async function loadPyodide(path: string) {
	if (pyodide) return;
	const runtimeBaseUrl = path.endsWith('/') ? path : `${path}/`;
	// Download independent bootstrap files together, but preserve module evaluation order.
	// The existing bounded loader (and host bridge, when configured) still owns every byte.
	const [asmAsset, runtimeAsset, loadedLock] = await Promise.all([
		loadWorkerRuntimeAsset('pyodide.asm.mjs'),
		loadWorkerRuntimeAsset('pyodide.mjs'),
		useAssetBridge ? undefined : loadWorkerRuntimeAsset('pyodide-lock.json')
	]);
	const { default: createPyodideModule } = (await importRuntimeAssetModule(asmAsset)) as {
		default: PyodideConfig['createPyodideModule'];
	};
	if (typeof createPyodideModule !== 'function') {
		throw new Error('Pyodide module factory is unavailable');
	}
	const runtimeModule = (await importRuntimeAssetModule(
		runtimeAsset
	)) as typeof import('pyodide');
	let packageBaseUrl = runtimeBaseUrl;
	let lockFileContents: Lockfile | undefined;
	if (!useAssetBridge) {
		packageBaseUrl = resolvePinnedPackageBaseUrl(runtimeModule.version);
		if (!loadedLock) throw new Error('Python runtime lock file is unavailable');
		const parsedLock = parsePythonPackageLock(loadedLock.bytes);
		// The interceptor caps downloaded (including browser-decoded transport) archive bytes.
		// Pyodide owns package extraction after receiving that bounded archive.
		configureWorkerRuntimeAssetAllowlist({
			baseUrl: packageBaseUrl,
			assets: [...parsedLock.packageAssets],
			runtimeAssets: directPyodideRuntimeAssets
		});
		lockFileContents = parsedLock.lock as unknown as Lockfile;
	}
	const { loadPyodide } = runtimeModule;
	pyodide = await withCachedPyodideModule(runtimeBaseUrl, () =>
		loadPyodide({
			indexURL: path,
			createPyodideModule,
			packageBaseUrl,
			...(lockFileContents ? { lockFileContents } : {})
		})
	);
	installPythonFlushHooks = pyodide.runPython(PYTHON_FLUSH_HOOK_FACTORY);
}

function getExecutionHelpers() {
	return (executionHelpers ??= createPythonExecutionHelpers(pyodide, imageHook));
}

async function loadPackages(code: string, files: { path: string; content: string }[] = []) {
	const helpers = getExecutionHelpers();
	// Cache analysis only. Package availability is still checked for each unprepared run.
	// Parse files separately so one file's syntax or a data file cannot corrupt its neighbors.
	const imports = new Set([code, ...files.map((file) => file.content)].map((source) => helpers.importSource(source)));
	const stub = [...imports].filter(Boolean).join('\n');
	if (stub) await pyodide.loadPackagesFromImports(stub);
}

function packagePreparationKey(
	code: string,
	activePath: string | undefined,
	files: { path: string; content: string }[] = []
) {
	// Keep source boundaries and paths: joining contents alone can alias different workspaces.
	return JSON.stringify([
		code,
		activePath ?? null,
		files.map(({ path, content }) => [path, content])
	]);
}

function normalizeWorkspacePath(path: string) {
	return path
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
}

function writeWorkspaceFiles(files: { path: string; content: string }[] = []) {
	const fs = (pyodide as any).FS;
	for (const file of files) {
		const safePath = normalizeWorkspacePath(file.path);
		if (!safePath) continue;
		const directory = safePath.split('/').slice(0, -1).join('/');
		if (directory) fs.mkdirTree(directory);
		fs.writeFile(safePath, file.content, { encoding: 'utf8' });
	}
}

/** Own file-descriptor streams and private source files for original Python interpreters. */
async function withInterpreterFileDescriptors(
	code: string,
	activePath: string | undefined,
	stdin: unknown,
	language: 'aheui' | 'apecode',
	execute: (filename: string) => Promise<unknown>
) {
	const fs = (pyodide as any).FS;
	const defaultPath = language === 'aheui' ? 'main.aheui' : 'main.ape';
	const filename = `/tmp/__wasm_idle_${language}__/${normalizeWorkspacePath(activePath || '') || defaultPath}`;
	const encoder = new TextEncoder();
	const stdoutDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const stderrDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const hasInitialStdin = typeof stdin === 'string';
	let initialStdin: string | null = hasInitialStdin ? stdin : null;
	let stdinEnded = false;
	const emit = (output: string) => {
		if (output) postMessage({ output });
	};
	pyodide.setStdin({
		stdin: () => {
			if (stdinEnded) return null;
			let chunk: string | null;
			if (hasInitialStdin) {
				chunk = initialStdin;
				initialStdin = null;
			} else {
				chunk = waitForBufferedStdin(stdinBufferPyodide, () =>
					postMessage({ buffer: true })
				);
			}
			if (chunk === null) {
				stdinEnded = true;
				return null;
			}
			return encoder.encode(chunk);
		},
		// Pyodide's legacy stdin otherwise inserts EOF after chunks without a newline.
		autoEOF: false,
		isatty: false
	});
	pyodide.setStdout({
		write: (bytes) => {
			emit(stdoutDecoder.decode(bytes, { stream: true }));
			return bytes.length;
		}
	});
	pyodide.setStderr({
		write: (bytes) => {
			emit(stderrDecoder.decode(bytes, { stream: true }));
			return bytes.length;
		}
	});
	try {
		fs.mkdirTree(filename.slice(0, filename.lastIndexOf('/')));
		fs.writeFile(filename, code, { encoding: 'utf8' });
		postMessage({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: `${PYTHON_EXTENSIONS[language].label} program started`
			}
		});
		await execute(filename);
	} finally {
		emit(stdoutDecoder.decode());
		emit(stderrDecoder.decode());
		pyodide.setStdin({ error: true });
		pyodide.setStdout({ write: (bytes) => bytes.length });
		pyodide.setStderr({ write: (bytes) => bytes.length });
		if (fs.analyzePath(filename).exists) fs.unlink(filename);
	}
}

async function executeAheui(code: string, activePath: string | undefined, stdin: unknown) {
	await withInterpreterFileDescriptors(code, activePath, stdin, 'aheui', (filename) =>
		pyodide.runPythonAsync(`import importlib
import aheui.aheui as __wasm_idle_aheui
__wasm_idle_aheui = importlib.reload(__wasm_idle_aheui)
__wasm_idle_aheui.entry_point(["aheui", "--no-c", "--warning-limit=0", ${JSON.stringify(filename)}])
None
`)
	);
}

async function executeApecode(code: string, activePath: string | undefined, stdin: unknown) {
	await withInterpreterFileDescriptors(code, activePath, stdin, 'apecode', (filename) =>
		pyodide.runPythonAsync(`import sys
from apecode.cli import run_source as __wasm_idle_apecode_run_source
with open(${JSON.stringify(filename)}, "r", encoding="utf-8") as __wasm_idle_apecode_source:
    try:
        __wasm_idle_apecode_status = __wasm_idle_apecode_run_source(
            __wasm_idle_apecode_source.read(), sys.stdin, sys.stdout, sys.stderr)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
if __wasm_idle_apecode_status != 0:
    raise RuntimeError(f"APECode interpreter exited with status {__wasm_idle_apecode_status}")
None
`)
	);
}

self.onmessage = async (event: any) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		debugBuffer,
		watchBuffer,
		watchResultBuffer,
		load,
		interrupt,
		assets,
		prepare,
		stdin,
		debug = false,
		breakpoints = [],
		pauseOnEntry = false,
		activePath,
		debugPath,
		workspaceFiles,
		language = 'python',
		extension
	} = event.data;
	const isHy = language === 'hy';
	const isAheui = language === 'aheui';
	const isApecode = language === 'apecode';
	const usesInterpreterFileDescriptors = isAheui || isApecode;
	const isPython = !isHy && !usesInterpreterFileDescriptors;
	const interpreterLabel = isApecode ? 'APECode' : 'Aheui';
	if (load) {
		preparedPackagesKey = undefined;
		try {
			const runtimeAssets = assets as WorkerRuntimeAssetConfig | undefined;
			baseUrl = runtimeAssets?.baseUrl || baseUrl;
			useAssetBridge = runtimeAssets?.useAssetBridge === true;
			maxRuntimeAssetBytes = runtimeAssets?.maxAssetBytes;
			configureWorkerRuntimeAssets(runtimeAssets || null);
			postProgress(2, 'Loading Pyodide module');
			await loadPyodide(baseUrl);
			if (extension !== undefined) {
				await installPythonExtension(
					extension,
					(extension as { language?: unknown } | null)?.language === 'aheui'
						? 'aheui'
						: (extension as { language?: unknown } | null)?.language === 'apecode'
							? 'apecode'
							: 'hy'
				);
			}
			postProgress(100, 'Pyodide runtime ready');
			postMessage({ load: true });
		} catch (e: any) {
			self.postMessage({ error: e.message || 'Unknown error' });
		}
	} else if (prepare) {
		preparedPackagesKey = undefined;
		try {
			if (isAheui && installedAheuiVersion === undefined) {
				throw new Error('Aheui runtime is not installed');
			}
			if (isApecode && installedApecodeVersion === undefined) {
				throw new Error('APECode runtime is not installed');
			}
			if (usesInterpreterFileDescriptors && debug) {
				throw new Error(`${interpreterLabel} debugging is not supported`);
			}
			postProgress(
				5,
				usesInterpreterFileDescriptors
					? `Preparing ${interpreterLabel} source`
					: 'Preparing Python workspace'
			);
			const preparationKey = packagePreparationKey(code, activePath, workspaceFiles);
			await loadPyodide(baseUrl);
			if (!usesInterpreterFileDescriptors) writeWorkspaceFiles(workspaceFiles);
			// The genuine language implementations own their source, never Python's import scanner.
			if (isPython) {
				postProgress(15, 'Resolving Python imports');
				await loadPackages(code, workspaceFiles);
			}
			preparedPackagesKey = preparationKey;
			if (usesInterpreterFileDescriptors)
				postProgress(100, `${interpreterLabel} source ready`);
			else postProgress(100, 'Python packages ready');
			self.postMessage({ results: true });
		} catch (e: any) {
			preparedPackagesKey = undefined;
			self.postMessage({ error: e.message || 'Unknown error' });
		}
	} else if (typeof code === 'string') {
		const preparedKey = preparedPackagesKey;
		// Consume before any await or user code, including executions that fail. Python can
		// mutate imports and the filesystem, so this is not a cross-execution package cache.
		preparedPackagesKey = undefined;
		try {
			await loadPyodide(baseUrl);
			if (!usesInterpreterFileDescriptors) writeWorkspaceFiles(workspaceFiles);
			if (isHy && installedHyVersion === undefined) {
				throw new Error('Hy runtime is not installed');
			}
			if (isAheui && installedAheuiVersion === undefined) {
				throw new Error('Aheui runtime is not installed');
			}
			if (isApecode && installedApecodeVersion === undefined) {
				throw new Error('APECode runtime is not installed');
			}
			if (isHy && debug) throw new Error('Hy debugging is not supported');
			if (usesInterpreterFileDescriptors && debug) {
				throw new Error(`${interpreterLabel} debugging is not supported`);
			}
			if (
				isPython &&
				preparedKey !== packagePreparationKey(code, activePath, workspaceFiles)
			) {
				await loadPackages(code, workspaceFiles);
			}
		} catch (e: any) {
			self.postMessage({ error: e.message || 'Unknown error' });
			return;
		}
		const ts = Date.now();
		stdinBufferPyodide = new Int32Array(buffer);
		debugBufferPyodide = new Int32Array(debugBuffer);
		watchBufferPyodide = new Int32Array(watchBuffer);
		watchResultBufferPyodide = new Int32Array(watchResultBuffer);
		interruptBufferPyodide = new Uint8Array(interrupt);
		if (debug && !isSharedBufferBackedView(debugBufferPyodide)) {
			self.postMessage({ error: 'Python debugging requires SharedArrayBuffer.' });
			return;
		}
		if (isSharedBufferBackedView(interruptBufferPyodide)) {
			pyodide.setInterruptBuffer(interruptBufferPyodide);
		}
		if (usesInterpreterFileDescriptors) {
			try {
				if (isAheui) await executeAheui(code, activePath, stdin);
				else await executeApecode(code, activePath, stdin);
				self.postMessage({ results: true });
			} catch (e: any) {
				self.postMessage({ error: e.message || 'Unknown error' });
			}
			return;
		}
		const stdio = createPythonStdio(pyodide, {
			initialInput: typeof stdin === 'string' ? stdin : undefined,
			readInput: () => waitForBufferedStdin(stdinBufferPyodide, () => postMessage({ buffer: true })),
			emit: (output) => postMessage({ output })
		});
		self.prompt = stdio.prompt;
		let restoreStdio: PythonStdioRestore | undefined;
		let stdioFinished = false;
		const finishStdio = () => {
			if (stdioFinished) return;
			stdioFinished = true;
			try {
				restoreStdio?.();
			} finally {
				try { restoreStdio?.destroy(); }
				finally { stdio.close(); delete self.prompt; }
			}
		};
		const debugPauseName = `__wasm_idle_python_debug_pause_${ts}`;
		const debugWaitName = `__wasm_idle_python_debug_wait_${ts}`;
		const debugReadWatchName = `__wasm_idle_python_debug_watch_read_${ts}`;
		const debugWriteWatchName = `__wasm_idle_python_debug_watch_write_${ts}`;
		const debugReadBreakpointsName = `__wasm_idle_python_debug_breakpoints_${ts}`;
		const executionReadyName = `__wasm_idle_python_execution_ready_${ts}`;
		let executionReadyReported = false;
		self[executionReadyName] = () => {
			if (executionReadyReported) return;
			executionReadyReported = true;
			delete self[executionReadyName];
			postMessage({
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'Python program started'
				}
			});
		};
		self[debugPauseName] = (
			line: number,
			reason: string,
			localsJson: string,
			callStackJson: string
		) => {
			stdio.flush();
			let locals: unknown[];
			let callStack: unknown[];
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
		self[debugReadWatchName] = () => readBufferedStdin(watchBufferPyodide) || '';
		self[debugWriteWatchName] = (value: string) => {
			flushQueuedStdin([value], watchResultBufferPyodide);
		};
		self[debugReadBreakpointsName] = (knownVersion: number) => {
			const version = Atomics.load(debugBufferPyodide, 2);
			if (version === knownVersion) return null;
			const count = Math.max(
				0,
				Math.min(Atomics.load(debugBufferPyodide, 3), debugBufferPyodide.length - 4)
			);
			const lines: number[] = [];
			for (let index = 0; index < count; index += 1) {
				const line = Atomics.load(debugBufferPyodide, 4 + index);
				if (Number.isInteger(line) && line > 0) lines.push(line);
			}
			return JSON.stringify({ version, lines });
		};
		const executionFilename =
			normalizeWorkspacePath(activePath || '') ||
			(isHy ? '__wasm_idle_user__.hy' : '__wasm_idle_user__.py');
		const debugFilename = normalizeWorkspacePath(debugPath || '') || executionFilename;
		const executionFilenameLiteral = JSON.stringify(executionFilename);
		const debugFilenameLiteral = JSON.stringify(debugFilename);
		const normalizedBreakpoints = JSON.stringify(
			[...(Array.isArray(breakpoints) ? breakpoints : [])]
				.map((value) => Number(value))
				.filter((value) => Number.isInteger(value) && value > 0)
		);

		try {
			try {
				if (!installPythonFlushHooks) throw new Error('Python flush hooks are unavailable');
				restoreStdio = installPythonFlushHooks(stdio.flush);
			} catch {
				// Unusual non-mutable streams remain correct, without batching their writes.
				stdio.disableBatching();
			}
			if (isPython && !debug) {
				await getExecutionHelpers().run(code, executionFilename, self[executionReadyName]);
			} else {
			await pyodide.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import ${executionReadyName} as __wasm_idle_execution_ready
${debug ? `from js import ${debugPauseName}, ${debugWaitName}` : ''}
${debug ? `from js import ${debugReadWatchName}, ${debugWriteWatchName}` : ''}
${debug ? `from js import ${debugReadBreakpointsName}` : ''}

${imageHook}

${
	debug
		? `
__wasm_idle_debug_breakpoints = set(${normalizedBreakpoints})
__wasm_idle_debug_breakpoint_version = -1
__wasm_idle_debug_pause_on_entry = ${pauseOnEntry ? 'True' : 'False'}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_refresh_breakpoints():
    global __wasm_idle_debug_breakpoints
    global __wasm_idle_debug_breakpoint_version
    payload = ${debugReadBreakpointsName}(__wasm_idle_debug_breakpoint_version)
    if payload is None:
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
        if current.f_code.co_filename == ${debugFilenameLiteral}:
            depth += 1
        current = current.f_back
    return depth

${PYTHON_DEBUG_PREVIEW}

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
        if current.f_code.co_filename == ${debugFilenameLiteral}:
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

    if frame.f_code.co_filename != ${debugFilenameLiteral}:
        return None
    if event != "line":
        return __wasm_idle_debug_trace

    __wasm_idle_debug_refresh_breakpoints()
    needs_depth = (__wasm_idle_debug_resume_skip is not None or __wasm_idle_debug_step_mode in ("next", "out"))
    depth = __wasm_idle_debug_depth(frame) if needs_depth else None
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

    if depth is None:
        depth = __wasm_idle_debug_depth(frame)
    __wasm_idle_debug_pause_on_entry = False
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None

    sys.stdout.flush()
    sys.stderr.flush()
    ${debugPauseName}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = ${debugWaitName}()
        if command < 0:
            raise KeyboardInterrupt()
        if command != 5:
            break
        try:
            expression = ${debugReadWatchName}()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        ${debugWriteWatchName}(result)
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

${
	isHy
		? `
try:
    import types
    import hy
    import hy.compiler
    __wasm_idle_module = types.ModuleType("__main__")
    __wasm_idle_module.__file__ = ${executionFilenameLiteral}
    __wasm_idle_source = ${JSON.stringify(code)}
    __wasm_idle_compiled = compile(
        hy.compiler.hy_compile(
            hy.read_many(__wasm_idle_source, filename = ${executionFilenameLiteral}),
            __wasm_idle_module,
            filename = ${executionFilenameLiteral},
            source = __wasm_idle_source,
        ),
        ${executionFilenameLiteral},
        "exec",
    )
    __wasm_idle_execution_ready()
    exec(__wasm_idle_compiled, __wasm_idle_module.__dict__)
finally:
    del __wasm_idle_execution_ready
`
		: `
try:
    __wasm_idle_globals = {
        "__name__": "__main__",
        ${JSON.stringify(executionReadyName)}: __wasm_idle_execution_ready,
    }
    __wasm_idle_compiled = compile(
        ${JSON.stringify(code)},
        ${executionFilenameLiteral},
        "exec",
        flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
    )
    __wasm_idle_globals.pop(${JSON.stringify(executionReadyName)})()
    __wasm_idle_result = eval(
        __wasm_idle_compiled,
        __wasm_idle_globals,
        __wasm_idle_globals,
    )
    if inspect.isawaitable(__wasm_idle_result):
        await __wasm_idle_result
finally:
    __wasm_idle_globals.pop(${JSON.stringify(executionReadyName)}, None)
    del __wasm_idle_execution_ready
    sys.settrace(None)
    ${
		debug
			? `
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_resume_skip = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None
`
			: ''
	}
`
}
`);
			}
			finishStdio();
			self.postMessage({ results: true });
		} catch (e: any) {
			try { finishStdio(); } catch { /* Preserve the execution error. */ }
			self.postMessage({ error: e.message || 'Unknown error' });
		} finally {
			delete self['__pyodide__input_' + ts];
			delete self['__pyodide__output_' + ts];
			delete self.prompt;
			delete self[executionReadyName];
			delete self[debugPauseName];
			delete self[debugWaitName];
			delete self[debugReadWatchName];
			delete self[debugWriteWatchName];
			delete self[debugReadBreakpointsName];
		}
	}
};
