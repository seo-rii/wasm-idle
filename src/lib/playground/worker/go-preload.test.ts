// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A data: module URL never reaches the persistent cache, so stand in for the cached fetch
// that an http(s) deployment installs.
vi.mock('./moduleAssetCache', () => ({
	createModuleAssetFetch: (
		_moduleUrl: string,
		_prefix: string,
		cache: { enabled?: boolean } | undefined,
		network: typeof fetch
	) => (cache?.enabled ? (...args: Parameters<typeof fetch>) => network(...args) : network)
}));

const moduleUrl = (source: string) =>
	`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;

const runtime = moduleUrl(`
	export async function createGoCompiler() {
		return {
			async plan(request) {
				globalThis.__events.push('plan');
				globalThis.__planRequest = request;
				if (globalThis.__planError) throw globalThis.__planError;
				return { sysrootChunks: [{ index: 'a.index' }, { index: 'b.index' }] };
			},
			async compile(options) {
				globalThis.__events.push('compile');
				return {
					success: true,
					artifact: { wasm: new Uint8Array([0, 97, 115, 109]), target: options.target }
				};
			}
		};
	}
	export async function preloadBrowserGoRuntime(options) {
		globalThis.__events.push('tools');
		globalThis.__toolOptions = options;
		await globalThis.__gate;
	}
	export async function loadRuntimePackEntries(...args) {
		globalThis.__packCalls.push(args);
		await globalThis.__gate;
		return [];
	}
	export async function executeBrowserGoArtifact() {
		return { exitCode: 0, stdout: '', stderr: '' };
	}
`);

const manifestUrl = 'https://example.invalid/wasm-go/runtime/runtime-manifest.v1.json?v=7';
const limits = { assetTimeoutMs: 31, maxAssetBytes: 32, maxWasmMemoryBytes: 33 };

async function load(persistentCache: object | undefined) {
	await import('./go');
	await (globalThis as any).self.onmessage({
		data: {
			load: true,
			compilerUrl: runtime,
			manifestUrl,
			runtimeLimits: limits,
			persistentCache
		}
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const run = () =>
	(globalThis as any).self.onmessage({
		data: {
			code: 'package main\nfunc main() {}',
			prepare: true,
			buffer: new SharedArrayBuffer(1024)
		}
	});

describe('Go worker preload', () => {
	let open = () => {};
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__events = [];
		(globalThis as any).__packCalls = [];
		(globalThis as any).__planError = undefined;
		(globalThis as any).__gate = new Promise<void>((resolve) => (open = resolve));
	});

	it('fetches the tools and the chunks a fmt build needs without holding up a compile', async () => {
		await load({ enabled: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).__toolOptions).toEqual({
			runtimeManifestUrl: manifestUrl,
			target: 'wasip1/wasm',
			includeSysroot: false,
			...limits
		});
		expect((globalThis as any).__planRequest).toEqual({
			code: expect.stringContaining('import "fmt"'),
			target: 'wasip1/wasm',
			...limits
		});
		// Chunks resolve against the manifest directory with its version query, unsignalled.
		expect((globalThis as any).__packCalls).toEqual([
			[
				'https://example.invalid/wasm-go/runtime/?v=7',
				{ index: 'a.index' },
				globalThis.fetch,
				undefined,
				limits
			],
			[
				'https://example.invalid/wasm-go/runtime/?v=7',
				{ index: 'b.index' },
				globalThis.fetch,
				undefined,
				limits
			]
		]);
		// The downloads are still open; a Run compiles at once and joins them per file.
		await run();
		expect((globalThis as any).__events).toEqual(['tools', 'plan', 'compile']);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		open();
	});

	it('compiles normally when the preload fails', async () => {
		(globalThis as any).__planError = new Error('offline');
		await load({ enabled: true });
		await run();
		expect((globalThis as any).__events).toEqual(['tools', 'plan', 'compile']);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		open();
	});

	it('preloads only the in-memory sysroot chunks without the persistent cache', async () => {
		await load({ enabled: false });
		await run();
		// Without the cache a second request for a tool could be a second download.
		expect((globalThis as any).__events).toEqual(['plan', 'compile']);
		expect((globalThis as any).__packCalls).toHaveLength(2);
		open();
	});
});
