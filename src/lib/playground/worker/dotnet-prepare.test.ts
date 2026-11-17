// @vitest-environment node

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./dotnet.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function harness(prepare?: (request?: { language?: string }) => Promise<void>) {
	const compile = vi.fn();
	const execute = vi.fn();
	const messages: any[] = [];
	const create = vi.fn(() => ({ prepare, compile }));
	const assetFetch = vi.fn((..._args: unknown[]) => vi.fn());
	const context: any = {
		exports: {},
		postMessage: (message: unknown) => messages.push(message),
		console,
		fetch: vi.fn(),
		require: (id: string) =>
			id === './moduleAssetCache'
				? { createModuleAssetFetch: assetFetch }
				: { createDotnetCompiler: create, executeBrowserDotnetArtifact: execute }
	};
	vm.runInNewContext(code, context);
	const load = (language = 'csharp', persistentCache?: unknown) =>
		context.onmessage({
			data: {
				load: true,
				moduleUrl: 'https://test.invalid/index.js',
				language,
				persistentCache
			}
		});
	return { load, messages, compile, execute, create, assetFetch, context };
}
describe('.NET worker load readiness', () => {
	it.each(['csharp', 'fsharp', 'vbnet'])(
		'waits for actual %s compiler readiness',
		async (language) => {
			let ready!: () => void;
			const prepare = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						ready = resolve;
					})
			);
			const h = harness(prepare);
			const loading = h.load(language);
			await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
			expect(prepare).toHaveBeenCalledWith({ language });
			expect(h.messages).toEqual([]);
			ready();
			await loading;
			expect(h.messages).toEqual([{ load: true }]);
			expect(h.compile).not.toHaveBeenCalled();
			expect(h.execute).not.toHaveBeenCalled();
		}
	);
	it('keeps legacy runtime modules without prepare compatible', async () => {
		const h = harness();
		await h.load();
		expect(h.messages).toEqual([{ load: true }]);
	});
	it('reports preparation failure without load success and retries the next load', async () => {
		const prepare = vi
			.fn()
			.mockRejectedValueOnce(new Error('prepare failed'))
			.mockResolvedValue(undefined);
		const h = harness(prepare);
		await h.load();
		expect(h.messages.some((m) => m.load)).toBe(false);
		expect(String(h.messages[0].error)).toContain('prepare failed');
		await h.load();
		expect(h.messages.at(-1)).toEqual({ load: true });
		expect(prepare).toHaveBeenCalledTimes(2);
	});

	it('serves pinned wasm-dotnet files through the persistent cache before importing the runtime', async () => {
		const h = harness(async () => {});
		const nativeFetch = h.context.fetch;
		const policy = { enabled: true, maxEntryBytes: 1024 };
		await h.load('csharp', policy);
		expect(h.assetFetch).toHaveBeenCalledWith(
			'https://test.invalid/index.js',
			'wasm-dotnet',
			policy,
			expect.any(Function)
		);
		expect(h.create).toHaveBeenCalled();
		await h.load('csharp', policy);
		// A later load wraps the fetch the Worker started with, never its own wrapper.
		expect(h.context.fetch).toBe(h.assetFetch.mock.results[1]!.value);
		expect(h.assetFetch.mock.calls[1]![3]).toBe(h.assetFetch.mock.calls[0]![3]);
		expect(h.assetFetch.mock.calls[1]![3]).not.toBe(h.assetFetch.mock.results[0]!.value);
		expect(typeof nativeFetch).toBe('function');
	});
});
