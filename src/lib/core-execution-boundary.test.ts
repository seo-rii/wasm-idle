import {
	DEFAULT_EXECUTION_LIMITS,
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	createPlaygroundBinding,
	type ExecutionResult,
	type Sandbox
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

function createSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
	return {
		constructor: Object,
		eof: vi.fn(),
		load: vi.fn(async () => undefined),
		run: vi.fn(async () => true),
		terminate: vi.fn(),
		clear: vi.fn(async () => undefined),
		...overrides
	};
}

const completedResult: ExecutionResult = {
	ok: true,
	exitCode: 0,
	stdout: '',
	stderr: '',
	diagnostics: [],
	artifacts: [],
	timings: { assetMs: 0, startupMs: 0, compileMs: 0, executeMs: 0, totalMs: 0 },
	terminationReason: 'completed',
	runtime: {
		languageId: 'C',
		implementationId: 'clang',
		version: '22.1.8',
		protocolVersion: 1
	}
};

const resourceTrustProfile = {
	schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	profileId: 'resource-admission-test',
	network: { mode: 'allowlist' as const, allowedOrigins: ['https://cdn.example.com'] },
	storage: { mode: 'ephemeral' as const },
	environment: { mode: 'allowlist' as const, allowedNames: ['MODE'] },
	threads: { maxThreads: 4 },
	workers: { maxNestedWorkers: 3 },
	sharedArrayBuffer: true,
	dynamicCode: 'javascript-and-wasm' as const,
	sameOriginAccess: false
};

describe('core execution boundary', () => {
	it('leaves targeted run-ID cancellation to the adapter', async () => {
		let finishRun!: (value: boolean | string) => void;
		const cancel = vi.fn(async (_runId?: string) => undefined);
		const binding = createPlaygroundBinding('/runtime', async () =>
			createSandbox({
				run: () =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					}),
				cancel
			})
		);
		const sandbox = await binding.load('C');
		const operation = sandbox.run('', false);
		await Promise.resolve();
		await sandbox.cancel!('an-older-run');
		expect(cancel).toHaveBeenCalledWith('an-older-run');
		finishRun(true);
		await expect(operation).resolves.toBe(true);
		await binding.dispose();
	});

	it.each(['cancel', 'kill', 'terminate'] as const)(
		'applies the cancellation deadline to explicit %s calls',
		async (method) => {
			vi.useFakeTimers();
			const cancel = vi.fn(async () => undefined);
			const dispose = vi.fn(async () => undefined);
			const raw = createSandbox({
				run: () => new Promise<boolean | string>(() => undefined),
				dispose,
				[method]: cancel
			});
			const binding = createPlaygroundBinding('/runtime', async () => raw);
			const sandbox = await binding.load('C');
			const run = sandbox.run('', false);
			const rejectedRun = expect(run).rejects.toMatchObject({ code: 'cancelled' });
			await Promise.resolve();
			const cancellation = sandbox[method]!();
			const rejectedCancellation = expect(cancellation).rejects.toMatchObject({
				code: 'timeout',
				phase: 'dispose'
			});
			expect(sandbox[method]!()).toBe(cancellation);
			await rejectedRun;
			expect(cancel).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1_000);
			await rejectedCancellation;
			await expect(sandbox.run('', false)).rejects.toMatchObject({
				code: 'runtime-configuration',
				phase: 'dispose'
			});
			expect(dispose).toHaveBeenCalledOnce();
			await binding.dispose();
		}
	);

	it('awaits cooperative explicit cancellation before admitting a second operation', async () => {
		let finishRun!: (value: boolean | string) => void;
		const cancel = vi.fn(async () => {
			finishRun(false);
		});
		const raw = createSandbox({
			run: vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<boolean | string>((resolve) => {
							finishRun = resolve;
						})
				)
				.mockResolvedValue(true),
			cancel
		});
		const binding = createPlaygroundBinding('/runtime', async () => raw);
		const sandbox = await binding.load('C');
		const first = sandbox.run('', false);
		const rejection = expect(first).rejects.toMatchObject({ code: 'cancelled' });
		await Promise.resolve();
		await sandbox.cancel!();
		await rejection;
		await expect(sandbox.run('', false)).resolves.toBe(true);
		await binding.dispose();
	});

	it('honors an explicit cancellation before asynchronous operation dispatch', async () => {
		const cancel = vi.fn(async () => undefined);
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () =>
			createSandbox({ run, cancel })
		);
		const sandbox = await binding.load('C');
		const first = sandbox.run('', false);
		const rejection = expect(first).rejects.toMatchObject({ code: 'cancelled' });
		await sandbox.cancel!();
		await rejection;
		expect(run).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
		await expect(sandbox.run('', false)).resolves.toBe(true);
		await binding.dispose();
	});

	it.each(['throw', 'reject'] as const)(
		'preserves cancellation when adapter cleanup fails by %s',
		async (failure) => {
			const cleanupError = new Error('cancel failed');
			const dispose = vi.fn(async () => undefined);
			const raw = createSandbox({
				run: () => new Promise<boolean | string>(() => undefined),
				dispose,
				cancel: () => {
					if (failure === 'throw') throw cleanupError;
					return Promise.reject(cleanupError);
				}
			});
			const binding = createPlaygroundBinding('/runtime', async () => raw);
			const sandbox = await binding.load('C');
			const controller = new AbortController();
			const operation = sandbox.run('', false, false, undefined, [], {
				signal: controller.signal
			});
			await Promise.resolve();
			controller.abort('original reason');
			await expect(operation).rejects.toMatchObject({
				code: 'cancelled',
				phase: 'execute',
				cause: 'original reason'
			});
			await expect(sandbox.run('', false)).rejects.toMatchObject({
				code: 'runtime-configuration',
				phase: 'dispose'
			});
			expect(dispose).toHaveBeenCalledOnce();
			await binding.dispose();
		}
	);

	it.each(['operation', 'cancellation'] as const)(
		'retires an adapter with a hung %s and permits a fresh binding instance',
		async (hung) => {
			vi.useFakeTimers();
			let finishRun!: (result: boolean | string) => void;
			const run = vi.fn(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			);
			const dispose = vi.fn(async () => undefined);
			const broken = createSandbox({
				run,
				dispose,
				cancel: () =>
					hung === 'operation' ? Promise.resolve() : new Promise<void>(() => undefined)
			});
			const fresh = createSandbox();
			const loader = vi.fn().mockResolvedValueOnce(broken).mockResolvedValue(fresh);
			const binding = createPlaygroundBinding('/runtime', loader);
			const sandbox = await binding.load('C');
			const output = vi.fn();
			sandbox.output = output;
			const controller = new AbortController();
			const operation = sandbox.run('old', false, false, undefined, [], {
				signal: controller.signal
			});
			const rejection = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
			await Promise.resolve();
			const oldOutput = broken.output!;
			controller.abort();
			await rejection;
			if (hung === 'cancellation') finishRun(true);
			await expect(sandbox.run('too soon', false)).rejects.toMatchObject({ code: 'busy' });
			await vi.advanceTimersByTimeAsync(1_000);

			expect(dispose).toHaveBeenCalledOnce();
			await expect(sandbox.run('retired', false)).rejects.toMatchObject({
				code: 'runtime-configuration',
				phase: 'dispose'
			});
			const replacement = await binding.load('C');
			replacement.output = output;
			const nextOperation = replacement.run('fresh', false);
			oldOutput('late captured output');
			broken.output?.('late direct output');
			finishRun(true);
			await expect(nextOperation).resolves.toBe(true);
			expect(output).not.toHaveBeenCalled();
			await binding.dispose();
			expect(dispose).toHaveBeenCalledOnce();
		}
	);

	it('drops inactive and stale-generation output without interrupting current output', async () => {
		let finishRun!: (result: boolean | string) => void;
		const raw = createSandbox({
			run: vi.fn(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			)
		});
		const binding = createPlaygroundBinding('/runtime', async () => raw);
		const sandbox = await binding.load('C');
		const output = vi.fn();
		const diagnostics = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostics;
		raw.output?.('before a run');
		const first = sandbox.run('first', false);
		await Promise.resolve();
		const oldOutput = raw.output!;
		const oldDiagnostic = raw.oncompilerdiagnostic!;
		oldOutput('first');
		finishRun(true);
		await first;
		oldOutput('after completion');
		oldDiagnostic({ message: 'after completion' });
		const second = sandbox.run('second', false);
		await Promise.resolve();
		oldOutput('old during new run');
		oldDiagnostic({ message: 'old during new run' });
		raw.output?.('second');
		raw.oncompilerdiagnostic?.({ message: 'second' });
		finishRun(true);
		await second;
		await sandbox.dispose?.();
		raw.output?.('after disposal');
		expect(output.mock.calls).toEqual([['first'], ['second']]);
		expect(diagnostics.mock.calls).toEqual([[{ message: 'second' }]]);
	});

	it('mutes output as soon as cancellation settles, before cooperative cleanup finishes', async () => {
		vi.useFakeTimers();
		const raw = createSandbox({
			run: () => new Promise<boolean | string>(() => undefined),
			cancel: async () => undefined
		});
		const binding = createPlaygroundBinding('/runtime', async () => raw);
		const sandbox = await binding.load('C');
		const output = vi.fn();
		sandbox.output = output;
		const controller = new AbortController();
		const operation = sandbox.run('code', false, false, undefined, [], {
			signal: controller.signal
		});
		const rejection = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
		await Promise.resolve();
		controller.abort();
		await rejection;
		raw.output?.('late');
		expect(output).not.toHaveBeenCalled();
		await binding.dispose();
	});

	it('resolves execution limits and applies their workspace ceiling to legacy runs', async () => {
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ run }));
		const sandbox = await binding.load('C');

		await sandbox.run('int main() {}', false, false, undefined, [], {
			limits: { runTimeoutMs: 1234, maxWorkspaceBytes: 1024 },
			workspaceLimits: { maxTotalBytes: 4096 }
		});

		expect(run).toHaveBeenCalledWith(
			'int main() {}',
			false,
			false,
			undefined,
			[],
			expect.objectContaining({
				limits: {
					...DEFAULT_EXECUTION_LIMITS,
					runTimeoutMs: 1234,
					maxWorkspaceBytes: 1024
				},
				workspaceLimits: expect.objectContaining({ maxTotalBytes: 1024 })
			})
		);
	});

	it('rejects a pre-aborted operation before invoking a sandbox', async () => {
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ run }));
		const sandbox = await binding.load('C');
		const controller = new AbortController();
		controller.abort('user cancelled');

		await expect(
			sandbox.run('int main() {}', false, false, undefined, [], {
				signal: controller.signal
			})
		).rejects.toMatchObject({ code: 'cancelled', phase: 'execute' });
		expect(run).not.toHaveBeenCalled();
	});

	it('cancels and settles an active legacy run when its signal aborts', async () => {
		const run = vi.fn(() => new Promise<boolean | string>(() => undefined));
		const cancel = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding('/runtime', async () =>
			createSandbox({ run, cancel })
		);
		const sandbox = await binding.load('C');
		const controller = new AbortController();

		const operation = sandbox.run('int main() {}', false, false, undefined, [], {
			signal: controller.signal
		});
		await Promise.resolve();
		controller.abort('stop this run');

		await expect(operation).rejects.toMatchObject({
			code: 'cancelled',
			phase: 'execute',
			cause: 'stop this run'
		});
		expect(run).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not start a runtime operation when cancellation wins the scheduling race', async () => {
		const run = vi.fn(async () => true);
		const cancel = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding('/runtime', async () =>
			createSandbox({ run, cancel })
		);
		const sandbox = await binding.load('C');
		const controller = new AbortController();

		const operation = sandbox.run('int main() {}', false, false, undefined, [], {
			signal: controller.signal
		});
		const rejection = expect(operation).rejects.toMatchObject({ code: 'cancelled' });
		controller.abort();

		await rejection;
		expect(run).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
		await expect(sandbox.run('int main() {}', false)).resolves.toBe(true);
	});

	it('keeps an explicitly interactive run alive beyond the ordinary run deadline', async () => {
		vi.useFakeTimers();
		try {
			let finishRun: ((result: boolean | string) => void) | undefined;
			const run = vi.fn(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			);
			const cancel = vi.fn(async () => undefined);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ run, cancel })
			);
			const sandbox = await binding.load('C');

			const operation = sandbox.run('int main() {}', false, false, undefined, [], {
				interactive: true,
				limits: { compileTimeoutMs: 10, runTimeoutMs: 15 }
			});
			const outcome = operation.then(
				(value) => ({ value }),
				(error: unknown) => ({ error })
			);
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(250);
			finishRun?.(true);

			expect(await outcome).toEqual({ value: true });
			expect(cancel).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives network-backed preparation asset, startup, and compile time budgets', async () => {
		vi.useFakeTimers();
		try {
			let finishRun: ((result: boolean | string) => void) | undefined;
			const run = vi.fn(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			);
			const cancel = vi.fn(async () => undefined);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ run, cancel })
			);
			const sandbox = await binding.load('C');

			const operation = sandbox.run('int main() {}', true, false, undefined, [], {
				limits: {
					assetTimeoutMs: 10,
					startupTimeoutMs: 10,
					compileTimeoutMs: 10,
					runTimeoutMs: 5
				}
			});
			const outcome = operation.then(
				(value) => ({ value }),
				(error: unknown) => ({ error })
			);
			await Promise.resolve();

			// Preparing can legitimately include lazy compiler and toolchain downloads.
			// It must therefore survive the old compile-plus-run deadline (15 ms here).
			await vi.advanceTimersByTimeAsync(20);
			expect(cancel).not.toHaveBeenCalled();
			finishRun?.(true);

			expect(await outcome).toEqual({ value: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps prepare bounded even when the following run will be interactive', async () => {
		vi.useFakeTimers();
		try {
			let finishRun: ((result: boolean | string) => void) | undefined;
			const run = vi.fn(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			);
			const cancel = vi.fn(async () => undefined);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ run, cancel })
			);
			const sandbox = await binding.load('C');
			const operation = sandbox.run('int main() {}', true, false, undefined, [], {
				interactive: true,
				limits: {
					assetTimeoutMs: 5,
					startupTimeoutMs: 7,
					compileTimeoutMs: 10,
					runTimeoutMs: 15
				}
			});
			const rejection = expect(operation).rejects.toMatchObject({
				code: 'timeout',
				phase: 'execute',
				timeoutMs: 22
			});
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(22);

			await rejection;
			expect(cancel).toHaveBeenCalledOnce();
			finishRun?.(true);
			await Promise.resolve();
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects a non-boolean interactive run contract before invoking the sandbox', async () => {
		const run = vi.fn(async () => true);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ run }));
		const sandbox = await binding.load('C');

		await expect(
			sandbox.run('int main() {}', false, false, undefined, [], {
				interactive: 'yes' as unknown as boolean
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', phase: 'execute' });
		expect(run).not.toHaveBeenCalled();
	});

	it('keeps structured execution exclusive until a timed-out runtime actually settles', async () => {
		vi.useFakeTimers();
		try {
			let finishExecution: ((result: ExecutionResult) => void) | undefined;
			let finishCancellation: (() => void) | undefined;
			const execute = vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<ExecutionResult>((resolve) => {
							finishExecution = resolve;
						})
				)
				.mockResolvedValue(completedResult);
			const cancel = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finishCancellation = resolve;
					})
			);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ execute, cancel })
			);
			const sandbox = await binding.load('C');

			const operation = sandbox.execute!({
				code: 'int main() {}',
				limits: { compileTimeoutMs: 10, runTimeoutMs: 15 }
			});
			const rejection = expect(operation).rejects.toMatchObject({
				code: 'timeout',
				phase: 'execute',
				timeoutMs: 25
			});
			await Promise.resolve();
			await expect(sandbox.execute!({ code: 'int second() {}' })).rejects.toMatchObject({
				code: 'busy',
				phase: 'execute'
			});
			await vi.advanceTimersByTimeAsync(25);

			await rejection;
			await expect(sandbox.execute!({ code: 'int third() {}' })).rejects.toMatchObject({
				code: 'busy',
				phase: 'execute'
			});
			finishExecution?.(completedResult);
			await Promise.resolve();
			await Promise.resolve();
			await expect(sandbox.execute!({ code: 'int fourth() {}' })).rejects.toMatchObject({
				code: 'busy',
				phase: 'execute'
			});
			finishCancellation?.();
			await Promise.resolve();
			await Promise.resolve();
			await expect(sandbox.execute!({ code: 'int fifth() {}' })).resolves.toBe(
				completedResult
			);
			expect(execute).toHaveBeenCalledTimes(2);
			expect(cancel).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('applies the startup deadline to sandbox loading', async () => {
		vi.useFakeTimers();
		try {
			const load = vi.fn(() => new Promise<void>(() => undefined));
			const cancel = vi.fn(async () => undefined);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ load, cancel })
			);
			const sandbox = await binding.load('C');

			const operation = sandbox.load('', false, [], {
				interactive: true,
				limits: { assetTimeoutMs: 5, startupTimeoutMs: 15 }
			});
			const rejection = expect(operation).rejects.toMatchObject({
				code: 'timeout',
				phase: 'startup',
				timeoutMs: 20
			});
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(20);

			await rejection;
			expect(load).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('blocks streamed output at the UTF-8 byte budget and cancels the runtime', async () => {
		let finishRun: ((result: boolean | string) => void) | undefined;
		let finishCancellation: (() => void) | undefined;
		const run = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean | string>((resolve) => {
						finishRun = resolve;
					})
			)
			.mockResolvedValue(true);
		const cancel = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCancellation = resolve;
				})
		);
		const rawSandbox = createSandbox({ run, cancel });
		const binding = createPlaygroundBinding('/runtime', async () => rawSandbox);
		const sandbox = await binding.load('C');
		const output = vi.fn();
		sandbox.output = output;

		const operation = sandbox.run('int main() {}', false, false, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const rejection = expect(operation).rejects.toMatchObject({
			code: 'output-limit',
			phase: 'execute',
			limit: 5,
			actual: 6
		});
		await Promise.resolve();
		rawSandbox.output?.('1234');
		rawSandbox.output?.('é');

		await rejection;
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('1234');
		expect(cancel).toHaveBeenCalledOnce();
		finishRun?.(true);
		await Promise.resolve();
		await Promise.resolve();
		await expect(sandbox.run('int second() {}', false)).rejects.toMatchObject({
			code: 'busy',
			phase: 'execute'
		});
		finishCancellation?.();
		await Promise.resolve();
		await Promise.resolve();
		await expect(sandbox.run('int third() {}', false)).resolves.toBe(true);
	});

	it('validates structured output and diagnostic budgets before returning results', async () => {
		const diagnostic = { message: 'warning', severity: 'warning' as const };
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ ...completedResult, stdout: 'ééé' })
			.mockResolvedValueOnce({
				...completedResult,
				diagnostics: [diagnostic, diagnostic]
			});
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ execute }));
		const sandbox = await binding.load('C');

		await expect(
			sandbox.execute!({ code: 'int main() {}', limits: { maxOutputBytes: 5 } })
		).rejects.toMatchObject({
			code: 'output-limit',
			limit: 5,
			actual: 6
		});
		await expect(
			sandbox.execute!({ code: 'int main() {}', limits: { maxDiagnostics: 1 } })
		).rejects.toMatchObject({
			code: 'diagnostic-limit',
			phase: 'compile',
			limit: 1,
			actual: 2
		});
	});

	it('cleans deadline and abort listeners after successful execution', async () => {
		vi.useFakeTimers();
		try {
			const run = vi.fn(async () => true);
			const cancel = vi.fn(async () => undefined);
			const binding = createPlaygroundBinding('/runtime', async () =>
				createSandbox({ run, cancel })
			);
			const sandbox = await binding.load('C');
			const controller = new AbortController();

			await expect(
				sandbox.run('int main() {}', false, false, undefined, [], {
					signal: controller.signal,
					limits: { compileTimeoutMs: 10, runTimeoutMs: 15 }
				})
			).resolves.toBe(true);
			expect(vi.getTimerCount()).toBe(0);
			controller.abort();
			expect(cancel).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('normalizes structured requests before forwarding execute', async () => {
		const execute = vi.fn(async () => completedResult);
		const binding = createPlaygroundBinding('/runtime', async () => createSandbox({ execute }));
		const sandbox = await binding.load('C');

		await expect(
			sandbox.execute?.({
				code: 'int helper();',
				activePath: 'src\\main.c',
				workspaceFiles: [{ path: 'src\\helper.c', content: 'int helper() { return 1; }' }],
				limits: { compileTimeoutMs: 4321 }
			})
		).resolves.toBe(completedResult);
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				activePath: 'src/main.c',
				workspaceFiles: [{ path: 'src/helper.c', content: 'int helper() { return 1; }' }],
				limits: { ...DEFAULT_EXECUTION_LIMITS, compileTimeoutMs: 4321 }
			})
		);
	});

	it('admits and normalizes declared runtime requirements before dispatch', async () => {
		const execute = vi.fn(async () => completedResult);
		const binding = createPlaygroundBinding(
			'/runtime',
			async () => createSandbox({ execute }),
			{ trustProfile: resourceTrustProfile }
		);
		const sandbox = await binding.load('C');

		await sandbox.execute!({
			code: 'int main() {}',
			env: { MODE: 'test' },
			runtimeRequirements: {
				wasmMemoryBytes: 64,
				networkUrls: ['https://cdn.example.com/pkg/../runtime.wasm'],
				pageOrigin: 'https://app.example.com',
				storage: 'ephemeral',
				threads: 2,
				nestedWorkers: 1,
				sharedArrayBuffer: true,
				dynamicCode: 'wasm-only'
			},
			limits: { maxWasmMemoryBytes: 128, maxThreads: 2, maxWorkers: 1 }
		});

		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				env: { MODE: 'test' },
				runtimeRequirements: {
					wasmMemoryBytes: 64,
					networkUrls: ['https://cdn.example.com/runtime.wasm'],
					pageOrigin: 'https://app.example.com',
					storage: 'ephemeral',
					threads: 2,
					nestedWorkers: 1,
					sharedArrayBuffer: true,
					dynamicCode: 'wasm-only',
					sameOriginAccess: false
				}
			})
		);
	});

	it('rejects undeclared and over-budget runtime requirements before dispatch', async () => {
		const untrustedExecute = vi.fn(async () => completedResult);
		const untrustedBinding = createPlaygroundBinding('/runtime', async () =>
			createSandbox({ execute: untrustedExecute })
		);
		const untrustedSandbox = await untrustedBinding.load('C');
		await expect(
			untrustedSandbox.execute!({
				code: 'int main() {}',
				runtimeRequirements: { wasmMemoryBytes: 1 }
			})
		).rejects.toThrow('without a trust profile');
		expect(untrustedExecute).not.toHaveBeenCalled();

		const execute = vi.fn(async () => completedResult);
		const binding = createPlaygroundBinding(
			'/runtime',
			async () => createSandbox({ execute }),
			{ trustProfile: resourceTrustProfile }
		);
		const sandbox = await binding.load('C');
		for (const [runtimeRequirements, expected] of [
			[{ wasmMemoryBytes: 129 }, '129 Wasm memory bytes'],
			[{ threads: 3, sharedArrayBuffer: true }, '3 threads'],
			[{ nestedWorkers: 2 }, '2 nested workers']
		] as const) {
			await expect(
				sandbox.execute!({
					code: 'int main() {}',
					runtimeRequirements,
					limits: { maxWasmMemoryBytes: 128, maxThreads: 2, maxWorkers: 1 }
				})
			).rejects.toThrow(expected);
		}
		expect(execute).not.toHaveBeenCalled();
	});
});
