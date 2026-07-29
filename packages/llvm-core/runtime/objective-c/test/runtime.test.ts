import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MAX_RUNTIME_JSON_BYTES } from '../../core/src/wasm.js';

const validEmptyWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let runCalls: string[][] = [];
let compileCalls: any[] = [];
let debugRunCalls: any[] = [];
let executedArtifacts: any[] = [];
let runtimeInstances: any[] = [];

class MockMemfs {
	files = new Map<string, Uint8Array | string>();
	directories = new Set<string>();

	addDirectory(path: string) {
		this.directories.add(path);
	}

	addFile(path: string, contents: Uint8Array | string) {
		this.files.set(path, contents);
	}

	getFileContents(path: string) {
		return this.files.get(path) ?? new Uint8Array();
	}
}

function bytes(value: string) {
	return new TextEncoder().encode(value);
}

function responseBytesForObjectiveCAsset(url: string) {
	if (url.endsWith('foundation-headers.json')) {
		return bytes(
			JSON.stringify({
				'Foundation/Foundation.h': '@interface NSObject @end',
				'sys/socket.h': 'struct sockaddr;',
				'stdio.h': 'int mock_scanf(const char *format, ...);'
			})
		);
	}
	if (url.endsWith('headers.json')) {
		return bytes(JSON.stringify({ 'include/objc/runtime.h': 'typedef void *id;' }));
	}
	if (url.endsWith('libgnustep-base.a')) return bytes('mock-libgnustep');
	if (url.endsWith('libgnustep-base.o')) return bytes('mock-libgnustep-object');
	if (url.endsWith('libffi.a')) return bytes('mock-libffi');
	return bytes('mock-libobjc');
}

function objectiveCLoadEvent() {
	return {
		data: {
			load: true,
			log: false,
			clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
			objectivecAssets: {
				libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
				headersUrl: 'http://localhost/wasm-objectivec/headers.json',
				libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
				libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
				foundationHeadersUrl: 'http://localhost/wasm-objectivec/foundation-headers.json',
				libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
			}
		}
	};
}

vi.mock('../../clang/src/index.js', () => {
	class MockBrowserClangRuntime {
		assetUrls = {
			clang: 'mock-clang.wasm',
			lld: 'mock-lld.wasm'
		};
		compilerConfig = {
			resourceDir: '/lib/clang/22',
			compilerRuntimeLibDir: 'lib/clang/22/lib/wasi'
		};
		log = false;
		debug = false;
		debugBreakpoints = new Set<number>();
		debugPauseOnEntry = false;
		debugBuffer?: Int32Array;
		debugWatchBuffer?: Int32Array;
		debugWatchResultBuffer?: Int32Array;
		debugInterruptBuffer?: Uint8Array;
		debugVariableMetadata = { 1: [] };
		debugGlobalMetadata: any[] = [];
		debugFunctionMetadata = { 1: 'main' };
		memfs = new MockMemfs();
		ready = Promise.resolve();
		stdout: (chunk: string) => void;
		onDebugEvent?: (event: any) => void;

		constructor(options: {
			log?: boolean;
			stdout?: (chunk: string) => void;
			onDebugEvent?: (event: any) => void;
		}) {
			this.log = !!options.log;
			this.stdout = options.stdout || (() => {});
			this.onDebugEvent = options.onDebugEvent;
			runtimeInstances.push(this);
		}

		beginTrace(debug: boolean) {
			this.debug = debug;
		}

		async compile(options: any) {
			compileCalls.push(options);
			this.memfs.addFile(
				options.input,
				options.transformSource ? options.transformSource(options.code) : options.code
			);
			this.memfs.addFile(options.obj, bytes('obj'));
		}

		async getModule(url: string) {
			return { url };
		}

		async run(_module: unknown, _log: boolean, argv0: string, ...args: string[]) {
			runCalls.push([argv0, ...args]);
			if (argv0 === 'clang') this.stdout('mock clang compile log\n');
			const inputPath = args.find((arg) => /^__wasm_idle_objc_\d+\/.*\.[cm]$/.test(arg));
			if (inputPath?.endsWith('broken.m')) throw new Error('mock clang failure');
			const outputIndex = args.lastIndexOf('-o');
			if (outputIndex === -1) return;
			const outputPath = args[outputIndex + 1];
			this.memfs.addFile(outputPath, argv0 === 'wasm-ld' ? validEmptyWasm : bytes('obj'));
		}

		async runWithOptions(
			module: unknown,
			out: boolean,
			args: string[],
			environ: Record<string, string>,
			extraImports: WebAssembly.Imports | undefined,
			instanceRef: { current: WebAssembly.Instance | null } | undefined
		) {
			debugRunCalls.push({ module, out, args, environ, extraImports, instanceRef });
			this.onDebugEvent?.({
				type: 'pause',
				line: 2,
				reason: 'entry',
				locals: [],
				callStack: [{ functionName: 'main', line: 2 }]
			});
		}
	}

	return {
		BrowserClangRuntime: MockBrowserClangRuntime,
		executeBrowserClangArtifact: vi.fn(async (artifact, options) => {
			executedArtifacts.push({ artifact, options });
			const input = options.stdin?.() ?? '';
			options.stdout?.(`stdin=${input}`);
			return { exitCode: 0 };
		}),
		loadRuntimeManifest: vi.fn(async () => ({
			manifestVersion: 1,
			defaultTarget: 'wasm32-wasi'
		})),
		resolveRuntimeManifestUrl: vi.fn((baseUrl: string) => `${baseUrl}runtime-manifest.v1.json`)
	};
});

async function installWorker() {
	const { installObjectiveCWorker } = await import('../src/worker.js');
	installObjectiveCWorker(globalThis as any, {
		configureRuntimeAssets: vi.fn(),
		handleAssetMessage: vi.fn(() => false),
		waitForStdin: vi.fn(() => null)
	});
}

describe('Objective-C worker', () => {
	beforeEach(() => {
		vi.resetModules();
		runCalls = [];
		compileCalls = [];
		debugRunCalls = [];
		executedArtifacts = [];
		runtimeInstances = [];
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (url: string | URL) =>
					new Response(responseBytesForObjectiveCAsset(String(url)))
			)
		);
	});

	it('rejects inline and filesystem runtime assets before loading', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'https://cdn.test/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'data:application/octet-stream;base64,AA==',
					headersUrl: 'https://cdn.test/objective-c/headers.json',
					libgnustepBaseUrl: 'https://cdn.test/objective-c/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'https://cdn.test/objective-c/libgnustep-base.o',
					foundationHeadersUrl: 'https://cdn.test/objective-c/foundation-headers.json',
					libffiUrl: 'https://cdn.test/objective-c/libffi.a'
				}
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Objective-C libobjc URL must use HTTP(S).'
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('loads gzip-only Objective-C startup assets through original asset urls', async () => {
		const fetchedUrls: string[] = [];
		const fetchedOptions: (RequestInit | undefined)[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL, options?: RequestInit) => {
				const url = String(input);
				fetchedUrls.push(url);
				fetchedOptions.push(options);
				if (!url.endsWith('.gz')) {
					return {
						ok: false,
						status: 404,
						arrayBuffer: async () => new ArrayBuffer(0)
					};
				}
				const uncompressed = responseBytesForObjectiveCAsset(url.slice(0, -'.gz'.length));
				return {
					body: null,
					headers: new Headers({ 'content-encoding': 'gzip' }),
					ok: true,
					status: 200,
					arrayBuffer: async () => uncompressed.buffer
				};
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		expect(fetchedUrls).toEqual(
			expect.arrayContaining([
				'http://localhost/wasm-objectivec/libobjc.a',
				'http://localhost/wasm-objectivec/libobjc.a.gz',
				'http://localhost/wasm-objectivec/headers.json',
				'http://localhost/wasm-objectivec/headers.json.gz'
			])
		);
		expect(Array.from(runtimeInstances[0]?.memfs.files.get('libobjc.a') as Uint8Array)).toEqual(
			Array.from(bytes('mock-libobjc'))
		);
		for (const options of fetchedOptions) {
			expect(options).toEqual(
				expect.objectContaining({
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer'
				})
			);
		}
	});

	it('rejects oversized Objective-C header metadata before reading its body', async () => {
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (!url.endsWith('headers.json')) {
					return new Response(responseBytesForObjectiveCAsset(url));
				}
				return new Response(
					new ReadableStream({
						pull() {
							throw new Error('oversized metadata body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{
						headers: {
							'Content-Length': String(DEFAULT_MAX_RUNTIME_JSON_BYTES + 1)
						}
					}
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `Runtime asset http://localhost/wasm-objectivec/headers.json size exceeds the ${DEFAULT_MAX_RUNTIME_JSON_BYTES} byte limit`
		});
		expect(cancelled).toBe(true);
	});

	it('keeps the Objective-C metadata limit on gzip fallback assets', async () => {
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (url.endsWith('headers.json')) {
					return new Response(null, { status: 404 });
				}
				if (!url.endsWith('headers.json.gz')) {
					return new Response(responseBytesForObjectiveCAsset(url));
				}
				return new Response(
					new ReadableStream({
						pull() {
							throw new Error(
								'oversized compressed metadata body should not be read'
							);
						},
						cancel() {
							cancelled = true;
						}
					}),
					{
						headers: {
							'Content-Length': String(DEFAULT_MAX_RUNTIME_JSON_BYTES + 1)
						}
					}
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `Runtime asset http://localhost/wasm-objectivec/headers.json.gz download size exceeds the ${DEFAULT_MAX_RUNTIME_JSON_BYTES} byte limit`
		});
		expect(cancelled).toBe(true);
	});

	it.each([
		['an array', bytes('[]'), 'metadata must be a plain object'],
		['null', bytes('null'), 'metadata must be a plain object'],
		[
			'a non-string value',
			bytes(JSON.stringify({ 'include/objc/runtime.h': 73 })),
			'metadata contains a non-string header source'
		],
		['invalid UTF-8', new Uint8Array([0xc3, 0x28]), 'metadata is not valid UTF-8 JSON']
	])('rejects Objective-C header metadata containing %s', async (_caseName, payload, error) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				return new Response(
					url.endsWith('/headers.json') ? payload : responseBytesForObjectiveCAsset(url)
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage(objectiveCLoadEvent());

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining(error)
		});
		expect(runtimeInstances[0]?.memfs.files.size).toBe(0);
	});

	it.each([
		['traversal', '../escape.h'],
		['absolute', '/escape.h'],
		['Windows absolute', 'C:/escape.h'],
		['backslash', 'include\\escape.h'],
		['empty segment', 'include//escape.h'],
		['dot segment', 'include/./escape.h'],
		['control character', 'include/\u0000escape.h']
	])('rejects an Objective-C header metadata %s path', async (_caseName, unsafePath) => {
		const metadata = Object.fromEntries([
			['safe.h', 'int safe(void);'],
			[unsafePath, 'int escaped(void);']
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				return new Response(
					url.endsWith('/headers.json')
						? bytes(JSON.stringify(metadata))
						: responseBytesForObjectiveCAsset(url)
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage(objectiveCLoadEvent());

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Objective-C headers metadata contains an unsafe header path.'
		});
		expect(runtimeInstances[0]?.memfs.files.has('safe.h')).toBe(false);
	});

	it.each([
		[
			'path byte limit',
			Object.fromEntries([[`${'é'.repeat(513)}.h`, 'int oversized(void);']]),
			'Objective-C headers metadata header path exceeds the 1024 byte limit.'
		],
		[
			'file/directory collision',
			Object.fromEntries([
				['include', 'int collision(void);'],
				['include/objc.h', 'int nested(void);']
			]),
			'Objective-C headers metadata contains a file/directory path collision.'
		],
		[
			'directory/file collision',
			Object.fromEntries([
				['include/objc.h', 'int nested(void);'],
				['include', 'int collision(void);']
			]),
			'Objective-C headers metadata contains a file/directory path collision.'
		]
	])('rejects an Objective-C header metadata %s', async (_caseName, metadata, error) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				return new Response(
					url.endsWith('/headers.json')
						? bytes(JSON.stringify(metadata))
						: responseBytesForObjectiveCAsset(url)
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage(objectiveCLoadEvent());

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error });
		expect(runtimeInstances[0]?.memfs.files.size).toBe(0);
	});

	it('rejects Objective-C header metadata above the entry limit before materialization', async () => {
		const metadata = Object.fromEntries(
			Array.from({ length: 4097 }, (_, index) => [`include/header-${index}.h`, ''])
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				return new Response(
					url.endsWith('/headers.json')
						? bytes(JSON.stringify(metadata))
						: responseBytesForObjectiveCAsset(url)
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage(objectiveCLoadEvent());

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Objective-C headers metadata exceeds the 4096 header entry limit.'
		});
		expect(runtimeInstances[0]?.memfs.files.size).toBe(0);
	});

	it('validates Foundation header metadata before using it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (url.endsWith('/foundation-headers.json')) {
					return new Response(
						bytes(
							JSON.stringify({
								Foundation: 'file',
								'Foundation/Foundation.h': '@interface NSObject @end'
							})
						)
					);
				}
				return new Response(responseBytesForObjectiveCAsset(url));
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage(objectiveCLoadEvent());
		await (globalThis as any).self.onmessage({
			data: {
				code: '#import <Foundation/Foundation.h>\nint main(void) { return 0; }',
				buffer: new SharedArrayBuffer(64),
				prepare: false,
				log: false,
				activePath: 'main.m',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Objective-C Foundation headers metadata contains a file/directory path collision.'
		});
		expect(runtimeInstances[0]?.memfs.files.has('Foundation/Foundation.h')).toBe(false);
	});

	it('rejects oversized Objective-C startup assets before reading their bodies', async () => {
		const limit = 128 * 1024 * 1024;
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (!url.endsWith('libobjc.a')) {
					return new Response(responseBytesForObjectiveCAsset(url));
				}
				return new Response(
					new ReadableStream({
						pull() {
							throw new Error('oversized body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{ headers: { 'Content-Length': String(limit + 1) } }
				);
			})
		);

		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `Runtime asset http://localhost/wasm-objectivec/libobjc.a size exceeds the ${limit} byte limit`
		});
		expect(cancelled).toBe(true);
	});

	it('compiles and links Objective-C workspace implementation files', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		await (globalThis as any).self.onmessage({
			data: {
				code: '#include "Reader.h"\nint main(void) { return reader_value(); }',
				buffer: new SharedArrayBuffer(64),
				prepare: false,
				log: false,
				activePath: 'main.m',
				stdin: '68\n',
				programArgs: ['--sample'],
				workspaceFiles: [
					{ path: 'Reader.h', content: 'int reader_value(void);' },
					{
						path: 'Reader.m',
						content: '#include "Reader.h"\nint reader_value(void) { return 73; }'
					},
					{ path: 'helper.c', content: 'int helper(void) { return 3; }' },
					{ path: 'notes.txt', content: 'not a source file' }
				]
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'stdin=68\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			output: 'mock clang compile log\n'
		});
		expect(runtimeInstances[0]?.memfs.files.has('libobjc.a')).toBe(true);
		expect(runtimeInstances[0]?.memfs.files.has('libgnustep-base.o')).toBe(false);
		expect(runtimeInstances[0]?.memfs.files.has('libffi.a')).toBe(false);
		expect(runtimeInstances[0]?.memfs.files.has('Foundation/Foundation.h')).toBe(false);

		const clangRuns = runCalls.filter((call) => call[0] === 'clang');
		expect(clangRuns).toHaveLength(3);
		const clangInputs = clangRuns.map((call) =>
			call.find((arg) => /^__wasm_idle_objc_\d+\/.*\.[cm]$/.test(arg))
		);
		expect(clangInputs).toEqual([
			expect.stringMatching(/main\.m$/),
			expect.stringMatching(/Reader\.m$/),
			expect.stringMatching(/helper\.c$/)
		]);
		expect(clangRuns[1]).toContain('objective-c');
		expect(clangRuns[2]).toContain('c');

		const lldRun = runCalls.find((call) => call[0] === 'wasm-ld');
		expect(lldRun).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/main\.o$/),
				expect.stringMatching(/Reader\.o$/),
				expect.stringMatching(/helper\.o$/),
				'libobjc.a',
				'-lwasi-emulated-mman'
			])
		);
		expect(lldRun).not.toEqual(
			expect.arrayContaining([
				'--export-table',
				'--allow-undefined',
				'libgnustep-base.o',
				'libffi.a'
			])
		);
		expect(lldRun).not.toEqual(expect.arrayContaining([expect.stringMatching(/notes\.o$/)]));
		expect(executedArtifacts[0]?.options.args).toEqual(['--sample']);
		expect(executedArtifacts[0]?.options.extraImports).toBeUndefined();
	});

	it('compiles and links Objective-C++ active and workspace implementation files', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		await (globalThis as any).self.onmessage({
			data: {
				code: '#include <objc/runtime.h>\n#include "Greeter.h"\nint main(void) { Greeter *greeter = (Greeter *)class_createInstance(objc_getClass("Greeter"), 0); return [greeter offset: 68] == 73 ? 0 : 1; }',
				buffer: new SharedArrayBuffer(64),
				prepare: false,
				log: false,
				activePath: 'main.mm',
				stdin: '',
				workspaceFiles: [
					{
						path: 'Greeter.h',
						content:
							'#include <objc/runtime.h>\n__attribute__((objc_root_class))\n@interface Greeter { Class isa; }\n- (int)offset:(int)value;\n@end'
					},
					{
						path: 'Greeter.mm',
						content:
							'#include <string>\n#include "Greeter.h"\n@implementation Greeter\n- (int)offset:(int)value { const std::string step = "12345"; return value + (int)step.size(); }\n@end'
					}
				]
			}
		});

		const objectiveCxxRuns = runCalls.filter((call) => {
			const languageIndex = call.indexOf('-x');
			return languageIndex >= 0 && call[languageIndex + 1] === 'objective-c++';
		});
		expect(objectiveCxxRuns).toHaveLength(2);
		for (const compileRun of objectiveCxxRuns) {
			expect(compileRun).toEqual(
				expect.arrayContaining([
					'-std=gnu++20',
					'/include/c++/v1',
					'-fobjc-runtime=gnustep-2.0',
					'-fblocks'
				])
			);
		}
		expect(objectiveCxxRuns[0]).toEqual(
			expect.arrayContaining([expect.stringMatching(/main\.mm$/)])
		);
		expect(objectiveCxxRuns[1]).toEqual(
			expect.arrayContaining([expect.stringMatching(/Greeter\.mm$/)])
		);

		const lldRun = runCalls.find((call) => call[0] === 'wasm-ld');
		expect(lldRun).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/main\.o$/),
				expect.stringMatching(/Greeter\.o$/),
				'libobjc.a',
				'-lc++',
				'-lc++abi'
			])
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('links GNUstep Base and libffi only when Foundation is imported', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		await (globalThis as any).self.onmessage({
			data: {
				code: '#include <stdio.h>\n#import <Foundation/Foundation.h>\nint main(void) { return 0; }',
				buffer: new SharedArrayBuffer(64),
				prepare: false,
				log: false,
				activePath: 'main.m',
				stdin: '',
				workspaceFiles: []
			}
		});

		const lldRun = runCalls.find((call) => call[0] === 'wasm-ld');
		expect(lldRun).toEqual(
			expect.arrayContaining([
				'--allow-undefined',
				'--export-table',
				'libgnustep-base.a',
				'libobjc.a',
				'libffi.a',
				'-lwasi-emulated-mman'
			])
		);
		expect(runtimeInstances[0]?.memfs.files.has('libgnustep-base.a')).toBe(true);
		expect(runtimeInstances[0]?.memfs.files.has('libffi.a')).toBe(true);
		expect(runtimeInstances[0]?.memfs.files.has('Foundation/Foundation.h')).toBe(false);
		expect(runtimeInstances[0]?.memfs.files.has('sys/socket.h')).toBe(false);
		expect(runtimeInstances[0]?.memfs.files.has('stdio.h')).toBe(false);
		const memfsEntries = Array.from(
			(runtimeInstances[0]?.memfs.files as Map<string, Uint8Array | string>).entries()
		);
		const mainSource = memfsEntries.find(([path]) =>
			/__wasm_idle_objc_\d+\/main\.m$/.test(path)
		)?.[1];
		expect(mainSource).toContain('@interface NSObject @end');
		expect(executedArtifacts[0]?.options.extraImports).toEqual(expect.any(Function));
	});

	it('compiles and runs Objective-C debug sessions through the Clang trace host', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});
		const debugBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 32);
		const watchBuffer = new SharedArrayBuffer(64);
		const watchResultBuffer = new SharedArrayBuffer(64);
		const interrupt = new SharedArrayBuffer(1);

		await (globalThis as any).self.onmessage({
			data: {
				code: '#include <stdio.h>\n#import <Foundation/Foundation.h>\nint main(void) {\n    int value = 73;\n    printf("%d\\n", value);\n    return 0;\n}',
				buffer: new SharedArrayBuffer(64),
				debugBuffer,
				watchBuffer,
				watchResultBuffer,
				interrupt,
				debug: true,
				breakpoints: [4],
				pauseOnEntry: true,
				prepare: false,
				log: false,
				activePath: 'main.m',
				programArgs: ['--trace'],
				workspaceFiles: []
			}
		});

		expect(compileCalls).toEqual([
			expect.objectContaining({
				language: 'OBJC',
				debug: true,
				input: expect.stringMatching(/main\.m$/),
				transformSource: expect.any(Function)
			})
		]);
		const linkCall = runCalls.find((call) => call[0] === 'wasm-ld');
		expect(linkCall).toEqual(
			expect.arrayContaining(['--allow-undefined', 'libgnustep-base.a', 'libffi.a'])
		);
		const compiledSource = [...runtimeInstances[0].memfs.files.entries()].find(([path]) =>
			/main\.m$/.test(path)
		)?.[1];
		expect(String(compiledSource)).toContain('@interface NSObject @end');
		expect(String(compiledSource)).not.toContain('#import <Foundation/Foundation.h>');
		expect(executedArtifacts).toEqual([]);
		expect(debugRunCalls).toHaveLength(1);
		expect(debugRunCalls[0]).toEqual(
			expect.objectContaining({
				args: [expect.stringMatching(/main\.wasm$/), '--trace'],
				extraImports: {
					env: expect.objectContaining({ ffi_call_js: expect.any(Function) })
				}
			})
		);
		expect(runtimeInstances[0]).toEqual(
			expect.objectContaining({
				debug: true,
				debugPauseOnEntry: true,
				debugBreakpoints: new Set([4]),
				debugBuffer: expect.any(Int32Array),
				debugWatchBuffer: expect.any(Int32Array),
				debugWatchResultBuffer: expect.any(Int32Array),
				debugInterruptBuffer: expect.any(Uint8Array)
			})
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				debugEvent: expect.objectContaining({ type: 'pause', line: 2, reason: 'entry' })
			})
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('replays captured clang output when object compilation fails', async () => {
		await installWorker();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: 'http://localhost/clang/', useAssetBridge: false },
				objectivecAssets: {
					libobjcUrl: 'http://localhost/wasm-objectivec/libobjc.a',
					headersUrl: 'http://localhost/wasm-objectivec/headers.json',
					libgnustepBaseUrl: 'http://localhost/wasm-objectivec/libgnustep-base.a',
					libgnustepBaseObjectUrl: 'http://localhost/wasm-objectivec/libgnustep-base.o',
					foundationHeadersUrl:
						'http://localhost/wasm-objectivec/foundation-headers.json',
					libffiUrl: 'http://localhost/wasm-objectivec/libffi.a'
				}
			}
		});

		await (globalThis as any).self.onmessage({
			data: {
				code: 'int main(void) { return missing_symbol; }',
				buffer: new SharedArrayBuffer(64),
				prepare: false,
				log: false,
				activePath: 'broken.m',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'mock clang compile log\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'mock clang failure'
		});
	});
});
