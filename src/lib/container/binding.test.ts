import { describe, expect, it, vi } from 'vitest';
import { createContainerPlaygroundBinding } from './binding.js';
import { createContainerWorkerClient, type ContainerWorkerClient } from './client.js';
import type { ContainerWorkerEvent } from './protocol.js';
function prewarmFixture(canStart = true) {
	const scheduled: (() => void)[] = [];
	const environment = {
		canStart: vi.fn(() => canStart),
		schedule: vi.fn((callback: () => void) => {
			scheduled.push(callback);
			return () => scheduled.splice(scheduled.indexOf(callback) >>> 0, 1);
		})
	};
	const calls: { method: string; args?: unknown[]; signal?: AbortSignal }[] = [];
	const gates: (() => void)[] = [];
	const client = {
		call: vi.fn(
			async (method: string, args?: unknown[], options?: { signal?: AbortSignal }) => {
				calls.push({ method, args, signal: options?.signal });
				if (method !== 'prewarm') return undefined;
				await new Promise<void>((resolve) => gates.push(resolve));
				return true;
			}
		),
		onEvent: () => () => {},
		dispose: vi.fn(async () => {})
	} as unknown as ContainerWorkerClient;
	const factory = vi.fn(() => client);
	const binding = createContainerPlaygroundBinding('/runtime/', {
		applicationRootURL: 'https://example.test/sandbox/',
		workspaceId: 'prewarm',
		clientFactory: factory,
		prewarmEnvironment: environment
	});
	const runScheduled = () => scheduled.splice(0).forEach((callback) => callback());
	const settle = async () => {
		for (let i = 0; i < 4; i++) await Promise.resolve();
	};
	return { binding, environment, calls, gates, factory, runScheduled, settle };
}
function fixture() {
	let listener: (event: ContainerWorkerEvent) => void = () => {};
	const call = vi.fn(
		async (method: string, _args?: unknown[], _options?: unknown): Promise<unknown> =>
			method === 'prepare' || method === 'run' ? true : undefined
	);
	const client = {
		call,
		onEvent: (sink: typeof listener) => {
			listener = sink;
			return () => {};
		},
		dispose: vi.fn(async () => {})
	} as unknown as ContainerWorkerClient;
	const binding = createContainerPlaygroundBinding('/wasm-idle/', {
		applicationRootURL: 'https://example.test/wasm-idle/',
		workspaceId: 'unit',
		getLanguage: () => 'C',
		clientFactory: () => client
	});
	return { binding, call, client, event: (event: ContainerWorkerEvent) => listener(event) };
}
describe('existing playground container binding', () => {
	it('forwards structured debugger requests through the owner without flattening metadata', async () => {
		const { binding, call } = fixture();
		const value = {
			result: 'size=3',
			variablesReference: 42,
			indexedVariables: 3,
			type: 'std::vector<int>'
		};
		call.mockImplementation(async (method: string) =>
			method === 'debugEvaluateValue' ? value : undefined
		);
		const sandbox = await binding.load('CPP');
		expect(
			await sandbox.debugEvaluateValue?.('items', { context: 'hover', frameId: 7 })
		).toEqual(value);
		await sandbox.setSourceBreakpoints?.(
			[{ line: 9, hitCondition: '3' }],
			'/workspace/main.cpp'
		);
		await sandbox.debugSetSteppingOptions?.({ skipLibraryCode: true });
		expect(call.mock.calls).toEqual([
			[
				'debugEvaluateValue',
				['CPP', 'items', { context: 'hover', frameId: 7 }],
				{ signal: undefined, progress: undefined }
			],
			[
				'setSourceBreakpoints',
				['CPP', [{ line: 9, hitCondition: '3' }], '/workspace/main.cpp'],
				{ signal: undefined, progress: undefined }
			],
			[
				'debugSetSteppingOptions',
				['CPP', { skipLibraryCode: true }],
				{ signal: undefined, progress: undefined }
			]
		]);
		await binding.dispose?.();
	});

	it('does not create an owner for an unused facade or a language selection', async () => {
		const factory = vi.fn();
		const binding = createContainerPlaygroundBinding('/runtime/', {
			applicationRootURL: 'https://example.test/sandbox/',
			workspaceId: 'unused',
			clientFactory: factory
		});
		await binding.setShellDirectory('PYTHON3');
		await binding.load('PYTHON3');
		await binding.dispose();
		expect(factory).not.toHaveBeenCalled();
	});
	it('cannot start a queued workspace operation after its panel is disposed', async () => {
		const factory = vi.fn();
		const binding = createContainerPlaygroundBinding('/runtime/', {
			applicationRootURL: 'https://example.test/sandbox/',
			workspaceId: 'leaving',
			clientFactory: factory
		});
		const publishing = binding.syncWorkspace('PYTHON3', [
			{ path: 'main.py', content: 'print(1)' }
		]);
		const rejected = expect(publishing).rejects.toThrow('disposed');
		await binding.dispose();
		await rejected;
		expect(factory).not.toHaveBeenCalled();
	});
	it('retires its real transport while the first workspace publish is awaiting initialization', async () => {
		vi.useFakeTimers();
		try {
			const worker = Object.assign(new EventTarget(), {
				postMessage: vi.fn(),
				terminate: vi.fn()
			});
			const binding = createContainerPlaygroundBinding('/runtime/', {
				applicationRootURL: 'https://example.test/sandbox/',
				workspaceId: 'leaving-during-init',
				clientFactory: () =>
					createContainerWorkerClient({
						runtimeAssets: '/runtime/',
						applicationRootURL: 'https://example.test/sandbox/',
						workspaceId: 'leaving-during-init',
						workerFactory: () => worker,
						cleanupDeadlineMs: 20
					})
			});
			const publishing = binding.syncWorkspace('PYTHON3', [
				{ path: 'main.py', content: 'print(1)' }
			]);
			const rejected = expect(publishing).rejects.toThrow('disposal deadline expired');
			await vi.advanceTimersByTimeAsync(0);
			expect(worker.postMessage).toHaveBeenCalledTimes(1);
			const disposal = binding.dispose();
			await vi.advanceTimersByTimeAsync(20);
			await Promise.all([disposal, rejected]);
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
	it('keeps prepare, execute, stdin and debugger commands on one owner connection', async () => {
		const { binding, call, client } = fixture();
		await binding.syncWorkspace('C', [{ path: 'main.c', content: 'int main(){}' }]);
		const sandbox = await binding.load('C');
		await sandbox.load('int main(){}');
		await sandbox.run('int main(){}', true);
		await sandbox.run('int main(){}', false);
		await sandbox.debugCommand?.('continue');
		expect(call.mock.calls.map((row) => row[0])).toEqual([
			'syncWorkspace',
			'load',
			'prepare',
			'run',
			'debugCommand'
		]);
		await binding.dispose?.();
		await binding.dispose?.();
		expect(client.dispose).toHaveBeenCalledTimes(1);
	});
	it('lets terminal cleanup overlap owner disposal while preserving cleanup failures on a live owner', async () => {
		const { binding, call } = fixture();
		const sandbox = await binding.load('C');
		await binding.inspect();
		call.mockRejectedValueOnce(new Error('Live shell cleanup failed'));
		await expect(binding.shell.dispose()).rejects.toThrow('Live shell cleanup failed');
		call.mockRejectedValueOnce(new Error('Live sandbox cleanup failed'));
		await expect(sandbox.clear()).rejects.toThrow('Live sandbox cleanup failed');
		const failures: Array<(error: Error) => void> = [];
		call.mockImplementation(
			() =>
				new Promise((_, reject) => {
					failures.push(reject);
				})
		);
		const shellCleanup = binding.shell.dispose();
		const sandboxCleanup = sandbox.dispose!();
		const clear = sandbox.clear();
		const cleanups = Promise.all([shellCleanup, sandboxCleanup, clear]);
		await binding.dispose();
		for (const reject of failures) reject(new Error('Container owner has been disposed'));
		await expect(cleanups).resolves.toEqual([undefined, undefined, undefined]);
		await expect(sandbox.clear()).resolves.toBeUndefined();
	});
	it('clones queued bytes and sends only changed files with their conflict precondition', async () => {
		const { binding, call } = fixture();
		const content = Uint8Array.of(0, 255, 1);
		const first = binding.syncWorkspace('C', [{ path: 'binary.bin', content }]);
		content[1] = 9;
		await first;
		await binding.syncWorkspace('C', [{ path: 'binary.bin', content: Uint8Array.of(0, 8, 1) }]);
		expect((call.mock.calls[0] as unknown[])[1]).toEqual([
			'C',
			[{ path: 'binary.bin', content: Uint8Array.of(0, 255, 1) }],
			undefined
		]);
		expect(((call.mock.calls[1] as unknown[])[1] as unknown[])[2]).toEqual([
			{ path: 'binary.bin', content: Uint8Array.of(0, 255, 1) }
		]);
		expect(call.mock.calls[1][0]).toBe('syncWorkspaceDelta');
	});
	it('omits unchanged binary bodies from an edit and an explicit deletion', async () => {
		const { binding, call } = fixture();
		const large = { path: 'data.bin', content: new Uint8Array(1024 * 1024) };
		await binding.syncWorkspace('C', [
			large,
			{ path: 'main.c', content: 'before' },
			{ path: 'old', content: 'delete' }
		]);
		await binding.syncWorkspace('C', [large, { path: 'main.c', content: 'after' }]);
		expect(call.mock.calls[1]).toEqual([
			'syncWorkspaceDelta',
			[
				'C',
				[{ path: 'main.c', content: 'after' }],
				[
					{ path: 'main.c', content: 'before' },
					{ path: 'old', content: 'delete' }
				],
				[
					{ path: 'data.bin', bytes: 1024 * 1024 },
					{ path: 'main.c', bytes: 5 }
				]
			]
		]);
		await binding.syncWorkspace('C', [large, { path: 'main.c', content: 'after' }]);
		expect(call).toHaveBeenCalledTimes(2);
	});
	it('keeps the published baseline after a failed delta', async () => {
		const { binding, call } = fixture();
		await binding.syncWorkspace('C', [{ path: 'main.c', content: 'base' }]);
		call.mockRejectedValueOnce(new Error('conflict'));
		await expect(
			binding.syncWorkspace('C', [{ path: 'main.c', content: 'edit' }])
		).rejects.toThrow('conflict');
		await binding.syncWorkspace('C', [{ path: 'main.c', content: 'edit' }]);
		expect(((call.mock.calls[2] as unknown[])[1] as unknown[])[2]).toEqual([
			{ path: 'main.c', content: 'base' }
		]);
	});
	it('rebuilds read results from deltas without exposing cached byte ownership', async () => {
		const { binding, call } = fixture();
		call.mockResolvedValueOnce({
			revision: 1,
			reset: true,
			files: [{ path: 'data', content: Uint8Array.of(1, 2) }],
			deleted: []
		});
		const first = await binding.readWorkspace('C');
		(first[0].content as Uint8Array)[0] = 9;
		call.mockResolvedValueOnce({
			revision: 2,
			reset: false,
			files: [{ path: 'added', content: Uint8Array.of(3) }],
			deleted: []
		});
		expect(await binding.readWorkspace('C')).toEqual([
			{ path: 'added', content: Uint8Array.of(3) },
			{ path: 'data', content: Uint8Array.of(1, 2) }
		]);
		call.mockResolvedValueOnce({ revision: 3, reset: false, files: [], deleted: ['data'] });
		expect(await binding.readWorkspace('C')).toEqual([
			{ path: 'added', content: Uint8Array.of(3) }
		]);
		expect(call.mock.calls.map((row) => row[1])).toEqual([
			['C', undefined],
			['C', 1],
			['C', 2]
		]);
	});
	it('rejects a pending read completed after disposal instead of repopulating its mirror', async () => {
		const { binding, call } = fixture();
		let complete!: (value: unknown) => void;
		call.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const reading = binding.readWorkspace('C');
		const failure = expect(reading).rejects.toThrow('disposed');
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
		await binding.dispose?.();
		complete({
			revision: 1,
			reset: true,
			files: [{ path: 'data', content: Uint8Array.of(1) }],
			deleted: []
		});
		await failure;
	});
	it('serializes overlapping reads so each delta follows the acknowledged cursor', async () => {
		const { binding, call } = fixture();
		let complete!: (value: unknown) => void;
		call.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const first = binding.readWorkspace('C');
		const second = binding.readWorkspace('C');
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
		call.mockResolvedValueOnce({ revision: 2, reset: false, files: [], deleted: ['first'] });
		complete({
			revision: 1,
			reset: true,
			files: [{ path: 'first', content: Uint8Array.of(1) }],
			deleted: []
		});
		expect(await first).toEqual([{ path: 'first', content: Uint8Array.of(1) }]);
		expect(await second).toEqual([]);
		expect(call.mock.calls[1]).toEqual(['readWorkspaceDelta', ['C', 1]]);
	});
	it('does not let a later publish overtake an in-flight workspace read', async () => {
		const { binding, call } = fixture();
		const original = [{ path: 'main.c', content: 'base' }];
		await binding.syncWorkspace('C', original);
		let complete!: (value: unknown) => void;
		call.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
		const reading = binding.readWorkspace('C');
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
		const publishing = binding.syncWorkspace('C', [{ path: 'main.c', content: 'edit' }]);
		// Drain the promise continuations without resolving the remote read.
		for (let index = 0; index < 8; index++) await Promise.resolve();
		const methodsBeforeReadCompleted = call.mock.calls.map(([method]) => method);
		complete({ revision: 1, reset: true, files: original, deleted: [] });
		await Promise.all([reading, publishing]);
		expect(methodsBeforeReadCompleted).toEqual(['syncWorkspace', 'readWorkspaceDelta']);
		expect(call.mock.calls.at(-1)?.[0]).toBe('syncWorkspaceDelta');
	});
	it('pairs reconciliation with the baseline after earlier queued publishes', async () => {
		const { binding, call } = fixture();
		const original = [{ path: 'main.c', content: 'base' }];
		const edited = [{ path: 'main.c', content: 'first edit' }];
		await binding.syncWorkspace('C', original);
		let complete!: () => void;
		call.mockImplementationOnce(() => new Promise<void>((resolve) => (complete = resolve)));
		const publishing = binding.syncWorkspace('C', edited);
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
		call.mockResolvedValueOnce({ revision: 1, reset: true, files: edited, deleted: [] });
		const reconcile = vi.fn(() => true);
		const refreshing = binding.reconcileWorkspace('C', reconcile);
		complete();
		await publishing;
		expect(await refreshing).toBe(true);
		expect(reconcile).toHaveBeenCalledExactlyOnceWith(edited, edited);
	});
	it('retries before accepting terminal additions when a later editor snapshot is queued', async () => {
		const { binding, call } = fixture();
		const original = [{ path: 'main.c', content: 'base' }];
		const edited = [{ path: 'main.c', content: 'edit' }];
		const terminalFile = { path: 'terminal.txt', content: 'must survive' };
		await binding.syncWorkspace('C', original);
		let complete!: (value: unknown) => void;
		call.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
		const reconcile = vi.fn(() => true);
		const refreshing = binding.reconcileWorkspace('C', reconcile);
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
		// This snapshot predates the terminal addition. Accepting that addition first
		// would make the queued snapshot look like an intentional deletion.
		const publishing = binding.syncWorkspace('C', edited);
		complete({ revision: 1, reset: true, files: [...original, terminalFile], deleted: [] });
		expect(await refreshing).toBe(false);
		await publishing;
		expect(reconcile).not.toHaveBeenCalled();
		expect(call.mock.calls[2]).toEqual([
			'syncWorkspaceDelta',
			['C', edited, original, [{ path: 'main.c', bytes: 4 }]]
		]);
		// The next read retains its acknowledged cursor and accepts the terminal file.
		call.mockResolvedValueOnce({ revision: 2, reset: false, files: edited, deleted: [] });
		expect(await binding.reconcileWorkspace('C', reconcile)).toBe(true);
		expect(reconcile).toHaveBeenCalledExactlyOnceWith(edited, [...edited, terminalFile]);
		expect(binding.publishedWorkspace('C')).toEqual([...edited, terminalFile]);
		await binding.syncWorkspace('C', [{ path: 'main.c', content: 'new edit' }, terminalFile]);
		expect(call.mock.calls[4]?.[1]).toEqual([
			'C',
			[{ path: 'main.c', content: 'new edit' }],
			edited,
			[
				{ path: 'main.c', bytes: 8 },
				{ path: 'terminal.txt', bytes: 12 }
			]
		]);
	});
	it('keeps a declined reconciliation baseline and recovers after read or callback errors', async () => {
		const { binding, call } = fixture();
		const original = [{ path: 'main.c', content: 'base' }];
		const remote = [{ path: 'main.c', content: 'terminal' }];
		await binding.syncWorkspace('C', original);
		call.mockRejectedValueOnce(new Error('read failed'));
		await expect(binding.reconcileWorkspace('C', () => true)).rejects.toThrow('read failed');
		call.mockResolvedValueOnce({ revision: 1, reset: true, files: remote, deleted: [] });
		await expect(
			binding.reconcileWorkspace('C', () => {
				throw new Error('reconciliation failed');
			})
		).rejects.toThrow('reconciliation failed');
		expect(binding.publishedWorkspace('C')).toEqual(original);
		call.mockResolvedValueOnce({ revision: 2, reset: false, files: [], deleted: [] });
		expect(await binding.reconcileWorkspace('C', () => false)).toBe(true);
		expect(binding.publishedWorkspace('C')).toEqual(original);
		const edited = [{ path: 'main.c', content: 'edit' }];
		await binding.syncWorkspace('C', edited);
		expect(binding.publishedWorkspace('C')).toEqual(edited);
	});
	it('retains a real terminal edit when a queued conflicting publish fails', async () => {
		const { binding, call } = fixture();
		const original = [{ path: 'main.c', content: 'base' }];
		const remote = [{ path: 'main.c', content: 'terminal' }];
		await binding.syncWorkspace('C', original);
		let complete!: (value: unknown) => void;
		call.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
		const reconcile = vi.fn(() => false);
		const refreshing = binding.reconcileWorkspace('C', reconcile);
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
		call.mockRejectedValueOnce(new Error('Workspace changed while editing main.c'));
		const failure = expect(
			binding.syncWorkspace('C', [{ path: 'main.c', content: 'editor' }])
		).rejects.toThrow('Workspace changed while editing main.c');
		complete({ revision: 1, reset: true, files: remote, deleted: [] });
		expect(await refreshing).toBe(false);
		await failure;
		expect(reconcile).not.toHaveBeenCalled();
		call.mockResolvedValueOnce({ revision: 2, reset: false, files: [], deleted: [] });
		expect(await binding.reconcileWorkspace('C', reconcile)).toBe(true);
		expect(reconcile).toHaveBeenCalledExactlyOnceWith(original, remote);
		expect(binding.publishedWorkspace('C')).toEqual(original);
	});
	it('routes program bytes/debug events separately from shell and watcher events', async () => {
		const { binding, event } = fixture();
		const sandbox = await binding.load('C');
		const output = vi.fn(),
			debug = vi.fn(),
			shell = vi.fn(),
			watch = vi.fn();
		sandbox.output = output;
		sandbox.ondebug = debug;
		binding.onWorkspaceChange(watch);
		await binding.shell.connect(shell);
		event({ name: 'output', language: 'C', data: Uint8Array.of(65) });
		event({ name: 'debug', language: 'C', data: { type: 'pause' } });
		event({ name: 'shell-output', data: { stream: 'stdout', bytes: Uint8Array.of(66) } });
		event({ name: 'workspace', data: { path: '/workspace/C/main.c' } });
		expect(output).toHaveBeenCalledExactlyOnceWith('A');
		expect(debug).toHaveBeenCalledExactlyOnceWith({ type: 'pause' });
		expect(shell).toHaveBeenCalledExactlyOnceWith('B');
		expect(watch).toHaveBeenCalledTimes(1);
	});
	it('starts Bash in the selected language without starting a temporary default session', async () => {
		const { binding, call } = fixture();
		await binding.setShellDirectory('PYTHON');
		expect(call).not.toHaveBeenCalled();
		await binding.shell.connect(() => {});
		expect(call).toHaveBeenCalledExactlyOnceWith('shellStart', [
			{ cwd: '/workspace/PYTHON', env: { PS1: '\\[\\e[1;34m\\]\\w\\[\\e[0m\\] $ ' } }
		]);
	});

	it('requests a directory change through the control channel after shell startup', async () => {
		const { binding, call } = fixture();
		let started!: () => void;
		call.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					started = resolve;
				})
		);
		const connecting = binding.shell.connect(() => {});
		await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
		const switching = binding.setShellDirectory('PYTHON');
		expect(call).toHaveBeenCalledOnce();
		started();
		await Promise.all([connecting, switching]);
		expect(call.mock.calls.map((row) => row[0])).toEqual(['shellStart', 'shellSetDirectory']);
		expect((call.mock.calls[1] as unknown[])[1]).toEqual(['PYTHON']);
		expect(call.mock.calls.some((row) => row[0] === 'shellWrite')).toBe(false);
	});

	it('passes an AbortSignal through the transport cancellation contract', async () => {
		const { binding, call } = fixture();
		const sandbox = await binding.load('C');
		const signal = new AbortController().signal;
		await sandbox.run('code', false, false, undefined, [], { signal });
		expect((call.mock.calls[0] as unknown[])[2]).toMatchObject({ signal });
	});

	it('hands the shared terminal back after success and never resumes a failed claim', async () => {
		const { binding, call } = fixture();
		const sandbox = await binding.load('C');
		await binding.shell.connect(() => {});
		await binding.beginTerminalExecution();
		await binding.beginTerminalExecution();
		await sandbox.run('source', false);
		await binding.endTerminalExecution();
		await binding.endTerminalExecution();
		call.mockRejectedValueOnce(new Error('Execution failed'));
		await expect(
			(async () => {
				await binding.beginTerminalExecution();
				try {
					await sandbox.run('source', false);
				} finally {
					await binding.endTerminalExecution();
				}
			})()
		).rejects.toThrow('Execution failed');
		// The failed suspend cannot claim stdin or cause a later unpaired resume.
		await binding.endTerminalExecution();
		expect(call.mock.calls.map((row) => row[0])).toEqual([
			'shellStart',
			'shellSuspend',
			'run',
			'shellResume',
			'shellSuspend'
		]);
	});

	it('restores the shell after runtime failures or Stop without injecting terminal input', async () => {
		const { binding, call } = fixture();
		const sandbox = await binding.load('C');
		await binding.shell.connect(() => {});
		await binding.beginTerminalExecution();
		call.mockRejectedValueOnce(new Error('Runtime operation cancelled'));
		try {
			await expect(sandbox.run('source', false)).rejects.toThrow('cancelled');
			await sandbox.kill?.();
		} finally {
			await binding.endTerminalExecution();
		}
		expect(call.mock.calls.map((row) => row[0])).toEqual([
			'shellStart',
			'shellSuspend',
			'run',
			'stop',
			'shellResume'
		]);
		expect(call.mock.calls.some((row) => ['shellWrite', 'write'].includes(row[0]))).toBe(false);
	});

	it('keeps batch execution independent from an unused or unavailable shell and skips redraw after disposal', async () => {
		const { binding, call } = fixture();
		await binding.beginTerminalExecution();
		await binding.endTerminalExecution();
		expect(call).not.toHaveBeenCalled();
		call.mockRejectedValueOnce(new Error('Shell unavailable'));
		await expect(binding.shell.connect(() => {})).rejects.toThrow('unavailable');
		await binding.beginTerminalExecution();
		await binding.endTerminalExecution();
		expect(call).toHaveBeenCalledOnce();
		const live = fixture();
		await live.binding.shell.connect(() => {});
		await live.binding.beginTerminalExecution();
		await live.binding.dispose();
		await live.binding.endTerminalExecution();
		expect(live.call.mock.calls.map((row) => row[0])).toEqual(['shellStart', 'shellSuspend']);
	});

	it('prewarms the selected runtime in the owner once the page is idle', async () => {
		const f = prewarmFixture();
		const result = f.binding.prewarm?.('PYTHON3');
		expect(f.factory).toHaveBeenCalledOnce();
		expect(f.calls).toEqual([]);
		f.runScheduled();
		await f.settle();
		expect(f.calls.map(({ method, args }) => [method, args])).toEqual([
			['prewarm', ['PYTHON3']]
		]);
		f.gates.shift()?.();
		await expect(result).resolves.toBe(true);
		await f.binding.dispose();
	});

	it('honors the toggle and the data-saving environment, while still booting the owner', async () => {
		const saving = prewarmFixture(false);
		await expect(saving.binding.prewarm?.('CPP')).resolves.toBe(false);
		expect(saving.factory).toHaveBeenCalledOnce();
		expect(saving.environment.schedule).not.toHaveBeenCalled();
		const off = prewarmFixture();
		await off.binding.setPrewarmEnabled?.(false);
		await expect(off.binding.prewarm?.('CPP')).resolves.toBe(false);
		expect(off.environment.schedule).not.toHaveBeenCalled();
		await expect(off.binding.setPrewarmEnabled?.('yes' as never)).rejects.toThrow(TypeError);
		await Promise.all([saving.binding.dispose(), off.binding.dispose()]);
	});

	it('keeps a warm-up across an effect re-run but cancels it for another language or the toggle', async () => {
		const f = prewarmFixture();
		const first = f.binding.prewarm?.('CPP');
		f.runScheduled();
		await f.settle();
		const signal = f.calls[0]!.signal!;
		// Svelte cleans up and re-runs the effect in one task.
		await f.binding.cancelPrewarm?.();
		const again = f.binding.prewarm?.('CPP');
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(signal.aborted).toBe(false);
		expect(f.calls).toHaveLength(1);
		const other = f.binding.prewarm?.('PYTHON3');
		expect(signal.aborted).toBe(true);
		await expect(first).resolves.toBe(false);
		await expect(again).resolves.toBe(false);
		await f.binding.cancelPrewarm?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
		await expect(other).resolves.toBe(false);
		expect(f.calls).toHaveLength(1);
		const scheduled = f.binding.prewarm?.('JAVA');
		f.runScheduled();
		await f.settle();
		await f.binding.setPrewarmEnabled?.(false);
		expect(f.calls[1]!.signal!.aborted).toBe(true);
		await expect(scheduled).resolves.toBe(false);
		await f.binding.dispose();
	});
});
