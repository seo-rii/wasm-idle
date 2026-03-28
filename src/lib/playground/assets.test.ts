import { describe, expect, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: '',
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: ''
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import { resolveRuntimeAssetConfig } from './assets';

describe('runtime asset config resolution', () => {
	it('derives the default python asset base url from the legacy root path', () => {
		expect(
			resolveRuntimeAssetConfig('python', '/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/pyodide/',
			useAssetBridge: false
		});
	});

	it('derives the default TeaVM asset base url from the shared root path', () => {
		expect(
			resolveRuntimeAssetConfig(
				'java',
				{ rootUrl: '/absproxy/5173' },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/teavm/',
			useAssetBridge: false
		});
	});

	it('uses a virtual base url when only a python custom loader is provided', () => {
		const loader = vi.fn();
		expect(resolveRuntimeAssetConfig('python', { python: { loader } })).toEqual({
			baseUrl: 'https://wasm-idle.invalid/python/',
			loader,
			useAssetBridge: true
		});
	});

	it('prefers an explicit java base url over the shared root path', () => {
		const loader = vi.fn();
		expect(
			resolveRuntimeAssetConfig(
				'java',
				{
					rootUrl: '/ignored',
					java: {
						baseUrl: 'https://cdn.example.com/teavm',
						loader
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/teavm/',
			loader,
			useAssetBridge: true
		});
	});

	it('prefers an explicit rust compiler url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = 'https://env.example.com/compiler.js';
		const { resolveRustCompilerUrl } = await import('./assets');

		expect(
			resolveRustCompilerUrl(
				{
					rust: {
						compilerUrl: '/runtime/rust/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/rust/index.js');
	});

	it('falls back to PUBLIC_WASM_RUST_COMPILER_URL when no rust runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '/wasm-rust/index.js';
		const { resolveRustCompilerUrl } = await import('./assets');

		expect(resolveRustCompilerUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/wasm-rust/index.js'
		);
	});

	it('prefers an explicit TinyGo runtime module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = 'https://env.example.com/wasm-tinygo/runtime.js';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(
			resolveTinyGoModuleUrl(
				{
					tinygo: {
						moduleUrl: '/runtime/tinygo/runtime.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/tinygo/runtime.js');
	});

	it('derives the default TinyGo runtime module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(resolveTinyGoModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-tinygo/runtime.js'
		);
	});

	it('derives the TinyGo runtime module url from the legacy app url override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = 'https://env.example.com/wasm-tinygo/index.html?v=42';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(resolveTinyGoModuleUrl(undefined, 'https://example.com/app')).toBe(
			'https://env.example.com/wasm-tinygo/runtime.js?v=42'
		);
	});
});
