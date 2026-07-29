import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeManifestV1 } from '../src/types.js';

const runtimeState = vi.hoisted(() => ({
	options: [] as Array<{ signal?: AbortSignal }>
}));

vi.mock('../src/runtime.js', () => ({
	default: class MockRuntime {
		readonly ready: Promise<void>;

		constructor(options: { signal?: AbortSignal }) {
			runtimeState.options.push(options);
			const { signal } = options;
			this.ready = new Promise<void>((resolve, reject) => {
				if (!signal) {
					resolve();
					return;
				}
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		}
	}
}));

import { createClangCompiler, preloadBrowserClangRuntime } from '../src/compiler.js';

const manifest: RuntimeManifestV1 = {
	manifestVersion: 1,
	version: 'cancellation-test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: { asset: 'bin/memfs.wasm.gz', argv0: 'memfs' },
		clang: { asset: 'bin/clang.wasm.gz', argv0: 'clang' },
		lld: { asset: 'bin/lld.wasm.gz', argv0: 'wasm-ld' },
		sysroot: { asset: 'bin/sysroot.tar.gz' }
	},
	clangd: {
		js: 'clangd/clangd.js',
		wasm: 'clangd/clangd.wasm.gz'
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	}
};

describe('Clang compiler startup cancellation', () => {
	beforeEach(() => {
		runtimeState.options.length = 0;
	});

	it('passes the caller signal through manifest fetch startup', async () => {
		const controller = new AbortController();
		const reason = new Error('stop Clang manifest fetch');
		const fetchImpl = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (!signal) return;
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		);
		const pending = preloadBrowserClangRuntime({
			manifestUrl: 'https://cdn.test/clang/runtime-manifest.v1.json',
			fetchImpl,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://cdn.test/clang/runtime-manifest.v1.json',
			expect.objectContaining({ signal: controller.signal })
		);
		expect(runtimeState.options).toHaveLength(0);
	});

	it('preserves cancellation from compiler runtime startup', async () => {
		const controller = new AbortController();
		const reason = new Error('stop Clang compiler startup');
		const compiler = await createClangCompiler({
			runtimeBaseUrl: 'https://cdn.test/clang/',
			manifest,
			signal: controller.signal
		});
		const pending = compiler.compile({
			code: 'int main(void) { return 0; }',
			language: 'C'
		});

		await vi.waitFor(() => expect(runtimeState.options).toHaveLength(1));
		expect(runtimeState.options[0]?.signal).toBe(controller.signal);
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

	it('preserves cancellation from preload runtime startup', async () => {
		const controller = new AbortController();
		const reason = new Error('stop Clang preload');
		const pending = preloadBrowserClangRuntime({
			runtimeBaseUrl: 'https://cdn.test/clang/',
			manifest,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(runtimeState.options).toHaveLength(1));
		expect(runtimeState.options[0]?.signal).toBe(controller.signal);
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});
});
