import { executeBrowserClangArtifact } from '@wasm-idle/llvm-core/clang';
import {
	CLANG_STDIN_DATA,
	CLANG_STDIN_EOF,
	CLANG_STDIN_HEADER_BYTES,
	CLANG_STDIN_WAITING,
	type ClangExecuteWorkerRequest,
	type ClangExecuteWorkerResponse
} from '../clangWorkerProtocol';

const worker = globalThis as unknown as {
	onmessage: ((event: MessageEvent<ClangExecuteWorkerRequest>) => void) | null;
	postMessage(message: ClangExecuteWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
	worker.onmessage = null;
	try {
		const hasStaticInput = typeof data.stdin === 'string';
		let staticInput = hasStaticInput ? new TextEncoder().encode(data.stdin) : null;
		let reachedEof = false;
		const control = hasStaticInput ? null : new Int32Array(data.inputBuffer, 0, 2);
		const payload = hasStaticInput
			? null
			: new Uint8Array(data.inputBuffer, CLANG_STDIN_HEADER_BYTES);
		if (payload && payload.byteLength === 0) throw new Error('C/C++ stdin buffer is empty.');
		const files = (data.workspaceFiles || []).map(({ path, content }) => ({
			path,
			contents: content
		}));
		if (data.code !== undefined) {
			files.push({
				path: data.activePath || (data.artifact.language === 'C' ? 'main.c' : 'main.cc'),
				contents: data.code
			});
		}
		// The public executor creates a fresh WASI host, files, descriptors and Wasm
		// instance. Only the immutable compiled Module is reused across executions.
		const result = await executeBrowserClangArtifact(data.artifact, {
			args: data.programArgs,
			env: data.env,
			files,
			stdin: () => {
				if (hasStaticInput) {
					const next = staticInput;
					staticInput = null;
					return next?.byteLength ? next : null;
				}
				if (reachedEof) return null;
				Atomics.store(control!, 0, CLANG_STDIN_WAITING);
				worker.postMessage({ type: 'stdin' });
				while (Atomics.load(control!, 0) === CLANG_STDIN_WAITING) {
					Atomics.wait(control!, 0, CLANG_STDIN_WAITING);
				}
				const state = Atomics.load(control!, 0);
				if (state === CLANG_STDIN_EOF) {
					reachedEof = true;
					return null;
				}
				const length = Atomics.load(control!, 1);
				if (state !== CLANG_STDIN_DATA || length < 0 || length > payload!.byteLength) {
					throw new Error('Invalid C/C++ stdin buffer response.');
				}
				return payload!.slice(0, length);
			},
			stdout: (output) => worker.postMessage({ type: 'output', output }),
			stderr: (output) => worker.postMessage({ type: 'output', output })
		});
		worker.postMessage({ type: 'done', exitCode: result.exitCode });
	} catch (error) {
		worker.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
