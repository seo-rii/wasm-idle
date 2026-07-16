import { beforeEach, describe, expect, it, vi } from 'vitest';

const validEmptyWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let runCalls: string[][] = [];
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
		memfs = new MockMemfs();
		ready = Promise.resolve();
		stdout: (chunk: string) => void;

		constructor(options: { log?: boolean; stdout?: (chunk: string) => void }) {
			this.log = !!options.log;
			this.stdout = options.stdout || (() => {});
			runtimeInstances.push(this);
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
		executedArtifacts = [];
		runtimeInstances = [];
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => ({
				ok: true,
				arrayBuffer: async () => {
					return responseBytesForObjectiveCAsset(url).buffer;
				}
			}))
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
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				fetchedUrls.push(url);
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
