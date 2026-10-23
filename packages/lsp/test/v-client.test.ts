import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLanguageToolAsset } from '../src/assets.js';
import { getVLanguageServer } from '../src/v/language-server.js';
import type { LanguageServerStatus } from '../src/worker-client.js';

vi.mock('../src/assets.js', async (original) => ({
	...(await original<typeof import('../src/assets.js')>()),
	loadLanguageToolAsset: vi.fn()
}));

describe('V multi-asset startup', () => {
	afterEach(() => vi.mocked(loadLanguageToolAsset).mockReset());
	it('cancels other downloads on an integrity failure and keeps the error status terminal', async () => {
		const failure = new Error('V loader SHA-256 mismatch');
		const aborted: string[] = [];
		const statuses: LanguageServerStatus[] = [];
		const createWorker = vi.fn();
		vi.mocked(loadLanguageToolAsset).mockImplementation(
			(_runtime, name, _config, progress, options) => {
				if (name === 'v_analyzer.mjs') return Promise.reject(failure);
				return new Promise((_resolve, reject) =>
					options?.signal?.addEventListener(
						'abort',
						() => {
							aborted.push(name);
							progress(1, 2);
							reject(options.signal!.reason);
						},
						{ once: true }
					)
				);
			}
		);
		await expect(
			getVLanguageServer({
				rootUrl: 'https://app.example/',
				createWorker,
				onStatus: (status) => statuses.push(status)
			})
		).rejects.toBe(failure);
		expect(aborted.sort()).toEqual(['v_analyzer.wasm', 'stdlib.json.gz.bin'].sort());
		expect(statuses.at(-1)?.state).toBe('error');
		expect(createWorker).not.toHaveBeenCalled();
	});
	it('aborts every in-flight asset with the caller cancellation reason', async () => {
		const controller = new AbortController();
		const reason = new DOMException('V startup cancelled', 'AbortError');
		const aborted: string[] = [];
		vi.mocked(loadLanguageToolAsset).mockImplementation(
			(_runtime, name, _config, _progress, options) =>
				new Promise((_resolve, reject) =>
					options?.signal?.addEventListener(
						'abort',
						() => {
							aborted.push(name);
							reject(options.signal!.reason);
						},
						{ once: true }
					)
				)
		);
		const startup = getVLanguageServer({
			rootUrl: 'https://app.example/',
			signal: controller.signal
		});
		controller.abort(reason);
		await expect(startup).rejects.toBe(reason);
		expect(aborted.sort()).toEqual(
			['v_analyzer.mjs', 'v_analyzer.wasm', 'stdlib.json.gz.bin'].sort()
		);
	});
});
