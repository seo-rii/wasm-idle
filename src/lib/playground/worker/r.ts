import type { WebR } from 'webr';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

const encoder = new TextEncoder();

let stdinBufferR: Int32Array | null = null;
let baseUrl = '';
let loadedBaseUrl = '';
let webRPromise: Promise<WebR> | null = null;

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

function rString(value: string) {
	return JSON.stringify(value);
}

function normalizeWorkspacePath(path: string) {
	const parts: string[] = [];
	for (const part of path.replace(/^\/+/, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		if (part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/');
}

function dirname(path: string) {
	const slashIndex = path.lastIndexOf('/');
	return slashIndex === -1 ? '' : path.slice(0, slashIndex);
}

async function mkdirp(webR: WebR, path: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	let current = '';
	for (const part of normalized.split('/')) {
		current += `/${part}`;
		const info = await webR.FS.analyzePath(current).catch(() => null);
		if (!info?.exists) await webR.FS.mkdir(current);
	}
}

async function writeWorkspaceFile(webR: WebR, path: string, content: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	const fullPath = `/workspace/${normalized}`;
	await mkdirp(webR, dirname(`workspace/${normalized}`));
	await webR.FS.writeFile(fullPath, encoder.encode(content));
}

async function loadWebR(url: string, log = true) {
	if (!url) {
		throw new Error(
			'R runtime is not configured. Set PUBLIC_WASM_R_BASE_URL or runtimeAssets.r.baseUrl.'
		);
	}
	if (loadedBaseUrl === url && webRPromise) {
		return await webRPromise;
	}
	loadedBaseUrl = url;
	webRPromise?.then((runtime) => runtime.close()).catch(() => {});
	webRPromise = (async () => {
		postProgress(5);
		const moduleUrl = `${url.endsWith('/') ? url : `${url}/`}webr.js`;
		const { ChannelType, WebR: WebRConstructor } = (await import(
			/* @vite-ignore */ moduleUrl
		)) as typeof import('webr');
		const webR = new WebRConstructor({
			baseUrl: url,
			serviceWorkerUrl: url,
			channelType: ChannelType.PostMessage,
			interactive: false,
			REnv: {
				R_HOME: '/usr/lib/R',
				R_ENABLE_JIT: '0'
			}
		});
		await webR.init();
		postProgress(90);
		await mkdirp(webR, 'workspace');
		await webR.evalRVoid('options(device = webr::canvas)');
		if (log) {
			console.log(`[wasm-idle:r-worker] webR ready baseUrl=${url}`);
		}
		postProgress(100);
		return webR;
	})();
	return await webRPromise;
}

function codeMightReadStdin(code: string) {
	return /\b(stdin|readLines|readline|scan)\s*\(/.test(code);
}

function readInitialStdin(code: string, initialStdin: unknown, log = true) {
	if (typeof initialStdin === 'string') return initialStdin;
	if (!codeMightReadStdin(code)) return '';
	const chunk = waitForBufferedStdin(stdinBufferR!, () => postMessage({ buffer: true }));
	if (log) {
		console.log(
			chunk == null
				? '[wasm-idle:r-stdin] read(bytes=0, eof=true)'
				: `[wasm-idle:r-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
		);
	}
	return chunk || '';
}

function buildRunnerSource(activePath: string, args: string[]) {
	const argsSource = args.map(rString).join(', ');
	return `
.wasm_idle_stdin_path <- "/workspace/.stdin"
stdin <- function() file(.wasm_idle_stdin_path, open = "r")
.wasm_idle_args <- c(${argsSource})
commandArgs <- function(trailingOnly = FALSE) {
  if (trailingOnly) .wasm_idle_args else c("R", .wasm_idle_args)
}
source(${rString(`/workspace/${normalizeWorkspacePath(activePath)}`)}, local = TRUE, echo = FALSE, print.eval = FALSE)
`;
}

function emitCapturedOutput(output: { type: string; data: any }[]) {
	for (const entry of output) {
		if (entry.type === 'stdout' || entry.type === 'stderr') {
			if (entry.data) postMessage({ output: String(entry.data) });
			continue;
		}
		const message =
			typeof entry.data === 'string'
				? entry.data
				: typeof entry.data?.message === 'string'
					? entry.data.message
					: '';
		if (message) postMessage({ output: `${message}\n` });
	}
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		baseUrl: nextBaseUrl,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.R',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			baseUrl = nextBaseUrl || '';
			if (log) {
				console.log(`[wasm-idle:r-worker] load baseUrl=${baseUrl}`);
			}
			await loadWebR(baseUrl, log);
			postMessage({ load: true });
			return;
		}

		stdinBufferR = new Int32Array(buffer);
		const webR = await loadWebR(baseUrl, log);

		if (prepare) {
			await webR.evalRVoid(`parse(text = ${rString(code)})`, {
				captureStreams: true,
				captureConditions: true,
				captureGraphics: false
			});
			postMessage({ results: true });
			return;
		}

		await mkdirp(webR, 'workspace');
		for (const file of workspaceFiles as SandboxWorkspaceFile[]) {
			await writeWorkspaceFile(webR, file.path, file.content);
		}
		await writeWorkspaceFile(webR, activePath, code);
		await webR.FS.writeFile(
			'/workspace/.stdin',
			encoder.encode(readInitialStdin(code, stdin, log))
		);

		if (log) {
			console.log(
				`[wasm-idle:r-worker] eval start bytes=${code.length} activePath=${activePath}`
			);
		}
		const captured = await webR.globalShelter.captureR(buildRunnerSource(activePath, args), {
			captureStreams: true,
			captureConditions: true,
			captureGraphics: false,
			withAutoprint: false,
			throwJsException: true
		});
		emitCapturedOutput(captured.output || []);
		await webR.globalShelter.purge();
		if (log) {
			console.log(`[wasm-idle:r-worker] eval settled output=${captured.output?.length || 0}`);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:r-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
