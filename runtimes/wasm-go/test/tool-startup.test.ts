import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

import { executeGoToolInvocation } from '../src/tool-runtime.js';
import type { BrowserGoBuildPlan, BrowserGoToolInvocation } from '../src/types.js';

// A real, minimal WASI command exporting memory and a no-op _start.
const command = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fixture() {
	const invocation: BrowserGoToolInvocation = {
		tool: 'compile',
		argv0: 'compile',
		toolAsset: 'tools/compile.wasm',
		args: ['compile'],
		env: {},
		inputFiles: [{ path: '/work/main.go', contents: 'package main' }],
		outputPath: '/work/main.a'
	};
	const plan = {
		compile: invocation,
		sysrootFiles: [{ runtimePath: '/sysroot/lib.a', asset: 'sysroot/lib.a' }]
	} as BrowserGoBuildPlan;
	const sysroot = deferred<Response>();
	const tool = deferred<Response>();
	const fetchImpl = vi.fn((url: string | URL | Request) =>
		String(url).includes('/tools/') ? tool.promise : sysroot.promise
	) as unknown as typeof fetch;
	const start = (options = {}) =>
		executeGoToolInvocation(
			invocation,
			plan,
			'https://example.test/go/',
			fetchImpl,
			undefined,
			options
		);
	return { invocation, plan, sysroot, tool, fetchImpl, start };
}

const response = (bytes: Uint8Array) => new Response(Uint8Array.from(bytes).buffer);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
afterEach(() => vi.restoreAllMocks());

describe('Go tool startup', () => {
	it('starts both asset requests before either response is available', async () => {
		const f = fixture();
		const run = f.start();
		await tick();
		expect(f.fetchImpl).toHaveBeenCalledTimes(2);
		f.sysroot.resolve(new Response('library'));
		f.tool.resolve(response(command));
		expect((await run).exitCode).toBe(0);
	});

	it('compiles the tool while sysroot is pending, but does not instantiate it', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const f = fixture();
		const run = f.start();
		f.tool.resolve(response(command));
		await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
		expect(instantiate).not.toHaveBeenCalled();
		f.sysroot.resolve(new Response('library'));
		expect(await run).toMatchObject({ exitCode: 0, stdout: '', stderr: '', outputs: {} });
		expect(instantiate).toHaveBeenCalledTimes(1);
	});

	it('also handles a sysroot that finishes before the compiler', async () => {
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const f = fixture();
		const run = f.start();
		f.sysroot.resolve(new Response('library'));
		await tick();
		expect(instantiate).not.toHaveBeenCalled();
		f.tool.resolve(response(command));
		expect((await run).exitCode).toBe(0);
	});

	it('reports a tool fetch failure while sysroot remains pending', async () => {
		const f = fixture();
		const run = f.start();
		const assertion = expect(run).rejects.toThrow('tool unavailable');
		f.tool.reject(new Error('tool unavailable'));
		await assertion;
		f.sysroot.reject(new Error('late sysroot failure'));
		await tick();
	});

	it('reports a sysroot failure while the tool remains pending', async () => {
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const f = fixture();
		const run = f.start();
		const assertion = expect(run).rejects.toThrow('sysroot unavailable');
		f.sysroot.reject(new Error('sysroot unavailable'));
		await assertion;
		f.tool.reject(new Error('late tool failure'));
		await tick();
		expect(instantiate).not.toHaveBeenCalled();
	});

	it('observes synchronous fetch failures in both branches', async () => {
		const f = fixture();
		const fetchImpl = vi.fn(() => {
			throw new Error('synchronous fetch failure');
		});
		await expect(
			executeGoToolInvocation(f.invocation, f.plan, 'https://example.test/', fetchImpl)
		).rejects.toThrow('synchronous fetch failure');
		await tick();
	});

	it('does not start I/O for a previously aborted invocation', async () => {
		const f = fixture();
		const controller = new AbortController();
		controller.abort(new Error('cancelled'));
		await expect(f.start({ signal: controller.signal })).rejects.toThrow('cancelled');
		expect(f.fetchImpl).not.toHaveBeenCalled();
	});

	it('does not instantiate after an abort during native compilation', async () => {
		const compiled = deferred<WebAssembly.Module>();
		const nativeModule = await WebAssembly.compile(command);
		vi.spyOn(WebAssembly, 'compile').mockReturnValue(compiled.promise);
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		const controller = new AbortController();
		const f = fixture();
		const run = f.start({ signal: controller.signal });
		const assertion = expect(run).rejects.toThrow('cancelled');
		f.tool.resolve(response(command));
		f.sysroot.resolve(new Response('library'));
		await tick();
		controller.abort(new Error('cancelled'));
		compiled.resolve(nativeModule);
		await assertion;
		expect(instantiate).not.toHaveBeenCalled();
	});

	it('preserves decoded byte limits on the parallel tool branch', async () => {
		const f = fixture();
		const run = f.start({ maxAssetBytes: command.length - 1 });
		const assertion = expect(run).rejects.toThrow(/asset limit/);
		f.tool.resolve(response(command));
		f.sysroot.resolve(new Response('library'));
		await assertion;
	});

	it('preserves engine-enforced memory caps', async () => {
		const f = fixture();
		f.tool.resolve(response(command));
		f.sysroot.resolve(new Response('library'));
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		expect((await f.start({ maxWasmMemoryBytes: 65_536 })).exitCode).toBe(0);
		const instance = (await instantiate.mock.results[0]!.value) as WebAssembly.Instance;
		expect(() => (instance.exports.memory as WebAssembly.Memory).grow(1)).toThrow(RangeError);
	});

	it('preserves gzip tool loading', async () => {
		const f = fixture();
		f.invocation.toolAsset += '.gz';
		f.tool.resolve(response(gzipSync(command)));
		f.sysroot.resolve(new Response('library'));
		expect((await f.start()).exitCode).toBe(0);
	});

	it('does not start I/O for a linker without compile output', async () => {
		const f = fixture();
		f.invocation.tool = 'link';
		f.plan.link = f.invocation;
		await expect(f.start()).rejects.toThrow('missing compile output');
		expect(f.fetchImpl).not.toHaveBeenCalled();
	});

	it('propagates malformed Wasm without running a tool instance', async () => {
		const f = fixture();
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		f.tool.resolve(response(new Uint8Array([1, 2, 3])));
		f.sysroot.resolve(new Response('library'));
		await expect(f.start()).rejects.toThrow(/WebAssembly header/);
		expect(instantiate).not.toHaveBeenCalled();
	});
});
