// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ source: '' }));

vi.mock('$lib/playground/dOuterAssets', () => ({
	snapshotDOuterAssetConfig: (config: unknown) => config,
	loadVerifiedDOuterAssets: vi.fn(async () => ({
		moduleBytes: new TextEncoder().encode(runtime.source),
		manifestBytes: new TextEncoder().encode('{}')
	}))
}));

vi.mock('@wasm-idle/core', () => ({
	createRuntimeAssetsKey: () => 'd-runtime',
	verifyRuntimeAssetIntegrity: vi.fn()
}));

describe('D worker', () => {
	beforeEach(() => {
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
});
