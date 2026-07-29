import { describe, expect, it, vi } from 'vitest';

import { compileD } from '../src/compiler.js';
import type { RuntimeManifestV1 } from '../src/types.js';

const manifest = {
	manifestVersion: 1,
	name: 'wasm-d',
	version: 'test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		ldc2: { asset: 'ldc2.wasm' },
		toolchain: { asset: 'toolchain.tar.gz', compression: 'gzip' },
		linker: {
			kind: 'emscripten-lld',
			js: { asset: 'lld.js' },
			wasm: { asset: 'lld.wasm.gz', compression: 'gzip' },
			data: { asset: 'lld.data.gz', compression: 'gzip' }
		}
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	}
} satisfies RuntimeManifestV1;

describe('D compiler asset cancellation', () => {
	it('rejects a pre-aborted compile without fetching the manifest', async () => {
		const fetchImpl = vi.fn();
		const controller = new AbortController();
		const reason = new Error('stop before D compilation');
		controller.abort(reason);

		await expect(
			compileD(
				{
					code: 'void main() {}',
					signal: controller.signal
				},
				{
					runtimeBaseUrl: 'https://example.test/runtime/',
					fetchImpl
				}
			)
		).rejects.toBe(reason);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('passes one signal to every parallel asset fetch and preserves its abort reason', async () => {
		const signals: Array<AbortSignal | null | undefined> = [];
		let cancelled = 0;
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			signals.push(init?.signal);
			return new Response(
				new ReadableStream({
					cancel() {
						cancelled += 1;
					}
				})
			);
		});
		const controller = new AbortController();
		const reason = new Error('stop parallel D assets');
		const pending = compileD(
			{
				code: 'void main() {}',
				signal: controller.signal
			},
			{
				runtimeBaseUrl: 'https://example.test/runtime/',
				manifest,
				fetchImpl
			}
		);

		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
		expect(signals).toEqual([
			controller.signal,
			controller.signal,
			controller.signal,
			controller.signal
		]);
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		await vi.waitFor(() => expect(cancelled).toBe(4));
	});
});
