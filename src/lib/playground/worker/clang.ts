import type { BrowserClangRuntime as Clang } from '@seo-rii/wasm-llvm/runtime/clang';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};
let stdinBufferClang: Int32Array,
	debugBufferClang: Int32Array,
	watchBufferClang: Int32Array,
	watchResultBufferClang: Int32Array,
	interruptBufferClang: Uint8Array,
	clang: Clang;
let hasInitialStdinClang = false;
let initialStdinClang: string | null = null;

async function loadClang(path: string, log: boolean) {
	const { BrowserClangRuntime, loadRuntimeManifest, resolveRuntimeManifestUrl } =
		await import('@seo-rii/wasm-llvm/runtime/clang');
	const manifest = await loadRuntimeManifest(resolveRuntimeManifestUrl(path));
	clang = new BrowserClangRuntime({
		stdout: (output) => postMessage({ output }),
		onDebugEvent: (debugEvent) => postMessage({ debugEvent }),
		stdin: () => {
			if (hasInitialStdinClang) {
				const chunk = initialStdinClang;
				initialStdinClang = null;
				return chunk ?? '';
			}
			return (
				waitForBufferedStdin(stdinBufferClang, () => postMessage({ buffer: true })) ?? ''
			);
		},
		progress: (value) => postMessage({ progress: value }),
		log,
		runtimeBaseUrl: path,
		manifest
	});
}

self.onmessage = async (event: { data: any }) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		debugBuffer,
		watchBuffer,
		watchResultBuffer,
		load,
		interrupt,
		log,
		path,
		assets,
		prepare,
		language,
		compileArgs,
		programArgs,
		activePath,
		workspaceFiles,
		cppVersion,
		cVersion,
		debug,
		breakpoints,
		pauseOnEntry,
		stdin
	} = event.data;
	if (load) {
		const runtimeAssets = assets as WorkerRuntimeAssetConfig | undefined;
		configureWorkerRuntimeAssets(runtimeAssets || null);
		await loadClang(runtimeAssets?.baseUrl || path || '', log);
		postMessage({ load: true });
	} else if (prepare) {
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);
		hasInitialStdinClang = typeof stdin === 'string';
		initialStdinClang = hasInitialStdinClang ? stdin : null;
		if (debug && !isSharedBufferBackedView(debugBufferClang)) {
			self.postMessage({ error: 'C/C++ debugging requires SharedArrayBuffer.' });
			return;
		}

		try {
			await clang.compileLink(code, {
				language,
				compileArgs,
				programArgs,
				activePath,
				workspaceFiles,
				cppVersion,
				cVersion,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	} else if (code) {
		clang.log = log;
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);
		hasInitialStdinClang = typeof stdin === 'string';
		initialStdinClang = hasInitialStdinClang ? stdin : null;
		if (debug && !isSharedBufferBackedView(debugBufferClang)) {
			self.postMessage({ error: 'C/C++ debugging requires SharedArrayBuffer.' });
			return;
		}

		try {
			await clang.compileLinkRun(code, {
				language,
				compileArgs,
				programArgs,
				activePath,
				workspaceFiles,
				cppVersion,
				cVersion,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	}
};
