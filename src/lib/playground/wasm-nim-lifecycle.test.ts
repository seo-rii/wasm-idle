// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = await readFile(
	new URL('../../../scripts/runtime-workers/wasm-nim-runner-worker.js', import.meta.url),
	'utf8'
);

function harness(initialize: (module: any, context: any) => void = () => {}) {
	const context: any = { TextEncoder, TextDecoder, Blob, URL, setTimeout, clearTimeout, console };
	const listeners = new Map<string, (event: unknown) => void>();
	context.addEventListener = (name: string, listener: (event: unknown) => void) =>
		listeners.set(name, listener);
	context.removeEventListener = (name: string) => listeners.delete(name);
	context.emit = (name: string, event: unknown) => listeners.get(name)?.(event);
	context.self = context;
	context.importScripts = () => initialize(context.Nim, context);
	const api = runInNewContext(`${source}\n({ loadNimCompiler, compileNimToC });`, context);
	return { ...api, context, assets: { take: () => new Uint8Array([0]) } };
}

describe('Nim initialization and translation contract', () => {
	it('times out even when the runtime callback never arrives and ignores a late callback', async () => {
		const api = harness();
		await expect(api.loadNimCompiler(api.assets, [], [], 10)).rejects.toThrow(
			'initialization timed out'
		);
		api.context.FS = {};
		api.context.callMain = () => 0;
		expect(() => api.context.Nim.onRuntimeInitialized()).not.toThrow();
	});

	it('uses the same deadline when initialization finishes without the filesystem exports', async () => {
		const api = harness((module) => module.onRuntimeInitialized());
		await expect(api.loadNimCompiler(api.assets, [], [], 10)).rejects.toThrow(
			'initialization timed out'
		);
	});

	it('rejects a runtime abort immediately, preserving its diagnostic', async () => {
		const api = harness((module) => module.onAbort('Wasm allocation failed'));
		await expect(api.loadNimCompiler(api.assets, [], [])).rejects.toThrow(
			'initialization aborted: Wasm allocation failed'
		);
	});

	it('rejects asynchronous initialization failures and removes the rejection listener', async () => {
		const preventDefault = vi.fn();
		const api = harness((_module, context) => {
			setTimeout(
				() =>
					context.emit('unhandledrejection', {
						reason: new Error('Wasm instantiate failed'),
						preventDefault
					}),
				0
			);
		});
		await expect(api.loadNimCompiler(api.assets, [], [])).rejects.toThrow(
			'Wasm instantiate failed'
		);
		expect(preventDefault).toHaveBeenCalledOnce();
		api.context.emit('unhandledrejection', { reason: new Error('late error'), preventDefault });
		expect(preventDefault).toHaveBeenCalledOnce();
	});

	it('waits for runtime initialization and usable compiler exports', async () => {
		const api = harness((module, context) => {
			context.FS = {};
			context.callMain = () => 0;
			module.onRuntimeInitialized();
		});
		await expect(api.loadNimCompiler(api.assets, [], [])).resolves.toEqual({
			FS: api.context.FS,
			callMain: api.context.callMain
		});
	});

	it.each([1, -1, undefined])(
		'rejects unsuccessful exit %s before reading incomplete generated files',
		(exitCode) => {
			const api = harness();
			const FS = { readdir: vi.fn(() => ['partial.nim.c']) };
			expect(() =>
				api.compileNimToC(
					{ FS, callMain: () => exitCode },
					'bad code',
					[],
					['type mismatch']
				)
			).toThrow('Nim translation failed');
			expect(FS.readdir).not.toHaveBeenCalled();
		}
	);

	it('allows a normal Emscripten exit and uses a fresh explicit compile-only directory', () => {
		const api = harness();
		const FS = { readdir: vi.fn(() => ['main.nim.c', 'system.nim.c']) };
		const callMain = vi.fn((_args: string[]) => {
			throw { name: 'ExitStatus', status: 0 };
		});
		const first = api.compileNimToC({ FS, callMain }, 'echo 1', [], []);
		const second = api.compileNimToC({ FS, callMain }, 'echo 2', [], []);
		expect(first).toMatchObject({
			success: true,
			exitCode: 0,
			cFiles: ['main.nim.c', 'system.nim.c']
		});
		expect(second.cacheDir).not.toBe(first.cacheDir);
		expect(callMain.mock.calls[0][0]).toEqual(
			expect.arrayContaining(['--compileOnly:on', `--nimcache:${first.cacheDir}`])
		);
	});

	it('does not treat arbitrary thrown objects or missing output as successful compilation', () => {
		const api = harness();
		const FS = { readdir: () => [] };
		expect(() =>
			api.compileNimToC(
				{
					FS,
					callMain: () => {
						throw new Error('compiler trap');
					}
				},
				'',
				[],
				[]
			)
		).toThrow('compiler trap');
		expect(() => api.compileNimToC({ FS, callMain: () => 0 }, '', [], [])).toThrow(
			'did not emit C files'
		);
	});
});
