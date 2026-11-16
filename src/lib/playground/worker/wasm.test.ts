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

// wasi-libc may issue readv with an empty leading vector before its byte buffer.
// Fixture reads 'A', then EOF with iovecs [{ptr:0,len:0},{ptr:c,len:1}].
it('does not consume terminal data or EOF for zero-length readv vectors', async () => {
	vi.resetModules();
	(globalThis as any).self = globalThis;
	(globalThis as any).postMessage = vi.fn();
	const nextChunk = vi
		.fn()
		.mockReturnValueOnce('A')
		.mockReturnValueOnce(null)
		.mockImplementation(() => {
			throw new Error('stdin was requested again after EOF');
		});
	vi.doMock('$lib/playground/stdinBuffer', () => ({ waitForBufferedStdin: nextChunk }));
	try {
		await import('./wasm');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'AGFzbQEAAAABFgRgBH9/f38Bf2ABfwBgAABgAn9/AX8CRQIWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQdmZF9yZWFkAAAWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQlwcm9jX2V4aXQAAQMDAgIDBQMBAAIGCAF/AUGAgAQLBxMCBm1lbW9yeQIABl9zdGFydAACDAEBCoECAuwBAQJ/AkBBhIAEKAIARQRAQYSABEEBNgIAQYyABEGMgAQ2AgBBxIAEQQA2AgBBwIAEQYCABDYCAEG8gARBgIAENgIAQZSABEGMgAQ2AgBBkIAEQYyABDYCAEGYgARBiIAEKAIANgIAQYCABEGAgAQ2AgAjAEEgayIAJABBASEBIABBATYCDCAAQgA3AwAgACAAQR9qNgIIAkAgACAAQRhqEAMNACAAKAIYQQFHDQAgAC0AH0HBAEcNACAAIABBGGoQAyEBQQJBAkEAIAAoAhgbIAEbIQELIABBIGokACABIgANAQ8LAAsgABABAAsRAEEAIABBAiABEABB//8DcQsLCQEAQYKABAsBAgB7D3RhcmdldF9mZWF0dXJlcwcrD211dGFibGUtZ2xvYmFscysTbm9udHJhcHBpbmctZnB0b2ludCsLYnVsay1tZW1vcnkrCHNpZ24tZXh0Kw9yZWZlcmVuY2UtdHlwZXMrCm11bHRpdmFsdWUrDmV4dGVuZGVkLWNvbnN0',
				activePath: 'main.wasm',
				workspaceFiles: [],
				buffer: new Int32Array(new SharedArrayBuffer(16))
			}
		});
		expect(nextChunk).toHaveBeenCalledTimes(2);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect(
			(globalThis as any).postMessage.mock.calls.some(([message]: [any]) => message.error)
		).toBe(false);
	} finally {
		vi.doUnmock('$lib/playground/stdinBuffer');
	}
});
