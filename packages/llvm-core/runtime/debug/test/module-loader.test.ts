import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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
		const stop = startLinearMemoryTelemetry(
			debugModule(),
			'target',
			'legacy-generation',
			10
		);

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
				throw new Error(
					"'HEAPU8' was not exported. add it to EXPORTED_RUNTIME_METHODS"
				);
			}
		});

		expect(() =>
			startLinearMemoryTelemetry(module, 'lldb', 'legacy-generation', 10)
		).not.toThrow();
		expect(postMessage).not.toHaveBeenCalled();
	});
});
