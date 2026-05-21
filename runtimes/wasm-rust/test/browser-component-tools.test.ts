import { describe, expect, it, vi } from 'vitest';

import { createPreview2ImportObject } from '../src/browser-component-tools.js';

describe('createPreview2ImportObject', () => {
	it('loads only the preview2 browser modules required by the transpiled component imports', async () => {
		const loadedAssetPaths: string[] = [];
		const cliModule = {
			_setStdin: vi.fn(),
			_setStdout: vi.fn(),
			_setStderr: vi.fn(),
			environment: {
				getEnvironment: () => [['DEFAULT', '1']] as Array<[string, string]>,
				getArguments: () => ['component.wasm'],
				initialCwd: () => '/'
			},
			exit: { exit: vi.fn() },
			stderr: { getStderr: vi.fn() },
			stdin: { getStdin: vi.fn() },
			stdout: { getStdout: vi.fn() },
			terminalInput: { TerminalInput: class TerminalInput {} },
			terminalOutput: { TerminalOutput: class TerminalOutput {} },
			terminalStderr: { getTerminalStderr: vi.fn() },
			terminalStdin: { getTerminalStdin: vi.fn() },
			terminalStdout: { getTerminalStdout: vi.fn() }
		};
		const filesystemModule = {
			preopens: {
				getDirectories: () => [['default', '/']]
			},
			types: {
				Descriptor: class Descriptor {}
			}
		};
		const ioModule = {
			error: { Error: class IoError {} },
			poll: { pollList: vi.fn() },
			streams: { InputStream: class InputStream {}, OutputStream: class OutputStream {} }
		};
		const randomModule = {
			random: { getRandomBytes: vi.fn() },
			insecure: { getInsecureRandomBytes: vi.fn() },
			insecureSeed: { insecureSeed: vi.fn() }
		};

		const importObject = await createPreview2ImportObject(
			'https://example.com/wasm-rust/runtime/',
			{
				args: ['component.wasm', 'preview2-cli'],
				env: {
					FOO: 'bar'
				},
				requiredImports: [
					'wasi:cli/environment@0.2.3',
					'wasi:filesystem/preopens@0.2.3',
					'wasi:io/streams@0.2.3',
					'wasi:random/random@0.2.3'
				],
				stdin: {
					blockingRead() {
						return new Uint8Array([1, 2, 3]);
					}
				},
				stdout() {},
				stderr() {}
			},
			{
				importRuntimeModule: async (_runtimeBaseUrl, assetPath) => {
					loadedAssetPaths.push(assetPath);
					switch (assetPath) {
						case '../vendor/preview2-shim/lib/browser/cli.js':
							return cliModule;
						case '../vendor/preview2-shim/lib/browser/filesystem.js':
							return filesystemModule;
						case '../vendor/preview2-shim/lib/browser/io.js':
							return ioModule;
						case '../vendor/preview2-shim/lib/browser/random.js':
							return randomModule;
						default:
							throw new Error(`unexpected preview2 browser module load: ${assetPath}`);
					}
				}
			}
		);

		expect(loadedAssetPaths.sort()).toEqual(
			[
				'../vendor/preview2-shim/lib/browser/cli.js',
				'../vendor/preview2-shim/lib/browser/filesystem.js',
				'../vendor/preview2-shim/lib/browser/io.js',
				'../vendor/preview2-shim/lib/browser/random.js'
			].sort()
		);
		expect(cliModule._setStdin).toHaveBeenCalledTimes(1);
		expect(cliModule._setStdout).toHaveBeenCalledTimes(1);
		expect(cliModule._setStderr).toHaveBeenCalledTimes(1);
		expect(
			(importObject['wasi:cli/environment'] as {
				getEnvironment: () => Array<[string, string]>;
				getArguments: () => string[];
			}).getEnvironment()
		).toEqual([['FOO', 'bar']]);
		expect(
			(importObject['wasi:cli/environment@0.2.3'] as {
				getArguments: () => string[];
			}).getArguments()
		).toEqual(['component.wasm', 'preview2-cli']);
		expect(
			(importObject['wasi:filesystem/preopens'] as {
				getDirectories: () => unknown[];
			}).getDirectories()
		).toEqual([]);
		expect(importObject['wasi:filesystem/types']).toBe(filesystemModule.types);
		expect(importObject['wasi:io/streams']).toBe(ioModule.streams);
		expect(importObject['wasi:random/random']).toBe(randomModule.random);
		expect(importObject['wasi:clocks/wall-clock']).toBeUndefined();
		expect(importObject['wasi:sockets/network']).toBeUndefined();
		expect(importObject['wasi:http/types']).toBeUndefined();
	});

	it('rejects unsupported preview3 import versions with an explicit transition error', async () => {
		await expect(
			createPreview2ImportObject('https://example.com/wasm-rust/runtime/', {
				requiredImports: ['wasi:cli/environment@0.3.0']
			})
		).rejects.toThrow(/currently provides only WASIp2 browser shims/);
	});
});
