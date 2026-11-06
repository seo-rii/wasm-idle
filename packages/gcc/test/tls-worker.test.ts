import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileGccWasm } from '../src/wasm-output.js';
import { tlsSharedFixture, tlsSharedProfile } from './tls-fixtures.js';

// Run the actual Worker handler with real boundary Wasm in a test realm. This
// checks lifecycle ordering; it does not qualify a compiler or parallel engine.
afterEach(() => vi.unstubAllGlobals());
async function run(options: Parameters<typeof tlsSharedFixture>[0] = {}) {
	vi.resetModules();
	const postMessage = vi.fn(),
		close = vi.fn();
	vi.stubGlobal('onmessage', null);
	vi.stubGlobal('postMessage', postMessage);
	vi.stubGlobal('close', close);
	await import('../src/shared-worker-entry.js');
	const { module } = await compileGccWasm(tlsSharedFixture(options), 'executable', {
		atomics: true,
		tls: true,
		sharedMemory: tlsSharedProfile
	});
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
		gate = new SharedArrayBuffer(4);
	Atomics.store(new Int32Array(gate), 0, 1);
	await (globalThis.onmessage as Function)({
		data: {
			id: 0,
			module,
			memory,
			gate,
			entry: 'entry',
			arguments: [0],
			stackTop: 8192,
			heapBase: 33808,
			dataEnd: 1040,
			memoryBytes: 65536,
			timeoutMs: 100,
			tls: { base: 2048, size: 4, alignment: 16, reservedLow: 1040, reservedHigh: 33808 }
		}
	});
	expect(close).toHaveBeenCalledOnce();
	return {
		messages: postMessage.mock.calls.map(([message]) => message),
		view: new DataView(memory.buffer)
	};
}
describe('actual TLS Worker lifecycle handler', () => {
	it('initializes TLS before readiness and finishes cleanup before publishing the result', async () => {
		const { messages, view } = await run({ yield: true });
		expect(messages).toEqual([
			{ id: 0, type: 'ready' },
			{ id: 0, type: 'result', value: 2048 }
		]);
		expect(view.getUint32(2048, true)).toBe(99);
	});
	it('does not promise TLS cleanup after an entry trap', async () => {
		const { messages, view } = await run({ trap: true });
		expect(messages.map((message) => message.type)).toEqual(['ready', 'error']);
		expect(messages[1].message).toMatch(/unreachable/);
		expect(view.getUint32(2048, true)).toBe(37);
	});
	it('rejects cleanup failure without publishing a result', async () => {
		const { messages } = await run({ cleanupTrap: true });
		expect(messages.map((message) => message.type)).toEqual(['ready', 'error']);
		expect(messages[1].message).toMatch(/unreachable/);
	});
});
