import { describe, expect, it, vi } from 'vitest';
import { createContainerPlaygroundBinding } from './binding.js';
import { createContainerWorkerClient, type ContainerWorkerClient } from './client.js';
import type { ContainerWorkerEvent } from './protocol.js';
function fixture() {
	let listener: (event: ContainerWorkerEvent) => void = () => {};
	const call = vi.fn(async (method: string): Promise<unknown> =>
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
	it('clones queued file bytes and sends previous published bytes as conflict precondition', async () => {
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
