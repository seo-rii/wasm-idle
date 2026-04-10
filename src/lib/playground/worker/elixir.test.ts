import { beforeEach, describe, expect, it, vi } from 'vitest';

const { atomVmInitMock, lastInitOptions, lastModule } = vi.hoisted(() => ({
	atomVmInitMock: vi.fn(),
	lastInitOptions: {
		current: null as any
	},
	lastModule: {
		current: null as any
	}
}));

vi.mock('../../../../node_modules/@swmansion/popcorn/dist/AtomVM.wasm?url', () => ({
	default: '/__mocks__/AtomVM.wasm'
}));

vi.mock('../../../../node_modules/@swmansion/popcorn/dist/AtomVM.mjs', () => ({
	default: atomVmInitMock
}));

describe('Elixir worker', () => {
	beforeEach(() => {
		vi.resetModules();
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
		atomVmInitMock.mockImplementation(async (options) => {
			lastInitOptions.current = options;
			let trackedObjectKey = 0;
			const rawCall = vi.fn(async (_process, payload) => {
				options.print?.('factorial_plus_bonus=27\n');
				expect(payload).toBe(JSON.stringify(['eval_elixir', 'IO.puts("hello")']));
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
			setTimeout(() => module.onElixirReady?.('popcorn_eval'), 0);
			return module;
		});
	});

	it('loads AtomVM with the Popcorn wasm asset and evaluates Elixir code inside the worker', async () => {
		const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
		const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
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
				log: true
			}
		});
		await Promise.resolve();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });

		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.puts("hello")',
				prepare: false,
				log: true
			}
		});
		await Promise.resolve();

		expect(lastModule.current.rawCall).toHaveBeenCalledWith(
			'popcorn_eval',
			JSON.stringify(['eval_elixir', 'IO.puts("hello")'])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: ':ok' });
	});
});
