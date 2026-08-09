import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	commandFree,
	commandRun,
	fromFile,
	importRuntimeModule,
	init,
	packageFree,
	verifyRuntimeAssetIntegrity
} = vi.hoisted(() => ({
	commandFree: vi.fn(),
	commandRun: vi.fn(),
	fromFile: vi.fn(),
	importRuntimeModule: vi.fn(),
	init: vi.fn(async () => {}),
	packageFree: vi.fn(),
	verifyRuntimeAssetIntegrity: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({ importRuntimeModule }));
vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRuntimeAssetIntegrity
}));

import Bash from './bash';
import { WASM_BASH_WEBC_RECEIPT } from './wasmBashVersion';

function byteStream(text: string) {
	return new ReadableStream({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}

async function observeSettlement<T>(promise: Promise<T>) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				(value) => ({ status: 'resolved' as const, value }),
				(reason) => ({ status: 'rejected' as const, reason: reason as unknown })
			),
			new Promise<{ status: 'pending' }>((resolve) => {
				timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

describe('Bash sandbox', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	beforeEach(() => {
		vi.resetAllMocks();
		init.mockResolvedValue(undefined);
		importRuntimeModule.mockResolvedValue({ init, Wasmer: { fromFile } });
		fromFile.mockResolvedValue({
			entrypoint: { run: commandRun, free: commandFree },
			free: packageFree
		});
		verifyRuntimeAssetIntegrity.mockResolvedValue(undefined);
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

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/assets/wasm-bash/bash.webc', {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: expect.any(AbortSignal)
		});
		expect(init).toHaveBeenCalledWith({
			sdkUrl: 'http://localhost:3000/assets/wasm-bash/sdk/index.mjs',
			workerUrl: 'http://localhost:3000/assets/wasm-bash/sdk/worker.mjs'
		});
		expect(importRuntimeModule).toHaveBeenCalledWith(
			'http://localhost:3000/assets/wasm-bash/sdk/index.mjs'
		);
		expect(fromFile).toHaveBeenCalledWith(expect.any(Uint8Array));
		expect(verifyRuntimeAssetIntegrity).toHaveBeenCalledWith({
			asset: 'bash.webc',
			bytes: expect.any(Uint8Array),
			expected: WASM_BASH_WEBC_RECEIPT,
			profileId: 'wasmer/bash@1.0.25',
			runtimeId: 'BASH'
		});
		expect(verifyRuntimeAssetIntegrity.mock.invocationCallOrder[0]).toBeLessThan(
			fromFile.mock.invocationCallOrder[0]!
		);
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
		expect(commandFree).toHaveBeenCalledOnce();
		expect(free).not.toHaveBeenCalled();
		expect(sandbox.stdinWriter).toBeNull();
	});

	it.each(['throw', 'reject'] as const)(
		'frees the Bash command handle when entrypoint startup %ss',
		async (failureMode) => {
			const reason = new Error('Bash command startup failed');
			if (failureMode === 'throw') {
				commandRun.mockImplementationOnce(() => {
					throw reason;
				});
			} else {
				commandRun.mockRejectedValueOnce(reason);
			}
			const sandbox = new Bash();
			await sandbox.load();

			await expect(sandbox.run('printf unreachable', false)).rejects.toBe(reason.message);

			expect(commandFree).toHaveBeenCalledOnce();
			expect(sandbox.instance).toBeNull();
			expect(sandbox.stdinWriter).toBeNull();
		}
	);

	it('preserves Bash success when command cleanup throws', async () => {
		const instanceFree = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('ok\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: instanceFree
		});
		commandFree.mockImplementationOnce(() => {
			throw new Error('Bash command cleanup failed');
		});
		const sandbox = new Bash();
		await sandbox.load();

		await expect(sandbox.run('printf ok', false)).resolves.toBe(true);

		expect(commandFree).toHaveBeenCalledOnce();
		expect(instanceFree).not.toHaveBeenCalled();
	});

	it('propagates caller cancellation and enforces byte limits while loading WEBc', async () => {
		const controller = new AbortController();
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(new Uint8Array(5), {
				headers: { 'content-length': '5' }
			})
		);
		const sandbox = new Bash();

		await expect(
			sandbox.load('/assets', '', true, [], {
				limits: { maxAssetBytes: 4 },
				signal: controller.signal
			})
		).rejects.toThrow('Bash WEBc receipt exceeds the 4 byte limit');

		expect(fetch).not.toHaveBeenCalled();
		expect(fromFile).not.toHaveBeenCalled();
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(fromFile).toHaveBeenCalledOnce();
	});

	it('rejects corrupt WEBc bytes before constructing a Wasmer package', async () => {
		verifyRuntimeAssetIntegrity.mockRejectedValueOnce(new Error('WEBc integrity mismatch'));
		const sandbox = new Bash();

		await expect(sandbox.load('/assets')).rejects.toThrow('WEBc integrity mismatch');

		expect(verifyRuntimeAssetIntegrity).toHaveBeenCalledOnce();
		expect(fromFile).not.toHaveBeenCalled();
	});

	it('snapshots a custom WEBc receipt before asynchronous startup', async () => {
		const receipt = { bytes: 4, sha256: 'a'.repeat(64) };
		const sandbox = new Bash();
		const loading = sandbox.load({
			bash: {
				moduleUrl: '/custom/bash-sdk.mjs',
				webcUrl: '/custom/bash.webc',
				workerUrl: '/custom/bash-worker.mjs',
				webcReceipt: receipt
			}
		});
		receipt.bytes = 5;
		receipt.sha256 = 'b'.repeat(64);

		await expect(loading).resolves.toBeUndefined();

		expect(verifyRuntimeAssetIntegrity).toHaveBeenCalledWith(
			expect.objectContaining({
				expected: { bytes: 4, sha256: 'a'.repeat(64) }
			})
		);
		expect(verifyRuntimeAssetIntegrity.mock.calls[0]?.[0].expected).not.toBe(receipt);
	});

	it('caps the WEBc download at the verified receipt size', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(new Uint8Array(5), { headers: { 'content-length': '5' } })
		);
		const sandbox = new Bash();

		await expect(
			sandbox.load({
				bash: {
					moduleUrl: '/custom/bash-sdk.mjs',
					webcUrl: '/custom/bash.webc',
					workerUrl: '/custom/bash-worker.mjs',
					webcReceipt: { bytes: 4, sha256: 'a'.repeat(64) }
				}
			})
		).rejects.toThrow('Bash WEBc package exceeds the 4 byte limit');

		expect(verifyRuntimeAssetIntegrity).not.toHaveBeenCalled();
		expect(fromFile).not.toHaveBeenCalled();
	});

	it('rejects operations that overlap a pending Bash load', async () => {
		let resolvePackage!: (runtimePackage: {
			entrypoint: { run: typeof commandRun };
			free: ReturnType<typeof vi.fn>;
		}) => void;
		const pendingPackage = new Promise<{
			entrypoint: { run: typeof commandRun };
			free: ReturnType<typeof vi.fn>;
		}>((resolve) => {
			resolvePackage = resolve;
		});
		const firstFree = vi.fn();
		fromFile.mockReturnValueOnce(pendingPackage);
		const sandbox = new Bash();
		const loading = sandbox.load('/assets');

		try {
			await vi.waitFor(() => expect(fromFile).toHaveBeenCalledOnce());
			await expect(sandbox.load('/other/')).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'BASH',
				phase: 'startup'
			});
			await expect(sandbox.run('printf nested', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'BASH',
				phase: 'startup'
			});
			expect(fetch).toHaveBeenCalledOnce();
			expect(fromFile).toHaveBeenCalledOnce();
			expect(commandRun).not.toHaveBeenCalled();

			resolvePackage({ entrypoint: { run: commandRun }, free: firstFree });
			await expect(loading).resolves.toBeUndefined();
			expect(firstFree).not.toHaveBeenCalled();
		} finally {
			resolvePackage({ entrypoint: { run: commandRun }, free: firstFree });
			await loading.catch(() => {});
		}
	});

	it('keeps Bash load ownership through the final progress callback', async () => {
		const sandbox = new Bash();
		let nestedLoad: Promise<void> | undefined;
		let nestedRun: Promise<boolean | string> | undefined;
		const loading = sandbox.load(
			'/assets',
			'',
			true,
			[],
			{},
			{
				set(value) {
					if (value !== 1) return;
					nestedLoad = sandbox.load('/other/');
					nestedRun = sandbox.run('printf nested', false);
					void nestedLoad.catch(() => undefined);
					void nestedRun.catch(() => undefined);
				}
			}
		);

		await expect(loading).resolves.toBeUndefined();
		await expect(nestedLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'BASH',
			phase: 'startup'
		});
		await expect(nestedRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'BASH',
			phase: 'startup'
		});
		expect(fromFile).toHaveBeenCalledOnce();
	});

	it('rejects operations that overlap an active Bash run', async () => {
		let resolveCommand!: (instance: {
			stdin: undefined;
			stdout: ReadableStream<Uint8Array>;
			stderr: ReadableStream<Uint8Array>;
			wait: ReturnType<typeof vi.fn>;
			free: ReturnType<typeof vi.fn>;
		}) => void;
		const pendingCommand = new Promise<{
			stdin: undefined;
			stdout: ReadableStream<Uint8Array>;
			stderr: ReadableStream<Uint8Array>;
			wait: ReturnType<typeof vi.fn>;
			free: ReturnType<typeof vi.fn>;
		}>((resolve) => {
			resolveCommand = resolve;
		});
		commandRun.mockReturnValueOnce(pendingCommand);
		const firstFree = vi.fn();
		const firstInstance = {
			stdin: undefined,
			stdout: byteStream('first\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: firstFree
		};
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load('/assets');
		const running = sandbox.run('printf first', false);

		try {
			await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
			await expect(sandbox.run('printf nested', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'BASH',
				phase: 'execute'
			});
			await expect(sandbox.load('/other/')).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'BASH',
				phase: 'execute'
			});
			expect(commandRun).toHaveBeenCalledOnce();
			expect(fromFile).toHaveBeenCalledOnce();

			resolveCommand(firstInstance);
			await expect(running).resolves.toBe(true);
			await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
			expect(output).toEqual(['first\n', 'retry\n']);
			expect(firstFree).not.toHaveBeenCalled();
		} finally {
			resolveCommand(firstInstance);
			await running.catch(() => {});
		}
	});

	it('rejects a killed Bash load and frees its late package before retrying', async () => {
		let resolvePackage!: (runtimePackage: {
			entrypoint: { run: typeof commandRun };
			free: ReturnType<typeof vi.fn>;
		}) => void;
		const pendingPackage = new Promise<{
			entrypoint: { run: typeof commandRun };
			free: ReturnType<typeof vi.fn>;
		}>((resolve) => {
			resolvePackage = resolve;
		});
		const lateFree = vi.fn();
		const retryFree = vi.fn();
		fromFile
			.mockReturnValueOnce(pendingPackage)
			.mockResolvedValueOnce({ entrypoint: { run: commandRun }, free: retryFree });
		const sandbox = new Bash();
		const loading = sandbox.load('/assets');

		try {
			await vi.waitFor(() => expect(fromFile).toHaveBeenCalledOnce());
			sandbox.kill();
			await expect(loading).rejects.toBe('Process terminated');

			resolvePackage({ entrypoint: { run: commandRun }, free: lateFree });
			await vi.waitFor(() => expect(lateFree).toHaveBeenCalledOnce());
			await expect(sandbox.load('/assets')).resolves.toBeUndefined();
			expect(fromFile).toHaveBeenCalledTimes(2);
			expect(retryFree).not.toHaveBeenCalled();
		} finally {
			resolvePackage({ entrypoint: { run: commandRun }, free: lateFree });
			await loading.catch(() => {});
		}
	});

	it('rejects a pre-aborted Bash load without changing loaded or queued state', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing');
		const runtimePackage = sandbox.runtimePackage;
		const webcUrl = sandbox.webcUrl;
		const fetchCalls = vi.mocked(fetch).mock.calls.length;
		const importCalls = importRuntimeModule.mock.calls.length;
		const packageCalls = fromFile.mock.calls.length;
		sandbox.write('queued\n');
		sandbox.eof();
		const controller = new AbortController();
		const reason = new Error('do not start Bash runtime');
		controller.abort(reason);
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);

		expect(fetch).toHaveBeenCalledTimes(fetchCalls);
		expect(importRuntimeModule).toHaveBeenCalledTimes(importCalls);
		expect(fromFile).toHaveBeenCalledTimes(packageCalls);
		expect(addEventListener).not.toHaveBeenCalled();
		expect(sandbox.runtimePackage).toBe(runtimePackage);
		expect(sandbox.webcUrl).toBe(webcUrl);
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(sandbox.activeLoadCleanup).toBeNull();
		expect(sandbox.activeLoadReject).toBeNull();
	});

	it.each(['import', 'init', 'package'] as const)(
		'cancels Bash startup promptly while %s remains pending',
		async (phase) => {
			const sdk = { init, Wasmer: { fromFile } };
			let resolveImport: ((value: typeof sdk) => void) | undefined;
			let resolveInit: (() => void) | undefined;
			type DeferredPackage = {
				entrypoint: { run: typeof commandRun };
				free: () => void;
			};
			let resolvePackage: ((runtimePackage: DeferredPackage) => void) | undefined;
			const lateFree = vi.fn();
			const latePackage: DeferredPackage = {
				entrypoint: { run: commandRun },
				free: lateFree
			};
			if (phase === 'import') {
				importRuntimeModule.mockReturnValueOnce(
					new Promise<typeof sdk>((resolve) => {
						resolveImport = resolve;
					})
				);
			}
			if (phase === 'init') {
				init.mockReturnValueOnce(
					new Promise<void>((resolve) => {
						resolveInit = resolve;
					})
				);
			}
			if (phase === 'package') {
				fromFile.mockReturnValueOnce(
					new Promise<DeferredPackage>((resolve) => {
						resolvePackage = resolve;
					})
				);
			}
			const sandbox = new Bash();
			const controller = new AbortController();
			const reason = new Error(`stop pending Bash ${phase}`);
			const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = { set: vi.fn() };
			const loading = sandbox.load(
				`/slow-${phase}`,
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			);
			let retry: Promise<void> | undefined;

			try {
				if (phase === 'import') {
					await vi.waitFor(() => expect(importRuntimeModule).toHaveBeenCalledOnce());
				} else if (phase === 'init') {
					await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
				} else {
					await vi.waitFor(() => expect(fromFile).toHaveBeenCalledOnce());
				}
				controller.abort(reason);
				await expect(observeSettlement(loading)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				const abortRegistration = addEventListener.mock.calls.find(
					([type]) => type === 'abort'
				);
				expect(abortRegistration).toBeDefined();
				expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
				expect(sandbox.activeLoadCleanup).toBeNull();
				expect(sandbox.activeLoadReject).toBeNull();
				const progressCalls = progress.set.mock.calls.length;
				retry = sandbox.load(`/slow-${phase}`);
				if (phase === 'package') {
					await expect(retry).resolves.toBeUndefined();
					expect(fromFile).toHaveBeenCalledTimes(2);
				} else {
					expect(importRuntimeModule).toHaveBeenCalledOnce();
					expect(fromFile).not.toHaveBeenCalled();
				}

				resolveImport?.(sdk);
				resolveInit?.();
				resolvePackage?.(latePackage);
				await expect(retry).resolves.toBeUndefined();
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				if (phase === 'package') {
					await vi.waitFor(() => expect(lateFree).toHaveBeenCalledOnce());
				} else {
					expect(fromFile).toHaveBeenCalledOnce();
				}
				expect(progress.set).toHaveBeenCalledTimes(progressCalls);
				expect(sandbox.runtimePackage).not.toBeNull();
			} finally {
				controller.abort(reason);
				resolveImport?.(sdk);
				resolveInit?.();
				resolvePackage?.(latePackage);
				await loading.catch(() => {});
				await retry?.catch(() => {});
			}
		}
	);

	it('stops Bash startup before loading assets when initial progress aborts', async () => {
		const sandbox = new Bash();
		const controller = new AbortController();
		const reason = new Error('stop Bash from initial progress');
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 0.1) controller.abort(reason);
			})
		};

		await expect(
			sandbox.load('/progress-abort', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(progress.set).toHaveBeenCalledOnce();
		expect(progress.set).toHaveBeenCalledWith(0.1, 'Loading Bash runtime');
		expect(fetch).not.toHaveBeenCalled();
		expect(importRuntimeModule).not.toHaveBeenCalled();
		expect(init).not.toHaveBeenCalled();
		expect(fromFile).not.toHaveBeenCalled();
		expect(sandbox.activeLoadCleanup).toBeNull();
		expect(sandbox.activeLoadReject).toBeNull();
	});

	it('preserves the loaded Bash package when final progress aborts', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-final-progress');
		const runtimePackage = sandbox.runtimePackage;
		const webcUrl = sandbox.webcUrl;
		const staleFree = vi.fn(() => {
			throw new Error('stale Bash package cleanup failed');
		});
		fromFile.mockResolvedValueOnce({ entrypoint: { run: commandRun }, free: staleFree });
		const controller = new AbortController();
		const reason = new Error('stop Bash from final progress');
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 1) controller.abort(reason);
			})
		};

		await expect(
			sandbox.load(
				'/replacement-final-progress',
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			)
		).rejects.toBe(reason);

		expect(progress.set).toHaveBeenLastCalledWith(1, 'Bash runtime ready');
		expect(staleFree).toHaveBeenCalledOnce();
		expect(packageFree).not.toHaveBeenCalled();
		expect(sandbox.runtimePackage).toBe(runtimePackage);
		expect(sandbox.webcUrl).toBe(webcUrl);
		expect(sandbox.activeLoadCleanup).toBeNull();
		expect(sandbox.activeLoadReject).toBeNull();
	});

	it.each(['import', 'init'] as const)(
		'retries Bash startup after an SDK %s failure',
		async (phase) => {
			const reason = new Error(`Bash SDK ${phase} failed`);
			if (phase === 'import') importRuntimeModule.mockRejectedValueOnce(reason);
			else init.mockRejectedValueOnce(reason);
			const sandbox = new Bash();

			await expect(sandbox.load(`/sdk-${phase}-failure`)).rejects.toBe(reason);
			expect(sandbox.activeLoadCleanup).toBeNull();
			expect(sandbox.activeLoadReject).toBeNull();

			await expect(sandbox.load(`/sdk-${phase}-failure`)).resolves.toBeUndefined();
			expect(importRuntimeModule).toHaveBeenCalledTimes(2);
			expect(fromFile).toHaveBeenCalledOnce();
		}
	);

	it('aborts a pending Bash WEBc fetch when SDK startup fails first', async () => {
		let resolveFetch: ((response: Response) => void) | undefined;
		let requestSignal: AbortSignal | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			requestSignal = init?.signal ?? undefined;
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		});
		const reason = new Error('Bash SDK failed before its WEBc fetch');
		importRuntimeModule.mockRejectedValueOnce(reason);
		const sandbox = new Bash();

		await expect(sandbox.load('/sdk-failure-pending-fetch')).rejects.toBe(reason);
		expect(requestSignal?.aborted).toBe(true);
		expect(requestSignal?.reason).toBe(reason);

		resolveFetch?.(new Response(new Uint8Array([0, 97, 115, 109])));
		await expect(sandbox.load('/sdk-failure-pending-fetch')).resolves.toBeUndefined();
		expect(importRuntimeModule).toHaveBeenCalledTimes(2);
		expect(fromFile).toHaveBeenCalledOnce();
	});

	it('removes a settled Bash startup listener before a late abort', async () => {
		const sandbox = new Bash();
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await sandbox.load('/settled', '', true, [], { signal: controller.signal });
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		const runtimePackage = sandbox.runtimePackage;
		const uid = sandbox.uid;

		controller.abort(new Error('late Bash startup abort'));
		expect(sandbox.runtimePackage).toBe(runtimePackage);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.activeLoadCleanup).toBeNull();
		expect(sandbox.activeLoadReject).toBeNull();
	});

	it('rejects a pre-aborted execution without consuming queued stdin or starting Bash', async () => {
		const sandbox = new Bash();
		await sandbox.load();
		sandbox.write('queued\n');
		sandbox.eof();
		const controller = new AbortController();
		const reason = new Error('do not start Bash');
		controller.abort(reason);

		await expect(
			sandbox.run('read value', false, true, undefined, [], {
				stdin: 'replacement\n',
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it('preserves an exact null pre-abort reason without changing idle Bash state', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-null');
		const runtimePackage = sandbox.runtimePackage;
		const webcUrl = sandbox.webcUrl;
		const uid = sandbox.uid;
		sandbox.write('queued null input\n');
		sandbox.eof();
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load('/replacement-null', '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBeNull();

		expect(sandbox.runtimePackage).toBe(runtimePackage);
		expect(sandbox.webcUrl).toBe(webcUrl);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued null input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(commandRun).not.toHaveBeenCalled();
	});

	it('preserves replacement startup when the outer Bash signal getter terminates', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-signal-getter');
		const reason = new Error('replace Bash during startup option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-signal-getter');
				return undefined;
			}
		};

		const superseded = sandbox.load('/outer-signal-getter', '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(sandbox.webcUrl).toMatch(/\/replacement-signal-getter\/wasm-bash\/bash\.webc$/);
		expect(sandbox.runtimePackage).not.toBeNull();
	});

	it('preserves the first Bash cancellation when the triggering option getter later throws', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-option-failure');
		const reason = new Error('replace Bash during execution option snapshot');
		const laterError = new Error('later Bash option failure');
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		let replacement: Promise<void> | undefined;
		const options = {
			signal: controller.signal,
			get limits(): never {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-option-failure');
				throw laterError;
			}
		};

		const superseded = sandbox.run('printf stale', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(commandRun).not.toHaveBeenCalled();
		expect(addEventListener).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledOnce();
		expect(sandbox.webcUrl).toMatch(/\/replacement-option-failure\/wasm-bash\/bash\.webc$/);
	});

	it('preserves a Bash replacement when a later option getter aborts the snapshot', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-option-abort');
		const controller = new AbortController();
		const reason = new Error('abort Bash during execution option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			signal: controller.signal,
			get limits() {
				controller.abort(reason);
				replacement = sandbox.load('/replacement-option-abort');
				return undefined;
			}
		};

		const superseded = sandbox.run('printf stale', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.webcUrl).toMatch(/\/replacement-option-abort\/wasm-bash\/bash\.webc$/);
	});

	it('preserves a Bash replacement started by a pre-session abort reason getter', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-reason-getter');
		const reason = new Error('replace Bash while reading the abort reason');
		const staleReason = new Error('stale Bash abort reason');
		let replacement: Promise<void> | undefined;
		let reasonReads = 0;
		const signal = {
			aborted: true,
			get reason() {
				reasonReads += 1;
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-reason-getter');
				return staleReason;
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;

		const superseded = sandbox.run('printf stale', false, true, undefined, [], { signal });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(reasonReads).toBe(1);
		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.webcUrl).toMatch(/\/replacement-reason-getter\/wasm-bash\/bash\.webc$/);
	});

	it('stops the Bash snapshot when the bound signal aborted getter starts a replacement', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-aborted-getter');
		const reason = new Error('replace Bash while rechecking the abort signal');
		let replacement: Promise<void> | undefined;
		let abortedReads = 0;
		let staleLimitReads = 0;
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		const signal = {
			get aborted() {
				abortedReads += 1;
				if (abortedReads === 2) {
					sandbox.terminate(reason);
					replacement = sandbox.load('/replacement-aborted-getter');
				}
				return false;
			},
			reason: undefined,
			addEventListener,
			removeEventListener
		} as unknown as AbortSignal;
		const options = {
			signal,
			get limits() {
				staleLimitReads += 1;
				return undefined;
			}
		};

		const superseded = sandbox.run('printf stale', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(abortedReads).toBe(2);
		expect(staleLimitReads).toBe(0);
		expect(addEventListener).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledOnce();
		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.webcUrl).toMatch(/\/replacement-aborted-getter\/wasm-bash\/bash\.webc$/);
	});

	it('snapshots explicit Bash asset fields once without reading the root URL', async () => {
		const sandbox = new Bash();
		const reads = { bash: 0, rootUrl: 0, webcUrl: 0, moduleUrl: 0, workerUrl: 0 };
		let webcUrl = '/snapshot-bash/package.webc';
		let moduleUrl = '/snapshot-bash/sdk.mjs';
		let workerUrl = '/snapshot-bash/worker.mjs';
		const runtimeConfig = {
			get webcUrl() {
				reads.webcUrl += 1;
				return webcUrl;
			},
			get moduleUrl() {
				reads.moduleUrl += 1;
				return moduleUrl;
			},
			get workerUrl() {
				reads.workerUrl += 1;
				return workerUrl;
			}
		};
		const runtimeAssets = {
			get rootUrl() {
				reads.rootUrl += 1;
				return '/unused-bash-root';
			},
			get bash() {
				reads.bash += 1;
				return runtimeConfig;
			}
		};

		const loading = sandbox.load(runtimeAssets);
		webcUrl = '/mutated-bash/package.webc';
		moduleUrl = '/mutated-bash/sdk.mjs';
		workerUrl = '/mutated-bash/worker.mjs';
		await loading;

		expect(reads).toEqual({ bash: 1, rootUrl: 0, webcUrl: 1, moduleUrl: 1, workerUrl: 1 });
		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/snapshot-bash/package.webc', {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: expect.any(AbortSignal)
		});
		expect(importRuntimeModule).toHaveBeenCalledWith(
			'http://localhost:3000/snapshot-bash/sdk.mjs'
		);
		expect(init).toHaveBeenCalledWith({
			sdkUrl: 'http://localhost:3000/snapshot-bash/sdk.mjs',
			workerUrl: 'http://localhost:3000/snapshot-bash/worker.mjs'
		});
		expect(sandbox.webcUrl).toBe('http://localhost:3000/snapshot-bash/package.webc');
	});

	it('reads the Bash root URL once when resolving fallback assets', async () => {
		const sandbox = new Bash();
		let rootUrlReads = 0;
		const runtimeAssets = {
			get rootUrl() {
				rootUrlReads += 1;
				return '/snapshot-bash-root';
			}
		};

		await sandbox.load(runtimeAssets);

		expect(rootUrlReads).toBe(1);
		expect(sandbox.webcUrl).toMatch(/\/snapshot-bash-root\/wasm-bash\/bash\.webc$/);
	});

	it('stops reading nested Bash limits after a getter starts a replacement', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-nested-limits');
		const reason = new Error('replace Bash while reading nested execution limits');
		let replacement: Promise<void> | undefined;
		let staleLimitReads = 0;
		const limits = {
			get assetTimeoutMs() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-nested-limits');
				return 1000;
			},
			get startupTimeoutMs() {
				staleLimitReads += 1;
				return 1000;
			}
		};

		const superseded = sandbox.load('/superseded-nested-limits', '', true, [], { limits });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleLimitReads).toBe(0);
		expect(sandbox.webcUrl).toMatch(/\/replacement-nested-limits\/wasm-bash\/bash\.webc$/);
	});

	it('ignores a stale Bash config after its top-level getter starts a replacement', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-top-level-config');
		const reason = new Error('replace Bash while reading runtime config');
		let replacement: Promise<void> | undefined;
		let staleWebcReads = 0;
		const runtimeAssets = {
			get bash() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-top-level-config');
				return {
					get webcUrl() {
						staleWebcReads += 1;
						return '/superseded.webc';
					}
				};
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleWebcReads).toBe(0);
		expect(sandbox.webcUrl).toMatch(/\/replacement-top-level-config\/wasm-bash\/bash\.webc$/);
	});

	it('ignores later Bash asset getters after the WEBc getter starts a replacement', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-nested-config');
		const reason = new Error('replace Bash while reading WEBc URL');
		let replacement: Promise<void> | undefined;
		let staleModuleReads = 0;
		const runtimeAssets = {
			bash: {
				get webcUrl() {
					sandbox.terminate(reason);
					replacement = sandbox.load('/replacement-nested-config');
					return '/superseded.webc';
				},
				get moduleUrl() {
					staleModuleReads += 1;
					return '/superseded.mjs';
				}
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleModuleReads).toBe(0);
		expect(sandbox.webcUrl).toMatch(/\/replacement-nested-config\/wasm-bash\/bash\.webc$/);
	});

	it('snapshots Bash args, workspace, limits, and stdin once before dispatch', async () => {
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('snapshot\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load('/snapshot-run');
		const reads = {
			programArgs: 0,
			workspaceFiles: 0,
			path: 0,
			content: 0,
			activePath: 0,
			workspaceLimits: 0,
			maxFiles: 0,
			stdin: 0
		};
		let filePath = 'lib/original.sh';
		let fileContent = 'value=original';
		let stdin = 'original stdin\n';
		const workspaceFile = {
			get path() {
				reads.path += 1;
				return filePath;
			},
			get content() {
				reads.content += 1;
				return fileContent;
			}
		};
		const workspaceLimits = {
			get maxFiles() {
				reads.maxFiles += 1;
				return 3;
			}
		};
		const options = {
			get programArgs() {
				reads.programArgs += 1;
				return ['original-arg'];
			},
			get workspaceFiles() {
				reads.workspaceFiles += 1;
				return [workspaceFile];
			},
			get activePath() {
				reads.activePath += 1;
				return 'scripts/original.sh';
			},
			get workspaceLimits() {
				reads.workspaceLimits += 1;
				return workspaceLimits;
			},
			get stdin() {
				reads.stdin += 1;
				return stdin;
			}
		};

		const running = sandbox.run(
			'source ../lib/original.sh',
			false,
			true,
			undefined,
			[],
			options
		);
		filePath = 'lib/mutated.sh';
		fileContent = 'value=mutated';
		stdin = 'mutated stdin\n';
		await expect(running).resolves.toBe(true);

		expect(reads).toEqual({
			programArgs: 1,
			workspaceFiles: 1,
			path: 1,
			content: 1,
			activePath: 1,
			workspaceLimits: 1,
			maxFiles: 1,
			stdin: 1
		});
		expect(commandRun).toHaveBeenCalledWith({
			args: ['-c', 'source ../lib/original.sh', 'scripts/original.sh', 'original-arg'],
			mount: {
				'/workspace': {
					'lib/original.sh': 'value=original',
					'scripts/original.sh': 'source ../lib/original.sh'
				}
			},
			cwd: '/workspace',
			stdin: 'original stdin\n'
		});
	});

	it('stops reading nested Bash arguments after an element starts a replacement', async () => {
		const sandbox = new Bash();
		await sandbox.load('/existing-nested-args');
		const reason = new Error('replace Bash while reading a nested program argument');
		let replacement: Promise<void> | undefined;
		let compileArgReads = 0;
		let staleProgramArgReads = 0;
		const programArgs = ['first', 'second'];
		Object.defineProperty(programArgs, 0, {
			configurable: true,
			get() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-nested-args');
				return 'stale-first';
			}
		});
		Object.defineProperty(programArgs, 1, {
			configurable: true,
			get() {
				staleProgramArgReads += 1;
				return 'stale-second';
			}
		});
		const options = {
			get compileArgs() {
				compileArgReads += 1;
				return ['unused'];
			},
			programArgs
		};

		const superseded = sandbox.run('printf stale', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(compileArgReads).toBe(0);
		expect(staleProgramArgReads).toBe(0);
		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.webcUrl).toMatch(/\/replacement-nested-args\/wasm-bash\/bash\.webc$/);
	});

	it('preserves exact null while cancelling active Bash startup and execution', async () => {
		let resolvePackage!: (value: {
			entrypoint: { run: typeof commandRun };
			free: ReturnType<typeof vi.fn>;
		}) => void;
		const latePackageFree = vi.fn();
		fromFile.mockReturnValueOnce(
			new Promise((resolve) => {
				resolvePackage = resolve;
			})
		);
		const loadingSandbox = new Bash();
		const loadController = new AbortController();
		const loading = loadingSandbox.load('/active-null-load', '', true, [], {
			signal: loadController.signal
		});
		await vi.waitFor(() => expect(fromFile).toHaveBeenCalledOnce());
		loadController.abort(null);
		await expect(loading).rejects.toBeNull();
		resolvePackage({ entrypoint: { run: commandRun }, free: latePackageFree });
		await vi.waitFor(() => expect(latePackageFree).toHaveBeenCalledOnce());

		let resolveInstance!: (value: {
			stdin: undefined;
			stdout: ReadableStream<Uint8Array>;
			stderr: ReadableStream<Uint8Array>;
			wait: ReturnType<typeof vi.fn>;
			free: ReturnType<typeof vi.fn>;
		}) => void;
		const lateInstanceFree = vi.fn();
		commandRun.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveInstance = resolve;
			})
		);
		const runningSandbox = new Bash();
		await runningSandbox.load('/active-null-run');
		const runController = new AbortController();
		vi.useFakeTimers();
		const running = runningSandbox.run('sleep forever', false, true, undefined, [], {
			signal: runController.signal,
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		expect(commandRun).toHaveBeenCalledOnce();
		runController.abort(null);
		await expect(running).rejects.toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(10);
		resolveInstance({
			stdin: undefined,
			stdout: byteStream('late'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: lateInstanceFree
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(lateInstanceFree).toHaveBeenCalledOnce();
	});

	it('reads an active Bash abort reason once without cancelling its replacement', async () => {
		let resolveInstance:
			| ((value: {
					stdin: undefined;
					stdout: ReadableStream<Uint8Array>;
					stderr: ReadableStream<Uint8Array>;
					wait: ReturnType<typeof vi.fn>;
					free: ReturnType<typeof vi.fn>;
			  }) => void)
			| undefined;
		const lateInstanceFree = vi.fn();
		commandRun.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveInstance = resolve;
			})
		);
		const sandbox = new Bash();
		await sandbox.load('/active-reason-getter');
		const controller = new AbortController();
		const reason = new Error('replace Bash while reading an active abort reason');
		const staleReason = new Error('stale active Bash abort reason');
		let replacement: Promise<void> | undefined;
		let reasonReads = 0;
		Object.defineProperty(controller.signal, 'reason', {
			configurable: true,
			get() {
				reasonReads += 1;
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement-active-reason');
				if (reasonReads > 1) throw new Error('Bash abort reason was read more than once');
				return staleReason;
			}
		});
		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			signal: controller.signal
		});

		try {
			await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
			controller.abort(staleReason);
			await expect(running).rejects.toBe(reason);
			await expect(replacement).resolves.toBeUndefined();
			expect(reasonReads).toBe(1);
			expect(sandbox.webcUrl).toMatch(/\/replacement-active-reason\/wasm-bash\/bash\.webc$/);
		} finally {
			resolveInstance?.({
				stdin: undefined,
				stdout: byteStream('late'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: lateInstanceFree
			});
			await running.catch(() => {});
		}
		await vi.waitFor(() => expect(lateInstanceFree).toHaveBeenCalledOnce());
	});

	it('cancels a stalled Bash startup and frees its late instance before retrying', async () => {
		let resolveCommand!: (instance: unknown) => void;
		const pendingCommand = new Promise<unknown>((resolve) => {
			resolveCommand = resolve;
		});
		commandRun.mockReturnValueOnce(pendingCommand);
		const lateFree = vi.fn();
		const lateGetWriter = vi.fn();
		const lateWait = vi.fn(async () => ({ ok: true, code: 0 }));
		const lateInstance = {
			stdin: { getWriter: lateGetWriter },
			stdout: byteStream('late stdout\n'),
			stderr: byteStream('late stderr\n'),
			wait: lateWait,
			free: lateFree
		};
		const retryFree = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: retryFree
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();
		const controller = new AbortController();
		const reason = new Error('stop stalled Bash startup');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			signal: controller.signal
		});

		try {
			await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
			expect(commandFree).toHaveBeenCalledOnce();
			controller.abort(reason);
			await expect(observeSettlement(running)).resolves.toEqual({
				status: 'rejected',
				reason
			});
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

			resolveCommand(lateInstance);
			await vi.waitFor(() => expect(lateFree).toHaveBeenCalledOnce());
			expect(commandFree).toHaveBeenCalledOnce();
			expect(lateGetWriter).not.toHaveBeenCalled();
			expect(lateWait).not.toHaveBeenCalled();
			await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
			expect(output).toEqual(['retry\n']);
			expect(retryFree).not.toHaveBeenCalled();
		} finally {
			resolveCommand(lateInstance);
			await running.catch(() => {});
		}
	});

	it('cleans a Bash instance when cancellation occurs during stdin writer acquisition', async () => {
		const controller = new AbortController();
		const reason = new Error('stop while acquiring Bash stdin');
		const writerAbort = vi.fn(async () => {});
		const writer = {
			write: vi.fn(async () => {}),
			close: vi.fn(async () => {}),
			abort: writerAbort
		};
		const wait = vi.fn(async () => ({ ok: true, code: 0 }));
		const free = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: {
				getWriter() {
					controller.abort(reason);
					return writer;
				}
			},
			stdout: byteStream(''),
			stderr: byteStream(''),
			wait,
			free
		});
		const sandbox = new Bash();
		await sandbox.load();

		await expect(
			sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);
		await vi.waitFor(() => expect(free).toHaveBeenCalledOnce());
		expect(writerAbort).toHaveBeenCalledOnce();
		expect(writerAbort).toHaveBeenCalledWith(reason);
		expect(wait).not.toHaveBeenCalled();
		expect(sandbox.stdinWriter).toBeNull();
		expect(sandbox.instance).toBeNull();
	});

	it.each(['write', 'close'] as const)(
		'frees pre-wait Bash resources when queued stdin %s fails',
		async (operation) => {
			const failure = new Error(`Bash stdin ${operation} failed`);
			const writerAbort = vi.fn(async () => {});
			const write = vi.fn(async () => {
				if (operation === 'write') throw failure;
			});
			const close = vi.fn(async () => {
				if (operation === 'close') throw failure;
			});
			const wait = vi.fn(async () => ({ ok: true, code: 0 }));
			const free = vi.fn();
			const sandbox = new Bash();
			commandRun.mockResolvedValueOnce({
				stdin: {
					getWriter() {
						if (operation === 'close') sandbox.eof();
						return { write, close, abort: writerAbort };
					}
				},
				stdout: byteStream(''),
				stderr: byteStream(''),
				wait,
				free
			});
			await sandbox.load();
			if (operation === 'write') sandbox.write('queued\n');

			await expect(sandbox.run('read value', false)).rejects.toBe(failure.message);

			expect(writerAbort).toHaveBeenCalledOnce();
			expect(writerAbort).toHaveBeenCalledWith(failure);
			expect(free).toHaveBeenCalledOnce();
			expect(wait).not.toHaveBeenCalled();
			expect(sandbox.stdinWriter).toBeNull();
			expect(sandbox.instance).toBeNull();
		}
	);

	it('frees a pre-wait Bash instance when output stream setup throws', async () => {
		const failure = new Error('Bash stderr stream setup failed');
		const stdoutPipe = vi.fn(async () => {});
		const stderrPipe = vi.fn(() => {
			throw failure;
		});
		const wait = vi.fn(async () => ({ ok: true, code: 0 }));
		const free = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: { pipeTo: stdoutPipe },
			stderr: { pipeTo: stderrPipe },
			wait,
			free
		});
		const sandbox = new Bash();
		await sandbox.load();

		await expect(sandbox.run('printf unreachable', false)).rejects.toBe(failure.message);

		expect(stdoutPipe).toHaveBeenCalledOnce();
		expect(stderrPipe).toHaveBeenCalledOnce();
		expect(free).toHaveBeenCalledOnce();
		expect(wait).not.toHaveBeenCalled();
		expect(sandbox.instance).toBeNull();
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'preserves caller cancellation while %s Bash cleanup is uncooperative',
		async (cleanupMode) => {
			let resolveWait!: (result: { ok: boolean; code: number }) => void;
			const pendingWait = new Promise<{ ok: boolean; code: number }>((resolve) => {
				resolveWait = resolve;
			});
			let resolveAbort!: () => void;
			const pendingAbort = new Promise<void>((resolve) => {
				resolveAbort = resolve;
			});
			const writerAbort = vi.fn((reason?: unknown) => {
				void reason;
				if (cleanupMode === 'throw') throw new Error('stdin cleanup threw');
				if (cleanupMode === 'reject') {
					return Promise.reject(new Error('stdin cleanup rejected'));
				}
				return pendingAbort;
			});
			const writer = {
				write: vi.fn(async () => {}),
				close: vi.fn(async () => {}),
				abort: writerAbort
			};
			const wait = vi.fn(() => pendingWait);
			const free = vi.fn(() => {
				if (cleanupMode === 'throw') throw new Error('instance cleanup threw');
			});
			commandRun.mockResolvedValueOnce({
				stdin: { getWriter: () => writer },
				stdout: byteStream(''),
				stderr: byteStream(''),
				wait,
				free
			});
			const sandbox = new Bash();
			await sandbox.load();
			const controller = new AbortController();
			const reason = new Error(`stop Bash with ${cleanupMode} cleanup`);
			const running = sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			});

			try {
				await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
				controller.abort(reason);
				await expect(observeSettlement(running)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				expect(writerAbort).toHaveBeenCalledOnce();
				expect(writerAbort).toHaveBeenCalledWith(reason);
				expect(free).not.toHaveBeenCalled();
				expect(sandbox.activeReject).toBeNull();
				expect(sandbox.activeRunCleanup).toBeNull();
				expect(sandbox.stdinWriter).toBeNull();
				expect(sandbox.instance).toBeNull();
				expect(sandbox.exit).toBe(true);
			} finally {
				resolveAbort();
				resolveWait({ ok: true, code: 0 });
				await running.catch(() => {});
			}
		}
	);

	it.each(['write', 'close'] as const)(
		'consumes a cancelled background stdin %s failure before retrying',
		async (operation) => {
			let markIoStarted!: () => void;
			const ioStarted = new Promise<void>((resolve) => {
				markIoStarted = resolve;
			});
			let rejectIo!: (reason: unknown) => void;
			const pendingIo = new Promise<void>((_resolve, reject) => {
				rejectIo = reject;
			});
			const write = vi.fn(() => {
				if (operation !== 'write') return Promise.resolve();
				markIoStarted();
				return pendingIo;
			});
			const close = vi.fn(() => {
				if (operation !== 'close') return Promise.resolve();
				markIoStarted();
				return pendingIo;
			});
			const writerAbort = vi.fn(async (reason?: unknown) => {
				rejectIo(reason);
			});
			let resolveWait!: (result: { ok: boolean; code: number }) => void;
			const wait = vi.fn(
				() =>
					new Promise<{ ok: boolean; code: number }>((resolve) => {
						resolveWait = resolve;
					})
			);
			commandRun.mockResolvedValueOnce({
				stdin: { getWriter: () => ({ write, close, abort: writerAbort }) },
				stdout: byteStream(''),
				stderr: byteStream(''),
				wait,
				free: vi.fn()
			});
			commandRun.mockResolvedValueOnce({
				stdin: undefined,
				stdout: byteStream('retry after stdin cancellation\n'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: vi.fn()
			});
			const sandbox = new Bash();
			const output: string[] = [];
			sandbox.output = (chunk) => output.push(chunk);
			await sandbox.load();
			const controller = new AbortController();
			const reason = new Error(`cancel pending Bash stdin ${operation}`);
			const running = sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			});

			try {
				await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
				if (operation === 'write') sandbox.write('pending\n');
				else sandbox.eof();
				await ioStarted;
				controller.abort(reason);
				await expect(observeSettlement(running)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				expect(writerAbort).toHaveBeenCalledWith(reason);
				await Promise.resolve();
				await Promise.resolve();
				await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
				expect(output).toEqual(['retry after stdin cancellation\n']);
			} finally {
				rejectIo(reason);
				resolveWait({ ok: true, code: 0 });
				await running.catch(() => {});
			}
		}
	);

	it('cancels stale output after cancellation and removes the signal listener after retry', async () => {
		const stdoutCancel = vi.fn();
		const stderrCancel = vi.fn();
		const oldStdout = new ReadableStream<Uint8Array>({
			cancel: stdoutCancel
		});
		const oldStderr = new ReadableStream<Uint8Array>({
			cancel: stderrCancel
		});
		let resolveOldWait!: (result: { ok: boolean; code: number }) => void;
		const oldWait = vi.fn(
			() =>
				new Promise<{ ok: boolean; code: number }>((resolve) => {
					resolveOldWait = resolve;
				})
		);
		const oldFree = vi.fn();
		const oldWriterAbort = vi.fn(async () => {});
		const oldWriterRelease = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: {
				getWriter: () => ({
					write: vi.fn(async () => {}),
					close: vi.fn(async () => {}),
					abort: oldWriterAbort,
					releaseLock: oldWriterRelease
				})
			},
			stdout: oldStdout,
			stderr: oldStderr,
			wait: oldWait,
			free: oldFree
		});
		const retryFree = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry only\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: retryFree
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();
		const oldController = new AbortController();
		const oldReason = new Error('replace stalled Bash wait');
		const oldRunning = sandbox.run('read old', false, true, undefined, [], {
			signal: oldController.signal
		});

		try {
			await vi.waitFor(() => expect(oldWait).toHaveBeenCalledOnce());
			oldController.abort(oldReason);
			await expect(oldRunning).rejects.toBe(oldReason);

			const retryController = new AbortController();
			await expect(
				sandbox.run('printf retry', false, true, undefined, [], {
					signal: retryController.signal
				})
			).resolves.toBe(true);
			const settledUid = sandbox.uid;
			retryController.abort(new Error('late retry abort'));
			expect(sandbox.uid).toBe(settledUid);
			expect(retryFree).not.toHaveBeenCalled();

			await vi.waitFor(() => expect(stdoutCancel).toHaveBeenCalledWith(oldReason));
			expect(stderrCancel).toHaveBeenCalledWith(oldReason);
			expect(oldWriterRelease).toHaveBeenCalledOnce();
			resolveOldWait({ ok: true, code: 0 });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(oldFree).not.toHaveBeenCalled();
			expect(oldWriterAbort).toHaveBeenCalledWith(oldReason);
			expect(output).toEqual(['retry only\n']);
		} finally {
			resolveOldWait({ ok: true, code: 0 });
			await oldRunning.catch(() => {});
		}
	});

	it('connects write and eof to a running Bash stdin stream', async () => {
		const writes: Uint8Array[] = [];
		const close = vi.fn(async () => {});
		const releaseLock = vi.fn();
		let finish: ((value: { ok: boolean; code: number }) => void) | undefined;
		const finished = new Promise<{ ok: boolean; code: number }>((resolve) => {
			finish = resolve;
		});
		const writer = {
			write: vi.fn(async (chunk: Uint8Array) => writes.push(chunk)),
			close,
			abort: vi.fn(async () => {}),
			releaseLock
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
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				mount: { '/workspace': { 'main.sh': 'read value; printf "%s\\n" "$value"' } },
				cwd: '/workspace'
			})
		);
		expect(commandRun.mock.calls[0]?.[0]).not.toHaveProperty('stdin');
	});

	it.each([
		{ name: 'success', result: { ok: true, code: 0 } },
		{ name: 'non-zero exit', result: { ok: false, code: 2 } }
	])('isolates explicit Bash stdin after $name', async ({ result }) => {
		let finishExplicit!: (value: { ok: boolean; code: number }) => void;
		const explicitFinished = new Promise<{ ok: boolean; code: number }>((resolve) => {
			finishExplicit = resolve;
		});
		const explicitWait = vi.fn(() => explicitFinished);
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream(''),
			stderr: byteStream(''),
			wait: explicitWait,
			free: vi.fn()
		});
		const writes: Uint8Array[] = [];
		const write = vi.fn(async (chunk: Uint8Array) => {
			writes.push(chunk);
		});
		const close = vi.fn(async () => {});
		let finishRetry!: (value: { ok: boolean; code: number }) => void;
		const retryFinished = new Promise<{ ok: boolean; code: number }>((resolve) => {
			finishRetry = resolve;
		});
		const retryWait = vi.fn(() => retryFinished);
		commandRun.mockResolvedValueOnce({
			stdin: {
				getWriter: () => ({ write, close, abort: vi.fn(async () => {}) })
			},
			stdout: byteStream(''),
			stderr: byteStream(''),
			wait: retryWait,
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load('/assets');
		sandbox.write('stale before explicit\n');
		sandbox.eof();
		const explicitRun = sandbox.run('read value', false, true, undefined, [], {
			stdin: 'explicit\n'
		});
		let retryRun: Promise<boolean | string> | undefined;

		try {
			await vi.waitFor(() => expect(explicitWait).toHaveBeenCalledOnce());
			expect(commandRun).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ stdin: 'explicit\n' })
			);
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);

			sandbox.write('stale during explicit\n');
			sandbox.eof();
			expect(sandbox.pendingInput).toEqual(['stale during explicit\n']);
			expect(sandbox.pendingEof).toBe(true);
			finishExplicit(result);
			if (result.ok) await expect(explicitRun).resolves.toBe(true);
			else await expect(explicitRun).rejects.toBe('Bash exited with status 2.');
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);

			retryRun = sandbox.run('read value', false);
			await vi.waitFor(() => expect(retryWait).toHaveBeenCalledOnce());
			expect(write).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
			sandbox.write('fresh\n');
			await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
			sandbox.eof();
			await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
			finishRetry({ ok: true, code: 0 });
			await expect(retryRun).resolves.toBe(true);
			expect(writes.map((chunk) => new TextDecoder().decode(chunk))).toEqual(['fresh\n']);
		} finally {
			finishExplicit(result);
			finishRetry({ ok: true, code: 0 });
			await explicitRun.catch(() => {});
			await retryRun?.catch(() => {});
		}
	});

	it.each([
		{
			name: 'empty path',
			code: 'printf ok',
			options: { activePath: '' },
			expected: { code: 'invalid-path', path: '' }
		},
		{
			name: 'traversal path',
			code: 'printf ok',
			options: { activePath: '../main.sh' },
			expected: { code: 'invalid-path', path: '../main.sh' }
		},
		{
			name: 'absolute path',
			code: 'printf ok',
			options: { activePath: '/tmp/main.sh' },
			expected: { code: 'invalid-path', path: '/tmp/main.sh' }
		},
		{
			name: 'NUL path',
			code: 'printf ok',
			options: { activePath: 'bad\0.sh' },
			expected: { code: 'invalid-path', path: 'bad\0.sh' }
		},
		{
			name: 'URL-style path',
			code: 'printf ok',
			options: { activePath: 'file:main.sh' },
			expected: { code: 'invalid-path', path: 'file:main.sh' }
		},
		{
			name: 'duplicate path',
			code: 'printf ok',
			options: {
				workspaceFiles: [
					{ path: 'lib/helper.sh', content: 'printf first' },
					{ path: 'lib\\helper.sh', content: 'printf second' }
				]
			},
			expected: { code: 'duplicate-path', path: 'lib/helper.sh' }
		},
		{
			name: 'active-path case collision',
			code: 'printf ok',
			options: {
				activePath: 'main.sh',
				workspaceFiles: [
					{ path: 'MAIN.sh', content: 'printf first stale' },
					{ path: 'main.sh', content: 'printf second stale' }
				]
			},
			expected: { code: 'case-collision', path: 'main.sh' }
		},
		{
			name: 'file count overflow',
			code: 'x',
			options: {
				workspaceFiles: [{ path: 'helper.sh', content: 'y' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'path byte overflow',
			code: 'x',
			options: {
				activePath: 'é',
				workspaceLimits: { maxPathBytes: 1 }
			},
			expected: { code: 'path-size-limit', path: 'é', limit: 1, actual: 2 }
		},
		{
			name: 'per-file overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 5 }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 10 },
				workspaceFiles: [{ path: 'helper.sh', content: '123456' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 10, actual: 11 }
		}
	])(
		'rejects a Bash workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			commandRun.mockResolvedValue({
				stdin: undefined,
				stdout: byteStream('retry\n'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: vi.fn()
			});
			const sandbox = new Bash();
			await sandbox.load('/assets');
			const runtimePackage = sandbox.runtimePackage;
			const webcUrl = sandbox.webcUrl;
			sandbox.write('queued\n');
			sandbox.eof();

			await expect(
				sandbox.run(code, false, true, undefined, [], {
					...options,
					stdin: 'replacement\n'
				})
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(commandRun).not.toHaveBeenCalled();
			expect(sandbox.runtimePackage).toBe(runtimePackage);
			expect(sandbox.webcUrl).toBe(webcUrl);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued\n']);
			expect(sandbox.pendingEof).toBe(true);
			expect(sandbox.activeReject).toBeNull();
			expect(sandbox.activeRunCleanup).toBeNull();

			await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
			expect(commandRun).toHaveBeenCalledOnce();
		}
	);

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
			activePath: 'scripts\\main.sh',
			workspaceFiles: [
				{ path: 'lib\\helper.sh', content: 'helper() { printf "helper\\n"; }' },
				{ path: 'scripts\\main.sh', content: 'printf stale' }
			]
		});

		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				args: ['-c', 'source lib/helper.sh; helper', 'scripts/main.sh'],
				mount: {
					'/workspace': {
						'lib/helper.sh': 'helper() { printf "helper\\n"; }',
						'scripts/main.sh': 'source lib/helper.sh; helper'
					}
				}
			})
		);
	});

	it('enforces the aggregate Bash startup deadline and aborts an in-flight WEBc fetch', async () => {
		vi.useFakeTimers();
		let resolveFetch: ((response: Response) => void) | undefined;
		let requestSignal: AbortSignal | undefined;
		let replacement: Promise<void> | undefined;
		const sandbox = new Bash();
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			requestSignal = init?.signal ?? undefined;
			requestSignal?.addEventListener(
				'abort',
				() => {
					replacement = sandbox.load('/startup-timeout-replacement');
				},
				{ once: true }
			);
			return new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			});
		});
		const progress = { set: vi.fn() };
		const loading = sandbox.load(
			'/startup-timeout',
			'',
			true,
			[],
			{ limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 } },
			progress
		);
		const rejected = loading.catch((reason: unknown) => reason);

		expect(requestSignal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(12);
		const timeout = await rejected;
		expect(timeout).toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'BASH',
			timeoutMs: 12
		});
		expect(requestSignal?.aborted).toBe(true);
		expect(requestSignal?.reason).toBe(timeout);
		await expect(replacement).resolves.toBeUndefined();
		const progressCalls = progress.set.mock.calls.length;

		resolveFetch?.(new Response(new Uint8Array([0, 97, 115, 109])));
		vi.useRealTimers();
		await vi.waitFor(() => expect(fromFile).toHaveBeenCalledOnce());
		expect(progress.set).toHaveBeenCalledTimes(progressCalls);
		expect(sandbox.webcUrl).toMatch(/\/startup-timeout-replacement\/wasm-bash\/bash\.webc$/);
	});

	it('caps the aggregate Bash startup deadline at the host timer maximum', async () => {
		vi.useFakeTimers();
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		let resolveFetch: ((response: Response) => void) | undefined;
		vi.mocked(fetch).mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				})
		);
		const sandbox = new Bash();
		const loading = sandbox.load('/capped-startup-timeout', '', true, [], {
			limits: {
				assetTimeoutMs: Number.MAX_SAFE_INTEGER,
				startupTimeoutMs: Number.MAX_SAFE_INTEGER
			}
		});
		const reason = new Error('stop capped Bash startup');

		expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
		sandbox.terminate(reason);
		await expect(loading).rejects.toBe(reason);
		expect(vi.getTimerCount()).toBe(0);

		resolveFetch?.(new Response(new Uint8Array([0, 97, 115, 109])));
		await vi.advanceTimersByTimeAsync(0);
	});

	it('frees a Bash package that arrives after the startup deadline', async () => {
		vi.useFakeTimers();
		let resolvePackage:
			| ((value: {
					entrypoint: { run: typeof commandRun };
					free: ReturnType<typeof vi.fn>;
			  }) => void)
			| undefined;
		const latePackageFree = vi.fn();
		fromFile.mockReturnValueOnce(
			new Promise((resolve) => {
				resolvePackage = resolve;
			})
		);
		const sandbox = new Bash();
		const loading = sandbox.load('/late-package-timeout', '', true, [], {
			limits: { assetTimeoutMs: 3, startupTimeoutMs: 5 }
		});
		const rejected = loading.catch((reason: unknown) => reason);
		await vi.advanceTimersByTimeAsync(0);
		expect(fromFile).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(8);
		const timeout = await rejected;
		expect(timeout).toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'BASH',
			timeoutMs: 8
		});

		resolvePackage?.({ entrypoint: { run: commandRun }, free: latePackageFree });
		await vi.waitFor(() => expect(latePackageFree).toHaveBeenCalledOnce());
		vi.useRealTimers();
		await expect(sandbox.load('/late-package-timeout-retry')).resolves.toBeUndefined();
		expect(sandbox.webcUrl).toMatch(/\/late-package-timeout-retry\/wasm-bash\/bash\.webc$/);
	});

	it('enforces the aggregate Bash execution deadline and frees a late instance', async () => {
		let resolveInstance:
			| ((value: {
					stdin: undefined;
					stdout: ReadableStream<Uint8Array>;
					stderr: ReadableStream<Uint8Array>;
					wait: ReturnType<typeof vi.fn>;
					free: ReturnType<typeof vi.fn>;
			  }) => void)
			| undefined;
		const lateInstanceFree = vi.fn();
		commandRun.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveInstance = resolve;
			})
		);
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry only\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load('/execution-timeout');
		const controller = new AbortController();
		const callerReason = new Error('late caller cancellation after Bash timeout');
		vi.useFakeTimers();
		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 },
			signal: controller.signal
		});
		const rejected = running.catch((reason: unknown) => reason);
		expect(commandRun).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(10);
		const timeout = await rejected;
		expect(timeout).toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'BASH',
			timeoutMs: 10
		});
		expect(vi.getTimerCount()).toBe(0);
		controller.abort(callerReason);
		await vi.advanceTimersByTimeAsync(0);
		expect(output).toEqual([]);

		resolveInstance?.({
			stdin: undefined,
			stdout: byteStream('stale output\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: lateInstanceFree
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(lateInstanceFree).toHaveBeenCalledOnce();

		vi.useRealTimers();
		await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
		expect(output).toEqual(['retry only\n']);
	});

	it('times out a consumed Bash wait without freeing its transferred instance', async () => {
		let resolveWait: ((value: { ok: boolean; code: number }) => void) | undefined;
		const wait = vi.fn(
			() =>
				new Promise<{ ok: boolean; code: number }>((resolve) => {
					resolveWait = resolve;
				})
		);
		const instanceFree = vi.fn();
		const writerAbort = vi.fn(async () => undefined);
		const writerRelease = vi.fn();
		const writer = {
			write: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			abort: writerAbort,
			releaseLock: writerRelease
		} as unknown as WritableStreamDefaultWriter;
		const stdoutCancel = vi.fn();
		const stderrCancel = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: { getWriter: vi.fn(() => writer) } as unknown as WritableStream<Uint8Array>,
			stdout: new ReadableStream<Uint8Array>({ cancel: stdoutCancel }),
			stderr: new ReadableStream<Uint8Array>({ cancel: stderrCancel }),
			wait,
			free: instanceFree
		});
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load('/wait-timeout');
		vi.useFakeTimers();
		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			limits: { compileTimeoutMs: 40, runTimeoutMs: 60 }
		});
		const rejected = running.catch((reason: unknown) => reason);
		await vi.advanceTimersByTimeAsync(0);
		expect(wait).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(100);
		const timeout = await rejected;
		expect(timeout).toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'BASH',
			timeoutMs: 100
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(writerAbort).toHaveBeenCalledWith(timeout);
		expect(writerRelease).toHaveBeenCalledOnce();
		expect(stdoutCancel).toHaveBeenCalledWith(timeout);
		expect(stderrCancel).toHaveBeenCalledWith(timeout);
		expect(instanceFree).not.toHaveBeenCalled();

		resolveWait?.({ ok: true, code: 0 });
		await vi.advanceTimersByTimeAsync(0);
		vi.useRealTimers();
		await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
		expect(instanceFree).not.toHaveBeenCalled();
	});

	it('clears settled Bash deadlines before they can affect an idle runtime', async () => {
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream('ok\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		vi.useFakeTimers();
		const sandbox = new Bash();
		await sandbox.load('/settled-deadlines', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		await expect(
			sandbox.run('printf ok', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);
		const runtimePackage = sandbox.runtimePackage;
		const uid = sandbox.uid;
		expect(vi.getTimerCount()).toBe(0);

		await vi.advanceTimersByTimeAsync(20);
		expect(sandbox.runtimePackage).toBe(runtimePackage);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
		await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reports a non-zero Bash exit status after forwarding stderr', async () => {
		const free = vi.fn();
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream(''),
			stderr: byteStream('main.sh: syntax error\n'),
			wait: vi.fn(async () => ({ ok: false, code: 2 })),
			free
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();

		await expect(sandbox.run('if', false)).rejects.toBe('Bash exited with status 2.');
		expect(output.join('')).toContain('syntax error');
		expect(free).not.toHaveBeenCalled();
	});

	it('does not free a Bash instance after wait consumes it and rejects', async () => {
		const failure = new Error('Bash wait failed');
		const free = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream(''),
			stderr: byteStream(''),
			wait: vi.fn(async () => {
				throw failure;
			}),
			free
		});
		const sandbox = new Bash();
		await sandbox.load();

		await expect(sandbox.run('exit 0', false)).rejects.toBe(failure.message);

		expect(free).not.toHaveBeenCalled();
		expect(sandbox.instance).toBeNull();
	});

	it('detaches a Bash package when SDK cleanup throws and keeps clear idempotent', async () => {
		const cleanupFailure = new Error('Bash package cleanup failed');
		const free = vi.fn(() => {
			throw cleanupFailure;
		});
		fromFile.mockResolvedValueOnce({ entrypoint: { run: commandRun }, free });
		const sandbox = new Bash();
		await sandbox.load();

		await expect(sandbox.clear()).resolves.toBeUndefined();
		await expect(sandbox.clear()).resolves.toBeUndefined();

		expect(free).toHaveBeenCalledOnce();
		expect(sandbox.runtimePackage).toBeNull();

		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		await expect(sandbox.load('/retry')).resolves.toBeUndefined();
		await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
	});
});
