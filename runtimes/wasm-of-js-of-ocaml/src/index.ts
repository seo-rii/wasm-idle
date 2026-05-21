import type { MemoryFileSystem } from '../runtime/fs/memory-fs.js';
import type { SystemDispatcher } from '../runtime/system-dispatch.js';
import { createCompileHandler } from './compiler-worker.js';
import type { CompileRequest, CompileResult, ToolchainManifest } from './types.js';
import type {
	CompileWorkerErrorMessage,
	CompileWorkerMessage,
	CompileWorkerResultMessage
} from './worker-protocol.js';

export * from './types.js';
export * from '../runtime/system-dispatch.js';
export * from '../runtime/fs/memory-fs.js';
export * from '../runtime/system-dispatch-browser-worker.js';

export interface CompileOptions {
	manifest?: ToolchainManifest;
	worker?: Worker;
	createFileSystem?: () => MemoryFileSystem;
	system?: SystemDispatcher;
	toolchainRoot?: string;
}

export async function compile(
	request: CompileRequest,
	options: CompileOptions = {}
): Promise<CompileResult> {
	const worker = options.worker;
	if (worker) {
		return await new Promise<CompileResult>((resolve, reject) => {
			const handleMessage = (event: MessageEvent<CompileWorkerMessage>) => {
				const message = event.data;
				if (!message) {
					return;
				}
				if (message.type === 'result') {
					worker.removeEventListener('message', handleMessage as EventListener);
					resolve((message as CompileWorkerResultMessage).result);
					return;
				}
				if (message.type === 'error') {
					worker.removeEventListener('message', handleMessage as EventListener);
					reject(new Error((message as CompileWorkerErrorMessage).error));
				}
			};
			worker.addEventListener('message', handleMessage as EventListener);
			worker.postMessage({
				type: 'compile',
				request,
				...(options.manifest ? { manifest: options.manifest } : {})
			});
		});
	}

	const compileHandlerOptions: {
		createFileSystem?: () => MemoryFileSystem;
		system?: SystemDispatcher;
		toolchainRoot?: string;
	} = {};
	if (options.createFileSystem) {
		compileHandlerOptions.createFileSystem = options.createFileSystem;
	}
	if (options.system) {
		compileHandlerOptions.system = options.system;
	}
	if (options.toolchainRoot) {
		compileHandlerOptions.toolchainRoot = options.toolchainRoot;
	}

	const handleCompile = createCompileHandler(compileHandlerOptions);
	return await handleCompile(request, options.manifest);
}

export function createCompilerWorker() {
	return new Worker(new URL('./compiler-worker.js', import.meta.url), {
		type: 'module'
	});
}
