import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	atomVmInitMock,
	lastInitOptions,
	lastModule,
	verifyRuntimeAssetIntegrityMock,
	waitForBufferedStdinMock
} = vi.hoisted(() => ({
	atomVmInitMock: vi.fn(),
	lastInitOptions: {
		current: null as any
	},
	lastModule: {
		current: null as any
	},
	verifyRuntimeAssetIntegrityMock: vi.fn(),
	waitForBufferedStdinMock: vi.fn()
}));

const TEST_ASSET_RECEIPTS = Object.freeze({
	'bundle.avm': Object.freeze({
		bytes: 3,
		sha256: '1'.repeat(64),
		uncompressedBytes: 128 * 1024 * 1024,
		uncompressedSha256: '2'.repeat(64)
	}),
	'AtomVM.mjs': Object.freeze({
		bytes: 3,
		sha256: '3'.repeat(64),
		uncompressedBytes: 3,
		uncompressedSha256: '4'.repeat(64)
	}),
	'AtomVM.wasm': Object.freeze({
		bytes: 3,
		sha256: '5'.repeat(64),
		uncompressedBytes: 3,
		uncompressedSha256: '6'.repeat(64)
	})
});

vi.mock('$lib/playground/stdinBuffer', () => ({
	waitForBufferedStdin: waitForBufferedStdinMock
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRuntimeAssetIntegrity: verifyRuntimeAssetIntegrityMock
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
		(globalThis as any).fetch = vi.fn(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					statusText: 'OK',
					headers: { 'content-length': '3' }
				})
		);
		lastInitOptions.current = null;
		lastModule.current = null;
		atomVmInitMock.mockReset();
		verifyRuntimeAssetIntegrityMock.mockReset();
		verifyRuntimeAssetIntegrityMock.mockResolvedValue(undefined);
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

	it('preserves a custom bundle filename and query while loading sibling AtomVM assets', async () => {
		const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
		const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
		const bundleUrl = new URL(
			'/runtime/elixir/runtime-abc.avm?v=receipt-1',
			globalThis.location.href
		).href;
		(globalThis as any).fetch.mockResolvedValueOnce(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2]));
						controller.enqueue(new Uint8Array([3]));
						controller.close();
					}
				}),
				{
					status: 200,
					statusText: 'OK',
					headers: { 'content-length': '3' }
				}
			)
		);
		const buffer = new SharedArrayBuffer(1024);
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/runtime-abc.avm?v=receipt-1',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).fetch).toHaveBeenCalledWith(bundleUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect((globalThis as any).fetch).toHaveBeenCalledTimes(3);
		expect((globalThis as any).fetch).toHaveBeenNthCalledWith(
			2,
			new URL('/runtime/elixir/AtomVM.mjs?v=receipt-1', globalThis.location.href).href,
			expect.any(Object)
		);
		expect((globalThis as any).fetch).toHaveBeenNthCalledWith(
			3,
			new URL('/runtime/elixir/AtomVM.wasm?v=receipt-1', globalThis.location.href).href,
			expect.any(Object)
		);
		expect(verifyRuntimeAssetIntegrityMock).toHaveBeenCalledTimes(3);
		expect(verifyRuntimeAssetIntegrityMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				asset: 'bundle.avm',
				expected: TEST_ASSET_RECEIPTS['bundle.avm'],
				stage: 'uncompressed',
				runtimeId: 'ELIXIR'
			})
		);
		expect(atomVmInitMock).toHaveBeenCalledTimes(1);
		expect(lastInitOptions.current.mainScriptUrlOrBlob).toBeInstanceOf(Blob);
		expect(
			new Uint8Array(await lastInitOptions.current.mainScriptUrlOrBlob.arrayBuffer())
		).toEqual(new Uint8Array([1, 2, 3]));
		expect(lastInitOptions.current.wasmBinary).toEqual(new Uint8Array([1, 2, 3]));
		expect(lastInitOptions.current.locateFile('AtomVM.wasm')).toBe(
			new URL('/runtime/elixir/AtomVM.wasm?v=receipt-1', globalThis.location.href).href
		);
		expect(lastModule.current.FS.mkdir).toHaveBeenCalledWith('/data');
		expect(lastModule.current.FS.writeFile).toHaveBeenCalledWith(
			'/data/bundle.avm',
			new Int8Array([1, 2, 3])
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

	it.each([
		['data:application/octet-stream;base64,AQID', 'must use HTTP(S)'],
		['https://user:secret@example.com/bundle.avm', 'must not include credentials'],
		['https://example.com/bundle.avm#fragment', 'must not include a fragment']
	])('rejects an unsafe AtomVM bundle URL: %s', async (bundleUrl, expectedError) => {
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl,
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect((globalThis as any).fetch).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: expect.stringContaining(expectedError)
		});
	});

	it('rejects a missing bundle URL before fetching', async () => {
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect((globalThis as any).fetch).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
		});
	});

	it('rejects a runtime load without the complete receipt set before fetching', async () => {
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				log: false
			}
		});

		expect((globalThis as any).fetch).not.toHaveBeenCalled();
		expect(atomVmInitMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'Elixir runtime requires exactly three asset receipts'
		});
	});

	it('does not initialize AtomVM from unverified assets and permits a clean retry', async () => {
		verifyRuntimeAssetIntegrityMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('AtomVM module integrity mismatch'));
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect((globalThis as any).fetch).toHaveBeenCalledTimes(2);
		expect(atomVmInitMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'AtomVM module integrity mismatch'
		});

		(globalThis as any).fetch.mockClear();
		(globalThis as any).postMessage.mockClear();
		verifyRuntimeAssetIntegrityMock.mockReset();
		verifyRuntimeAssetIntegrityMock.mockResolvedValue(undefined);
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect((globalThis as any).fetch).toHaveBeenCalledTimes(3);
		expect(atomVmInitMock).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({ load: true });
	});

	it('rejects a substituted final bundle URL and cancels its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		const bundleUrl = new URL('/runtime/elixir/bundle.avm', globalThis.location.href).href;
		(globalThis as any).fetch.mockResolvedValueOnce({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: 'https://cdn.example.com/substituted.avm'
		});
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect(bodyCancel).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: `Elixir runtime asset bundle.avm response URL mismatch: expected ${bundleUrl}, received https://cdn.example.com/substituted.avm`
		});
	});

	it('cancels an unsuccessful bundle response before reporting it', async () => {
		const bodyCancel = vi.fn(() => new Promise<void>(() => undefined));
		const bundleUrl = new URL('/runtime/elixir/bundle.avm', globalThis.location.href).href;
		(globalThis as any).fetch.mockResolvedValueOnce({
			body: { cancel: bodyCancel },
			headers: new Headers(),
			ok: false,
			status: 503,
			statusText: 'Unavailable',
			url: ''
		});
		await import('./elixir');
		const handled = (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});
		await expect(
			Promise.race([
				handled.then(() => 'handled'),
				new Promise<string>((resolve) => {
					setTimeout(() => resolve('timed out'), 100);
				})
			])
		).resolves.toBe('handled');

		expect(bodyCancel).toHaveBeenCalledOnce();
		expect(bodyCancel).toHaveBeenCalledWith(
			expect.objectContaining({
				message: `failed to load Elixir runtime asset bundle.avm from ${bundleUrl}: 503`
			})
		);
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: `failed to load Elixir runtime asset bundle.avm from ${bundleUrl}: 503`
		});
	});

	it('rejects an oversized declared bundle before reading and cancels its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		(globalThis as any).fetch.mockResolvedValueOnce({
			body: { cancel: bodyCancel },
			headers: new Headers({ 'content-length': String(128 * 1024 * 1024 + 1) }),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: ''
		});
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect(bodyCancel).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'Elixir runtime asset bundle.avm exceeds the 134217728 byte limit'
		});
	});

	it('cancels an unknown-length stream when it crosses the bundle byte limit', async () => {
		const readerCancel = vi.fn(() => new Promise<void>(() => undefined));
		const releaseLock = vi.fn();
		const read = vi.fn().mockResolvedValueOnce({
			done: false,
			value: { byteLength: 128 * 1024 * 1024 + 1 }
		});
		(globalThis as any).fetch.mockResolvedValueOnce({
			body: {
				getReader: () => ({ cancel: readerCancel, read, releaseLock })
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: ''
		});
		await import('./elixir');
		const handled = (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});
		await expect(
			Promise.race([
				handled.then(() => 'handled'),
				new Promise<string>((resolve) => {
					setTimeout(() => resolve('timed out'), 100);
				})
			])
		).resolves.toBe('handled');

		expect(readerCancel).toHaveBeenCalledOnce();
		expect(readerCancel).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Elixir runtime asset bundle.avm exceeds the 134217728 byte limit'
			})
		);
		expect(releaseLock).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'Elixir runtime asset bundle.avm exceeds the 134217728 byte limit'
		});
	});

	it('cancels and releases a bundle reader when streaming fails', async () => {
		const readerCancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('bundle stream failed'));
		(globalThis as any).fetch.mockResolvedValueOnce({
			body: {
				getReader: () => ({ cancel: readerCancel, read, releaseLock })
			},
			headers: new Headers(),
			ok: true,
			status: 200,
			statusText: 'OK',
			url: ''
		});
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: false
			}
		});

		expect(readerCancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: 'bundle stream failed'
		});
	});

	it('requests additional stdin chunks for repeated IO.gets calls', async () => {
		const buffer = new SharedArrayBuffer(1024);
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
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

	it.each([
		{
			name: 'non-empty Elixir',
			language: 'ELIXIR',
			stdin: '5\n',
			code: 'IO.inspect({IO.gets(""), IO.gets("")})',
			action: 'eval_elixir',
			inputLiteral: '"5\\n"',
			eofPattern: /\bnil\b/g,
			eofCount: 1
		},
		{
			name: 'empty Elixir',
			language: 'ELIXIR',
			stdin: '',
			code: 'IO.inspect({IO.gets(""), IO.gets("")})',
			action: 'eval_elixir',
			inputLiteral: null,
			eofPattern: /\bnil\b/g,
			eofCount: 2
		},
		{
			name: 'non-empty Erlang',
			language: 'ERLANG',
			stdin: '73\n',
			code: 'io:format("~p", [{io:get_line(""), io:get_line("")}]).',
			action: 'eval_erlang',
			inputLiteral: '"73\\n"',
			eofPattern: /\beof\b/g,
			eofCount: 1
		},
		{
			name: 'empty Erlang',
			language: 'ERLANG',
			stdin: '',
			code: 'io:format("~p", [{io:get_line(""), io:get_line("")}]).',
			action: 'eval_erlang',
			inputLiteral: null,
			eofPattern: /\beof\b/g,
			eofCount: 2
		}
	])('treats $name explicit stdin as authoritative through EOF', async (testCase) => {
		const buffer = new SharedArrayBuffer(1024);
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: true
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: testCase.code,
				language: testCase.language,
				prepare: false,
				buffer,
				stdin: testCase.stdin,
				log: true
			}
		});
		await Promise.resolve();

		expect(waitForBufferedStdinMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ buffer: true });
		const [, payload] = lastModule.current.rawCall.mock.calls.at(-1);
		const [action, rewrittenSource] = JSON.parse(payload);
		expect(action).toBe(testCase.action);
		if (testCase.inputLiteral) {
			expect(rewrittenSource).toContain(testCase.inputLiteral);
		}
		expect(rewrittenSource.match(testCase.eofPattern) ?? []).toHaveLength(testCase.eofCount);
	});

	it('evaluates Erlang expressions and bridges io:get_line stdin calls', async () => {
		const buffer = new SharedArrayBuffer(1024);
		await import('./elixir');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
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
				assetReceipts: TEST_ASSET_RECEIPTS,
				log: true
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				bundleUrl: '/runtime/elixir/bundle.avm',
				assetReceipts: TEST_ASSET_RECEIPTS,
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
				assetReceipts: TEST_ASSET_RECEIPTS,
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
				assetReceipts: TEST_ASSET_RECEIPTS,
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
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				progress: expect.objectContaining({
					kind: 'ready',
					state: 'running',
					reason: 'started'
				})
			})
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
				assetReceipts: TEST_ASSET_RECEIPTS,
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
				assetReceipts: TEST_ASSET_RECEIPTS,
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
				assetReceipts: TEST_ASSET_RECEIPTS,
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
