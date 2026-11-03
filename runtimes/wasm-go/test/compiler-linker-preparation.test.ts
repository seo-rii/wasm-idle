import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileGo } from '../src/compiler.js';
import { clearGoToolModuleCache } from '../src/tool-module.js';
import type { BrowserGoToolInvocation, BrowserGoToolResult } from '../src/types.js';
import { createCompileRequest, createRuntimeManifest } from './helpers.js';

const runtime = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../src/tool-runtime.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/tool-runtime.js')>()),
	// Keep the real bounded download, memory cap and Wasm compilation. Only guest
	// execution is controlled so its duration and diagnostic outcome are deterministic.
	executeGoToolInvocation: runtime.execute
}));

const linkerBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const compileOutput = { exitCode: 0, outputs: { '/workspace/pkg/main.a': new Uint8Array([7]) } };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function pendingDownload() {
	let signal: AbortSignal | undefined;
	const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
		signal = init?.signal ?? undefined;
		return new Promise<Response>((_resolve, reject) => {
			signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
		});
	});
	return { fetchImpl, signal: () => signal };
}

function compilerOptions(fetchImpl: typeof fetch) {
	return {
		manifest: createRuntimeManifest(),
		runtimeBaseUrl: 'https://runtime.test/go/',
		dependencies: { fetchImpl }
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	clearGoToolModuleCache();
	runtime.execute.mockReset();
	runtime.execute.mockImplementation(async (invocation: BrowserGoToolInvocation) => ({
		exitCode: 0,
		outputs: {
			[invocation.outputPath]:
				invocation.tool === 'compile' ? new Uint8Array([7]) : linkerBytes
		}
	}));
});

describe('Go linker preparation', () => {
	it('downloads and compiles the linker during compilation and reuses its module for linking', async () => {
		const compilation = deferred<BrowserGoToolResult>();
		runtime.execute.mockImplementationOnce(() => compilation.promise);
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(linkerBytes));
		const nativeCompile = vi.spyOn(WebAssembly, 'compile');
		const onProgress = vi.fn();
		const result = compileGo(createCompileRequest({ onProgress }), compilerOptions(fetchImpl));
		await vi.waitFor(() => expect(nativeCompile).toHaveBeenCalledOnce());
		expect(runtime.execute).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			'https://runtime.test/go/tools/link.wasm.gz'
		);
		expect(onProgress.mock.calls.some(([event]) => event.stage === 'link')).toBe(false);
		compilation.resolve(compileOutput);
		expect((await result).success).toBe(true);
		expect(runtime.execute).toHaveBeenCalledTimes(2);
		const link = runtime.execute.mock.calls[1];
		expect(link[0].tool).toBe('link');
		expect(link[0].inputFiles).toContainEqual({
			path: '/workspace/pkg/main.a',
			contents: new Uint8Array([7])
		});
		expect(link[6]).toBeInstanceOf(WebAssembly.Module);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(nativeCompile).toHaveBeenCalledOnce();
	});

	it('cancels speculative I/O when compilation returns diagnostics', async () => {
		const compilation = deferred<BrowserGoToolResult>();
		runtime.execute.mockImplementationOnce(() => compilation.promise);
		const download = pendingDownload();
		const result = compileGo(createCompileRequest(), compilerOptions(download.fetchImpl));
		await vi.waitFor(() => expect(download.fetchImpl).toHaveBeenCalledOnce());
		compilation.resolve({ exitCode: 1, stderr: 'main.go:3:2: undefined: missing' });
		const failed = await result;
		expect(failed.success).toBe(false);
		expect(failed.stderr).toContain('undefined: missing');
		expect(download.signal()?.aborted).toBe(true);
		expect(runtime.execute).toHaveBeenCalledOnce();
	});

	it('cancels both phases when the caller aborts during compilation', async () => {
		const compilation = deferred<BrowserGoToolResult>();
		runtime.execute.mockImplementationOnce(() => compilation.promise);
		const download = pendingDownload();
		const controller = new AbortController();
		const result = compileGo(
			createCompileRequest({ signal: controller.signal }),
			compilerOptions(download.fetchImpl)
		);
		const failure = new Error('user cancelled');
		const rejected = expect(result).rejects.toBe(failure);
		await vi.waitFor(() => expect(download.fetchImpl).toHaveBeenCalledOnce());
		controller.abort(failure);
		await rejected;
		expect(download.signal()?.aborted).toBe(true);
		expect(runtime.execute.mock.calls[0][5].signal.aborted).toBe(true);
		compilation.resolve(compileOutput);
	});

	it.each(['compile', 'link'] as const)(
		'cancels preparation after the %s deadline',
		async (phase) => {
			const compilation = deferred<BrowserGoToolResult>();
			if (phase === 'compile')
				runtime.execute.mockImplementationOnce(() => compilation.promise);
			const download = pendingDownload();
			const result = await compileGo(createCompileRequest(), {
				...compilerOptions(download.fetchImpl),
				[`${phase}TimeoutMs`]: 25
			});
			expect(result.success).toBe(false);
			expect(result.stderr).toContain(`Go ${phase} tool timed out`);
			expect(download.signal()?.aborted).toBe(true);
			expect(runtime.execute).toHaveBeenCalledOnce();
			compilation.resolve(compileOutput);
		}
	);

	it('keeps compile diagnostics when linker preparation has already failed', async () => {
		const compilation = deferred<BrowserGoToolResult>();
		runtime.execute.mockImplementationOnce(() => compilation.promise);
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
		const result = compileGo(createCompileRequest(), compilerOptions(fetchImpl));
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
		compilation.resolve({ exitCode: 1, stderr: 'main.go:3:2: undefined: missing' });
		expect((await result).stderr).toContain('undefined: missing');
		expect(runtime.execute).toHaveBeenCalledOnce();
	});

	it('reports failed preparation at link time and retries on the next compile', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(linkerBytes));
		fetchImpl.mockResolvedValueOnce(new Response(null, { status: 404 }));
		const options = compilerOptions(fetchImpl);
		const failed = await compileGo(createCompileRequest(), options);
		expect(failed.success).toBe(false);
		expect(failed.stderr).toContain('failed to fetch link.wasm');
		expect(runtime.execute).toHaveBeenCalledOnce();
		expect((await compileGo(createCompileRequest(), options)).success).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(runtime.execute.mock.calls.at(-1)?.[6]).toBeInstanceOf(WebAssembly.Module);
	});

	it('preserves the asset byte limit during preparation', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(linkerBytes));
		const nativeCompile = vi.spyOn(WebAssembly, 'compile');
		const result = await compileGo(createCompileRequest(), {
			...compilerOptions(fetchImpl),
			maxAssetBytes: 4
		});
		expect(result.success).toBe(false);
		expect(result.stderr).toContain('hard asset limit 4 bytes');
		expect(nativeCompile).not.toHaveBeenCalled();
		expect(runtime.execute).toHaveBeenCalledOnce();
	});

	it('does not prepare unused tools for library builds or injected runners', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			throw new Error('unexpected network');
		});
		const options = compilerOptions(fetchImpl);
		expect(
			(await compileGo(createCompileRequest({ packageKind: 'library' }), options)).success
		).toBe(true);
		expect(
			(
				await compileGo(createCompileRequest(), {
					...options,
					dependencies: { ...options.dependencies, runTool: runtime.execute }
				})
			).success
		).toBe(true);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
