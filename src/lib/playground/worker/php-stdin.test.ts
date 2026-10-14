import { flushBufferedEof, flushQueuedStdin } from '$lib/playground/stdinBuffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runPhp } = vi.hoisted(() => ({
	runPhp: vi.fn(async (_options: { body?: string }) => ({ text: '', errors: '', exitCode: 0 }))
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: vi.fn(async () => ({
		createPhp84: async () => ({
			mkdir: vi.fn(),
			rmdir: vi.fn(),
			writeFile: vi.fn(),
			run: runPhp
		})
	}))
}));

async function send(data: Record<string, unknown>) {
	await (globalThis as any).self.onmessage({ data });
}

describe('PHP worker terminal stdin', () => {
	beforeEach(async () => {
		vi.resetModules();
		runPhp.mockClear();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		await import('./php');
		await send({ load: true, moduleUrl: '/wasm-php/runtime.mjs' });
	});

	it('passes every terminal chunk written before EOF as the request body', async () => {
		const buffer = new SharedArrayBuffer(4096);
		const terminalInput = ['1\n', '2\n'];
		const requests: unknown[] = [];
		(globalThis as any).postMessage = vi.fn((message: { buffer?: boolean }) => {
			if (!message?.buffer) return;
			requests.push(message);
			// Answer each request synchronously, as the host does once input is queued.
			if (!flushQueuedStdin(terminalInput, buffer)) flushBufferedEof(buffer);
		});

		await send({
			code: '<?php echo fgets(STDIN) + fgets(STDIN);',
			prepare: false,
			buffer,
			activePath: 'main.php'
		});

		expect(requests).toHaveLength(3);
		expect(runPhp).toHaveBeenCalledOnce();
		expect(runPhp.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ body: '1\n2\n' }));
	});
});
