import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';
import {
	createCobolCompiler,
	executeBrowserCobolArtifact,
	type BrowserCobolCompiler
} from '@wasm-idle/llvm-core/cobol';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};

let compiler: BrowserCobolCompiler | null = null;
let stdinBufferCobol: Int32Array | null = null;
let hasInitialStdinCobol = false;
let initialStdinCobol: string | null = null;
let initialStdinConsumedCobol = false;

const normalizeWorkspacePath = (value: string) =>
	value
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');

const ensureTrailingNewline = (source: string) => (source.endsWith('\n') ? source : `${source}\n`);

function resolveInputPath(activePath?: string) {
	const normalized = normalizeWorkspacePath(activePath || '');
	if (!normalized) return 'main.cob';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.cob`;
}

function readProgramStdin() {
	if (hasInitialStdinCobol) {
		if (initialStdinConsumedCobol) return null;
		initialStdinConsumedCobol = true;
		return initialStdinCobol ?? '';
	}
	return waitForBufferedStdin(stdinBufferCobol, () => postMessage({ buffer: true }));
}

async function loadCobolRuntime(
	clangAssets: WorkerRuntimeAssetConfig | undefined,
	cobolBaseUrl: string,
	log: boolean
) {
	configureWorkerRuntimeAssets(clangAssets || null);
	compiler = await createCobolCompiler({
		runtimeBaseUrl: cobolBaseUrl,
		clangRuntimeBaseUrl: clangAssets?.baseUrl || '',
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
		cobolBaseUrl
	} = event.data;
	if (load) {
		try {
			await loadCobolRuntime(clangAssets, cobolBaseUrl, log);
			postMessage({ load: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	} else if (typeof log === 'boolean' && !code) {
		// The compiler receives the current logging preference for every compilation.
	} else if (code) {
		if (!compiler) {
			postMessage({ error: 'COBOL runtime is not loaded.' });
			return;
		}
		stdinBufferCobol = new Int32Array(buffer);
		hasInitialStdinCobol = typeof stdin === 'string';
		initialStdinCobol = hasInitialStdinCobol ? stdin : null;
		initialStdinConsumedCobol = false;

		try {
			const files = (workspaceFiles || []) as SandboxWorkspaceFile[];
			const result = await compiler.compile({
				code: ensureTrailingNewline(code),
				fileName: resolveInputPath(activePath),
				sourceFormat: 'free',
				compileArgs: compileArgs || [],
				workspaceFiles: files,
				log,
				onProgress: ({ percent, message }) => {
					postMessage({ progress: percent / 100 });
					if (log) postMessage({ log: message });
				}
			});
			if (!result.success || !result.artifact) {
				throw new Error(result.stderr || 'GnuCOBOL did not produce a WebAssembly program.');
			}
			if (!prepare) {
				const execution = await executeBrowserCobolArtifact(result.artifact, {
					args: programArgs || [],
					stdin: readProgramStdin,
					stdout: (output) => postMessage({ output }),
					stderr: (output) => postMessage({ output }),
					files: files.map(({ path, content }) => ({ path, contents: content }))
				});
				if (execution.exitCode) {
					throw new Error(`COBOL program exited with ${execution.exitCode}`);
				}
			}
			postMessage({ results: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	}
};
