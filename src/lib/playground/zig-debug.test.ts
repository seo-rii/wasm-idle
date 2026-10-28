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
		scopes = vi.fn(async () => []);
		frameScopes = vi.fn(async () => []);
		writeMemory = vi.fn(async () => ({ bytesWritten: 1 }));
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

	it.each(['frame', 'step', 'pause', 'resume', 'write', 'stop'] as const)(
		'invalidates formatted children and pending responses on %s',
		async (action) => {
			const sandbox = new Zig();
			await sandbox.load(assets);
			const outcome = sandbox
				.run(code, false, false, undefined, [], { debugMode: 'lldb' })
				.catch((error) => error);
			handoff();
			const session = sessions[0];
			const local = { name: 'maybe', type: '?i32', value: '?i32', variablesReference: 12 };
			session.variables.mockImplementation(async (reference: number) =>
				reference === 9
					? [local]
					: [
							{ name: 'payload', type: 'int', value: '7', variablesReference: 0 },
							{
								name: 'some',
								type: 'unsigned char',
								value: "'\\x01'",
								variablesReference: 0
							}
						]
			);
			expect((await sandbox.debugVariables(9))[0].value).toBe('some(7)');
			await sandbox.debugFrameScopes(7);
			expect((await sandbox.debugVariables(12)).map((field) => field.name)).toEqual([
				'payload'
			]);
			let release!: (values: unknown[]) => void;
			session.variables.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			);
			const pending = sandbox.debugVariables(9);
			if (action === 'frame') await sandbox.debugScopes(8);
			else if (action === 'step') sandbox.debugCommand('nextLine');
			else if (action === 'write')
				await sandbox.debugWriteMemory('0x100', 0, Uint8Array.of(0));
			else if (action === 'stop') await sandbox.dispose();
			else session.options.onDebugEvent({ type: action });
			release([local]);
			expect(await pending).toEqual([]);
			if (action !== 'stop') {
				// Memory writes retain the handle's layout, while a new stop/frame retires it.
				expect((await sandbox.debugVariables(12)).map((field) => field.name)).toEqual(
					action === 'write' ? ['payload'] : ['payload', 'some']
				);
				await sandbox.dispose();
			}
			await outcome;
		}
	);

	it('retires a formatter first created while a memory write was pending', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		const outcome = sandbox
			.run(code, false, false, undefined, [], { debugMode: 'lldb' })
			.catch((error) => error);
		handoff();
		const session = sessions[0];
		let finishWrite!: (result: unknown) => void;
		session.writeMemory.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishWrite = resolve;
				})
		);
		const writing = sandbox.debugWriteMemory('0x100', 0, Uint8Array.of(0));
		let finishRead!: (result: unknown[]) => void;
		session.variables.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishRead = resolve;
				})
		);
		const reading = sandbox.debugVariables(9);
		finishWrite({ bytesWritten: 1 });
		await writing;
		finishRead([{ name: 'result', value: '7' }]);
		expect(await reading).toEqual([]);
		await sandbox.dispose();
		await outcome;
	});

	it('refreshes existing slice pages and optional tags after a write in the same pause', async () => {
		const sandbox = new Zig();
		await sandbox.load(assets);
		const outcome = sandbox
			.run(code, false, false, undefined, [], { debugMode: 'lldb' })
			.catch((error) => error);
		handoff();
		const session = sessions[0];
		const bytes = new Uint8Array(96).fill(65);
		let some = "'\\x01'";
		session.variables.mockImplementation(
			async (reference: number, start = 0, count?: number) => {
				const variables =
					reference === 9
						? [
								{
									name: 'bytes',
									type: '[]u8',
									value: '[]u8',
									variablesReference: 12
								},
								{
									name: 'maybe',
									type: '?i32',
									value: '?i32',
									variablesReference: 13
								}
							]
						: reference === 12
							? [
									{
										name: 'ptr',
										type: 'unsigned char *',
										value: '0x100',
										variablesReference: 0
									},
									{
										name: 'len',
										type: 'unsigned int',
										value: '96',
										variablesReference: 0
									}
								]
							: [
									{
										name: 'payload',
										type: 'int',
										value: '7',
										variablesReference: 0
									},
									{
										name: 'some',
										type: 'unsigned char',
										value: some,
										variablesReference: 0
									}
								];
				return variables.slice(start, count === undefined ? undefined : start + count);
			}
		);
		session.readMemory = vi.fn(async (reference: string, _offset: number, count: number) => ({
			address: reference,
			data: bytes.slice(
				Number.parseInt(reference, 16) - 256,
				Number.parseInt(reference, 16) - 256 + count
			),
			unreadableBytes: 0
		}));
		session.writeMemory.mockImplementation(async () => {
			bytes[64] = 66;
			some = "'\\0'";
			return { bytesWritten: 1 };
		});
		const [slice, optional] = await sandbox.debugVariables(9);
		expect(slice.indexedVariables).toBe(96);
		expect(optional.value).toBe('some(7)');
		await sandbox.debugWriteMemory('0x140', 0, Uint8Array.of(66));
		// The caller retains these references: editing memory does not select a new frame.
		expect(
			(await sandbox.debugVariables(slice.variablesReference!, 66, 2)).map((value) => [
				value.name,
				value.value
			])
		).toEqual([
			['[64]', '66'],
			['[65]', '65']
		]);
		expect(await sandbox.debugVariables(optional.variablesReference!)).toEqual([]);
		await sandbox.dispose();
		await outcome;
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

	it.each(['terminate', 'abort', 'clear', 'dispose'] as const)(
		'cancels a restart waiting for debugger retirement through %s',
		async (action) => {
			const sandbox = new Zig();
			await sandbox.load(assets);
			const previous = sandbox.run(code, false, false, undefined, [], { debugMode: 'lldb' });
			const previousOutcome = previous.catch((error) => error);
			handoff();
			let finishCleanup!: () => void;
			const cleanup = new Promise<void>((resolve) => {
				finishCleanup = resolve;
			});
			sessions[0].disconnect.mockImplementation(() => {
				sessions[0].reject(new Error('disconnected'));
				return cleanup;
			});
			void sandbox.terminate('previous run');
			await previousOutcome;
			const controller = new AbortController();
			const next = sandbox.run(code, false, false, undefined, [], {
				signal: controller.signal
			});
			const outcome = next.then(
				(value) => ({ value }),
				(error) => ({ error })
			);
			const reason = new Error('cancel pending restart');
			if (action === 'terminate') void sandbox.terminate(reason);
			else if (action === 'abort') controller.abort(reason);
			else if (action === 'clear') await sandbox.clear();
			else void sandbox.dispose();
			expect(workers).toHaveLength(1);
			if (action === 'dispose') {
				await expect(outcome).resolves.toMatchObject({ error: { code: 'cancelled' } });
			} else {
				await expect(outcome).resolves.toEqual({
					error: action === 'clear' ? 'Process terminated' : reason
				});
			}
			finishCleanup();
			expect(workers).toHaveLength(1);
			expect(workers[0].postMessage).toHaveBeenCalledTimes(2);
			if (action !== 'dispose') {
				await expect(sandbox.run(code, false)).resolves.toBe(true);
				expect(workers).toHaveLength(2);
			}
			await sandbox.dispose();
		}
	);

	it('reserves startup ownership and its deadline while waiting for debugger retirement', async () => {
		vi.useFakeTimers();
		const sandbox = new Zig();
		await sandbox.load(assets);
		const previous = sandbox.run(code, false, false, undefined, [], { debugMode: 'lldb' });
		const previousOutcome = previous.catch((error) => error);
		handoff();
		let finishCleanup!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			finishCleanup = resolve;
		});
		sessions[0].disconnect.mockImplementation(() => {
			sessions[0].reject(new Error('disconnected'));
			return cleanup;
		});
		void sandbox.terminate('previous run');
		await previousOutcome;
		const pending = sandbox.run(code, false, false, undefined, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const outcome = pending.catch((error) => error);
		await expect(sandbox.run(code, false)).rejects.toMatchObject({ code: 'busy' });
		await expect(sandbox.load(assets)).rejects.toMatchObject({ code: 'busy' });
		await vi.advanceTimersByTimeAsync(5);
		await expect(outcome).resolves.toMatchObject({
			code: 'timeout',
			phase: 'startup',
			timeoutMs: 5
		});
		expect(workers).toHaveLength(1);
		finishCleanup();
		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(workers).toHaveLength(2);
		await sandbox.dispose();
	});

	it.each(['terminate', 'abort', 'dispose'] as const)(
		'preserves the original %s outcome when a stop listener terminates again and throws',
		async (action) => {
			const sandbox = new Zig();
			await sandbox.load(assets);
			const controller = new AbortController();
			const running = sandbox.run(code, false, false, undefined, [], {
				debugMode: 'lldb',
				signal: controller.signal
			});
			const outcome = running.catch((error) => error);
			handoff();
			const events = vi.fn((event) => {
				if (event.type !== 'stop') return;
				void sandbox.terminate(new Error('reentrant stop cancellation'));
				throw new Error('stop listener failed');
			});
			sandbox.ondebug = events;
			const reason = new Error('original cancellation');
			if (action === 'terminate') void sandbox.terminate(reason);
			else if (action === 'abort') controller.abort(reason);
			else await sandbox.dispose();
			if (action === 'dispose') {
				await expect(outcome).resolves.toMatchObject({
					code: 'cancelled',
					phase: 'dispose'
				});
			} else {
				await expect(outcome).resolves.toBe(reason);
				await expect(sandbox.run(code, false)).resolves.toBe(true);
			}
			expect(events).toHaveBeenCalledExactlyOnceWith({ type: 'stop' });
			expect(sessions[0].disconnect).toHaveBeenCalledOnce();
			await sandbox.dispose();
		}
	);
});
