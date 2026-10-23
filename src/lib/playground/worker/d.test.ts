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

	it('recompiles prepared non-debug artifacts with LDC DWARF and maps nested source paths', async () => {
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
		const data = { code, fileName: 'src/hello.d', buffer: new SharedArrayBuffer(1024) };
		await (globalThis as any).self.onmessage({ data: { ...data, prepare: true } });
		await (globalThis as any).self.onmessage({ data: { ...data, debugMode: 'lldb' } });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			compiledWith: [
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
