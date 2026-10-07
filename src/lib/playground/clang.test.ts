import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from './stdinBuffer';
import { RuntimeAssetCache } from './runtimeAssetCache';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];

class MockWorker {
	/** Lets a test answer a message itself; returning false keeps the default responses. */
	static respond?: (worker: MockWorker, message: any) => boolean;
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (MockWorker.respond?.(this, message)) return;
		if (message.load) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: { progress: { percent: 40, stage: 'Loading Clang modules' } }
				} as MessageEvent<any>);
				this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: '10:1\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/clang?worker', () => ({
	default: MockWorker
}));

import Clang from './clang';
import { createApplicationRuntimeAssets } from './applicationAssets';

describe('Clang sandbox', () => {
	it('applies each run cache override from its load baseline', async () => {
		const sandbox = new Clang('C');
		sandbox.output = vi.fn();
		await sandbox.load({ rootUrl: '/', persistentCache: { enabled: true, maxBytes: 4096 } });
		expect(workerInstances[0].postMessage.mock.calls[0][0].persistentCache).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
		const select = vi.spyOn(sandbox.assetBridge!, 'setExecutionPersistentCache');
		await sandbox.run('int main() {}', true, false, undefined, [], { persistentCache: false });
		expect(select.mock.results.at(-1)?.value).toMatchObject({ enabled: false, maxBytes: 4096 });
		expect(workerInstances[0].postMessage.mock.calls.at(-1)?.[0].persistentCache).toMatchObject(
			{ enabled: false, maxBytes: 4096 }
		);
		await sandbox.run('int main() {}', true);
		expect(select.mock.results.at(-1)?.value).toMatchObject({ enabled: true, maxBytes: 4096 });
		expect(workerInstances[0].postMessage.mock.calls.at(-1)?.[0].persistentCache).toMatchObject(
			{ enabled: true, maxBytes: 4096 }
		);
		await sandbox.dispose();
	});
	beforeEach(() => {
		workerInstances.length = 0;
		vi.stubGlobal('Worker', MockWorker);
	});

	it('clears execution state without dropping owned compiled modules, then fully disposes them', async () => {
		const sandbox = new Clang('CPP');
		const cache = (sandbox as unknown as { runtimeAssetCache: RuntimeAssetCache })
			.runtimeAssetCache;
		const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		cache.set('clang.wasm', module, 8);
		await sandbox.load('/');
		const firstWorker = workerInstances[0];
		const firstBridge = sandbox.assetBridge;
		sandbox.write('previous case input');
		sandbox.pendingEof = true;
		new Int32Array(sandbox.debugBuffer).fill(7);
		new Uint8Array(sandbox.interruptBuffer).fill(2);

		await sandbox.clear();

		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(new Int32Array(sandbox.debugBuffer).every((value) => value === 0)).toBe(true);
		expect(new Uint8Array(sandbox.interruptBuffer)[0]).toBe(0);
		expect(cache.get('clang.wasm')).toBe(module);
		expect(cache.stats().disposed).toBe(false);

		await sandbox.load('/');
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.assetBridge).not.toBe(firstBridge);
		expect(cache.get('clang.wasm')).toBe(module);
		await sandbox.dispose();
		expect(workerInstances[1].terminate).toHaveBeenCalledOnce();
		expect(cache.stats()).toMatchObject({ disposed: true, entries: 0 });
	});

	it('does not dispose a borrowed session cache and rejects reuse after disposal', async () => {
		const sandbox = new Clang('CPP');
		const original = (sandbox as unknown as { runtimeAssetCache: RuntimeAssetCache })
			.runtimeAssetCache;
		const shared = new RuntimeAssetCache();
		const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		shared.set('clang.wasm', module, 8);
		sandbox.setRuntimeAssetCache(shared);
		expect(original.stats().disposed).toBe(true);
		await sandbox.load('/');
		expect(() => sandbox.setRuntimeAssetCache(new RuntimeAssetCache())).toThrow(
			'active runtime cache'
		);
		sandbox.output = vi.fn();
		sandbox.ondebug = vi.fn();

		await sandbox.dispose();

		expect(shared.get('clang.wasm')).toBe(module);
		expect(shared.stats().disposed).toBe(false);
		expect(sandbox.output).toBeNull();
		expect(sandbox.ondebug).toBeUndefined();
		await expect(sandbox.load('/')).rejects.toThrow('disposed');
		await expect(sandbox.run('int main() {}', false)).rejects.toThrow('disposed');
		expect(() => sandbox.setRuntimeAssetCache(shared)).toThrow('disposed');
		expect(workerInstances).toHaveLength(1);
		shared.dispose();
	});

	it.each([false, true])(
		'shares disposal completion and releases owned cache even if cleanup fails: %s',
		async (fails) => {
			const sandbox = new Clang('CPP');
			const cache = (sandbox as unknown as { runtimeAssetCache: RuntimeAssetCache })
				.runtimeAssetCache;
			let finish!: () => void;
			const failure = new Error('cleanup failed');
			const clear = vi.spyOn(sandbox, 'clear').mockImplementation(
				() =>
					new Promise<void>((resolve, reject) => {
						finish = () => (fails ? reject(failure) : resolve());
					})
			);
			const first = sandbox.dispose();
			const second = sandbox.dispose();
			let settled = false;
			void second.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				}
			);
			expect(second).toBe(first);
			await Promise.resolve();
			expect(clear).toHaveBeenCalledOnce();
			expect(settled).toBe(false);
			expect(cache.stats().disposed).toBe(false);
			await expect(sandbox.load('/')).rejects.toThrow('disposed');
			finish();
			if (fails) await expect(first).rejects.toBe(failure);
			else await expect(first).resolves.toBeUndefined();
			expect(cache.stats().disposed).toBe(true);
			expect(sandbox.dispose()).toBe(first);
			expect(clear).toHaveBeenCalledOnce();
		}
	);

	it.each([false, true])('cancels initialization during import: %s', async (duringImport) => {
		const sandbox = new Clang('CPP');
		const oldProgress = { report: vi.fn(), set: vi.fn() };
		sandbox.output = vi.fn();
		const loading = sandbox.load('/', '', true, [], {}, oldProgress);
		const rejected = expect(loading).rejects.toBe('Process terminated');
		if (duringImport) await Promise.resolve();
		expect(workerInstances).toHaveLength(0);
		const terminating = sandbox.terminate();
		const replacement = sandbox.load('/');
		await Promise.all([terminating, replacement, rejected]);
		expect(workerInstances).toHaveLength(1);
		expect(sandbox.worker).toBe(workerInstances[0]);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
		expect(oldProgress.report).not.toHaveBeenCalled();
		expect(oldProgress.set).not.toHaveBeenCalled();
		await expect(sandbox.run('int main() {}', false)).resolves.toBe(true);
	});

	it('ignores saved callbacks from a cancelled worker after a replacement run starts', async () => {
		const sandbox = new Clang('CPP');
		sandbox.output = vi.fn();
		const progress = { report: vi.fn(), set: vi.fn() };
		await sandbox.load('/', '', true, [], {}, progress);
		const worker = workerInstances[0];
		const staleLoadHandler = worker.onmessage;
		worker.postMessage.mockImplementation(() => {});
		const run = sandbox.run('int main() {}', false);
		const rejected = expect(run).rejects.toBe('Process terminated');
		const staleRunHandler = worker.onmessage;
		await sandbox.terminate();
		await rejected;
		await sandbox.load('/');
		const replacement = workerInstances[1];
		replacement.postMessage.mockImplementation(() => {});
		const nextRun = sandbox.run('int main() {}', false);
		const nextHandler = replacement.onmessage;
		progress.report.mockClear();
		progress.set.mockClear();

		staleLoadHandler?.({ data: { load: true, progress: 0.5 } } as MessageEvent);
		staleRunHandler?.({
			data: { output: 'stale', results: true, buffer: true }
		} as MessageEvent);
		expect(sandbox.output).not.toHaveBeenCalled();
		expect(progress.report).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
		expect(replacement.onmessage).toBe(nextHandler);
		expect(sandbox.exit).toBe(false);
		nextHandler?.({ data: { results: true } } as MessageEvent);
		await expect(nextRun).resolves.toBe(true);
	});

	it('passes complex C++ source with multiple declarations and mutual recursion to the worker', async () => {
		const sandbox = new Clang('CPP');
		const outputs: string[] = [];
		const code = `#include <stdio.h>

bool is_odd(int value);

bool is_even(int value) {
    return value == 0 || is_odd(value - 1);
}

bool is_odd(int value) {
    return value != 0 && is_even(value - 1);
}

int main() {
    int left = 3, right = 7;
    printf("%d:%d\\n", left + right, is_even(left + right));
    return 0;
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		await expect(sandbox.run(code, false)).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				prepare: false
			})
		);
		expect(outputs).toContain('10:1\n');
	});

	it('forwards C++ runtime errors', async () => {
		const sandbox = new Clang('CPP');
		const worker = new MockWorker();
		const events: any[] = [];

		sandbox.ondebug = (event) => events.push(event);
		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() =>
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { error: 'Runtime error: division by zero' }
				} as MessageEvent<any>)
			)
		);

		await expect(
			sandbox.run(
				`#include <stdio.h>
int main() {
    int left = 10, right = 0;
    printf("%d\\n", left / right);
    return 0;
}`,
				false
			)
		).rejects.toContain('Runtime error');
		expect(events).toEqual([{ type: 'stop' }]);
	});

	it('aliases kill to terminate for C++ sessions', () => {
		const sandbox = new Clang('CPP');
		sandbox.terminate = vi.fn();

		sandbox.kill?.();
		expect(sandbox.terminate).toHaveBeenCalledTimes(1);
	});

	it('waits for the active LLDB session to disconnect before kill resolves', async () => {
		const sandbox = new Clang('CPP');
		let releaseDisconnect!: () => void;
		const disconnect = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseDisconnect = resolve;
				})
		);
		(
			sandbox as unknown as {
				lldbSession: { disconnect(): Promise<void> };
			}
		).lldbSession = { disconnect };

		let settled = false;
		const termination = Promise.resolve(sandbox.kill?.()).then(() => {
			settled = true;
		});
		await Promise.resolve();

		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(settled).toBe(false);

		releaseDisconnect();
		await expect(termination).resolves.toBeUndefined();
		expect(settled).toBe(true);
	});

	it('forwards target memory reads to the active LLDB session', async () => {
		const sandbox = new Clang('C');
		const readMemory = vi.fn(
			async (_memoryReference: string, _offset: number, _count: number) => ({
				address: '0x10',
				data: Uint8Array.of(7, 3),
				unreadableBytes: 0
			})
		);
		(
			sandbox as unknown as {
				lldbSession: { readMemory: typeof readMemory };
			}
		).lldbSession = { readMemory };

		await expect(
			(sandbox as unknown as { debugReadMemory: typeof readMemory }).debugReadMemory(
				'0x10',
				0,
				2
			)
		).resolves.toEqual({
			address: '0x10',
			data: Uint8Array.of(7, 3),
			unreadableBytes: 0
		});
		expect(readMemory).toHaveBeenCalledWith('0x10', 0, 2);
	});

	it('forwards target memory writes to the active LLDB session', async () => {
		const sandbox = new Clang('C');
		const writeMemory = vi.fn(
			async (
				_memoryReference: string,
				_offset: number,
				_data: Uint8Array,
				_allowPartial?: boolean
			) => ({ offset: 2, bytesWritten: 2 })
		);
		(
			sandbox as unknown as {
				lldbSession: { writeMemory: typeof writeMemory };
			}
		).lldbSession = { writeMemory };

		await expect(
			(sandbox as unknown as { debugWriteMemory: typeof writeMemory }).debugWriteMemory(
				'0x10',
				2,
				Uint8Array.of(7, 3),
				true
			)
		).resolves.toEqual({ offset: 2, bytesWritten: 2 });
		expect(writeMemory).toHaveBeenCalledWith('0x10', 2, Uint8Array.of(7, 3), true);
	});

	it('forwards data breakpoints to the active LLDB session', async () => {
		const sandbox = new Clang('C');
		const dataBreakpointInfo = vi.fn(async () => ({
			dataId: '10/2',
			description: '2 bytes at 10'
		}));
		const setDataBreakpoints = vi.fn(async () => [{ id: 2, verified: true }]);
		(
			sandbox as unknown as {
				lldbSession: {
					dataBreakpointInfo: typeof dataBreakpointInfo;
					setDataBreakpoints: typeof setDataBreakpoints;
				};
			}
		).lldbSession = { dataBreakpointInfo, setDataBreakpoints };

		await expect(
			sandbox.debugDataBreakpointInfo({ name: '0x10', asAddress: true, bytes: 2 })
		).resolves.toEqual({ dataId: '10/2', description: '2 bytes at 10' });
		await expect(
			sandbox.debugSetDataBreakpoints([{ dataId: '10/2', accessType: 'write' }])
		).resolves.toEqual([{ id: 2, verified: true }]);
	});

	it('forwards frame scope requests to the active LLDB session', async () => {
		const sandbox = new Clang('C');
		const scopes = vi.fn(async (_frameId: number) => [
			{ name: 'Locals', variablesReference: 7, expensive: false, variables: [] }
		]);
		(
			sandbox as unknown as {
				lldbSession: { scopes: typeof scopes };
			}
		).lldbSession = { scopes };

		await expect(
			(sandbox as unknown as { debugScopes: typeof scopes }).debugScopes(42)
		).resolves.toEqual([
			{ name: 'Locals', variablesReference: 7, expensive: false, variables: [] }
		]);
		expect(scopes).toHaveBeenCalledWith(42);
	});

	it('configures the C++ worker asset bridge when a clang loader is provided', async () => {
		const sandbox = new Clang('CPP');
		const loader = vi.fn();

		await sandbox.load({ clang: { loader } });

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				verifiedStreaming: false,
				languageSysrootProfiles: false,
				assets: {
					baseUrl: 'https://wasm-idle.invalid/clang/',
					maxAssetBytes: 128 * 1024 * 1024,
					useAssetBridge: true,
					useModuleBridge: true
				}
			})
		);
	});

	it.each(['C', 'CPP'] as const)(
		'enables bundled language sysroots for the application %s runtime',
		async (language) => {
			const sandbox = new Clang(language);
			await sandbox.load(createApplicationRuntimeAssets('/wasm-idle'));
			expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					load: true,
					languageSysrootProfiles: true,
					assets: expect.objectContaining({ useAssetBridge: true })
				})
			);
		}
	);

	it('replaces the worker when the same Clang base switches between split and full sysroots', async () => {
		const sandbox = new Clang('C');
		const rootUrl = '/wasm-idle';
		await sandbox.load(createApplicationRuntimeAssets(rootUrl));
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage.mock.calls[0]?.[0]).toMatchObject({
			languageSysrootProfiles: true
		});

		await sandbox.load(rootUrl);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].postMessage.mock.calls[0]?.[0]).toMatchObject({
			languageSysrootProfiles: false
		});

		await sandbox.load(createApplicationRuntimeAssets(rootUrl));
		expect(workerInstances).toHaveLength(3);
		expect(workerInstances[1].terminate).toHaveBeenCalledOnce();
		expect(workerInstances[2].postMessage.mock.calls[0]?.[0]).toMatchObject({
			languageSysrootProfiles: true
		});
	});

	it.each(['C', 'CPP'] as const)(
		'enables verified streaming for the default bundled %s runtime',
		async (language) => {
			const sandbox = new Clang(language);

			await sandbox.load();

			expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					load: true,
					verifiedStreaming: true,
					assets: expect.objectContaining({ useAssetBridge: true })
				})
			);
		}
	);

	it('forwards the caller asset ceiling to the C++ worker', async () => {
		const sandbox = new Clang('CPP');

		await sandbox.load(
			{ clang: { baseUrl: 'https://cdn.example.test/clang/' } },
			'',
			true,
			[],
			{ limits: { maxAssetBytes: 4096 } }
		);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				assets: {
					baseUrl: 'https://cdn.example.test/clang/',
					maxAssetBytes: 4096,
					useAssetBridge: false,
					useModuleBridge: true
				},
				maxAssetBytes: 4096
			})
		);
	});

	it('rejects the active C++ run when kill terminates the worker', async () => {
		const sandbox = new Clang('CPP');

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		const disposeAssetBridge = vi.spyOn(sandbox.assetBridge!, 'dispose');
		worker.postMessage.mockImplementationOnce(() => {});
		const running = sandbox.run('int main() {}', false);
		sandbox.kill();

		await expect(running).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(disposeAssetBridge).toHaveBeenCalledOnce();
		expect(sandbox.assetBridge).toBeNull();
	});

	it('evaluates C++ watch expressions through the worker debug buffers', async () => {
		const sandbox = new Clang('CPP');
		sandbox.worker = {} as Worker;

		setTimeout(() => {
			flushQueuedStdin(['42'], sandbox.watchResultBuffer);
		}, 0);

		await expect(sandbox.debugEvaluate?.('A[i].s')).resolves.toBe('42');
	});

	it('serializes overlapping C++ watch evaluations on the shared transport', async () => {
		const sandbox = new Clang('CPP');
		sandbox.worker = {} as Worker;
		const control = new Int32Array(sandbox.debugBuffer);

		const firstEvaluation = sandbox.debugEvaluate('first');
		const secondEvaluation = sandbox.debugEvaluate('second');

		await vi.waitFor(() => expect(Atomics.load(control, 0)).toBe(1));
		flushQueuedStdin(['first-result'], sandbox.watchResultBuffer);
		await expect(firstEvaluation).resolves.toBe('first-result');

		await vi.waitFor(() => expect(Atomics.load(control, 0)).toBe(2));
		flushQueuedStdin(['second-result'], sandbox.watchResultBuffer);

		await expect(secondEvaluation).resolves.toBe('second-result');
	});

	it('separates compile args from runtime args for C++ runs', async () => {
		const sandbox = new Clang('CPP');
		sandbox.output = vi.fn();

		await sandbox.load('/');
		await expect(
			sandbox.run('int main() {}', false, true, undefined, ['-DLEGACY=1'], {
				programArgs: ['one', 'two'],
				cppVersion: 'CPP17'
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				language: 'CPP',
				compileArgs: ['-DLEGACY=1'],
				programArgs: ['one', 'two'],
				cppVersion: 'CPP17'
			})
		);
	});

	it('forwards structured Clang progress with its stage label', async () => {
		const sandbox = new Clang('C');
		const progress = { set: vi.fn() };

		await sandbox.load('/', '', true, [], {}, progress);

		expect(progress.set).toHaveBeenCalledWith(0.4, 'Loading Clang modules');
	});
});

describe('Clang sandbox precompiled <bits/stdc++.h>', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		vi.stubGlobal('Worker', MockWorker);
	});

	it('builds the header in a helper worker and sends it once to the warm worker', async () => {
		const header = { key: 'stdc++', bytes: new Uint8Array([1, 2]) };
		MockWorker.respond = (worker, message) => {
			if (message.precompileHeader) {
				queueMicrotask(() =>
					worker.onmessage?.({ data: { precompiledHeader: header } } as MessageEvent<any>)
				);
				return true;
			}
			if (message.load || !message.code) return false;
			queueMicrotask(() =>
				worker.onmessage?.({
					data: {
						results: true,
						...(message.precompiledHeader ? {} : { precompiledHeaderKey: header.key })
					}
				} as MessageEvent<any>)
			);
			return true;
		};
		try {
			const sandbox = new Clang('CPP');
			sandbox.output = vi.fn();
			await sandbox.load('/');
			const source = '#include <bits/stdc++.h>\nint main() {}';
			await sandbox.run(source, true, false, undefined, [], { cppVersion: 'CPP20' });
			await vi.waitFor(() => expect(workerInstances[1]?.terminate).toHaveBeenCalledOnce());
			const [warm, helper] = workerInstances;
			expect(helper.postMessage.mock.calls.map(([message]) => message)).toEqual([
				expect.objectContaining({ load: true }),
				expect.objectContaining({
					precompileHeader: true,
					code: source,
					language: 'CPP',
					cppVersion: 'CPP20',
					debugMode: 'none'
				})
			]);

			await sandbox.run(`${source}\n`, true);
			await sandbox.run(`${source}\n\n`, true);
			const runs = warm.postMessage.mock.calls
				.map(([message]) => message)
				.filter((message) => message.code && !message.load);
			expect(runs.map((message) => message.precompiledHeader)).toEqual([
				undefined,
				header,
				undefined
			]);
			expect(workerInstances).toHaveLength(2);
			await sandbox.dispose();
		} finally {
			MockWorker.respond = undefined;
		}
	});

	it('sends a newer header to a worker that already received an older one', async () => {
		let next = 0;
		const headers = [
			{ key: 'gnu++17', bytes: new Uint8Array([1]) },
			{ key: 'gnu++20', bytes: new Uint8Array([2]) }
		];
		MockWorker.respond = (worker, message) => {
			if (message.precompileHeader) {
				const header = headers[next++];
				queueMicrotask(() =>
					worker.onmessage?.({ data: { precompiledHeader: header } } as MessageEvent<any>)
				);
				return true;
			}
			if (message.load || !message.code) return false;
			const key = message.cppVersion === 'CPP20' ? 'gnu++20' : 'gnu++17';
			queueMicrotask(() =>
				worker.onmessage?.({
					data: {
						results: true,
						...(message.precompiledHeader?.key === key
							? {}
							: { precompiledHeaderKey: key })
					}
				} as MessageEvent<any>)
			);
			return true;
		};
		try {
			const sandbox = new Clang('CPP');
			sandbox.output = vi.fn();
			await sandbox.load('/');
			const source = '#include <bits/stdc++.h>\nint main() {}';
			await sandbox.run(source, true);
			await vi.waitFor(() => expect(workerInstances[1]?.terminate).toHaveBeenCalledOnce());
			await sandbox.run(source, true, false, undefined, [], { cppVersion: 'CPP20' });
			await vi.waitFor(() => expect(workerInstances[2]?.terminate).toHaveBeenCalledOnce());
			await sandbox.run(source, true, false, undefined, [], { cppVersion: 'CPP20' });
			const sent = workerInstances[0].postMessage.mock.calls
				.map(([message]) => message)
				.filter((message) => message.code && !message.load)
				.map((message) => message.precompiledHeader?.key);
			expect(sent).toEqual([undefined, 'gnu++17', 'gnu++20']);
			await sandbox.dispose();
		} finally {
			MockWorker.respond = undefined;
		}
	});

	it('stops a pending helper when the sandbox is disposed', async () => {
		MockWorker.respond = (worker, message) => {
			if (message.precompileHeader) return true;
			if (message.load || !message.code) return false;
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { results: true, precompiledHeaderKey: 'stdc++' }
				} as MessageEvent<any>)
			);
			return true;
		};
		try {
			const sandbox = new Clang('CPP');
			sandbox.output = vi.fn();
			await sandbox.load('/');
			await sandbox.run('#include <bits/stdc++.h>\nint main() {}', true);
			await vi.waitFor(() =>
				expect(workerInstances[1]?.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({ precompileHeader: true })
				)
			);
			await sandbox.dispose();
			expect(workerInstances[1].terminate).toHaveBeenCalledOnce();
		} finally {
			MockWorker.respond = undefined;
		}
	});
});
