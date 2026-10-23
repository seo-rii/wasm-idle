import { describe, expect, it, vi } from 'vitest';
import { createContainerPlaygroundBinding } from './binding.js';
import { createContainerWorkerClient, type ContainerWorkerClient } from './client.js';
import type { ContainerWorkerEvent } from './protocol.js';
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
});
