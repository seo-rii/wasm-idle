import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
	session: null as FakeRuntimeSession | null,
	options: null as Record<string, unknown> | null,
	initializeGate: null as Promise<void> | null,
	disposeGate: null as Promise<void> | null
}));

class FakeRuntimeSession {
	readonly requests: Array<{ command: string; args?: unknown }> = [];
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
		if (command === 'evaluate') return { result: '42' } as T;
		return {} as T;
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
		runtimeState.disposeGate = null;
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
				sources: [{ path: '/workspace/main.cpp', content: 'int main() {}' }]
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
		expect(events).toContainEqual({
			type: 'breakpoints',
			sourcePath: '/workspace/main.cpp',
			breakpoints: [
				{
					requestedLine: 6,
					line: 6,
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
					threadId: 7,
					frameId: 41,
					stoppedReason: 'breakpoint',
					locals: [],
					callStack: [
						expect.objectContaining({
							functionName: 'main',
							sourcePath: '/workspace/main.cpp'
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
		runtimeState.session!.emit({
			event: 'output',
			body: { output: 'hello\n' }
		});
		expect(output).toEqual(['hello\n']);
		runtimeState.session!.emit({ event: 'exited', body: { exitCode: 0 } });
		runtimeState.session!.emitLifecycle({ type: 'target-exit', exitCode: 0 });
		await expect(completion).resolves.toBe(true);
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
