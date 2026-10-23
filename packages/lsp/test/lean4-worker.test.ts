import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameMessage, LspFrameDecoder } from '../src/lean4/stdio.js';

// Exercise the real supervisor and byte transport without downloading the compiler.
vi.mock('../src/bundledLean4Runtime.js', () => ({ WASM_LEAN4_PROFILE: { assets: {} } }));
vi.mock('../src/lean4/assets.js', () => ({ preflightLean4RuntimeAssets: async () => ({}) }));
vi.mock('../src/lean4/platform.js', () => ({ adaptLean4Glue: () => '' }));

const uri = 'file:///workspace/Main.lean';
const document = { uri, languageId: 'lean4', version: 1, text: 'def value : Nat := 1\n' };
const tick = async () => {
	await setImmediate();
	await setImmediate();
};

describe('Lean process lifecycle', () => {
	let posted: any[];
	let send: (data: any) => void;
	const event = (id: number, data: any) => send({ type: 'lean-worker-event', id, data });
	const processes = () => posted.filter((message) => message.leanWorker?.data?.args);
	const latest = () => processes().at(-1).leanWorker;
	const read = (id: number) => {
		const process = processes().find((message) => message.leanWorker.id === id).leanWorker;
		const { buffer, capacity } = process.data.stdin;
		const control = new Int32Array(buffer, 0, 4);
		const start = Atomics.load(control, 1),
			end = Atomics.load(control, 0);
		expect(end).toBeLessThan(capacity);
		const bytes = Uint8Array.from(new Uint8Array(buffer, 16 + start, end - start));
		Atomics.store(control, 1, end);
		return new LspFrameDecoder().push(bytes) as any[];
	};
	const open = async () => {
		send({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: { textDocument: document }
		});
		await tick();
		const process = latest();
		event(process.id, { ready: true });
		await tick();
		expect(read(process.id).map((message) => message.method)).toEqual([
			'initialize',
			'textDocument/didOpen'
		]);
		return process.id;
	};

	beforeEach(async () => {
		vi.resetModules();
		posted = [];
		vi.stubGlobal('crossOriginIsolated', true);
		vi.stubGlobal('postMessage', (message: any) => posted.push(message));
		vi.stubGlobal('onmessage', undefined);
		await import('../src/lean4/worker.js');
		send = (data) => globalThis.onmessage!({ data } as MessageEvent);
		send({ type: 'init', options: { maxMemoryBytes: 1024 ** 3 } });
		await tick();
		const bootstrap = latest();
		event(bootstrap.id, { ready: true });
		await tick();
		send({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: { rootUri: 'file:///workspace' }
		});
		await tick();
		event(bootstrap.id, {
			stdout: frameMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } })
		});
		await tick();
	});

	afterEach(async () => {
		// Release any deliberately paused startup before asking the real supervisor to stop.
		for (const message of processes()) event(message.leanWorker.id, { ready: true });
		await tick();
		send({ jsonrpc: '2.0', id: 'cleanup', method: 'shutdown' });
		await tick();
		vi.unstubAllGlobals();
	});

	it('preserves requests queued before the first didOpen', async () => {
		send({
			jsonrpc: '2.0',
			id: 40,
			method: 'textDocument/hover',
			params: { textDocument: { uri } }
		});
		send({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: { textDocument: document }
		});
		await tick();
		const process = latest();
		event(process.id, { ready: true });
		await tick();
		expect(read(process.id).map((message) => message.method)).toEqual([
			'initialize',
			'textDocument/didOpen',
			'textDocument/hover'
		]);
		expect(posted.find((message) => message.id === 40)).toBeUndefined();
	});

	it('keeps requests and edits behind initialize/didOpen during an import restart', async () => {
		const first = await open();
		event(first, { exit: 2 });
		await tick();
		const restarted = latest();
		expect(restarted.id).not.toBe(first);
		send({
			jsonrpc: '2.0',
			id: 41,
			method: 'textDocument/hover',
			params: { textDocument: { uri } }
		});
		send({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri, version: 2 },
				contentChanges: [{ text: 'def value : Nat := 2\n' }]
			}
		});
		await tick();
		expect(read(restarted.id)).toEqual([]);
		event(restarted.id, { ready: true });
		await tick();
		const messages = read(restarted.id);
		expect(messages.map((message) => message.method)).toEqual([
			'initialize',
			'textDocument/didOpen',
			'textDocument/hover',
			'textDocument/didChange'
		]);
		expect(messages[1].params.textDocument).toEqual(document);
	});

	it.each(['runtime', 'pthread'])(
		'settles pending and future requests after a terminal %s failure',
		async (kind) => {
			const process = await open();
			send({
				jsonrpc: '2.0',
				id: 41,
				method: 'textDocument/hover',
				params: { textDocument: { uri } }
			});
			await tick();
			if (kind === 'runtime') event(process, { error: 'runtime crashed' });
			else {
				event(process, { thread: { type: 'create', id: 7, url: latest().data.glueUrl } });
				const thread = posted
					.filter((message) => message.leanWorker?.type === 'create')
					.at(-1).leanWorker;
				send({ type: 'lean-worker-event', id: thread.id, error: 'pthread crashed' });
			}
			await tick();
			expect(posted.find((message) => message.id === 41)?.error).toBeDefined();
			send({
				jsonrpc: '2.0',
				id: 42,
				method: 'textDocument/hover',
				params: { textDocument: { uri } }
			});
			await tick();
			expect(posted.find((message) => message.id === 42)?.error).toBeDefined();
			expect(posted.filter((message) => message.type === 'error')).toHaveLength(1);
		}
	);
});
