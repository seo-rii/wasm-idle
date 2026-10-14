// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The runtime rejects at its deadline while the js/wasm program keeps running on the event loop.
const compilerModuleUrl = `data:text/javascript;base64,${Buffer.from(
	`
	export async function createGoCompiler() {
		return {
			async compile(options) {
				return {
					success: true,
					artifact: {
						wasm: new Uint8Array([0, 97, 115, 109]),
						bytes: new Uint8Array([0, 97, 115, 109]),
						target: options.target,
						format: options.target === 'js/wasm' ? 'js-wasm' : 'wasi-core-wasm'
					}
				};
			}
		};
	}

	export async function executeBrowserGoArtifact() {
		throw new Error('Go execution timed out after 5 ms');
	}
`,
	'utf8'
).toString('base64')}`;

async function send(data: Record<string, unknown>) {
	await (globalThis as any).self.onmessage({ data });
}

describe('Go worker abandoned executions', () => {
	beforeEach(async () => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		delete (globalThis as any).__wasmIdleGoDebugLine;
		await import('./go');
		await send({ load: true, compilerUrl: compilerModuleUrl });
	});

	it('reports a rejected js/wasm run as fatal and keeps the debug hook for the live program', async () => {
		await send({
			code: 'package main\n\nfunc main() {\n\tprintln("hi")\n}',
			prepare: false,
			buffer: new SharedArrayBuffer(1024),
			debugBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 1028),
			debug: true
		});

		expect(postMessage).toHaveBeenCalledWith({
			error: 'Go execution timed out after 5 ms',
			fatal: true
		});
		expect(typeof (globalThis as any).__wasmIdleGoDebugLine).toBe('function');
	});

	it('does not mark a rejected WASI run fatal because it has already stopped', async () => {
		await send({
			code: 'package main\nfunc main() {}',
			prepare: false,
			buffer: new SharedArrayBuffer(1024),
			target: 'wasip1/wasm'
		});

		expect(postMessage).toHaveBeenCalledWith({ error: 'Go execution timed out after 5 ms' });
	});
});
