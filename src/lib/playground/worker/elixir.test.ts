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
		(globalThis as any).__wasmIdleAtomVmInit = atomVmInitMock;
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
				if (action === 'eval_erlang_module') {
					return JSON.stringify('main');
				}
				if (action === 'eval_erlang') {
					if (source === 'main:main().') {
						options.print?.('module=ok\n');
						return JSON.stringify('ok');
					}
					options.print?.('erlang=73\n');
					return JSON.stringify('ok');
				}
				expect(action).toBe('eval_elixir');
				if (source === 'IO.puts("hello")') {
					options.print?.('factorial_plus_bonus=27\n');
					return JSON.stringify(':ok');
				}
				if (
					source ===
					'IO.puts(String.trim(((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); "5\\n" end).(""))))'
				) {
					options.print?.('stdin=5\n');
					return JSON.stringify(':ok');
				}
				options.print?.(`rewritten=${source}\n`);
				return JSON.stringify(source);
			});
			const module: {
				FS: {
					mkdir: ReturnType<typeof vi.fn>;
					writeFile: ReturnType<typeof vi.fn>;
				};
				cast: ReturnType<typeof vi.fn>;
				call: typeof rawCall;
				trackedObjectsMap: Map<unknown, unknown>;
				nextTrackedObjectKey: ReturnType<typeof vi.fn>;
				rawCall: typeof rawCall;
				onRunTrackedJs?: (scriptString: string, isDebug: boolean) => number[] | null;
			} = {
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
		expect(lastInitOptions.current.locateFile('AtomVM.wasm')).toBe(
			'http://localhost/runtime/elixir/AtomVM.wasm'
		);
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

	it('requests additional stdin chunks for repeated IO.gets calls', async () => {
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

		waitForBufferedStdinMock.mockReturnValueOnce('5\n').mockReturnValueOnce('7\n');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.puts(String.trim(IO.gets("")) <> ":" <> String.trim(IO.gets("")))',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledTimes(2);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify([
				'eval_elixir',
				'IO.puts(String.trim(((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); "5\\n" end).(""))) <> ":" <> String.trim(((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); "7\\n" end).(""))))'
			])
		);
	});

	it('evaluates Erlang expressions and bridges io:get_line stdin calls', async () => {
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

		waitForBufferedStdinMock.mockReturnValueOnce('73\n');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'Line = io:get_line(""), io:format("main=~s", [Line]).',
				language: 'ERLANG',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledTimes(1);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify([
				'eval_erlang',
				'Line = ((fun(WasmIdlePrompt) -> io:format("~s", [WasmIdlePrompt]), "73\\n" end)("")), io:format("main=~s", [Line]).'
			])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'erlang=73\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: 'ok' });
	});

	it('uses AtomVM eval actions for Elixir and Erlang diagnostics without executing user code', async () => {
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				log: true
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				bundleUrl: '/runtime/elixir/bundle.avm',
				code: 'IO.puts("hello")',
				diagnose: true,
				language: 'ELIXIR',
				log: false
			}
		});
		await Promise.resolve();

		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify(['eval_elixir', 'Code.string_to_quoted!("IO.puts(\\"hello\\")")'])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });

		await (globalThis as any).self.onmessage({
			data: {
				bundleUrl: '/runtime/elixir/bundle.avm',
				code: 'main() -> ok.',
				diagnose: true,
				language: 'ERLANG',
				log: false
			}
		});
		await Promise.resolve();

		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify([
				'eval_erlang',
				'{ok, WasmIdleTokens, _} = erl_scan:string("main() -> ok."), erl_parse:parse_exprs(WasmIdleTokens).'
			])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('compiles Erlang modules and invokes main/0 after loading the module', async () => {
		const buffer = new SharedArrayBuffer(1024);
		const source = `-module(main).
-export([main/0]).

main() ->
    io:format("module=ok~n").`;
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				log: true
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: source,
				language: 'ERLANG',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(lastModule.current.rawCall).toHaveBeenCalledWith(
			'main',
			JSON.stringify(['eval_erlang_module', source])
		);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify(['eval_erlang', 'main:main().'])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'module=ok\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: 'ok' });
	});

	it('bridges IO.read and IO.binread variants across chunk boundaries until EOF', async () => {
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

		waitForBufferedStdinMock
			.mockReturnValueOnce('abc\nre')
			.mockReturnValueOnce('stxyz')
			.mockReturnValueOnce(null);
		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.inspect({IO.read(:line), IO.read(3), IO.binread(:all)})',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledTimes(3);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify(['eval_elixir', 'IO.inspect({"abc\\n", "res", "txyz"})'])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'rewritten=IO.inspect({"abc\\n", "res", "txyz"})\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			results: 'IO.inspect({"abc\\n", "res", "txyz"})'
		});
	});

	it('bridges IO.getn and :io input helpers with prompt output preserved', async () => {
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

		waitForBufferedStdinMock
			.mockReturnValueOnce('ab')
			.mockReturnValueOnce('cde')
			.mockReturnValueOnce('rest\n');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.inspect({IO.getn("> ", 2), :io.get_chars(:stdio, "chars> ", 3), :io.get_line("line> ")})',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledTimes(3);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify([
				'eval_elixir',
				'IO.inspect({((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); "ab" end).("> ")), ((fn wasm_idle_device, wasm_idle_prompt -> _ = wasm_idle_device; IO.write(wasm_idle_prompt); "cde" end).(:stdio, "chars> ")), ((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); "rest\\n" end).("line> "))})'
			])
		);
	});

	it('keeps EOF semantics distinct between IO.gets and IO.read-style helpers', async () => {
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

		waitForBufferedStdinMock.mockReturnValueOnce(null);
		await (globalThis as any).self.onmessage({
			data: {
				code: 'IO.inspect({IO.gets(""), IO.read(:line), :io.get_line("")})',
				prepare: false,
				buffer,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).toHaveBeenCalledTimes(1);
		expect(lastModule.current.rawCall).toHaveBeenLastCalledWith(
			'main',
			JSON.stringify([
				'eval_elixir',
				'IO.inspect({((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); nil end).("")), :eof, ((fn wasm_idle_prompt -> IO.write(wasm_idle_prompt); :eof end).(""))})'
			])
		);
	});
});
