import { beforeEach, describe, expect, it, vi } from 'vitest';

const { commandRun, fromFile, importRuntimeModule, init, packageFree } = vi.hoisted(() => ({
	commandRun: vi.fn(),
	fromFile: vi.fn(),
	importRuntimeModule: vi.fn(),
	init: vi.fn(async () => {}),
	packageFree: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({ importRuntimeModule }));

import Bash from './bash';

function byteStream(text: string) {
	return new ReadableStream({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}

describe('Bash sandbox', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		importRuntimeModule.mockResolvedValue({ init, Wasmer: { fromFile } });
		fromFile.mockResolvedValue({ entrypoint: { run: commandRun }, free: packageFree });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109])))
		);
	});

	it('runs real Bash source with a script name, program args, stdin, and streamed output', async () => {
		const free = vi.fn();
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream('main=73 arg=demo\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);

		await sandbox.load('/assets', '', true, [], {}, { set: vi.fn() });
		await expect(
			sandbox.run(
				'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"',
				false,
				true,
				undefined,
				['demo'],
				{ activePath: 'script.sh', stdin: '68\n' }
			)
		).resolves.toBe(true);

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/assets/wasm-bash/bash.webc');
		expect(init).toHaveBeenCalledWith({
			sdkUrl: 'http://localhost:3000/assets/wasm-bash/sdk/index.mjs',
			workerUrl: 'http://localhost:3000/assets/wasm-bash/sdk/worker.mjs'
		});
		expect(importRuntimeModule).toHaveBeenCalledWith(
			'http://localhost:3000/assets/wasm-bash/sdk/index.mjs'
		);
		expect(fromFile).toHaveBeenCalledWith(expect.any(Uint8Array));
		expect(commandRun).toHaveBeenCalledWith({
			args: [
				'-c',
				'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"',
				'script.sh',
				'demo'
			],
			mount: {
				'/workspace': {
					'script.sh': 'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"'
				}
			},
			cwd: '/workspace',
			stdin: '68\n'
		});
		expect(output.join('')).toBe('main=73 arg=demo\n');
		expect(free).not.toHaveBeenCalled();
		expect(sandbox.stdinWriter).toBeNull();
	});

	it('connects write and eof to a running Bash stdin stream', async () => {
		const writes: Uint8Array[] = [];
		const close = vi.fn(async () => {});
		let finish: ((value: { ok: boolean; code: number }) => void) | undefined;
		const finished = new Promise<{ ok: boolean; code: number }>((resolve) => {
			finish = resolve;
		});
		const writer = {
			write: vi.fn(async (chunk: Uint8Array) => writes.push(chunk)),
			close,
			abort: vi.fn(async () => {})
		};
		commandRun.mockResolvedValue({
			stdin: { getWriter: () => writer },
			stdout: byteStream('typed\n'),
			stderr: byteStream(''),
			wait: vi.fn(() => finished),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load();

		const running = sandbox.run('read value; printf "%s\\n" "$value"', false);
		await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
		sandbox.write('typed\n');
		sandbox.eof();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		finish?.({ ok: true, code: 0 });
		await expect(running).resolves.toBe(true);

		expect(writes.map((chunk) => new TextDecoder().decode(chunk))).toEqual(['typed\n']);
		expect(close).toHaveBeenCalledOnce();
		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				mount: { '/workspace': { 'main.sh': 'read value; printf "%s\\n" "$value"' } },
				cwd: '/workspace'
			})
		);
		expect(commandRun.mock.calls[0]?.[0]).not.toHaveProperty('stdin');
	});

	it('mounts workspace files next to the active Bash script', async () => {
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream('helper\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load();

		await sandbox.run('source lib/helper.sh; helper', false, true, undefined, [], {
			activePath: 'scripts/main.sh',
			workspaceFiles: [{ path: 'lib/helper.sh', content: 'helper() { printf "helper\\n"; }' }]
		});

		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				mount: {
					'/workspace': {
						'lib/helper.sh': 'helper() { printf "helper\\n"; }',
						'scripts/main.sh': 'source lib/helper.sh; helper'
					}
				}
			})
		);
	});

	it('reports a non-zero Bash exit status after forwarding stderr', async () => {
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream(''),
			stderr: byteStream('main.sh: syntax error\n'),
			wait: vi.fn(async () => ({ ok: false, code: 2 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();

		await expect(sandbox.run('if', false)).rejects.toBe('Bash exited with status 2.');
		expect(output.join('')).toContain('syntax error');
	});
});
