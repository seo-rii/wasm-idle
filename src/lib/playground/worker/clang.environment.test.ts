// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Clang Worker environment detection', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal('self', globalThis);
		vi.stubGlobal('postMessage', vi.fn());
		expect('document' in globalThis).toBe(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(globalThis, 'document');
		Reflect.deleteProperty(globalThis, 'onmessage');
	});

	it('does not manufacture a document while importing the actual Clang runtime', async () => {
		const { BrowserClangRuntime } = await import('@wasm-idle/llvm-core/clang');
		expect(typeof BrowserClangRuntime).toBe('function');
		expect('document' in globalThis).toBe(false);
	});

	it('keeps the worker entry document-less so Vite HMR takes its Worker branch', async () => {
		await import('./clang');
		expect(typeof (globalThis as typeof globalThis & { onmessage?: unknown }).onmessage).toBe(
			'function'
		);
		// This is the capability check used by Vite's HMR overlay before accessing the DOM.
		expect('document' in globalThis).toBe(false);
	});
});
