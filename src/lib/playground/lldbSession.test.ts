import { ProtocolError } from '@wasm-idle/core';
import { DapProtocolError } from '@wasm-idle/llvm-core/debug';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
	session: null as FakeRuntimeSession | null,
	options: null as Record<string, unknown> | null,
	initializeCapabilities: {} as Record<string, unknown>,
	initializeGate: null as Promise<void> | null,
	continueGate: null as Promise<void> | null,
	pauseGate: null as Promise<void> | null,
	disposeGate: null as Promise<void> | null,
	scopesErrorFrameId: null as number | null,
	requestErrors: new Map<string, Error>(),
	responseOverrides: new Map<string, unknown>(),
	breakpointResponseGates: [] as Array<
		Promise<{
			breakpoints?: Array<{ verified?: boolean; line?: number; message?: string }>;
		}>
	>
}));
const { loadManifest } = vi.hoisted(() => ({
	loadManifest: vi.fn()
}));

vi.mock('$lib/playground/lldbManifest', () => ({
	loadVerifiedDebugRuntimeManifest: loadManifest
}));

class FakeRuntimeSession {
	readonly requests: Array<{ command: string; args?: unknown }> = [];
	readonly breakpointRequests: Array<{ source: { path: string }; lines: number[] }> = [];
	readonly input: string[] = [];
	readonly resolvedBreakpointsBySource = new Map<
		string,
		Array<{
			id?: number;
			verified: boolean;
			line: number;
			source?: { path?: string };
		}>
	>();
	stdinClosed = false;
	disposeCount = 0;
	disconnectCount = 0;
	private listeners = new Set<(event: { event: string; body?: unknown }) => void>();

	onEvent(listener: (event: { event: string; body?: unknown }) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async initialize() {
		await runtimeState.initializeGate;
		return runtimeState.initializeCapabilities;
	}

	getResolvedBreakpoints(sourcePath: string) {
		return (
			this.resolvedBreakpointsBySource.get(sourcePath) ?? [
				{ verified: true, line: 6, source: { path: sourcePath } }
			]
		);
	}

	async request<T>(command: string, args?: unknown): Promise<T> {
		this.requests.push({ command, args });
		const requestError = runtimeState.requestErrors.get(command);
		if (requestError) throw requestError;
		if (command === 'continue') await runtimeState.continueGate;
		if (command === 'pause') await runtimeState.pauseGate;
		if (command === 'setBreakpoints' && runtimeState.breakpointResponseGates.length > 0) {
			return (await runtimeState.breakpointResponseGates.shift()) as T;
		}
		if (runtimeState.responseOverrides.has(command)) {
			return runtimeState.responseOverrides.get(command) as T;
		}
		if (command === 'threads') return { threads: [{ id: 7, name: 'wasm' }] } as T;
		if (command === 'stackTrace') {
			return {
				stackFrames: [
					{
						id: 41,
						name: 'main',
						source: { path: '/workspace/main.cpp' },
						line: 6,
						column: 3
					},
					{
						id: 42,
						name: '_start',
						source: { path: '/workspace/crt.c' },
						line: 1,
						column: 1
					}
				]
			} as T;
		}
		if (command === 'scopes') {
			if (
				(args as { frameId?: number } | undefined)?.frameId ===
				runtimeState.scopesErrorFrameId
			) {
				throw new Error('scope failure');
			}
			return {
				scopes: [
					{ name: 'Arguments', variablesReference: 10, expensive: false },
					{ name: 'Locals', variablesReference: 11, expensive: false },
					{ name: 'Globals', variablesReference: 12, expensive: true }
				]
			} as T;
		}
		if (command === 'variables') {
			const reference = (args as { variablesReference: number }).variablesReference;
			return {
				variables: [
					{
						name: reference === 10 ? 'argc' : reference === 11 ? 'answer' : 'global',
						value: reference === 11 ? '42' : '1',
						type: 'int',
						variablesReference: reference === 11 ? 99 : 0
					}
				]
			} as T;
		}
		if (command === 'readMemory') {
			return {
				address: '0x1004',
				data: 'AQIDBA==',
				unreadableBytes: 2
			} as T;
		}
		if (command === 'writeMemory') {
			return { offset: 4, bytesWritten: 3 } as T;
		}
		if (command === 'dataBreakpointInfo') {
			return {
				dataId: '1000/4',
				description: '4 bytes at 1000',
				accessTypes: ['read', 'write', 'readWrite'],
				canPersist: false
			} as T;
		}
		if (command === 'setDataBreakpoints') {
			return { breakpoints: [{ id: 5, verified: true }] } as T;
		}
		if (command === 'evaluate') return { result: '42', variablesReference: 0 } as T;
		return {} as T;
	}

	async setBreakpoints(source: { path: string }, lines: number[]) {
		this.breakpointRequests.push({ source, lines: [...lines] });
		const response = await this.request<{
			breakpoints?: Array<{ verified?: boolean; line?: number; message?: string }>;
		}>('setBreakpoints', {
			source,
			breakpoints: lines.map((line) => ({ line })),
			lines,
			sourceModified: false
		});
		return lines.map((line, index) => ({
			...response.breakpoints?.[index],
			verified: response.breakpoints?.[index]?.verified === true,
			line: response.breakpoints?.[index]?.line ?? line,
			source
		}));
	}

	async disconnect() {
		this.disconnectCount += 1;
	}

	async dispose() {
		this.disposeCount += 1;
		await runtimeState.disposeGate;
	}

	async writeStdin(value: string) {
		this.input.push(value);
	}

	async closeStdin() {
		this.stdinClosed = true;
	}

	emit(event: { event: string; body?: unknown }) {
		for (const listener of this.listeners) listener(event);
	}

	emitLifecycle(
		event:
			| { type: 'worker-error'; worker: 'lldb' | 'target'; message: string }
			| { type: 'target-exit'; exitCode: number | null }
	) {
		const callback = runtimeState.options?.onLifecycle;
		if (typeof callback === 'function') callback(event);
	}
}

vi.mock('@wasm-idle/llvm-core/debug', () => ({
	DapProtocolError: class DapProtocolError extends Error {
		readonly command: string;
		readonly path: string;

		constructor(command: string, path: string, expectation: string) {
			super(`Invalid DAP ${command} response at ${path}: ${expectation}.`);
			this.name = 'DapProtocolError';
			this.command = command;
			this.path = path;
		}
	},
	parseDebugRuntimeManifest: (value: unknown) => value,
	createBrowserLldbSession: (options: Record<string, unknown>) => {
		runtimeState.options = options;
		runtimeState.session = new FakeRuntimeSession();
		return runtimeState.session;
	}
}));

import { LldbSandboxSession } from './lldbSession';

describe('LldbSandboxSession', () => {
	beforeEach(() => {
		runtimeState.session = null;
		runtimeState.options = null;
		runtimeState.initializeCapabilities = {
			supportsReadMemoryRequest: true,
			supportsWriteMemoryRequest: true
		};
		runtimeState.initializeGate = null;
		runtimeState.continueGate = null;
		runtimeState.pauseGate = null;
		runtimeState.disposeGate = null;
		runtimeState.scopesErrorFrameId = null;
		runtimeState.requestErrors.clear();
		runtimeState.responseOverrides.clear();
		runtimeState.breakpointResponseGates = [];
		loadManifest.mockReset();
		loadManifest.mockImplementation(
			async (url: string, _expected: unknown, fetchImpl: typeof fetch) => {
				const response = await fetchImpl(url);
				if (!response.ok) {
					throw new Error(
						`Unable to load the LLDB runtime manifest (${response.status}).`
					);
				}
				return await response.json();
			}
		);
	});

	it('does not create a runtime session after manifest verification fails', async () => {
		const fetchImpl = vi.fn();
		loadManifest.mockRejectedValueOnce(
			new Error('LLDB runtime requires an expected manifest SHA-256 receipt.')
		);
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://cdn.example/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://cdn.example/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		await expect(controller.start()).rejects.toThrow(
			'LLDB runtime requires an expected manifest SHA-256 receipt.'
		);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(loadManifest).toHaveBeenCalledWith(
			'https://cdn.example/debug/runtime-manifest.v2.json',
			undefined,
			fetchImpl,
			expect.any(AbortSignal)
		);
		expect(runtimeState.session).toBeNull();
	});

	it('aborts a pending manifest load when the session is disconnected', async () => {
		let startupSignal: AbortSignal | undefined;
		loadManifest.mockImplementationOnce(
			async (
				_url: string,
				_expected: unknown,
				_fetchImpl: typeof fetch,
				signal?: AbortSignal
			) => {
				startupSignal = signal;
				return await new Promise((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			}
		);
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://cdn.example/debug/runtime-manifest.v2.json',
			manifestReceipt: { sha256: 'a'.repeat(64) },
			runtimeBaseUrl: 'https://cdn.example/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn() as unknown as typeof fetch
		});

		const starting = controller.start();
		await vi.waitFor(() => expect(loadManifest).toHaveBeenCalledOnce());
		expect(startupSignal).toBeInstanceOf(AbortSignal);
		await controller.disconnect();

		expect(startupSignal?.aborted).toBe(true);
		await expect(starting).resolves.toBe(true);
		expect(runtimeState.session).toBeNull();
	});

	it('rejects invalid configured breakpoint lines before loading the runtime', () => {
		const fetchImpl = vi.fn();

		expect(
			() =>
				new LldbSandboxSession({
					manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
					runtimeBaseUrl: 'https://example.com/debug/',
					artifact: {
						bytes: Uint8Array.of(0),
						sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
					},
					sourcePath: '/workspace/main.cpp',
					breakpoints: [0],
					pauseOnEntry: true,
					onDebugEvent: () => undefined,
					onOutput: () => undefined,
					fetchImpl: fetchImpl as unknown as typeof fetch
				})
		).toThrow('LLDB breakpoint lines must be positive safe integers.');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('maps DAP stopped state to source frames and top-level scopes', async () => {
		const events: unknown[] = [];
		const output: string[] = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0, 97, 115, 109),
				descriptor: { moduleSha256: 'module-sha' },
				sources: [
					{
						path: '/workspace/main.cpp',
						content: 'int main() {}',
						contentSha256: 'main-source-sha'
					},
					{
						path: '/workspace/lib.cpp',
						content: 'int helper() {}',
						contentSha256: 'lib-source-sha'
					}
				]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [6],
			sourceBreakpoints: [
				{ sourcePath: '/workspace/main.cpp', lines: [6] },
				{ sourcePath: '/workspace/lib.cpp', lines: [12] }
			],
			pauseOnEntry: true,
			stdin: 'input\n',
			onDebugEvent: (event) => events.push(event),
			onOutput: (chunk) => output.push(chunk),
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: {
						capabilities: {
							evaluateExpressions: true,
							readMemory: true,
							writeMemory: true,
							dataBreakpoints: true
						}
					}
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		expect(runtimeState.options).toMatchObject({
			moduleSha256: 'module-sha',
			breakpoints: [
				{ source: { path: '/workspace/main.cpp' }, lines: [6] },
				{ source: { path: '/workspace/lib.cpp' }, lines: [12] }
			]
		});
		await vi.waitFor(() => expect(runtimeState.session?.input).toEqual(['input\n']));
		expect(runtimeState.session?.stdinClosed).toBe(true);
		runtimeState.session!.resolvedBreakpointsBySource.set('/workspace/main.cpp', [
			{
				id: 91,
				verified: true,
				line: 8,
				source: { path: '/workspace/lib.cpp' }
			}
		]);
		runtimeState.session!.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 91,
					verified: true,
					line: 8,
					source: { path: '/workspace/lib.cpp' }
				}
			}
		});
		expect(events).toContainEqual({
			type: 'breakpoints',
			sourcePath: '/workspace/main.cpp',
			sourceContentSha256: 'main-source-sha',
			breakpoints: [
				{
					requestedLine: 6,
					line: 8,
					verified: true,
					message: undefined
				}
			]
		});
		await controller.pause();
		expect(runtimeState.session!.requests).toContainEqual({
			command: 'pause',
			args: { threadId: 1 }
		});
		runtimeState.session!.emit({
			event: 'stopped',
			body: { reason: 'breakpoint', threadId: 7 }
		});
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					type: 'pause',
					capabilities: {
						readMemory: true,
						writeMemory: true,
						dataBreakpoints: false
					},
					line: 6,
					sourcePath: '/workspace/main.cpp',
					sourceContentSha256: 'main-source-sha',
					threadId: 7,
					frameId: 41,
					stoppedReason: 'breakpoint',
					locals: [],
					callStack: [
						expect.objectContaining({
							functionName: 'main',
							sourcePath: '/workspace/main.cpp',
							sourceContentSha256: 'main-source-sha'
						}),
						expect.objectContaining({ functionName: '_start' })
					],
					scopes: expect.arrayContaining([
						expect.objectContaining({
							name: 'Globals',
							variablesReference: 12,
							variables: []
						})
					])
				})
			)
		);

		await controller.debugCommand('nextLine');
		await controller.setBreakpoints([8, 9], '/workspace/lib.cpp');
		expect(runtimeState.session!.breakpointRequests).toContainEqual({
			source: { path: '/workspace/lib.cpp' },
			lines: [8, 9]
		});
		await expect(controller.evaluate('answer')).resolves.toBe('42');
		await expect(controller.variables(11)).resolves.toEqual([
			{
				name: 'answer',
				value: '42',
				type: 'int',
				variablesReference: 99,
				memoryReference: undefined
			}
		]);
		await expect(controller.variables(99)).resolves.toEqual([
			{
				name: 'global',
				value: '1',
				type: 'int',
				variablesReference: 0,
				memoryReference: undefined
			}
		]);
		expect(runtimeState.session!.requests).toEqual(
			expect.arrayContaining([
				{ command: 'next', args: { threadId: 7 } },
				expect.objectContaining({
					command: 'setBreakpoints',
					args: expect.objectContaining({
						source: { path: '/workspace/lib.cpp' },
						lines: [8, 9]
					})
				}),
				{
					command: 'evaluate',
					args: { expression: 'answer', frameId: 41, context: 'watch' }
				},
				{
					command: 'variables',
					args: { variablesReference: 11 }
				}
			])
		);
		await expect(controller.scopes(41)).resolves.toEqual([
			{
				name: 'Arguments',
				variablesReference: 10,
				expensive: false,
				variables: []
			},
			{
				name: 'Locals',
				variablesReference: 11,
				expensive: false,
				variables: []
			},
			{
				name: 'Globals',
				variablesReference: 12,
				expensive: true,
				variables: []
			}
		]);
		expect(runtimeState.session!.requests).toContainEqual({
			command: 'scopes',
			args: { frameId: 41 }
		});
		runtimeState.scopesErrorFrameId = 42;
		await expect(controller.scopes(42)).rejects.toThrow('scope failure');
		await expect(controller.evaluate('answer')).resolves.toBe('42');
		expect(runtimeState.session!.requests.at(-1)).toEqual({
			command: 'evaluate',
			args: { expression: 'answer', frameId: 41, context: 'watch' }
		});

		runtimeState.session!.emit({
			event: 'output',
			body: { output: 'hello\n' }
		});
		expect(output).toEqual(['hello\n']);
		runtimeState.session!.emit({ event: 'exited', body: { exitCode: 0 } });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await expect(completion).resolves.toBe(true);
	});

	it.each([
		{
			kind: 'valid',
			response: {
				scopes: [{ name: 'Older', variablesReference: 73, expensive: false }]
			},
			malformed: false
		},
		{
			kind: 'malformed',
			response: {
				scopes: [{ name: 'Older', variablesReference: -1, expensive: false }]
			},
			malformed: true
		}
	])(
		'keeps the newest frame after an obsolete $kind scopes response',
		async ({ response, malformed }) => {
			const events: Array<{ type: string }> = [];
			let resolveOlderScopes!: (response: unknown) => void;
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: (event) => events.push(event),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({
						manifestVersion: 2,
						debugger: { capabilities: { evaluateExpressions: true } }
					})
				})) as unknown as typeof fetch
			});
			const completion = controller.start().then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			runtimeState.responseOverrides.set(
				'scopes',
				new Promise<unknown>((resolve) => {
					resolveOlderScopes = resolve;
				})
			);

			const olderScopes = controller.scopes(41).then(
				(scopes) => scopes,
				(error: unknown) => error
			);
			await vi.waitFor(() =>
				expect(runtimeState.session!.requests.at(-1)).toEqual({
					command: 'scopes',
					args: { frameId: 41 }
				})
			);
			runtimeState.responseOverrides.delete('scopes');
			await controller.scopes(42);
			resolveOlderScopes(response);

			if (malformed) {
				await expect(olderScopes).resolves.toBeInstanceOf(ProtocolError);
			} else {
				await expect(olderScopes).resolves.toEqual([
					{
						name: 'Older',
						variablesReference: 73,
						expensive: false,
						variables: []
					}
				]);
			}
			await expect(controller.evaluate('answer')).resolves.toBe('42');
			expect(runtimeState.session!.requests.at(-1)).toEqual({
				command: 'evaluate',
				args: { expression: 'answer', frameId: 42, context: 'watch' }
			});
			expect(runtimeState.session!.disposeCount).toBe(0);
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);

			runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			await expect(completion).resolves.toBeNull();
		}
	);

	it('orders breakpoint responses per source without blocking other files', async () => {
		const events: Array<{
			type: string;
			breakpoints?: Array<{ requestedLine: number; line: number; verified: boolean }>;
		}> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [
					{ path: '/workspace/main.c', content: 'int main(void) {}' },
					{ path: '/workspace/lib.c', content: 'int helper(void) {}' }
				]
			},
			sourcePath: '/workspace/main.c',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() =>
			expect(events).toContainEqual(expect.objectContaining({ type: 'breakpoints' }))
		);

		let resolveOlder!: (value: {
			breakpoints: Array<{ verified: boolean; line: number }>;
		}) => void;
		let resolveNewer!: (value: {
			breakpoints: Array<{ verified: boolean; line: number }>;
		}) => void;
		let resolveOtherSource!: (value: {
			breakpoints: Array<{ verified: boolean; line: number }>;
		}) => void;
		runtimeState.breakpointResponseGates = [
			new Promise((resolve) => {
				resolveOlder = resolve;
			}),
			new Promise((resolve) => {
				resolveOtherSource = resolve;
			}),
			new Promise((resolve) => {
				resolveNewer = resolve;
			})
		];

		const olderUpdate = controller.setBreakpoints([5]);
		const otherSourceUpdate = controller.setBreakpoints([3], '/workspace/lib.c');
		const newerUpdate = controller.setBreakpoints([9]);
		resolveNewer({ breakpoints: [{ verified: true, line: 9 }] });
		await newerUpdate;
		resolveOtherSource({ breakpoints: [{ verified: true, line: 3 }] });
		await otherSourceUpdate;
		resolveOlder({ breakpoints: [{ verified: true, line: 5 }] });
		await olderUpdate;

		const breakpointEvents = events.filter((event) => event.type === 'breakpoints');
		expect(breakpointEvents).toContainEqual(
			expect.objectContaining({
				breakpoints: [{ requestedLine: 3, line: 3, verified: true }]
			})
		);
		expect(
			breakpointEvents.filter((event) => event.breakpoints?.[0]?.requestedLine !== 3).at(-1)
		).toMatchObject({
			breakpoints: [{ requestedLine: 9, line: 9, verified: true }]
		});

		let rejectStale!: (error: Error) => void;
		let resolveLatest!: (value: {
			breakpoints: Array<{ verified: boolean; line: number }>;
		}) => void;
		runtimeState.breakpointResponseGates = [
			new Promise((_resolve, reject) => {
				rejectStale = reject;
			}),
			new Promise((resolve) => {
				resolveLatest = resolve;
			})
		];
		const staleFailure = controller.setBreakpoints([11]);
		const latestUpdate = controller.setBreakpoints([13]);
		resolveLatest({ breakpoints: [{ verified: true, line: 13 }] });
		await latestUpdate;
		rejectStale(new Error('obsolete breakpoint failure'));

		await expect(staleFailure).resolves.toBeUndefined();
		expect(events.filter((event) => event.type === 'breakpoints').at(-1)).toMatchObject({
			breakpoints: [{ requestedLine: 13, line: 13, verified: true }]
		});

		let rejectCurrent!: (error: Error) => void;
		runtimeState.breakpointResponseGates = [
			new Promise((_resolve, reject) => {
				rejectCurrent = reject;
			})
		];
		const currentFailure = controller.setBreakpoints([17]);
		rejectCurrent(new Error('current breakpoint failure'));
		await expect(currentFailure).rejects.toThrow('current breakpoint failure');

		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await completion;
	});

	it('rejects Rust artifacts built with an incompatible LLVM version', async () => {
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0, 97, 115, 109),
				descriptor: {
					compiler: {
						name: 'rustc',
						version: '1.99.0',
						revision: 'rust-revision',
						llvmVersion: '21.1.0',
						llvmRevision: 'rust-llvm-revision'
					}
				},
				sources: [{ path: '/workspace/main.rs', content: 'fn main() {}' }]
			},
			sourcePath: '/workspace/main.rs',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: {
						lldb: { llvmVersion: '22.1.8' },
						capabilities: {}
					}
				})
			})) as unknown as typeof fetch
		});

		await expect(controller.start()).rejects.toThrow(
			'Rust LLVM/LLDB version mismatch: artifact 21.1.0, runtime 22.1.8.'
		);
		expect(runtimeState.session).toBeNull();
	});

	it('does not publish a stopped snapshot after the target continues', async () => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.rs', content: 'fn main() {}' }]
			},
			sourcePath: '/workspace/main.rs',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.session!.emit({ event: 'stopped', body: { reason: 'step', threadId: 7 } });
		runtimeState.session!.emit({ event: 'continued', body: { threadId: 7 } });
		await Promise.resolve();
		await Promise.resolve();
		expect(events).not.toContainEqual(expect.objectContaining({ type: 'pause' }));
		runtimeState.session!.emit({ event: 'terminated' });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await completion;
	});

	it.each([
		{
			command: 'stackTrace',
			response: undefined
		},
		{
			command: 'scopes',
			response: {
				scopes: [{ name: 'Locals', variablesReference: -1, expensive: false }]
			}
		}
	])(
		'ignores a stale $command failure after the target continues',
		async ({ command, response }) => {
			const events: Array<{ type: string }> = [];
			let resolveResponse!: (value: unknown) => void;
			let rejectResponse!: (error: Error) => void;
			runtimeState.responseOverrides.set(
				command,
				new Promise<unknown>((resolve, reject) => {
					resolveResponse = resolve;
					rejectResponse = reject;
				})
			);
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: false,
				onDebugEvent: (event) => events.push(event),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({ manifestVersion: 2 })
				})) as unknown as typeof fetch
			});
			const completion = controller.start().then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

			runtimeState.session!.emit({
				event: 'stopped',
				body: { reason: 'step', threadId: 7 }
			});
			await vi.waitFor(() =>
				expect(
					runtimeState.session!.requests.some((request) => request.command === command)
				).toBe(true)
			);
			runtimeState.session!.emit({
				event: 'continued',
				body: { threadId: 7, allThreadsContinued: true }
			});
			if (response === undefined) rejectResponse(new Error('obsolete stopped-state failure'));
			else resolveResponse(response);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const disposeCountBeforeExit = runtimeState.session!.disposeCount;
			const stopCountBeforeExit = events.filter((event) => event.type === 'stop').length;
			const pauseCount = events.filter((event) => event.type === 'pause').length;
			if (disposeCountBeforeExit === 0) {
				runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			}
			const outcome = await completion;

			expect(disposeCountBeforeExit).toBe(0);
			expect(stopCountBeforeExit).toBe(0);
			expect(pauseCount).toBe(0);
			expect(outcome).toBeNull();
		}
	);

	it.each([
		{
			kind: 'valid',
			command: 'variables',
			response: {
				variables: [{ name: 'late', value: '1', variablesReference: 0 }]
			},
			expected: [],
			invoke: (controller: LldbSandboxSession) => controller.variables(50)
		},
		{
			kind: 'malformed',
			command: 'variables',
			response: {
				variables: [{ name: 73, value: '1', variablesReference: 0 }]
			},
			expected: [],
			invoke: (controller: LldbSandboxSession) => controller.variables(50)
		},
		{
			kind: 'valid',
			command: 'readMemory',
			response: { address: '0x0', data: 'AQ==', unreadableBytes: 0 },
			expected: null,
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x0', 0, 1)
		},
		{
			kind: 'malformed',
			command: 'readMemory',
			response: { address: '0x0', data: '***', unreadableBytes: 0 },
			expected: null,
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x0', 0, 1)
		},
		{
			kind: 'valid',
			command: 'evaluate',
			response: { result: 'late', variablesReference: 0 },
			expected: '?',
			invoke: (controller: LldbSandboxSession) => controller.evaluate('answer')
		},
		{
			kind: 'malformed',
			command: 'evaluate',
			response: { variablesReference: 0 },
			expected: '?',
			invoke: (controller: LldbSandboxSession) => controller.evaluate('answer')
		}
	])(
		'discards a stale $kind $command response after the target continues',
		async ({ command, response, expected, invoke }) => {
			const events: Array<{ type: string }> = [];
			let resolveResponse!: (response: unknown) => void;
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: (event) => events.push(event),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({
						manifestVersion: 2,
						debugger: {
							capabilities: { evaluateExpressions: true, readMemory: true }
						}
					})
				})) as unknown as typeof fetch
			});
			const completion = controller.start().then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			if (command === 'evaluate') await controller.scopes(41);
			runtimeState.responseOverrides.set(
				command,
				new Promise<unknown>((resolve) => {
					resolveResponse = resolve;
				})
			);

			const result = invoke(controller);
			await vi.waitFor(() =>
				expect(
					runtimeState.session!.requests.some((request) => request.command === command)
				).toBe(true)
			);
			runtimeState.session!.emit({
				event: 'continued',
				body: { threadId: 7, allThreadsContinued: true }
			});
			resolveResponse(response);

			await expect(result).resolves.toEqual(expected);
			expect(runtimeState.session!.disposeCount).toBe(0);
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);
			runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			await expect(completion).resolves.toBeNull();
		}
	);

	it('publishes a running target before a pending continue response settles', async () => {
		const events: Array<{ type: string; command?: string }> = [];
		let releaseContinue: () => void = () => undefined;
		runtimeState.continueGate = new Promise<void>((resolve) => {
			releaseContinue = resolve;
		});
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.c', content: 'int main(void) {}' }]
			},
			sourcePath: '/workspace/main.c',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		let commandSettled = false;
		const command = controller.debugCommand('continue').then(() => {
			commandSettled = true;
		});
		await vi.waitFor(() =>
			expect(runtimeState.session!.requests).toContainEqual({
				command: 'continue',
				args: { threadId: 1 }
			})
		);
		try {
			await vi.waitFor(() => expect(commandSettled).toBe(true));
			expect(events.filter((event) => event.type === 'resume')).toEqual([
				{ type: 'resume', command: 'continue' }
			]);
		} finally {
			releaseContinue();
			await command;
			runtimeState.session!.emit({ event: 'terminated' });
			runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			await completion;
		}
	});

	it.each([
		{ state: 'current', publishNewerState: false },
		{ state: 'superseded', publishNewerState: true }
	])('handles a deferred execution failure as $state', async ({ publishNewerState }) => {
		const events: Array<{ type: string }> = [];
		const failure = new Error('deferred continue failure');
		let rejectContinue!: (error: Error) => void;
		runtimeState.continueGate = new Promise<void>((_resolve, reject) => {
			rejectContinue = reject;
		});
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.c', content: 'int main(void) {}' }]
			},
			sourcePath: '/workspace/main.c',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start().then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		await controller.debugCommand('continue');
		await vi.waitFor(() =>
			expect(runtimeState.session!.requests).toContainEqual({
				command: 'continue',
				args: { threadId: 1 }
			})
		);
		if (publishNewerState) {
			runtimeState.session!.emit({
				event: 'continued',
				body: { threadId: 1, allThreadsContinued: true }
			});
			runtimeState.session!.emit({
				event: 'stopped',
				body: { reason: 'breakpoint', threadId: 7 }
			});
			await vi.waitFor(() =>
				expect(events).toContainEqual(expect.objectContaining({ type: 'pause' }))
			);
		}

		rejectContinue(failure);
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (publishNewerState) {
			expect(runtimeState.session!.disposeCount).toBe(0);
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);
			runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			await expect(completion).resolves.toBeNull();
		} else {
			await vi.waitFor(() => expect(runtimeState.session!.disposeCount).toBe(1));
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
			await expect(completion).resolves.toBe(failure);
		}
	});

	it('reports an LLDB interrupt stop as a requested pause', async () => {
		const events: Array<{
			type: string;
			reason?: string;
			stoppedReason?: string;
		}> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		await controller.pause();
		runtimeState.session!.emit({
			event: 'stopped',
			body: { reason: 'exception', threadId: 7 }
		});
		await vi.waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					type: 'pause',
					reason: 'pause',
					stoppedReason: 'pause'
				})
			)
		);

		runtimeState.session!.emit({ event: 'terminated' });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await completion;
	});

	it.each([
		{ state: 'current', publishStop: false },
		{ state: 'superseded', publishStop: true }
	])('handles a deferred pause failure as $state', async ({ publishStop }) => {
		const events: Array<{ type: string }> = [];
		const failure = new Error('deferred pause failure');
		let rejectPause!: (error: Error) => void;
		runtimeState.pauseGate = new Promise<void>((_resolve, reject) => {
			rejectPause = reject;
		});
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.c', content: 'int main(void) {}' }]
			},
			sourcePath: '/workspace/main.c',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start().then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		const pauseResult = controller.pause().then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() =>
			expect(runtimeState.session!.requests).toContainEqual({
				command: 'pause',
				args: { threadId: 1 }
			})
		);
		if (publishStop) {
			runtimeState.session!.emit({
				event: 'stopped',
				body: { reason: 'exception', threadId: 7 }
			});
			await vi.waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({ type: 'pause', reason: 'pause' })
				)
			);
		}

		rejectPause(failure);
		await expect(pauseResult).resolves.toBe(publishStop ? null : failure);
		expect(runtimeState.session!.disposeCount).toBe(0);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);

		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await expect(completion).resolves.toBeNull();
	});

	it('does not send evaluate when the runtime manifest disables expressions', async () => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { evaluateExpressions: false } }
				})
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.session!.emit({
			event: 'stopped',
			body: { reason: 'breakpoint', threadId: 7 }
		});
		await vi.waitFor(() =>
			expect(events).toContainEqual(expect.objectContaining({ type: 'pause' }))
		);

		await expect(controller.evaluate('answer')).resolves.toBe('?');
		expect(runtimeState.session!.requests).not.toContainEqual(
			expect.objectContaining({ command: 'evaluate' })
		);

		runtimeState.session!.emit({ event: 'terminated' });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await completion;
	});

	it('cancels an initialization that is overtaken by disconnect', async () => {
		let releaseInitialize!: () => void;
		runtimeState.initializeGate = new Promise<void>((resolve) => {
			releaseInitialize = resolve;
		});
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		const session = runtimeState.session!;
		await controller.disconnect();
		releaseInitialize();

		await expect(completion).resolves.toBe(true);
		expect(session.disconnectCount).toBe(1);
		await vi.waitFor(() => expect(session.disposeCount).toBe(1));
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it('waits for worker disposal before completing a target exit', async () => {
		let releaseDispose!: () => void;
		runtimeState.disposeGate = new Promise<void>((resolve) => {
			releaseDispose = resolve;
		});
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		let settled = false;
		const completion = controller.start().then((result) => {
			settled = true;
			return result;
		});
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		runtimeState.session!.emit({ event: 'exited', body: { exitCode: 0 } });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(runtimeState.session!.disposeCount).toBe(0);

		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: null });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(runtimeState.session!.disposeCount).toBe(1);

		releaseDispose();
		await expect(completion).resolves.toBe(true);
	});

	it('rejects invalid dynamic breakpoints before replacing the current source state', async () => {
		const events: Array<{
			type: string;
			breakpoints?: Array<{ requestedLine: number }>;
		}> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [6],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		const requestCount = runtimeState.session!.breakpointRequests.length;
		const lowLevelFailure = Promise.reject(new RangeError('low-level breakpoint validation'));
		void lowLevelFailure.catch(() => undefined);
		runtimeState.breakpointResponseGates = [lowLevelFailure];

		await expect(controller.setBreakpoints([0])).rejects.toThrow(
			'LLDB breakpoint lines must be positive safe integers.'
		);
		expect(runtimeState.session!.breakpointRequests).toHaveLength(requestCount);
		expect(runtimeState.breakpointResponseGates).toHaveLength(1);

		runtimeState.session!.resolvedBreakpointsBySource.set('/workspace/main.cpp', [
			{
				id: 91,
				verified: true,
				line: 6,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		runtimeState.session!.emit({
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 91,
					verified: true,
					line: 6,
					source: { path: '/workspace/main.cpp' }
				}
			}
		});
		expect(events.filter((event) => event.type === 'breakpoints').at(-1)?.breakpoints).toEqual([
			expect.objectContaining({ requestedLine: 6 })
		]);

		runtimeState.breakpointResponseGates = [];
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await expect(completion).resolves.toBe(true);
	});

	it.each([
		{
			caseName: 'unsafe frame ID',
			command: 'scopes',
			message: 'frameId must be a positive safe integer.',
			invoke: (controller: LldbSandboxSession) =>
				controller.scopes(Number.MAX_SAFE_INTEGER + 1)
		},
		{
			caseName: 'zero variables reference',
			command: 'variables',
			message: 'variablesReference must be a positive safe integer.',
			invoke: (controller: LldbSandboxSession) => controller.variables(0)
		},
		{
			caseName: 'negative variable start',
			command: 'variables',
			message: 'start must be a non-negative safe integer.',
			invoke: (controller: LldbSandboxSession) => controller.variables(1, -1)
		},
		{
			caseName: 'fractional variable count',
			command: 'variables',
			message: 'count must be a non-negative safe integer.',
			invoke: (controller: LldbSandboxSession) => controller.variables(1, 0, 1.5)
		},
		{
			caseName: 'unsafe memory offset',
			command: 'readMemory',
			message: 'offset must be a safe integer.',
			invoke: (controller: LldbSandboxSession) =>
				controller.readMemory('0x0', Number.MAX_SAFE_INTEGER + 1, 1)
		},
		{
			caseName: 'negative memory count',
			command: 'readMemory',
			message: 'count must be a non-negative safe integer.',
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x0', 0, -1)
		}
	])('rejects an invalid $caseName before sending DAP', async ({ command, message, invoke }) => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { readMemory: true } }
				})
			})) as unknown as typeof fetch
		});
		const completion = controller.start().then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		const requestCount = runtimeState.session!.requests.filter(
			(request) => request.command === command
		).length;

		const callError = await invoke(controller).then(
			() => null,
			(error: unknown) => error
		);
		const disposeCountBeforeCleanup = runtimeState.session!.disposeCount;
		const stopCountBeforeCleanup = events.filter((event) => event.type === 'stop').length;
		if (disposeCountBeforeCleanup === 0) await controller.disconnect();
		const completionError = await completion;

		expect(callError).toBeInstanceOf(RangeError);
		expect((callError as Error).message).toBe(message);
		expect(
			runtimeState.session!.requests.filter((request) => request.command === command)
		).toHaveLength(requestCount);
		expect(disposeCountBeforeCleanup).toBe(0);
		expect(stopCountBeforeCleanup).toBe(0);
		expect(completionError).toBeNull();
	});

	it.each([
		{
			caseName: 'empty memory reference',
			command: 'readMemory',
			message: 'memoryReference must be a non-empty string.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) => controller.readMemory('', 0, 1)
		},
		{
			caseName: 'oversized memory reference',
			command: 'readMemory',
			message: 'memoryReference must not exceed 4096 UTF-16 code units.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.readMemory('x'.repeat(4097), 0, 1)
		},
		{
			caseName: 'oversized memory read',
			command: 'readMemory',
			message: 'count must not exceed 256.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x0', 0, 257)
		},
		{
			caseName: 'non-byte memory write',
			command: 'writeMemory',
			message: 'data must be a Uint8Array.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.writeMemory('0x0', 0, {} as Uint8Array)
		},
		{
			caseName: 'empty memory-write reference',
			command: 'writeMemory',
			message: 'memoryReference must be a non-empty string.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.writeMemory('', 0, Uint8Array.of(1))
		},
		{
			caseName: 'oversized memory write',
			command: 'writeMemory',
			message: 'data must not exceed 256 bytes.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.writeMemory('0x0', 0, new Uint8Array(257))
		},
		{
			caseName: 'non-boolean partial-write flag',
			command: 'writeMemory',
			message: 'allowPartial must be a boolean.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.writeMemory('0x0', 0, Uint8Array.of(1), 'yes' as unknown as boolean)
		},
		{
			caseName: 'oversized data-breakpoint name',
			command: 'dataBreakpointInfo',
			message: 'name must not exceed 4096 UTF-16 code units.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: 'x'.repeat(4097) })
		},
		{
			caseName: 'non-object data-breakpoint discovery arguments',
			command: 'dataBreakpointInfo',
			message: 'arguments must be an object.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) => controller.dataBreakpointInfo(null as never)
		},
		{
			caseName: 'oversized data-breakpoint byte range',
			command: 'dataBreakpointInfo',
			message: 'bytes must not exceed 256.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: '0x0', asAddress: true, bytes: 257 })
		},
		{
			caseName: 'non-boolean address flag',
			command: 'dataBreakpointInfo',
			message: 'asAddress must be a boolean.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({
					name: '0x0',
					asAddress: 1 as unknown as boolean,
					bytes: 1
				})
		},
		{
			caseName: 'non-array data-breakpoint collection',
			command: 'setDataBreakpoints',
			message: 'breakpoints must be an array.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) => controller.setDataBreakpoints(null as never)
		},
		{
			caseName: 'oversized data-breakpoint collection',
			command: 'setDataBreakpoints',
			message: 'breakpoints must not contain more than 256 entries.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.setDataBreakpoints(
					Array.from({ length: 257 }, (_, index) => ({ dataId: `id-${index}` }))
				)
		},
		{
			caseName: 'non-object data-breakpoint entry',
			command: 'setDataBreakpoints',
			message: 'breakpoints[0] must be an object.',
			errorType: TypeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.setDataBreakpoints([null] as never)
		},
		{
			caseName: 'oversized data-breakpoint identifier',
			command: 'setDataBreakpoints',
			message: 'breakpoints[0].dataId must not exceed 4096 UTF-16 code units.',
			errorType: RangeError,
			invoke: (controller: LldbSandboxSession) =>
				controller.setDataBreakpoints([{ dataId: 'x'.repeat(4097), accessType: 'write' }])
		}
	])(
		'rejects an invalid $caseName before allocating or sending DAP',
		async ({ command, message, errorType, invoke }) => {
			runtimeState.initializeCapabilities = {
				supportsReadMemoryRequest: true,
				supportsWriteMemoryRequest: true,
				supportsDataBreakpoints: true
			};
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: () => undefined,
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({
						manifestVersion: 2,
						debugger: {
							capabilities: {
								readMemory: true,
								writeMemory: true,
								dataBreakpoints: true
							}
						}
					})
				})) as unknown as typeof fetch
			});
			const completion = controller.start().then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			const requestCount = runtimeState.session!.requests.filter(
				(request) => request.command === command
			).length;

			const callError = await invoke(controller).then(
				() => null,
				(error: unknown) => error
			);
			const disposeCountBeforeCleanup = runtimeState.session!.disposeCount;
			if (disposeCountBeforeCleanup === 0) await controller.disconnect();
			const completionError = await completion;

			expect(callError).toBeInstanceOf(errorType);
			expect((callError as Error).message).toBe(message);
			expect(
				runtimeState.session!.requests.filter((request) => request.command === command)
			).toHaveLength(requestCount);
			expect(disposeCountBeforeCleanup).toBe(0);
			expect(completionError).toBeNull();
		}
	);

	it('reads target memory through DAP and decodes the returned bytes', async () => {
		runtimeState.initializeCapabilities = { supportsReadMemoryRequest: true };
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { readMemory: true } }
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		await expect(controller.readMemory('0x1000', 4, 6)).resolves.toEqual({
			address: '0x1004',
			data: Uint8Array.of(1, 2, 3, 4),
			unreadableBytes: 2
		});
		expect(runtimeState.session?.requests).toContainEqual({
			command: 'readMemory',
			args: { memoryReference: '0x1000', offset: 4, count: 6 }
		});

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('rejects an oversized encoded memory response before Base64 decoding', async () => {
		runtimeState.initializeCapabilities = { supportsReadMemoryRequest: true };
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { readMemory: true } }
				})
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		const completionError = completion.then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.responseOverrides.set('readMemory', {
			address: '0x1000',
			data: 'AAAAAAAA'
		});
		const originalAtob = globalThis.atob;
		const atobSpy = vi
			.spyOn(globalThis, 'atob')
			.mockImplementation((value) => originalAtob(value));

		await expect(controller.readMemory('0x1000', 0, 1)).rejects.toBeInstanceOf(ProtocolError);
		expect(atobSpy).not.toHaveBeenCalled();
		await expect(completionError).resolves.toBeInstanceOf(ProtocolError);
		await vi.waitFor(() => expect(runtimeState.session!.disposeCount).toBe(1));
		atobSpy.mockRestore();
	});

	it('writes target memory through DAP with an exact Base64 payload', async () => {
		runtimeState.initializeCapabilities = { supportsWriteMemoryRequest: true };
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { writeMemory: true } }
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		await expect(
			controller.writeMemory('0x1000', 4, Uint8Array.of(0, 0xff, 1), true)
		).resolves.toEqual({ offset: 4, bytesWritten: 3 });
		expect(runtimeState.session?.requests).toContainEqual({
			command: 'writeMemory',
			args: {
				memoryReference: '0x1000',
				offset: 4,
				allowPartial: true,
				data: 'AP8B'
			}
		});

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('does not access memory unless LLDB initialize advertises the requests', async () => {
		runtimeState.initializeCapabilities = {
			supportsReadMemoryRequest: false,
			supportsWriteMemoryRequest: false
		};
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { readMemory: true, writeMemory: true } }
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		await expect(controller.readMemory('0x1000', 0, 4)).resolves.toBeNull();
		await expect(
			controller.writeMemory('0x1000', 0, Uint8Array.of(1, 2, 3, 4))
		).resolves.toBeNull();
		expect(runtimeState.session?.requests).not.toContainEqual(
			expect.objectContaining({ command: 'readMemory' })
		);
		expect(runtimeState.session?.requests).not.toContainEqual(
			expect.objectContaining({ command: 'writeMemory' })
		);

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('discovers and replaces manifest-qualified LLDB data breakpoints', async () => {
		runtimeState.initializeCapabilities = { supportsDataBreakpoints: true };
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { dataBreakpoints: true } }
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		await expect(
			controller.dataBreakpointInfo({ name: '0x1000', asAddress: true, bytes: 4 })
		).resolves.toEqual({
			dataId: '1000/4',
			description: '4 bytes at 1000',
			accessTypes: ['read', 'write', 'readWrite'],
			canPersist: false
		});
		await expect(
			controller.setDataBreakpoints([{ dataId: '1000/4', accessType: 'write' }])
		).resolves.toEqual([{ id: 5, verified: true }]);
		expect(runtimeState.session?.requests.slice(-2)).toEqual([
			{
				command: 'dataBreakpointInfo',
				args: { name: '0x1000', asAddress: true, bytes: 4 }
			},
			{
				command: 'setDataBreakpoints',
				args: { breakpoints: [{ dataId: '1000/4', accessType: 'write' }] }
			}
		]);

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it.each([
		{
			caseName: 'DAP response timeout',
			breakpoints: [{ dataId: '1000/4', accessType: 'write' as const }],
			failure: new Error('DAP response timeout after 15000ms: setDataBreakpoints')
		},
		{
			caseName: 'negative DAP response while clearing',
			breakpoints: [],
			failure: new Error('Unable to remove the active data breakpoint')
		},
		{
			caseName: 'malformed DAP response',
			breakpoints: [{ dataId: '1000/4', accessType: 'write' as const }],
			response: { breakpoints: [{ id: 5, verified: 'yes' }] }
		}
	])(
		'fails, disposes, and permits a clean relaunch after a current $caseName',
		async ({ breakpoints, failure, response }) => {
			runtimeState.initializeCapabilities = { supportsDataBreakpoints: true };
			const events: Array<{ type: string }> = [];
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: (event) => events.push(event),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({
						manifestVersion: 2,
						debugger: { capabilities: { dataBreakpoints: true } }
					})
				})) as unknown as typeof fetch
			});

			const firstCompletionError = controller.start().then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			const failedSession = runtimeState.session!;
			if (failure) runtimeState.requestErrors.set('setDataBreakpoints', failure);
			else runtimeState.responseOverrides.set('setDataBreakpoints', response);

			const replacementError = await controller.setDataBreakpoints(breakpoints).then(
				() => null,
				(error: unknown) => error
			);
			if (failure) expect(replacementError).toBe(failure);
			else expect(replacementError).toBeInstanceOf(ProtocolError);
			await expect(firstCompletionError).resolves.toBe(replacementError);
			await vi.waitFor(() => expect(failedSession.disposeCount).toBe(1));
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
			await expect(controller.debugCommand('continue')).rejects.toThrow(
				'LLDB sandbox session is not running.'
			);
			expect(failedSession.requests).not.toContainEqual(
				expect.objectContaining({ command: 'continue' })
			);

			runtimeState.requestErrors.delete('setDataBreakpoints');
			runtimeState.responseOverrides.delete('setDataBreakpoints');
			const secondCompletion = controller.start();
			await vi.waitFor(() => expect(runtimeState.session).not.toBe(failedSession));
			const relaunchedSession = runtimeState.session!;
			await expect(
				controller.setDataBreakpoints([{ dataId: '2000/4', accessType: 'write' }])
			).resolves.toEqual([{ id: 5, verified: true }]);
			expect(relaunchedSession.disposeCount).toBe(0);

			await controller.disconnect();
			await expect(secondCompletion).resolves.toBe(true);
		}
	);

	it('keeps a successful unverified data-breakpoint replacement nonfatal', async () => {
		runtimeState.initializeCapabilities = { supportsDataBreakpoints: true };
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { dataBreakpoints: true } }
				})
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		const session = runtimeState.session!;
		runtimeState.responseOverrides.set('setDataBreakpoints', {
			breakpoints: [{ id: 5, verified: false, message: 'unsupported location' }]
		});

		await expect(
			controller.setDataBreakpoints([{ dataId: '1000/4', accessType: 'write' }])
		).resolves.toEqual([{ id: 5, verified: false, message: 'unsupported location' }]);
		expect(session.disposeCount).toBe(0);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);
		await controller.debugCommand('continue');
		expect(session.requests).toContainEqual({ command: 'continue', args: { threadId: 1 } });

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('treats null or omitted data IDs as unavailable and allows clearing all data breakpoints', async () => {
		runtimeState.initializeCapabilities = { supportsDataBreakpoints: true };
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { dataBreakpoints: true } }
				})
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());

		runtimeState.responseOverrides.set('dataBreakpointInfo', {
			dataId: null,
			description: 'not available'
		});
		await expect(controller.dataBreakpointInfo({ name: 'counter' })).resolves.toEqual({
			description: 'not available'
		});
		runtimeState.responseOverrides.set('dataBreakpointInfo', {
			description: 'still not available'
		});
		await expect(controller.dataBreakpointInfo({ name: 'counter' })).resolves.toEqual({
			description: 'still not available'
		});

		runtimeState.responseOverrides.set('setDataBreakpoints', { breakpoints: [] });
		await expect(controller.setDataBreakpoints([])).resolves.toEqual([]);
		expect(runtimeState.session?.requests.at(-1)).toEqual({
			command: 'setDataBreakpoints',
			args: { breakpoints: [] }
		});

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('requires both the runtime manifest and DAP capability for data breakpoints', async () => {
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({
					manifestVersion: 2,
					debugger: { capabilities: { dataBreakpoints: true } }
				})
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		await expect(
			controller.dataBreakpointInfo({ name: '0x1000', asAddress: true, bytes: 4 })
		).resolves.toBeNull();
		await expect(controller.setDataBreakpoints([])).resolves.toEqual([]);
		expect(runtimeState.session?.requests).not.toContainEqual(
			expect.objectContaining({ command: 'dataBreakpointInfo' })
		);

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it('preserves lazy-variable count and evaluation metadata from DAP', async () => {
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});
		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.responseOverrides.set('scopes', {
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					namedVariables: 2,
					indexedVariables: 3,
					expensive: false
				}
			]
		});

		await expect(controller.scopes(41)).resolves.toEqual([
			{
				name: 'Locals',
				variablesReference: 10,
				namedVariables: 2,
				indexedVariables: 3,
				expensive: false,
				variables: []
			}
		]);

		runtimeState.responseOverrides.set('variables', {
			variables: [
				{
					name: 'node',
					value: '{...}',
					type: 'Node',
					evaluateName: 'node',
					variablesReference: 20,
					memoryReference: '0x20',
					namedVariables: 4,
					indexedVariables: 5
				}
			]
		});
		await expect(controller.variables(10)).resolves.toEqual([
			{
				name: 'node',
				value: '{...}',
				type: 'Node',
				evaluateName: 'node',
				variablesReference: 20,
				memoryReference: '0x20',
				namedVariables: 4,
				indexedVariables: 5
			}
		]);

		await controller.disconnect();
		await expect(completion).resolves.toBe(true);
	});

	it.each([
		{
			command: 'scopes',
			response: {
				scopes: [{ name: 'Locals', variablesReference: -1, expensive: false }]
			},
			invoke: (controller: LldbSandboxSession) => controller.scopes(41)
		},
		{
			command: 'scopes',
			response: {
				scopes: [
					{
						name: 'Locals',
						variablesReference: 1,
						namedVariables: -1,
						expensive: false
					}
				]
			},
			invoke: (controller: LldbSandboxSession) => controller.scopes(41)
		},
		{
			command: 'variables',
			response: { variables: [{ name: 7, value: '42', variablesReference: 0 }] },
			invoke: (controller: LldbSandboxSession) => controller.variables(1)
		},
		{
			command: 'variables',
			response: {
				variables: [
					{
						name: 'answer',
						value: '42',
						evaluateName: 73,
						variablesReference: 0
					}
				]
			},
			invoke: (controller: LldbSandboxSession) => controller.variables(1)
		},
		{
			command: 'variables',
			response: {
				variables: [
					{
						name: 'answer',
						value: '42',
						variablesReference: 0,
						indexedVariables: -1
					}
				]
			},
			invoke: (controller: LldbSandboxSession) => controller.variables(1)
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', data: '***' },
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x1000', 0, 1)
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', data: 'AQIDBA==', unreadableBytes: 3 },
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x1000', 0, 6)
		},
		{
			command: 'dataBreakpointInfo',
			response: { dataId: '', description: 'empty identifier' },
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: 'counter' })
		},
		{
			command: 'dataBreakpointInfo',
			response: { dataId: 'x'.repeat(4097), description: 'oversized identifier' },
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: 'counter' })
		},
		{
			command: 'dataBreakpointInfo',
			response: { description: 'duplicate access', accessTypes: ['read', 'read'] },
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: 'counter' })
		},
		{
			command: 'dataBreakpointInfo',
			response: {
				description: 'too many access modes',
				accessTypes: ['read', 'write', 'readWrite', 'read']
			},
			invoke: (controller: LldbSandboxSession) =>
				controller.dataBreakpointInfo({ name: 'counter' })
		},
		{
			command: 'evaluate',
			response: { variablesReference: 0 },
			invoke: async (controller: LldbSandboxSession) => {
				await controller.scopes(41);
				return controller.evaluate('answer');
			}
		}
	])(
		'fails and disposes the live session for a malformed $command response',
		async ({ command, response, invoke }) => {
			if (command === 'dataBreakpointInfo') {
				runtimeState.initializeCapabilities = {
					...runtimeState.initializeCapabilities,
					supportsDataBreakpoints: true
				};
			}
			const events: Array<{ type: string }> = [];
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: (event) => events.push(event),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({
						manifestVersion: 2,
						debugger: {
							capabilities: {
								evaluateExpressions: true,
								readMemory: true,
								dataBreakpoints: true
							}
						}
					})
				})) as unknown as typeof fetch
			});

			const completion = controller.start();
			const completionError = completion.then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			runtimeState.responseOverrides.set(command, response);

			await expect(invoke(controller)).rejects.toBeInstanceOf(ProtocolError);
			await expect(completionError).resolves.toBeInstanceOf(ProtocolError);
			await vi.waitFor(() => expect(runtimeState.session!.disposeCount).toBe(1));
			expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
		}
	);

	it('publishes one stop and disposes after an active initialization failure', async () => {
		const events: Array<{ type: string }> = [];
		const failure = new Error('LLDB initialization failed');
		runtimeState.initializeGate = Promise.reject(failure);
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const startError = await controller.start().then(
			() => null,
			(error: unknown) => error
		);

		expect(startError).toBe(failure);
		expect(runtimeState.session!.disposeCount).toBe(1);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it('fails and disposes initialization after a malformed breakpoint response', async () => {
		const events: Array<{ type: string }> = [];
		runtimeState.initializeGate = Promise.reject(
			new DapProtocolError(
				'setBreakpoints',
				'breakpoints[0].column',
				'expected a non-negative safe integer'
			)
		);
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [1],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const startError = await controller.start().then(
			() => null,
			(error: unknown) => error
		);

		expect(startError).toBeInstanceOf(ProtocolError);
		expect((startError as Error).cause).toBeInstanceOf(DapProtocolError);
		expect(runtimeState.session!.disposeCount).toBe(1);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it('fails and disposes a running session after a malformed breakpoint response', async () => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		const completionError = completion.then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.breakpointResponseGates = [
			Promise.reject(
				new DapProtocolError(
					'setBreakpoints',
					'breakpoints[0].column',
					'expected a non-negative safe integer'
				)
			)
		];

		const updateError = await controller.setBreakpoints([7]).then(
			() => null,
			(error: unknown) => error
		);
		if (runtimeState.session!.disposeCount === 0) {
			runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		}
		const sessionError = await completionError;

		expect(updateError).toBeInstanceOf(ProtocolError);
		expect((updateError as Error).cause).toBeInstanceOf(DapProtocolError);
		expect(sessionError).toBeInstanceOf(ProtocolError);
		expect(runtimeState.session!.disposeCount).toBe(1);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it.each([
		{
			caseName: 'stopped event',
			responseCommand: undefined,
			response: undefined,
			event: { event: 'stopped', body: { reason: 7, threadId: 7 } }
		},
		{
			caseName: 'threads response',
			responseCommand: 'threads',
			response: { threads: [{ id: -1, name: 'wasm' }] },
			event: { event: 'stopped', body: { reason: 'breakpoint' } }
		},
		{
			caseName: 'stackTrace response',
			responseCommand: 'stackTrace',
			response: {
				stackFrames: [
					{
						id: 41,
						name: 'main',
						source: { path: '/workspace/main.cpp' },
						line: -1,
						column: 1
					}
				]
			},
			event: { event: 'stopped', body: { reason: 'breakpoint', threadId: 7 } }
		}
	])(
		'fails and disposes the live session for a malformed $caseName',
		async ({ responseCommand, response, event }) => {
			const events: Array<{ type: string }> = [];
			const controller = new LldbSandboxSession({
				manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
				runtimeBaseUrl: 'https://example.com/debug/',
				artifact: {
					bytes: Uint8Array.of(0),
					sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
				},
				sourcePath: '/workspace/main.cpp',
				breakpoints: [],
				pauseOnEntry: true,
				onDebugEvent: (debugEvent) => events.push(debugEvent),
				onOutput: () => undefined,
				fetchImpl: vi.fn(async () => ({
					ok: true,
					json: async () => ({ manifestVersion: 2 })
				})) as unknown as typeof fetch
			});

			const completion = controller.start();
			const completionError = completion.then(
				() => null,
				(error: unknown) => error
			);
			await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
			if (responseCommand) runtimeState.responseOverrides.set(responseCommand, response);
			runtimeState.session!.emit(event);

			await vi.waitFor(() =>
				expect(
					runtimeState.session!.disposeCount > 0 ||
						events.some((debugEvent) => debugEvent.type === 'pause')
				).toBe(true)
			);
			if (runtimeState.session!.disposeCount === 0) {
				runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
			}

			await expect(completionError).resolves.toBeInstanceOf(ProtocolError);
			expect(runtimeState.session!.disposeCount).toBe(1);
			expect(events.filter((debugEvent) => debugEvent.type === 'pause')).toHaveLength(0);
			expect(events.filter((debugEvent) => debugEvent.type === 'stop')).toHaveLength(1);
		}
	);

	it('fails and disposes the live session for a malformed exited event', async () => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		const completionError = completion.then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.session!.emit({ event: 'exited', body: { exitCode: 'zero' } });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: null });

		await expect(completionError).resolves.toBeInstanceOf(ProtocolError);
		expect(runtimeState.session!.disposeCount).toBe(1);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it('fails before a malformed continued event can change the live session state', async () => {
		const events: Array<{ type: string }> = [];
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: true,
			onDebugEvent: (event) => events.push(event),
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		const completionError = completion.then(
			() => null,
			(error: unknown) => error
		);
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.session!.emit({
			event: 'continued',
			body: { threadId: 0, allThreadsContinued: 'yes' }
		});
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });

		await expect(completionError).resolves.toBeInstanceOf(ProtocolError);
		expect(runtimeState.session!.disposeCount).toBe(1);
		expect(events.filter((event) => event.type === 'pause')).toHaveLength(0);
		expect(events.filter((event) => event.type === 'stop')).toHaveLength(1);
	});

	it('keeps a fast target exit successful when disposal rejects in-flight initialization', async () => {
		let rejectInitialize!: (error: Error) => void;
		runtimeState.initializeGate = new Promise<void>((_resolve, reject) => {
			rejectInitialize = reject;
		});
		const controller = new LldbSandboxSession({
			manifestUrl: 'https://example.com/debug/runtime-manifest.v2.json',
			runtimeBaseUrl: 'https://example.com/debug/',
			artifact: {
				bytes: Uint8Array.of(0),
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
			},
			sourcePath: '/workspace/main.cpp',
			breakpoints: [],
			pauseOnEntry: false,
			onDebugEvent: () => undefined,
			onOutput: () => undefined,
			fetchImpl: vi.fn(async () => ({
				ok: true,
				json: async () => ({ manifestVersion: 2 })
			})) as unknown as typeof fetch
		});

		const completion = controller.start();
		await vi.waitFor(() => expect(runtimeState.session).not.toBeNull());
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		rejectInitialize(new Error('debug session disposed during initialization'));

		await expect(completion).resolves.toBe(true);
		expect(runtimeState.session!.disposeCount).toBe(1);
	});
});
