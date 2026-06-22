import { beforeEach, describe, expect, it, vi } from 'vitest';

const answerWasm = 'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL';
const stdinWasm = 'AGFzbQEAAAABBQFgAAF/AhABA2VudghyZWFkQnl0ZQAAAwIBAAcIAQRtYWluAAEKBgEEABAACw==';

describe('WASM worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
	});

	it('loads and executes zero-argument exports from a real WebAssembly binary', async () => {
		await import('./wasm');
		await (globalThis as any).self.onmessage({
			data: {
				load: true
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: '# base64 wasm\n' + answerWasm,
				prepare: false,
				activePath: 'main.wasm',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'answer=42\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('provides stdin through the env readByte import', async () => {
		await import('./wasm');
		await (globalThis as any).self.onmessage({
			data: {
				code: stdinWasm,
				prepare: false,
				stdin: 'A\n',
				activePath: 'main.wasm',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'main=65\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('validates decoded input before compiling', async () => {
		await import('./wasm');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'not-a-wasm-module',
				prepare: false,
				activePath: 'main.wasm',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'WASM source must decode to a WebAssembly binary'
		});
	});
});
