import { describe, expect, it } from 'vitest';

import { findRustCompilerRetries } from '../../../scripts/rust-browser-probe-lib.mjs';

describe('Rust browser compiler stability diagnostics', () => {
	it('retains every rustc retry even when later console output would evict it from the tail', () => {
		const messages = [
			{
				type: 'warning',
				text: '[wasm-rust] browser rustc attempt 1/5 failed; retrying'
			},
			...Array.from({ length: 200 }, (_, index) => ({
				type: 'debug',
				text: `later compiler message ${index}`
			})),
			{
				type: 'warning',
				text: '[wasm-rust] browser rustc attempt 2/5 failed; retrying'
			}
		];

		expect(findRustCompilerRetries(messages)).toEqual([
			'[warning] [wasm-rust] browser rustc attempt 1/5 failed; retrying',
			'[warning] [wasm-rust] browser rustc attempt 2/5 failed; retrying'
		]);
	});
});
