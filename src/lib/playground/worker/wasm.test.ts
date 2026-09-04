import { beforeEach, describe, expect, it, vi } from 'vitest';

const answerWasm = 'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL';
const stdinWasm = 'AGFzbQEAAAABBQFgAAF/AhABA2VudghyZWFkQnl0ZQAAAwIBAAcIAQRtYWluAAEKBgEEABAACw==';

describe('WASM worker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
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
		const request = {
			code: '# base64 wasm\n' + answerWasm,
			activePath: 'main.wasm',
			workspaceFiles: []
		};
		await (globalThis as any).self.onmessage({
			data: { ...request, prepare: true }
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: false
			}
		});

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		const readyIndex = messages.findIndex((message: any) => message.progress?.kind === 'ready');
		expect(messages.filter((message: any) => message.progress?.kind === 'ready')).toEqual([
			{
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'WASM program started'
				}
			}
		]);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(
			messages.findIndex((message: any) => message.output === 'answer=42\n')
		);
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

	it('does not report execution readiness when final instantiation fails', async () => {
		vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new Error('WASM link failed'));
		await import('./wasm');

		await (globalThis as any).self.onmessage({
			data: {
				code: answerWasm,
				prepare: false,
				activePath: 'main.wasm',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'WASM link failed'
		});
	});
});
