import { describe, expect, it, vi } from 'vitest';
import { createContainerPlaygroundBinding } from './binding';
import type { ContainerWorkerClient } from './client';
import type { ContainerWorkerEvent } from './protocol';
function fixture() {
	let listener: (event: ContainerWorkerEvent) => void = () => {};
	const call = vi.fn(async (method: string) =>
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
		await binding.dispose();
		await binding.dispose();
		expect(client.dispose).toHaveBeenCalledTimes(1);
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
			{ cwd: '/workspace/PYTHON', env: { PS1: '\\w $ ' } }
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
});
