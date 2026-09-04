import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
	findRustCompilerRetries,
	readActiveState
} from '../../../scripts/rust-browser-probe-lib.mjs';

describe('Rust browser compiler stability diagnostics', () => {
	it('targets the dedicated language selector', async () => {
		const source = await readFile('scripts/rust-browser-probe-lib.mjs', 'utf8');

		expect(source).toContain("document.querySelector('#language-select')");
		expect(source).not.toMatch(/waitForSelector\('select'/u);
		expect(source).not.toContain("querySelector('select')");
	});

	it('retains a rustc retry even when later console output would evict it from the tail', () => {
		const messages = [
			{
				type: 'warning',
				text: '[wasm-rust] browser rustc attempt 1/2 failed; retrying'
			},
			...Array.from({ length: 200 }, (_, index) => ({
				type: 'debug',
				text: `later compiler message ${index}`
			}))
		];

		expect(findRustCompilerRetries(messages)).toEqual([
			'[warning] [wasm-rust] browser rustc attempt 1/2 failed; retrying'
		]);
	});

	it('retries readiness measurement after navigation replaces the execution context', async () => {
		const activeState = {
			crossOriginIsolated: true,
			sharedArrayBuffer: true,
			serviceWorkerControlled: true
		};
		const page = {
			evaluate: vi
				.fn()
				.mockRejectedValueOnce(
					new Error(
						'page.evaluate: Execution context was destroyed, most likely because of a navigation'
					)
				)
				.mockResolvedValueOnce(activeState),
			waitForLoadState: vi.fn().mockResolvedValue(undefined)
		};

		await expect(readActiveState(page as never)).resolves.toEqual(activeState);
		expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');
		expect(page.evaluate).toHaveBeenCalledTimes(2);
	});
});
