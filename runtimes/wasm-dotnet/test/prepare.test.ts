import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDotnetCompiler } from '../src/compiler.js';
import * as loader from '../src/runtime-loader.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
let serial = 0;
const options = () => ({ runtimeBaseUrl: `https://prepare.test/${serial++}/` });
function runtime() {
	return {
		compile: vi.fn(async () => ({ success: true, assemblyId: 'test' })),
		run: vi.fn(async () => ({ exitCode: 0 }))
	};
}
beforeEach(() => loader.resetDotnetCompilerRuntimeForTests());
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('real compiler preparation contract', () => {
	it('starts runtime and reference loading together and never compiles or runs code', async () => {
		const rt = runtime();
		const native = deferred<loader.DotnetCompilerRuntime>();
		const manifest = deferred<Response>();
		const load = vi.spyOn(loader, 'loadDotnetCompilerRuntime').mockReturnValue(native.promise);
		const fetchImpl = vi.fn(async (url: URL) =>
			String(url).endsWith('manifest.json')
				? manifest.promise
				: new Response(new Uint8Array([1, 2]))
		);
		vi.stubGlobal('fetch', fetchImpl);
		const compiler = createDotnetCompiler(options());
		let prepared = false;
		const preparing = compiler.prepare({ language: 'csharp' }).then(() => {
			prepared = true;
		});
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ language: 'csharp' }));
		native.resolve(rt);
		await Promise.resolve();
		expect(prepared).toBe(false);
		manifest.resolve(Response.json({ assemblies: ['System.Console.dll'] }));
		await preparing;
		expect(rt.compile).not.toHaveBeenCalled();
		expect(rt.run).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		await compiler.compile({ language: 'csharp', code: 'Console.WriteLine(42);' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(rt.compile).toHaveBeenCalledWith(
			expect.objectContaining({
				references: [{ name: 'System.Console.dll', bytesBase64: 'AQI=' }]
			})
		);
	});
	it.each(['csharp', 'fsharp', 'vbnet'] as const)(
		'prepares the selected %s runtime without fetching references when disabled',
		async (language) => {
			const rt = runtime();
			const load = vi.spyOn(loader, 'loadDotnetCompilerRuntime').mockResolvedValue(rt);
			const fetchImpl = vi.fn();
			vi.stubGlobal('fetch', fetchImpl);
			await createDotnetCompiler({ loadReferences: false }).prepare({ language });
			expect(load).toHaveBeenCalledWith(expect.objectContaining({ language }));
			expect(fetchImpl).not.toHaveBeenCalled();
			expect(rt.compile).not.toHaveBeenCalled();
		}
	);
	it('uses the factory language by default and forwards tracing without disabling factory tracing', async () => {
		const load = vi.spyOn(loader, 'loadDotnetCompilerRuntime').mockResolvedValue(runtime());
		await createDotnetCompiler({
			language: 'csharp',
			loadReferences: false,
			diagnosticTracing: true
		}).prepare();
		expect(load).toHaveBeenLastCalledWith(
			expect.objectContaining({ language: 'csharp', diagnosticTracing: true })
		);
		await createDotnetCompiler({ loadReferences: false }).prepare({
			language: 'vbnet',
			runtimeDiagnosticTracing: true
		});
		expect(load).toHaveBeenLastCalledWith(
			expect.objectContaining({ language: 'vbnet', diagnosticTracing: true })
		);
	});
	it('validates unsupported languages before any loader starts', async () => {
		const load = vi.spyOn(loader, 'loadDotnetCompilerRuntime');
		const fetchImpl = vi.fn();
		vi.stubGlobal('fetch', fetchImpl);
		await expect(
			createDotnetCompiler().prepare({ language: 'python' as never })
		).rejects.toThrow('Unsupported .NET language');
		expect(load).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
	it('retries failed reference loads during a later prepare', async () => {
		vi.spyOn(loader, 'loadDotnetCompilerRuntime').mockResolvedValue(runtime());
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockImplementation(async () => Response.json({ assemblies: [] }));
		vi.stubGlobal('fetch', fetchImpl);
		const compiler = createDotnetCompiler(options());
		await expect(compiler.prepare({ language: 'csharp' })).rejects.toThrow('503');
		await compiler.prepare({ language: 'csharp' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
	it('observes both rejected startup branches without compiling', async () => {
		vi.spyOn(loader, 'loadDotnetCompilerRuntime').mockImplementation(() => {
			throw new Error('runtime failed');
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('references failed');
			})
		);
		await expect(createDotnetCompiler(options()).prepare()).rejects.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	it('reuses the actual loader cache across prepare and compile, and reloads after fatal exit', async () => {
		let exit!: (code: number) => void;
		const bridge = {
			Compile: vi.fn(() => JSON.stringify({ success: true, assemblyId: 'ok' })),
			Run: vi.fn(() => JSON.stringify({ exitCode: 0 }))
		};
		const create = vi.fn(async () => ({
			getAssemblyExports: async () => ({ CompilerHost: bridge })
		}));
		const dotnetModule = {
			dotnet: {
				withModuleConfig(config: { onExit: (code: number) => void }) {
					exit = config.onExit;
					return this;
				},
				create
			}
		};
		const compiler = createDotnetCompiler({ ...options(), dotnetModule });
		await Promise.all([
			compiler.prepare({ language: 'csharp' }),
			compiler.prepare({ language: 'csharp' })
		]);
		expect(create).toHaveBeenCalledTimes(1);
		expect(bridge.Compile).not.toHaveBeenCalled();
		await compiler.compile({ language: 'csharp', code: 'Console.WriteLine(42);' });
		expect(create).toHaveBeenCalledTimes(1);
		expect(bridge.Compile).toHaveBeenCalledTimes(1);
		exit(1);
		await compiler.prepare({ language: 'csharp' });
		expect(create).toHaveBeenCalledTimes(2);
		expect(bridge.Run).not.toHaveBeenCalled();
	});
});
