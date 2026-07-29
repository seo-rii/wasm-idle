import { beforeEach, describe, expect, it, vi } from 'vitest';

const startupMocks = vi.hoisted(() => ({
	compile: vi.fn(),
	memfsOptions: [] as Array<{ signal?: AbortSignal }>,
	readBuffer: vi.fn()
}));

vi.mock('../../core/src/wasm.js', () => ({
	compile: startupMocks.compile,
	readBuffer: startupMocks.readBuffer
}));

vi.mock('../../core/src/memfs.js', () => ({
	default: class MockMemFS {
		ready = Promise.resolve();

		constructor(options: { signal?: AbortSignal }) {
			startupMocks.memfsOptions.push(options);
		}
	}
}));

import Clang from '../src/runtime.js';

function rejectOnAbort(signal?: AbortSignal) {
	return new Promise<never>((_resolve, reject) => {
		if (!signal) return;
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

describe('Clang runtime startup', () => {
	beforeEach(() => {
		startupMocks.compile.mockReset();
		startupMocks.readBuffer.mockReset();
		startupMocks.memfsOptions.length = 0;
		startupMocks.compile.mockImplementation(
			(_url: string, _progress: unknown, signal?: AbortSignal) => rejectOnAbort(signal)
		);
		startupMocks.readBuffer.mockImplementation(
			(_url: string, _progress: unknown, _maxBytes: unknown, signal?: AbortSignal) =>
				rejectOnAbort(signal)
		);
	});

	it('cancels every startup asset with the caller signal', async () => {
		const controller = new AbortController();
		const reason = new Error('stop Clang runtime startup');
		const runtime = new Clang({
			runtimeBaseUrl: 'https://cdn.test/clang/',
			signal: controller.signal
		});

		await vi.waitFor(() => {
			expect(startupMocks.compile).toHaveBeenCalledTimes(2);
			expect(startupMocks.readBuffer).toHaveBeenCalledOnce();
		});
		expect(startupMocks.memfsOptions).toEqual([
			expect.objectContaining({ signal: controller.signal })
		]);
		expect(startupMocks.compile.mock.calls.map(([url]) => url)).toEqual([
			'https://cdn.test/clang/bin/clang.wasm.gz',
			'https://cdn.test/clang/bin/lld.wasm.gz'
		]);
		for (const call of startupMocks.compile.mock.calls) {
			expect(call[2]).toBe(controller.signal);
		}
		expect(startupMocks.readBuffer).toHaveBeenCalledWith(
			'https://cdn.test/clang/bin/sysroot.tar.gz',
			undefined,
			undefined,
			controller.signal
		);

		controller.abort(reason);

		await expect(runtime.ready).rejects.toBe(reason);
	});
});
