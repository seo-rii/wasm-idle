import { ProtocolError } from '@wasm-idle/core';
import { DapProtocolError } from '@wasm-idle/llvm-core/debug';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
	session: null as FakeRuntimeSession | null,
	options: null as Record<string, unknown> | null,
	initializeGate: null as Promise<void> | null,
	continueGate: null as Promise<void> | null,
	disposeGate: null as Promise<void> | null,
	scopesErrorFrameId: null as number | null,
	responseOverrides: new Map<string, unknown>(),
	breakpointResponseGates: [] as Array<
		Promise<{
			breakpoints?: Array<{ verified?: boolean; line?: number; message?: string }>;
		}>
	>
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
		return {};
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
		if (command === 'continue') await runtimeState.continueGate;
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
		runtimeState.initializeGate = null;
		runtimeState.continueGate = null;
		runtimeState.disposeGate = null;
		runtimeState.scopesErrorFrameId = null;
		runtimeState.responseOverrides.clear();
		runtimeState.breakpointResponseGates = [];
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
					debugger: { capabilities: { evaluateExpressions: true } }
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

	it('reads target memory through DAP and decodes the returned bytes', async () => {
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

	it.each([
		{
			command: 'scopes',
			response: {
				scopes: [{ name: 'Locals', variablesReference: -1, expensive: false }]
			},
			invoke: (controller: LldbSandboxSession) => controller.scopes(41)
		},
		{
			command: 'variables',
			response: { variables: [{ name: 7, value: '42', variablesReference: 0 }] },
			invoke: (controller: LldbSandboxSession) => controller.variables(1)
		},
		{
			command: 'readMemory',
			response: { address: '0x1000', data: '***' },
			invoke: (controller: LldbSandboxSession) => controller.readMemory('0x1000', 0, 1)
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
							capabilities: { evaluateExpressions: true, readMemory: true }
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
