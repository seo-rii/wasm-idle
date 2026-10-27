import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LldbSandboxSessionOptions } from './lldbSession';

const { workers, sessions } = vi.hoisted(() => ({ workers: [] as any[], sessions: [] as any[] }));

vi.mock('$lib/playground/worker/zig?worker', () => ({
	default: class {
		onmessage: ((event: any) => void) | null = null;
		onerror = null;
		onmessageerror = null;
		terminate = vi.fn();
		postMessage = vi.fn((message) => {
			if (message.load) queueMicrotask(() => this.onmessage?.({ data: { load: true } }));
			else if (message.prepare || message.debugMode === 'none')
				queueMicrotask(() => this.onmessage?.({ data: { results: true } }));
		});
		constructor() {
			workers.push(this);
		}
	}
}));

vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		resolve!: (value: true) => void;
		reject!: (error: unknown) => void;
		constructor(readonly options: LldbSandboxSessionOptions) {
			sessions.push(this);
		}
		start() {
			return new Promise<true>((resolve, reject) => {
				this.resolve = resolve;
				this.reject = reject;
			});
		}
		disconnect = vi.fn(async () => {
			this.reject(new Error('disconnected'));
		});
		write = vi.fn(async () => undefined);
		eof = vi.fn(async () => undefined);
		debugCommand = vi.fn();
		setBreakpoints = vi.fn();
		variables = vi.fn(async () => [{ name: 'result', value: '12' }]);
	}
}));

import Zig from './zig';

const assets = { rootUrl: '/runtime', zig: { compilerUrl: '/zig.wasm', stdlibUrl: '/lib.tar.gz' } };
const code = 'pub fn main() void {}';
const artifact = {
	bytes: Uint8Array.of(0, 97, 115, 109),
	sources: [{ path: '/workspace/src/solution.zig', content: code }]
};
const handoff = () => workers.at(-1).onmessage({ data: { lldbArtifact: artifact } });

describe('Zig LLDB lifecycle', () => {
	beforeEach(() => {
		workers.length = 0;
		sessions.length = 0;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('hands the real artifact to LLDB, preserves source breakpoints, and retires the compiler', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		const run = sandbox.run(code, false, false, undefined, ['arg'], {
			debugMode: 'lldb',
			activePath: 'src/solution.zig',
			stdin: '7\n',
			breakpoints: [3],
			sourceBreakpoints: [{ sourcePath: 'src/helper.zig', lines: [5] }]
		});
		const compilerHandler = workers[0].onmessage;
		expect(workers[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				debugMode: 'lldb',
				debugClangPath: expect.stringContaining('/runtime/clang/')
			})
		);
		handoff();
		expect(workers[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		compilerHandler({ data: { results: true, output: 'stale compiler output' } });
		await expect(sandbox.run(code, false)).rejects.toMatchObject({ code: 'busy' });
		expect(sessions[0].options).toMatchObject({
			artifact,
			sourcePath: '/workspace/src/solution.zig',
			entryFunctionName: 'solution.main',
			stdin: '7\n',
			programArgs: ['arg'],
			sourceBreakpoints: [
				{ sourcePath: '/workspace/src/helper.zig', lines: [5] },
				{ sourcePath: '/workspace/src/solution.zig', lines: [3] }
			]
		});
		sandbox.debugCommand('nextLine');
		expect(sessions[0].debugCommand).toHaveBeenCalledWith('nextLine');
		await expect(sandbox.debugVariables(9)).resolves.toEqual([{ name: 'result', value: '12' }]);
		sessions[0].resolve(true);
		await expect(run).resolves.toBe(true);
		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(workers).toHaveLength(2);
		await sandbox.dispose();
	});

	it('compiles prepare-only debug requests without starting a debug target', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		await expect(sandbox.run(code, true, false, undefined, [], { debug: true })).resolves.toBe(
			true
		);
		expect(sessions).toHaveLength(0);
		expect(workers[0].terminate).not.toHaveBeenCalled();
		await sandbox.dispose();
	});

	it('cancels a paused target with the exact reason and ignores stale debugger completion', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		const controller = new AbortController();
		const run = sandbox.run(code, false, false, undefined, [], {
			debugMode: 'lldb',
			signal: controller.signal
		});
		const reason = new Error('cancel Zig debug');
		const rejected = expect(run).rejects.toBe(reason);
		handoff();
		controller.abort(reason);
		await rejected;
		expect(sessions[0].disconnect).toHaveBeenCalledOnce();
		await expect(sandbox.run(code, false)).resolves.toBe(true);
		sessions[0].resolve(true);
		const debugEvents = vi.fn();
		sandbox.ondebug = debugEvents;
		sessions[0].options.onDebugEvent({ type: 'stop' });
		expect(debugEvents).not.toHaveBeenCalled();
		expect(workers[1].terminate).not.toHaveBeenCalled();
		await sandbox.dispose();
	});

	it('counts running time while allowing an unbounded pause', async () => {
		vi.useFakeTimers();
		const sandbox = new Zig();
		await sandbox.load(assets);
		const run = sandbox.run(code, false, false, undefined, [], {
			debugMode: 'lldb',
			limits: { compileTimeoutMs: 50, runTimeoutMs: 20 }
		});
		const rejected = expect(run).rejects.toMatchObject({ code: 'timeout', timeoutMs: 20 });
		handoff();
		await vi.advanceTimersByTimeAsync(5);
		sessions[0].options.onDebugEvent({ type: 'pause' } as never);
		await vi.advanceTimersByTimeAsync(500);
		expect(sessions[0].disconnect).not.toHaveBeenCalled();
		sessions[0].options.onDebugEvent({ type: 'resume', command: 'continue' });
		await vi.advanceTimersByTimeAsync(15);
		await rejected;
		expect(sessions[0].disconnect).toHaveBeenCalledOnce();
		await sandbox.dispose();
	});

	it('enforces cumulative debugger output limits and disconnects the target', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		const run = sandbox.run(code, false, false, undefined, [], {
			debugMode: 'lldb',
			limits: { maxOutputBytes: 3 }
		});
		const rejected = expect(run).rejects.toMatchObject({ code: 'output-limit' });
		handoff();
		sessions[0].options.onOutput('1234');
		await rejected;
		expect(sessions[0].disconnect).toHaveBeenCalledOnce();
		await sandbox.dispose();
	});

	it.each(['dispose', 'restart'] as const)(
		'waits for target Worker retirement before %s',
		async (action) => {
			const sandbox = new Zig();
			await sandbox.load(assets);
			const run = sandbox.run(code, false, false, undefined, [], { debugMode: 'lldb' });
			const cancelled = expect(run).rejects.toBeDefined();
			handoff();
			let finishCleanup!: () => void;
			const cleanup = new Promise<void>((resolve) => {
				finishCleanup = resolve;
			});
			sessions[0].disconnect.mockImplementation(() => {
				sessions[0].reject(new Error('disconnected'));
				return cleanup;
			});
			let finished = false;
			let pending: Promise<unknown>;
			if (action === 'dispose') pending = sandbox.dispose();
			else {
				void sandbox.terminate();
				pending = sandbox.run(code, false);
			}
			void pending.then(() => {
				finished = true;
			});
			await cancelled;
			await Promise.resolve();
			expect(finished).toBe(false);
			expect(workers).toHaveLength(1);
			finishCleanup();
			await pending;
			expect(finished).toBe(true);
			if (action === 'restart') expect(workers).toHaveLength(2);
			await sandbox.dispose();
		}
	);
});
