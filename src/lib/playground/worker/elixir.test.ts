import { beforeEach, describe, expect, it, vi } from 'vitest';

const { atomVmInitMock, lastInitOptions, lastModule, waitForBufferedStdinMock } = vi.hoisted(
	() => ({
		atomVmInitMock: vi.fn(),
		lastInitOptions: {
			current: null as any
		},
		lastModule: {
			current: null as any
		},
		waitForBufferedStdinMock: vi.fn()
	})
);

vi.mock('../../../../node_modules/@swmansion/popcorn/dist/AtomVM.wasm?url', () => ({
	default: '/__mocks__/AtomVM.wasm'
}));

vi.mock('../../../../node_modules/@swmansion/popcorn/dist/AtomVM.mjs', () => ({
	default: atomVmInitMock
}));

vi.mock('$lib/playground/stdinBuffer', () => ({
	waitForBufferedStdin: waitForBufferedStdinMock
}));

describe('Elixir worker', () => {
	beforeEach(() => {
		vi.resetModules();
		const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
		const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).window = undefined;
		(globalThis as any).parent = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
		}));
		lastInitOptions.current = null;
		lastModule.current = null;
		atomVmInitMock.mockReset();
		waitForBufferedStdinMock.mockReset();
		atomVmInitMock.mockImplementation(async (options) => {
			lastInitOptions.current = options;
			let trackedObjectKey = 0;
			const rawCall = vi.fn(async (_process, payload) => {
				const [action, source] = JSON.parse(payload);
				expect(action).toBe('eval_elixir');
				if (source === 'IO.puts("hello")') {
					options.print?.('factorial_plus_bonus=27\n');
					return JSON.stringify(':ok');
				}
				expect(source).toBe('IO.puts(String.trim("5\\n"))');
				options.print?.('stdin=5\n');
				return JSON.stringify(':ok');
			});
			const module = {
				FS: {
					mkdir: vi.fn(),
					writeFile: vi.fn()
				},
				cast: vi.fn(),
				call: rawCall,
				trackedObjectsMap: new Map(),
				nextTrackedObjectKey: vi.fn(() => ++trackedObjectKey),
				rawCall
			};
			lastModule.current = module;
			options.preRun?.[0]?.(module);
			setTimeout(() => {
				for (const event of [
					{
						name: 'popcorn_app_ready',
						payload: {
							name: 'main'
						}
					},
					{
						name: 'popcorn_elixir_ready',
						payload: null
					}
				]) {
					module.onRunTrackedJs?.(
						`(Module) => {
						const window = ${popcornParentGlobal};
						const document = ${popcornParentGlobal}.document;
						return (({ wasm, args }) => {
							wasm.sendEvent(args.eventName, args.payload);
						})({
							wasm: Module,
							args: Module.deserialize(JSON.stringify(${JSON.stringify({
								eventName: event.name,
								payload: event.payload
							})})),
							window,
							document
						});
					}`,
						false
					);
				}
			}, 0);
			return module;
		});
	});

	it('loads AtomVM with the Popcorn wasm asset and evaluates Elixir code inside the worker', async () => {
		const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
		const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
		const buffer = new SharedArrayBuffer(1024);
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).fetch).toHaveBeenCalledWith('/runtime/elixir/bundle.avm');
		expect(atomVmInitMock).toHaveBeenCalledTimes(1);
		expect(lastInitOptions.current.locateFile('AtomVM.wasm')).toBe('/__mocks__/AtomVM.wasm');
		expect(lastModule.current.FS.mkdir).toHaveBeenCalledWith('/data');
		expect(lastModule.current.FS.writeFile).toHaveBeenCalledWith(
			'/data/bundle.avm',
			expect.any(Int8Array)
		);
		expect(lastModule.current.sendEvent).toEqual(expect.any(Function));
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect(
			lastModule.current.onRunTrackedJs(
				`() => {
					const browserGlobal = ${popcornBrowserGlobal};
					const parentGlobal = ${popcornParentGlobal};
					const document = ${popcornParentGlobal}.document;
					return [browserGlobal, parentGlobal, document];
				}`,
				false
			)
		).toEqual([1, 2, 3]);
		expect((globalThis as any).window).toBeUndefined();
		expect((globalThis as any).parent).toBeUndefined();
		expect(lastModule.current.trackedObjectsMap.get(1)).toBe(
			(globalThis as any).__wasmIdleElixirWorkerHost
		);
		expect(lastModule.current.trackedObjectsMap.get(2)).toBe(
			(globalThis as any).__wasmIdleElixirWorkerHost
		);
		expect(lastModule.current.trackedObjectsMap.get(3)).toBe(
			(globalThis as any).__wasmIdleElixirWorkerHost.document
		);

		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.puts("hello")',
				prepare: true,
				buffer,
				log: true
			}
		});
		await Promise.resolve();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });

		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.puts("hello")',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(lastModule.current.rawCall).toHaveBeenCalledWith(
			'main',
			JSON.stringify(['eval_elixir', 'IO.puts("hello")'])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: ':ok' });

		waitForBufferedStdinMock.mockReturnValueOnce('5\n');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.puts(String.trim(IO.gets("")))',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledWith(
			expect.any(Int32Array),
			expect.any(Function)
		);
		expect(waitForBufferedStdinMock.mock.calls[0][0].buffer).toBe(buffer);
		waitForBufferedStdinMock.mock.calls[0][1]();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'stdin=5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: ':ok' });
	});
});
