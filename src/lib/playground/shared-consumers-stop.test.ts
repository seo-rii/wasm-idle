import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LldbSandboxSessionOptions } from './lldbSession';
import type { DebugSessionEvent } from './options';

const { workers, sessions, MockWorker } = vi.hoisted(() => {
	const workers: any[] = [];
	const sessions: any[] = [];
	return {
		workers,
		sessions,
		MockWorker: class {
			onmessage: ((event: any) => void) | null = null;
			onerror = null;
			onmessageerror = null;
			terminate = vi.fn();
			postMessage = vi.fn((message) => {
				if (message.load) queueMicrotask(() => this.onmessage?.({ data: { load: true } }));
			});
			constructor() {
				workers.push(this);
			}
		}
	};
});

vi.mock('$lib/playground/worker/d?worker', () => ({ default: MockWorker }));
vi.mock('$lib/playground/worker/v?worker', () => ({ default: MockWorker }));
vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		resolve!: (value: true) => void;
		constructor(readonly options: LldbSandboxSessionOptions) {
			sessions.push(this);
		}
		start() {
			return new Promise<true>((resolve) => {
				this.resolve = resolve;
			});
		}
		disconnect = vi.fn(async () => {
			await Promise.resolve();
			this.resolve(true);
			this.options.onDebugEvent({ type: 'stop' });
		});
		write = vi.fn(async () => undefined);
		eof = vi.fn(async () => undefined);
	}
}));

import D from './d';
import V from './v';

const assets = { rootUrl: '/runtime', d: { moduleUrl: '/d/index.js' } };
const fixtures = [
	{ language: 'D', Constructor: D, code: 'void main() {}', path: '/workspace/main.d' },
	{ language: 'V', Constructor: V, code: 'fn main() {}', path: '/workspace/main.v' }
];

describe.each(fixtures)('$language synchronous LLDB stop consumers', (fixture) => {
	beforeEach(() => {
		workers.length = 0;
		sessions.length = 0;
		vi.stubGlobal('MessageChannel', undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const start = async () => {
		const sandbox = new fixture.Constructor();
		await sandbox.load(assets);
		const controller = new AbortController();
		const running = sandbox.run(fixture.code, false, false, undefined, [], {
			debugMode: 'lldb',
			signal: controller.signal
		});
		const outcome = running.then(
			(value) => ({ value }),
			(error) => ({ error })
		);
		workers[0].onmessage({
			data: {
				lldbArtifact: {
					bytes: Uint8Array.of(0, 97, 115, 109),
					sources: [{ path: fixture.path, content: fixture.code }]
				}
			}
		});
		expect(sessions).toHaveLength(1);
		return { sandbox, controller, outcome };
	};

	it.each(['terminate', 'abort', 'dispose'] as const)(
		'preserves the original %s outcome when a stop listener terminates, reloads, and throws',
		async (action) => {
			const { sandbox, controller, outcome } = await start();
			const reason = new Error('original cancellation');
			let attemptedLoad: Promise<unknown> | undefined;
			const events = vi.fn((event: DebugSessionEvent) => {
				if (event.type !== 'stop') return;
				sandbox.terminate(new Error('reentrant cancellation'));
				attemptedLoad = sandbox.load(assets).catch((error) => error);
				throw new Error('stop listener failed');
			});
			sandbox.ondebug = events;
			if (action === 'terminate') sandbox.terminate(reason);
			else if (action === 'abort') controller.abort(reason);
			else await sandbox.dispose();
			if (action === 'dispose') {
				await expect(outcome).resolves.toMatchObject({
					error: { code: 'cancelled', phase: 'dispose' }
				});
			} else await expect(outcome).resolves.toEqual({ error: reason });
			await expect(attemptedLoad).resolves.toMatchObject({
				code: action === 'dispose' ? 'runtime-configuration' : 'busy'
			});
			expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'stop' });
			expect(sessions[0].disconnect).toHaveBeenCalledOnce();
			expect(workers).toHaveLength(1);
			expect(workers[0].terminate).toHaveBeenCalledOnce();
			if (action !== 'dispose') {
				await expect(sandbox.load(assets)).resolves.toBeUndefined();
				expect(workers).toHaveLength(2);
				const retry = sandbox.run(fixture.code, false);
				workers[1].onmessage({ data: { results: true } });
				await expect(retry).resolves.toBe(true);
			}
			await sandbox.dispose();
		}
	);

	it.each(['terminate', 'abort', 'dispose'] as const)(
		'preserves %s ownership when a stop listener disposes the sandbox',
		async (action) => {
			const { sandbox, controller, outcome } = await start();
			const reason = new Error('original cancellation before listener disposal');
			let reentrantDisposal: Promise<void> | undefined;
			let attemptedLoad: Promise<unknown> | undefined;
			const events = vi.fn((event: DebugSessionEvent) => {
				if (event.type !== 'stop') return;
				reentrantDisposal = sandbox.dispose();
				attemptedLoad = sandbox.load(assets).catch((error) => error);
				throw new Error('stop listener failed after disposal');
			});
			sandbox.ondebug = events;
			let outerDisposal: Promise<void> | undefined;
			if (action === 'terminate') sandbox.terminate(reason);
			else if (action === 'abort') controller.abort(reason);
			else outerDisposal = sandbox.dispose();
			if (action === 'dispose') {
				await expect(outcome).resolves.toMatchObject({
					error: { code: 'cancelled', phase: 'dispose' }
				});
				expect(reentrantDisposal).toBe(outerDisposal);
			} else await expect(outcome).resolves.toEqual({ error: reason });
			await expect(attemptedLoad).resolves.toMatchObject({ code: 'runtime-configuration' });
			expect(sandbox.dispose()).toBe(reentrantDisposal);
			await reentrantDisposal;
			expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'stop' });
			expect(sessions[0].disconnect).toHaveBeenCalledOnce();
			expect(workers).toHaveLength(1);
			expect(workers[0].terminate).toHaveBeenCalledOnce();
		}
	);

	it('clears caller state before retiring an idle compiler and preserves one disposal promise', async () => {
		const sandbox = new fixture.Constructor();
		sandbox.output = vi.fn();
		await sandbox.load(assets);
		sandbox.write('queued input\n');
		sandbox.eof();
		let snapshot: Record<string, unknown> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		let attemptedLoad: Promise<unknown> | undefined;
		workers[0].terminate.mockImplementationOnce(() => {
			snapshot = {
				worker: sandbox.worker,
				output: sandbox.output,
				pendingInput: [...sandbox.pendingInput],
				pendingEof: sandbox.pendingEof,
				waitingForInput: sandbox.waitingForInput,
				...(sandbox instanceof D
					? { moduleUrl: sandbox.moduleUrl }
					: { assetBridge: sandbox.assetBridge, activeVBaseUrl: sandbox.activeVBaseUrl })
			};
			reentrantDisposal = sandbox.dispose();
			attemptedLoad = sandbox.load(assets).catch((error) => error);
		});
		const disposal = sandbox.dispose();
		expect(disposal).toBe(reentrantDisposal);
		expect(sandbox.dispose()).toBe(disposal);
		await disposal;
		await expect(attemptedLoad).resolves.toMatchObject({ code: 'runtime-configuration' });
		expect(snapshot).toEqual({
			worker: undefined,
			output: fixture.language === 'D' ? null : undefined,
			pendingInput: [],
			pendingEof: false,
			waitingForInput: false,
			...(fixture.language === 'D'
				? { moduleUrl: '' }
				: { assetBridge: null, activeVBaseUrl: '' })
		});
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});
});
