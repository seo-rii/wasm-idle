import { flushBufferedEof, flushQueuedStdin } from '$lib/playground/stdinBuffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PHP_STDIN_MESSAGE } from './phpPreload';

const mocks = vi.hoisted(() => ({
	run: vi.fn(),
	removeHandler: vi.fn(),
	onMessage: vi.fn()
}));
vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: vi.fn(async () => ({
		createPhp84: async () => ({
			mkdir: vi.fn(),
			rmdir: vi.fn(),
			writeFile: vi.fn(),
			onMessage: mocks.onMessage,
			run: mocks.run
		})
	}))
}));

async function send(data: Record<string, unknown>) {
	await (globalThis as any).self.onmessage({ data });
}

describe('PHP worker terminal stdin', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.onMessage.mockReturnValue(mocks.removeHandler);
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		await import('./php');
		await send({ load: true, moduleUrl: '/wasm-php/runtime.mjs' });
	});

	it('waits only in response to an engine input read and releases the handler after each request', async () => {
		const buffer = new SharedArrayBuffer(4096);
		const chunks = ['1\n', '2\n'];
		const requests: unknown[] = [];
		(globalThis as any).postMessage = vi.fn((message: { buffer?: boolean }) => {
			if (!message?.buffer) return;
			requests.push(message);
			if (!flushQueuedStdin(chunks, buffer)) flushBufferedEof(buffer);
		});
		mocks.run.mockImplementation(async () => {
			expect(requests).toHaveLength(0);
			const read = mocks.onMessage.mock.calls[0][0];
			expect(read('unrelated application message')).toBe('');
			expect(
				[read(PHP_STDIN_MESSAGE), read(PHP_STDIN_MESSAGE), read(PHP_STDIN_MESSAGE)].map(
					(chunk) => JSON.parse(chunk)
				)
			).toEqual(['1\n', '2\n', null]);
			return { text: '3', errors: '', exitCode: 0 };
		});
		await send({ code: '<?php require "lib.php";', buffer, activePath: 'main.php' });
		expect(requests).toHaveLength(3);
		expect(mocks.removeHandler).toHaveBeenCalledOnce();
	});

	it('does not request input for source text and removes the listener after a PHP exception', async () => {
		mocks.run.mockRejectedValue(new Error('PHP exception'));
		await send({
			code: '<?php // STDIN is unused\nthrow new Exception();',
			buffer: new SharedArrayBuffer(4096)
		});
		expect(postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect(mocks.removeHandler).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith({ error: 'PHP exception' });
	});
});
