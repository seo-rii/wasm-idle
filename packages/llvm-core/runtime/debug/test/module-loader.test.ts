import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSharedByteQueue } from '../src/shared-byte-queue.js';
import {
	createTransportBindings,
	mountDebugFiles,
	startLinearMemoryTelemetry,
	type EmscriptenDebugModule
} from '../src/worker/module-loader.js';

function debugModule(bytes?: number): EmscriptenDebugModule {
	return {
		FS: {
			mkdirTree: vi.fn(),
			writeFile: vi.fn(),
			chdir: vi.fn()
		},
		...(bytes === undefined ? {} : { HEAPU8: new Uint8Array(bytes) }),
		callMain: vi.fn()
	};
}

describe('debug transport bindings', () => {
	it('rejects a queue descriptor reused in both RSP directions', () => {
		const shared = createSharedByteQueue(4096, 41);

		expect(() =>
			createTransportBindings({
				generation: 'aliased-rsp',
				rspInput: shared,
				rspOutput: shared
			})
		).toThrow(/debug transport channels must not reuse shared buffers/u);
	});

	it('rejects a payload buffer shared between RSP and DAP channels', () => {
		const rspInput = createSharedByteQueue(4096, 42);
		const dapInput = createSharedByteQueue(4096, 42);

		expect(() =>
			createTransportBindings({
				generation: 'aliased-protocols',
				rspInput,
				rspOutput: createSharedByteQueue(4096, 42),
				dapInput: { ...dapInput, data: rspInput.data },
				dapOutput: createSharedByteQueue(4096, 42)
			})
		).toThrow(/debug transport channels must not reuse shared buffers/u);
	});

	it('requires DAP input and output descriptors together', () => {
		expect(() =>
			createTransportBindings({
				generation: 'partial-dap',
				rspInput: createSharedByteQueue(4096, 43),
				rspOutput: createSharedByteQueue(4096, 43),
				dapInput: createSharedByteQueue(4096, 43)
			})
		).toThrow(/DAP input and output descriptors must be provided together/u);
	});
});

describe('debug file mounting', () => {
	it.each([
		{
			name: 'program type',
			program: 'not-wasm-bytes',
			sources: [],
			error: /debug program must be a Uint8Array/u
		},
		{
			name: 'source collection',
			program: Uint8Array.of(0, 97, 115, 109),
			sources: {},
			error: /debug sources must be an array/u
		},
		{
			name: 'source entry',
			program: Uint8Array.of(0, 97, 115, 109),
			sources: [null],
			error: /debug source entry must be an object/u
		},
		{
			name: 'source path type',
			program: Uint8Array.of(0, 97, 115, 109),
			sources: [{ path: 42, content: 'int main() {}' }],
			error: /debug source path must be a string/u
		},
		{
			name: 'source content type',
			program: Uint8Array.of(0, 97, 115, 109),
			sources: [{ path: '/workspace/main.c', content: 42 }],
			error: /debug source content must be a string/u
		},
		{
			name: 'duplicate source path',
			program: Uint8Array.of(0, 97, 115, 109),
			sources: [
				{ path: '/workspace/main.c', content: 'int value;' },
				{ path: '/workspace/main.c', content: 'int main() {}' }
			],
			error: /duplicate debug source path/u
		}
	])('rejects an invalid $name before mutating MEMFS', ({ program, sources, error }) => {
		const module = debugModule();

		expect(() =>
			mountDebugFiles(
				module,
				program as Uint8Array,
				sources as Array<{ path: string; content: string }>
			)
		).toThrow(error);
		expect(module.FS.mkdirTree).not.toHaveBeenCalled();
		expect(module.FS.writeFile).not.toHaveBeenCalled();
	});
});

describe('linear memory telemetry', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('reports only growth and takes a final sample before stopping', () => {
		vi.useFakeTimers();
		const postMessage = vi.fn();
		vi.stubGlobal('postMessage', postMessage);
		const module = debugModule(64);

		const stop = startLinearMemoryTelemetry(module, 'lldb', 'memory-generation', 10);
		expect(postMessage).toHaveBeenLastCalledWith({
			type: 'memory',
			worker: 'lldb',
			bytes: 64,
			generation: 'memory-generation'
		});

		module.HEAPU8 = new Uint8Array(128);
		vi.advanceTimersByTime(10);
		vi.advanceTimersByTime(10);
		expect(postMessage).toHaveBeenCalledTimes(2);
		expect(postMessage).toHaveBeenLastCalledWith({
			type: 'memory',
			worker: 'lldb',
			bytes: 128,
			generation: 'memory-generation'
		});

		module.HEAPU8 = new Uint8Array(256);
		stop();
		expect(postMessage).toHaveBeenCalledTimes(3);
		expect(postMessage).toHaveBeenLastCalledWith({
			type: 'memory',
			worker: 'lldb',
			bytes: 256,
			generation: 'memory-generation'
		});
		vi.advanceTimersByTime(20);
		expect(postMessage).toHaveBeenCalledTimes(3);
	});

	it('is a no-op for an older runtime without the memory export', () => {
		const postMessage = vi.fn();
		vi.stubGlobal('postMessage', postMessage);
		const stop = startLinearMemoryTelemetry(debugModule(), 'target', 'legacy-generation', 10);

		stop();
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('does not touch the aborting compatibility getter in older Emscripten modules', () => {
		const postMessage = vi.fn();
		vi.stubGlobal('postMessage', postMessage);
		const module = debugModule();
		Object.defineProperty(module, 'HEAPU8', {
			configurable: true,
			get() {
				throw new Error("'HEAPU8' was not exported. add it to EXPORTED_RUNTIME_METHODS");
			}
		});

		expect(() =>
			startLinearMemoryTelemetry(module, 'lldb', 'legacy-generation', 10)
		).not.toThrow();
		expect(postMessage).not.toHaveBeenCalled();
	});
});
