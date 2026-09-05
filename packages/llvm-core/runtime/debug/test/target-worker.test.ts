import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedByteQueue, createSharedByteQueue } from '../src/shared-byte-queue.js';
import type { TargetWorkerInitializeMessage } from '../src/types.js';
const validWasmModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

const workerMocks = vi.hoisted(() => ({
	callMain: vi.fn(),
	chdir: vi.fn(),
	closeRspInput: vi.fn(),
	closeRspOutput: vi.fn(),
	stdinStream: {
		stream_ops: {
			read: (
				_stream: unknown,
				_buffer: Uint8Array | Int8Array,
				_offset: number,
				_length: number
			) => 0
		}
	},
	lifecycle: 'exit' as 'exit' | 'abort' | 'pending',
	loadFailure: undefined as Error | undefined,
	loadGate: undefined as Promise<void> | undefined,
	revokeAssets: vi.fn(),
	loadEmscriptenModuleFactory: vi.fn(async () => {
		if (workerMocks.loadGate) await workerMocks.loadGate;
		if (workerMocks.loadFailure) {
			const failure = workerMocks.loadFailure;
			workerMocks.loadFailure = undefined;
			throw failure;
		}
		return async (options: Record<string, unknown>) => ({
			FS: {
				mkdirTree: vi.fn(),
				writeFile: vi.fn(),
				chdir: workerMocks.chdir,
				getStream: (fd: number) => (fd === 0 ? workerMocks.stdinStream : undefined)
			},
			HEAPU8: new Uint8Array(256),
			callMain: (args: string[]) => {
				workerMocks.callMain(args);
				if (workerMocks.lifecycle === 'pending') return 0;
				queueMicrotask(() => {
					if (workerMocks.lifecycle === 'abort') {
						(options.onAbort as (reason: unknown) => void)('runtime crash');
						(options.onExit as (exitCode: unknown) => void)(undefined);
					} else {
						(options.onExit as (exitCode: unknown) => void)(0);
					}
				});
				return 0;
			}
		});
	}),
	mountDebugFiles: vi.fn(),
	postWorkerError: vi.fn(),
	postWorkerMessage: vi.fn()
}));

vi.mock('../src/worker/module-loader.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/worker/module-loader.js')>()),
	createTransportBindings: vi.fn((options: TargetWorkerInitializeMessage) => ({
		rspInput: {
			descriptor: options.rspInput,
			closed: false,
			close: workerMocks.closeRspInput
		},
		rspOutput: {
			descriptor: options.rspOutput,
			closed: false,
			close: workerMocks.closeRspOutput
		}
	})),
	createEmscriptenAssetUrls: vi.fn(() => ({
		js: 'blob:target-js',
		wasm: 'blob:target-wasm',
		worker: 'blob:target-worker',
		revoke: workerMocks.revokeAssets
	})),
	loadEmscriptenModuleFactory: workerMocks.loadEmscriptenModuleFactory,
	mountDebugFiles: workerMocks.mountDebugFiles,
	postWorkerError: workerMocks.postWorkerError,
	postWorkerMessage: workerMocks.postWorkerMessage,
	startLinearMemoryTelemetry: vi.fn(
		(module: { HEAPU8?: Uint8Array }, worker: 'target', generation: string) => {
			workerMocks.postWorkerMessage({
				type: 'memory',
				worker,
				bytes: module.HEAPU8?.buffer.byteLength ?? 0,
				generation
			});
			return vi.fn();
		}
	)
}));

function initializeMessage(generation: string): TargetWorkerInitializeMessage {
	return {
		type: 'initialize-target',
		generation,
		module: validWasmModule.slice(),
		args: ['first', 'second'],
		env: {
			MODE: 'debug',
			EMPTY: ''
		},
		cwd: '/workspace',
		workspaceFiles: [
			{
				path: '/workspace/data/input.txt',
				content: '73\n'
			}
		],
		rspInput: createSharedByteQueue(4096, 1),
		rspOutput: createSharedByteQueue(4096, 1),
		stdout: createSharedByteQueue(4096, 1),
		stderr: createSharedByteQueue(4096, 1),
		stdin: createSharedByteQueue(4096, 1),
		assets: {
			js: new TextEncoder().encode('export default function wamr() {}').buffer,
			wasm: Uint8Array.of(0, 97, 115, 109).buffer,
			worker: new TextEncoder().encode('export default function pthread() {}').buffer
		}
	};
}

async function loadTargetWorker() {
	vi.resetModules();
	return import('../src/worker/target-worker.js');
}

describe('WAMR target worker launch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		workerMocks.lifecycle = 'exit';
		workerMocks.loadFailure = undefined;
		workerMocks.loadGate = undefined;
		workerMocks.stdinStream.stream_ops.read = () => 0;
	});

	it('returns each available stdin chunk without EOF and preserves the next read', async () => {
		workerMocks.lifecycle = 'pending';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-streaming-stdin');
		const stdin = new SharedByteQueue(message.stdin!);
		handleTargetWorkerMessage(message);
		await vi.waitFor(() => expect(workerMocks.callMain).toHaveBeenCalledOnce());
		const stream = workerMocks.stdinStream;
		const buffer = new Uint8Array(1030).fill(0xff);
		try {
			stdin.tryWrite(new TextEncoder().encode('35\n'));
			expect(stream.stream_ops.read(stream, buffer, 3, 1024)).toBe(3);
			expect(Array.from(buffer.subarray(2, 7))).toEqual([0xff, 51, 53, 10, 0xff]);
			expect(stdin.closed).toBe(false);
			expect(stdin.available).toBe(0);

			stdin.tryWrite(new TextEncoder().encode('38\n'));
			expect(stream.stream_ops.read(stream, buffer, 0, 1)).toBe(1);
			expect(buffer[0]).toBe(51);
			expect(stream.stream_ops.read(stream, buffer, 1, 1024)).toBe(2);
			expect(new TextDecoder().decode(buffer.subarray(0, 3))).toBe('38\n');
			expect(stdin.closed).toBe(false);
		} finally {
			handleTargetWorkerMessage({ type: 'dispose', generation: message.generation });
		}
	});

	it('preserves split UTF-8 bytes and drains buffered stdin before EOF', async () => {
		workerMocks.lifecycle = 'pending';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-stdin-eof');
		const stdin = new SharedByteQueue(message.stdin!);
		handleTargetWorkerMessage(message);
		await vi.waitFor(() => expect(workerMocks.callMain).toHaveBeenCalledOnce());
		const stream = workerMocks.stdinStream;
		const storage = new Uint8Array(20).fill(0xff);
		const view = new Int8Array(storage.buffer, 4, 12);
		const bytes = new TextEncoder().encode('한\n');
		try {
			expect(stream.stream_ops.read(stream, view, 0, 0)).toBe(0);
			stdin.tryWrite(bytes.subarray(0, 1));
			expect(stream.stream_ops.read(stream, view, 2, 8)).toBe(1);
			stdin.tryWrite(bytes.subarray(1));
			stdin.close();
			expect(stream.stream_ops.read(stream, view, 3, 8)).toBe(3);
			expect(new TextDecoder().decode(storage.subarray(6, 10))).toBe('한\n');
			expect(storage[5]).toBe(0xff);
			expect(storage[10]).toBe(0xff);
			expect(stream.stream_ops.read(stream, view, 0, 12)).toBe(0);
		} finally {
			handleTargetWorkerMessage({ type: 'dispose', generation: message.generation });
		}
	});

	it('revokes verified runtime blobs synchronously when a live target is disposed', async () => {
		workerMocks.lifecycle = 'pending';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-revoke-on-dispose');

		handleTargetWorkerMessage(message);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: message.generation
			})
		);
		expect(workerMocks.revokeAssets).not.toHaveBeenCalled();

		handleTargetWorkerMessage({ type: 'dispose', generation: message.generation });

		expect(workerMocks.revokeAssets).toHaveBeenCalledOnce();
	});

	it.each([
		{
			name: 'working directory',
			corruption: { cwd: '/outside' },
			error: 'WAMR working directory must be /workspace'
		},
		{
			name: 'argument list',
			corruption: { args: 'not-an-array' },
			error: 'WAMR program arguments must be an array'
		},
		{
			name: 'argument value',
			corruption: { args: [42] },
			error: 'WAMR program arguments must be strings'
		},
		{
			name: 'environment object',
			corruption: { env: ['MODE=debug'] },
			error: 'WAMR environment must be an object'
		},
		{
			name: 'environment value',
			corruption: { env: { MODE: 42 } },
			error: 'invalid WAMR environment variable: MODE'
		},
		{
			name: 'empty generation',
			corruption: { generation: '' },
			error: 'debug worker generation must be a non-empty string without NUL bytes'
		},
		{
			name: 'NUL generation',
			corruption: { generation: 'target\0generation' },
			error: 'debug worker generation must be a non-empty string without NUL bytes'
		}
	])(
		'rejects an invalid direct-worker $name before loading WAMR',
		async ({ name, corruption, error }) => {
			const { handleTargetWorkerMessage } = await loadTargetWorker();
			const message = initializeMessage(`target-worker-invalid-${error}`);
			Object.assign(message, corruption);

			handleTargetWorkerMessage(message);

			await vi.waitFor(() =>
				expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
					'target',
					message.generation,
					expect.objectContaining({ message: error })
				)
			);
			expect(workerMocks.mountDebugFiles).not.toHaveBeenCalled();
			expect(workerMocks.chdir).not.toHaveBeenCalled();

			const recovery = initializeMessage(
				`target-worker-${name.replaceAll(' ', '-')}-recovery`
			);
			handleTargetWorkerMessage(recovery);
			await vi.waitFor(() =>
				expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
					type: 'ready',
					worker: 'target',
					generation: recovery.generation
				})
			);
		}
	);

	it('rejects an unsupported guest module before loading Emscripten WAMR assets', async () => {
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-unsupported-module');
		message.module = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1);

		handleTargetWorkerMessage(message);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'target',
				message.generation,
				expect.objectContaining({ message: expect.stringMatching(/shared memory/u) })
			)
		);
		expect(workerMocks.loadEmscriptenModuleFactory).not.toHaveBeenCalled();
		expect(workerMocks.mountDebugFiles).not.toHaveBeenCalled();

		const recovery = initializeMessage('target-worker-unsupported-module-recovery');
		handleTargetWorkerMessage(recovery);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: recovery.generation
			})
		);
	});

	it.each(['stdout', 'stderr', 'stdin'] as const)(
		'rejects %s sharing an RSP buffer before loading WAMR',
		async (channel) => {
			const { handleTargetWorkerMessage } = await loadTargetWorker();
			const message = initializeMessage(`target-worker-shared-${channel}`);
			message[channel] = message.rspInput;

			handleTargetWorkerMessage(message);

			await vi.waitFor(() =>
				expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
					'target',
					message.generation,
					expect.objectContaining({
						message: 'target debug channels must not reuse shared buffers'
					})
				)
			);
			expect(workerMocks.mountDebugFiles).not.toHaveBeenCalled();

			const recovery = initializeMessage(`${message.generation}-recovery`);
			handleTargetWorkerMessage(recovery);
			await vi.waitFor(() =>
				expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
					type: 'ready',
					worker: 'target',
					generation: recovery.generation
				})
			);
		}
	);

	it('releases a failed WAMR initialization before accepting a recovery generation', async () => {
		workerMocks.loadFailure = new Error('WAMR loader failed');
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const failed = initializeMessage('target-worker-loader-failure');
		const stdout = new SharedByteQueue(failed.stdout);
		const stderr = new SharedByteQueue(failed.stderr);
		const stdin = new SharedByteQueue(failed.stdin!);

		handleTargetWorkerMessage(failed);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'target',
				failed.generation,
				expect.objectContaining({ message: 'WAMR loader failed' })
			)
		);
		expect(workerMocks.closeRspInput).toHaveBeenCalledOnce();
		expect(workerMocks.closeRspOutput).toHaveBeenCalledOnce();
		expect(stdout.closed).toBe(true);
		expect(stderr.closed).toBe(true);
		expect(stdin.closed).toBe(true);
		expect(globalThis.__wasmIdleDebugTransport).toBeUndefined();

		const recovery = initializeMessage('target-worker-loader-recovery');
		handleTargetWorkerMessage(recovery);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: recovery.generation
			})
		);
	});

	it('does not launch WAMR when disposal wins the loader race', async () => {
		let releaseLoader!: () => void;
		workerMocks.loadGate = new Promise<void>((resolve) => {
			releaseLoader = resolve;
		});
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-disposed-during-load');

		handleTargetWorkerMessage(message);
		handleTargetWorkerMessage({ type: 'dispose', generation: message.generation });
		releaseLoader();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(workerMocks.mountDebugFiles).not.toHaveBeenCalled();
		expect(workerMocks.callMain).not.toHaveBeenCalled();
		expect(workerMocks.postWorkerMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: 'ready', generation: message.generation })
		);
		expect(workerMocks.postWorkerError).not.toHaveBeenCalled();
	});

	it('rejects duplicate initialization without closing the active target outputs', async () => {
		workerMocks.lifecycle = 'pending';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const active = initializeMessage('target-worker-active');
		const stdout = new SharedByteQueue(active.stdout);
		const stderr = new SharedByteQueue(active.stderr);

		handleTargetWorkerMessage(active);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: active.generation
			})
		);

		const duplicate = initializeMessage('target-worker-duplicate');
		handleTargetWorkerMessage(duplicate);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'target',
				duplicate.generation,
				expect.objectContaining({ message: 'target worker is already initialized' })
			)
		);
		expect(stdout.closed).toBe(false);
		expect(stderr.closed).toBe(false);

		handleTargetWorkerMessage({ type: 'dispose', generation: active.generation });
	});

	it('ignores a replayed initialization for the active target generation', async () => {
		workerMocks.lifecycle = 'pending';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const active = initializeMessage('target-worker-replay');
		const stdout = new SharedByteQueue(active.stdout);
		const stderr = new SharedByteQueue(active.stderr);

		handleTargetWorkerMessage(active);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: active.generation
			})
		);
		handleTargetWorkerMessage(initializeMessage(active.generation));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(workerMocks.callMain).toHaveBeenCalledOnce();
		expect(workerMocks.postWorkerError).not.toHaveBeenCalled();
		expect(stdout.closed).toBe(false);
		expect(stderr.closed).toBe(false);

		handleTargetWorkerMessage({ type: 'dispose', generation: active.generation });
	});

	it('passes cwd, environment, and guest arguments to the debug runtime', async () => {
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-launch');

		handleTargetWorkerMessage(message);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'memory',
				worker: 'target',
				bytes: 256,
				generation: message.generation
			})
		);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: message.generation
			})
		);
		expect(workerMocks.mountDebugFiles).toHaveBeenCalledWith(
			expect.anything(),
			message.module,
			message.workspaceFiles
		);
		expect(workerMocks.chdir).toHaveBeenCalledWith('/workspace');
		expect(workerMocks.callMain).toHaveBeenCalledWith([
			'--env=MODE=debug',
			'--env=EMPTY=',
			'-v=0',
			'--heap-size=1048576',
			'--dir=/workspace',
			'-g=wasm-messageport:1',
			'/workspace/program.wasm',
			'first',
			'second'
		]);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'exit',
				exitCode: 0,
				generation: message.generation
			})
		);
	});

	it('reports an abort as a worker error and suppresses its invalid exit callback', async () => {
		workerMocks.lifecycle = 'abort';
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-abort');

		handleTargetWorkerMessage(message);

		await vi.waitFor(() =>
			expect(workerMocks.postWorkerError).toHaveBeenCalledWith(
				'target',
				message.generation,
				expect.objectContaining({ message: 'WAMR aborted: runtime crash' })
			)
		);
		expect(workerMocks.postWorkerMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: 'exit' })
		);
	});

	it('continues target disposal after a transport queue close fails', async () => {
		const { handleTargetWorkerMessage } = await loadTargetWorker();
		const message = initializeMessage('target-worker-dispose');

		handleTargetWorkerMessage(message);
		await vi.waitFor(() =>
			expect(workerMocks.postWorkerMessage).toHaveBeenCalledWith({
				type: 'ready',
				worker: 'target',
				generation: message.generation
			})
		);
		workerMocks.closeRspInput.mockImplementationOnce(() => {
			throw new Error('stale RSP input queue');
		});

		expect(() =>
			handleTargetWorkerMessage({ type: 'dispose', generation: message.generation })
		).not.toThrow();
		expect(workerMocks.closeRspOutput).toHaveBeenCalledOnce();
		expect(globalThis.__wasmIdleDebugTransport).toBeUndefined();
		expect(new SharedByteQueue(message.stdin!).closed).toBe(true);
	});
});
