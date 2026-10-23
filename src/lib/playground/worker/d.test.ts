// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ source: '', manifest: {} as Record<string, unknown> }));

vi.mock('$lib/playground/dOuterAssets', () => ({
	snapshotDOuterAssetConfig: (config: unknown) => config,
	loadVerifiedDOuterAssets: vi.fn(async () => ({
		moduleBytes: new TextEncoder().encode(runtime.source),
		manifestBytes: new TextEncoder().encode(JSON.stringify(runtime.manifest))
	}))
}));

vi.mock('@wasm-idle/core', () => ({
	createRuntimeAssetsKey: () => 'd-runtime',
	verifyRuntimeAssetIntegrity: vi.fn()
}));

describe('D worker', () => {
	beforeEach(() => {
		runtime.manifest = {};
		vi.restoreAllMocks();
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		vi.spyOn(URL, 'createObjectURL').mockImplementation(
			() => `data:text/javascript;base64,${Buffer.from(runtime.source).toString('base64')}`
		);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
	});

	it('reports a nonzero exit without repeating already-streamed stderr', async () => {
		runtime.source = `
			export function parseRuntimeManifest(manifest) {
				return manifest;
			}

			export async function createDCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserDArtifact(_artifact, options = {}) {
				options.stderr?.('core.exception.AssertError@main.d(3): boom\\n');
				return {
					exitCode: 1,
					stdout: '',
					stderr: 'core.exception.AssertError@main.d(3): boom\\n'
				};
			}
		`;

		await import('./d');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: 'https://runtime.example/d/index.js',
				manifestUrl: 'https://runtime.example/d/runtime-manifest.v1.json',
				outerIntegrity: {}
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'void main() { assert(false, "boom"); }',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				stdin: ''
			}
		});

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		expect(messages).toContainEqual({ load: true });
		expect(messages.filter((message: any) => 'output' in message)).toEqual([
			{ output: 'core.exception.AssertError@main.d(3): boom\n' }
		]);
		expect(messages.at(-1)).toEqual({ error: 'D program exited with code 1' });
	});

	it('reuses prepared flags and recompiles changed compiler arguments independently of program argv', async () => {
		runtime.source = `
			export function parseRuntimeManifest(manifest) { return manifest; }
			export async function createDCompiler() {
				return { async compile(options) {
					postMessage({ compiledWith: options.compileArgs, target: options.target });
					return { success: true, artifact: {
						bytes: new Uint8Array([0,97,115,109,1,0,0,0]),
						compiledWith: options.compileArgs
					} };
				} };
			}
			export async function executeBrowserDArtifact(artifact, options) {
				postMessage({ executedWith: options.args, compiledWith: artifact.compiledWith });
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		`;
		await import('./d');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: 'https://runtime.example/d/index.js',
				manifestUrl: 'https://runtime.example/d/runtime-manifest.v1.json',
				outerIntegrity: {}
			}
		});
		const data = {
			code: 'void main(string[] args) {}',
			fileName: 'main.d',
			buffer: new SharedArrayBuffer(1024),
			stdin: ''
		};
		const compileArgs = ['-O2', '-w'];
		const preparing = (globalThis as any).self.onmessage({
			data: { ...data, prepare: true, compileArgs }
		});
		compileArgs[0] = '-O0';
		await preparing;
		await (globalThis as any).self.onmessage({
			data: { ...data, compileArgs: ['-O2', '-w'], args: ['first', 'two words', ''] }
		});
		await (globalThis as any).self.onmessage({
			data: { ...data, compileArgs, args: ['second'] }
		});
		await (globalThis as any).self.onmessage({
			data: { ...data, compileArgs: ['-O0', '-w'], args: ['third'] }
		});
		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		expect(messages.filter((message: any) => 'target' in message)).toEqual([
			{ compiledWith: ['-O2', '-w'], target: 'wasm32-wasi' },
			{ compiledWith: ['-O0', '-w'], target: 'wasm32-wasi' }
		]);
		expect(messages.filter((message: any) => 'executedWith' in message)).toEqual([
			{ executedWith: ['first', 'two words', ''], compiledWith: ['-O2', '-w'] },
			{ executedWith: ['second'], compiledWith: ['-O0', '-w'] },
			{ executedWith: ['third'], compiledWith: ['-O0', '-w'] }
		]);
	});

	it('recompiles prepared non-debug artifacts with mandatory LDC DWARF after custom flags', async () => {
		runtime.manifest = {
			version: 'ldc-1.42.0',
			compiler: { ldc2: { integrity: { uncompressedSha256: 'c'.repeat(64) } } }
		};
		runtime.source = `
			export function parseRuntimeManifest(manifest) { return manifest; }
			export async function createDCompiler() {
				return { async compile(options) {
					postMessage({ compiledWith: options.compileArgs || [] });
					return { success: true, artifact: { bytes: new Uint8Array([0,97,115,109,1,0,0,0]) } };
				} };
			}
			export async function executeBrowserDArtifact() { throw new Error('LLDB artifact executed in compiler worker'); }
		`;
		await import('./d');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: 'https://runtime.example/d/index.js',
				manifestUrl: 'https://runtime.example/d/runtime-manifest.v1.json',
				outerIntegrity: {}
			}
		});
		const code = 'void main() { int value = 73; }';
		const data = {
			code,
			fileName: 'src/hello.d',
			buffer: new SharedArrayBuffer(1024),
			compileArgs: ['-w', '-O2', '-dwarf-version=5']
		};
		await (globalThis as any).self.onmessage({ data: { ...data, prepare: true } });
		await (globalThis as any).self.onmessage({ data: { ...data, debugMode: 'lldb' } });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			compiledWith: [
				'-w',
				'-O2',
				'-dwarf-version=5',
				'-g',
				'-O0',
				'-dwarf-version=4',
				'--fdebug-prefix-map=/work/hello.d=/workspace/src/hello.d'
			]
		});
		const artifact = (globalThis as any).postMessage.mock.calls.at(-1)[0].lldbArtifact;
		expect(artifact.descriptor.compiler).toEqual({
			name: 'ldc',
			version: 'ldc-1.42.0',
			binarySha256: 'c'.repeat(64)
		});
		expect(artifact.descriptor.moduleSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(artifact.sources).toEqual([
			{
				path: '/workspace/src/hello.d',
				content: code,
				contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
			}
		]);
	});
});
