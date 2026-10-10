import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';
import {
	createVCompiler,
	executeBrowserVArtifact,
	type BrowserVCompiler
} from '@wasm-idle/llvm-core/v';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};

let compiler: BrowserVCompiler | null = null;
let stdinBufferV: Int32Array | null = null;
let hasInitialStdinV = false;
let initialStdinV: string | null = null;
let initialStdinConsumedV = false;

const normalizeWorkspacePath = (value: string) =>
	value
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');

const ensureTrailingNewline = (source: string) => (source.endsWith('\n') ? source : `${source}\n`);

function resolveInputPath(activePath?: string) {
	const normalized = normalizeWorkspacePath(activePath || '');
	if (!normalized) return 'main.v';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.v`;
}

function readProgramStdin() {
	if (hasInitialStdinV) {
		if (initialStdinConsumedV) return null;
		initialStdinConsumedV = true;
		return initialStdinV ?? '';
	}
	return waitForBufferedStdin(stdinBufferV, () => postMessage({ buffer: true }));
}

async function loadVRuntime(
	clangAssets: WorkerRuntimeAssetConfig | undefined,
	vBaseUrl: string,
	maxAssetBytes: number | undefined,
	log: boolean
) {
	configureWorkerRuntimeAssets(clangAssets || null);
	compiler = await createVCompiler({
		runtimeBaseUrl: vBaseUrl,
		clangRuntimeBaseUrl: clangAssets?.baseUrl || '',
		maxAssetBytes,
		log
	});
}

self.onmessage = async (event: { data: any }) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		load,
		log,
		prepare,
		compileArgs,
		programArgs,
		activePath,
		workspaceFiles,
		stdin,
		clangAssets,
		vBaseUrl,
		maxAssetBytes
	} = event.data;
	if (load) {
		try {
			await loadVRuntime(clangAssets, vBaseUrl, maxAssetBytes, log);
			postMessage({ load: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	} else if (typeof log === 'boolean' && !code) {
		// The compiler receives the current logging preference for every compilation.
		if (typeof code === 'string') postMessage({ results: true });
	} else if (code) {
		if (!compiler) {
			postMessage({ error: 'V runtime is not loaded.' });
			return;
		}
		stdinBufferV = new Int32Array(buffer);
		hasInitialStdinV = typeof stdin === 'string';
		initialStdinV = hasInitialStdinV ? stdin : null;
		initialStdinConsumedV = false;

		try {
			const files = (workspaceFiles || []) as SandboxWorkspaceFile[];
			const result = await compiler.compile({
				code: ensureTrailingNewline(code),
				fileName: resolveInputPath(activePath),
				compileArgs: compileArgs || [],
				workspaceFiles: files,
				log,
				onProgress: ({ percent, message }) => {
					postMessage({ progress: percent / 100 });
					if (log) postMessage({ log: message });
				}
			});
			if (!result.success || !result.artifact) {
				throw new Error(result.stderr || 'V did not produce a WebAssembly program.');
			}
			if (!prepare) {
				const execution = await executeBrowserVArtifact(result.artifact, {
					args: programArgs || [],
					stdin: readProgramStdin,
					stdout: (output) => postMessage({ output }),
					stderr: (output) => postMessage({ output }),
					files: files.map(({ path, content }) => ({ path, contents: content }))
				});
				if (execution.exitCode) {
					throw new Error(`V program exited with ${execution.exitCode}`);
				}
			}
			postMessage({ results: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	}
};
