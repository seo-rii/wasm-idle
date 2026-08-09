import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];
const workerBootstrapBlobs = new Map<string, Blob>();
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_PROLOG_BASE_URL: '',
		PUBLIC_WASM_PROLOG_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_BASE_URL: '',
		PUBLIC_WASM_GLEAM_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_MANIFEST_URL: '',
		PUBLIC_WASM_PERL_BASE_URL: '',
		PUBLIC_WASM_PERL_WORKER_URL: '',
		PUBLIC_WASM_TCL_BASE_URL: '',
		PUBLIC_WASM_TCL_WORKER_URL: '',
		PUBLIC_WASM_AWK_BASE_URL: '',
		PUBLIC_WASM_AWK_WORKER_URL: '',
		PUBLIC_WASM_PASCAL_BASE_URL: '',
		PUBLIC_WASM_PASCAL_WORKER_URL: '',
		PUBLIC_WASM_CLOJURESCRIPT_BASE_URL: '',
		PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL: '',
		PUBLIC_WASM_FORTH_BASE_URL: '',
		PUBLIC_WASM_FORTH_WORKER_URL: '',
		PUBLIC_WASM_J_BASE_URL: '',
		PUBLIC_WASM_J_WORKER_URL: '',
		PUBLIC_WASM_BQN_BASE_URL: '',
		PUBLIC_WASM_BQN_WORKER_URL: '',
		PUBLIC_WASM_JANET_BASE_URL: '',
		PUBLIC_WASM_JANET_WORKER_URL: '',
		PUBLIC_WASM_JULIA_BASE_URL: '',
		PUBLIC_WASM_JULIA_WORKER_URL: '',
		PUBLIC_WASM_NIM_BASE_URL: '',
		PUBLIC_WASM_NIM_WORKER_URL: ''
	}
}));
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;
let autoStartWorkers = true;
let workerBootstrapId = 0;
const initialCrossOriginIsolation = Object.getOwnPropertyDescriptor(
	globalThis,
	'crossOriginIsolated'
);

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	lastRunId: string | undefined;
	postMessage = vi.fn((message: any) => {
		this.lastRunId = message?.runId;
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					runId: this.lastRunId,
					output: 'factorial_plus_bonus=27\n',
					results: true
				}
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor(
		public url: string,
		public options?: WorkerOptions
	) {
		workerInstances.push(this);
		queueMicrotask(() => {
			if (!autoStartWorkers) return;
			this.onmessage?.({
				data: { __wasmIdleStaticWorkerReady: true }
			} as MessageEvent<any>);
		});
	}
}

vi.stubGlobal('Worker', MockWorker);

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Gleam from './gleam';
import Awk from './awk';
import Bqn from './bqn';
import ClojureScript from './clojurescript';
import Forth from './forth';
import J from './j';
import Janet from './janet';
import Julia from './julia';
import Nim from './nim';
import Perl from './perl';
import Pascal from './pascal';
import Prolog from './prolog';
import {
	STATIC_STDIN_RING_CANCELLED_INDEX,
	STATIC_STDIN_RING_CLOSED_INDEX,
	STATIC_STDIN_RING_CONTROL_SLOTS,
	STATIC_STDIN_RING_WRITE_INDEX
} from './staticStdinRing';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import Tcl from './tcl';

function createStreamingTestSandbox() {
	return new StaticWorkerRuntimeSandbox({
		languageId: 'STREAMING_STDIN_TEST',
		displayName: 'Streaming stdin test',
		defaultActivePath: 'main.txt',
		stdin: { mode: 'streaming', sourceHintPattern: /read/ },
		resolveRuntimeAssets: () => ({
			baseUrl: '/streaming-stdin-test/',
			workerUrl: '/streaming-stdin-test/worker.js'
		})
	});
}

async function withCrossOriginIsolation(value: boolean, callback: () => Promise<void>) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
	Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value });
	try {
		await callback();
	} finally {
		restoreCrossOriginIsolation(previous);
	}
}

function restoreCrossOriginIsolation(descriptor?: PropertyDescriptor) {
	if (descriptor) Object.defineProperty(globalThis, 'crossOriginIsolated', descriptor);
	else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
}

async function expectWorkerBootstrap(worker: MockWorker, targetUrl: string) {
	expect(worker.url).toMatch(/^blob:wasm-idle-worker-/);
	const bootstrap = workerBootstrapBlobs.get(worker.url);
	expect(bootstrap).toBeDefined();
	const source = await bootstrap!.text();
	expect(source).toContain(JSON.stringify(targetUrl));
	expect(source).toContain("['output', 'results', 'error', 'diagnostic', 'progress']");
	expect(source).toContain('runId: __wasmIdleRunId');
	expect(source).toContain("message.type === 'stdin-request'");
	expect(source.indexOf('self.postMessage =')).toBeLessThan(
		source.indexOf(JSON.stringify(targetUrl))
	);
}

describe('static worker backed language sandboxes', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'crossOriginIsolated', {
			configurable: true,
			value: false
		});
		workerInstances.length = 0;
		workerBootstrapBlobs.clear();
		onPostMessage = null;
		autoStartWorkers = true;
		workerBootstrapId = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('/* static worker */', {
						status: 200,
						headers: { 'content-length': '19' }
					})
			)
		);
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			const url = `blob:wasm-idle-worker-${workerBootstrapId++}`;
			workerBootstrapBlobs.set(url, blob as Blob);
			return url;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		for (const key of Object.keys(publicEnv)) {
			publicEnv[key as keyof typeof publicEnv] = '';
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
		restoreCrossOriginIsolation(initialCrossOriginIsolation);
	});

	it('reports prebuffered stdin for legacy runtimes and the non-isolated fallback', () => {
		expect(new Julia().stdinMode).toBe('prebuffered');
		expect(new Awk().stdinMode).toBe('prebuffered');
		expect(new Bqn().stdinMode).toBe('prebuffered');
		expect(new ClojureScript().stdinMode).toBe('prebuffered');
		expect(new Forth().stdinMode).toBe('prebuffered');
		expect(new Gleam().stdinMode).toBe('prebuffered');
		expect(new J().stdinMode).toBe('prebuffered');
		expect(new Janet().stdinMode).toBe('prebuffered');
		expect(new Nim().stdinMode).toBe('prebuffered');
		expect(new Pascal().stdinMode).toBe('prebuffered');
		expect(new Perl().stdinMode).toBe('prebuffered');
		expect(new Prolog().stdinMode).toBe('prebuffered');
		expect(new Tcl().stdinMode).toBe('prebuffered');
	});

	it('does not forward input when a static runtime declares no stdin capability', async () => {
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'NO_STDIN_TEST',
			displayName: 'No stdin test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({
				baseUrl: '/no-stdin-test/',
				workerUrl: '/no-stdin-test/worker.js'
			})
		});

		expect(sandbox.stdinMode).toBe('none');
		await sandbox.load();
		await expect(
			sandbox.run('print("ok")', false, true, undefined, [], { stdin: 'ignored\n' })
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: undefined, stdinEof: false })
		);
	});

	it('rejects missing static runtime configuration with a typed error', async () => {
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'UNCONFIGURED_TEST',
			displayName: 'Unconfigured test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets: () => ({ baseUrl: '', workerUrl: '' })
		});

		await expect(sandbox.load()).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'configuration',
			runtimeId: 'UNCONFIGURED_TEST'
		});
		await expect(sandbox.run('', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'configuration',
			runtimeId: 'UNCONFIGURED_TEST'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('streams run-correlated input after dispatch through a bounded shared ring', async () => {
		await withCrossOriginIsolation(true, async () => {
			const messages: any[] = [];
			onPostMessage = (worker, message) => {
				messages.push(message);
				if (message.run) {
					queueMicrotask(() => {
						worker.onmessage?.({
							data: { type: 'stdin-request', runId: message.runId }
						} as MessageEvent<any>);
					});
				}
			};
			const sandbox = createStreamingTestSandbox();
			expect(sandbox.stdinMode).toBe('streaming');
			expect(new Awk().stdinMode).toBe('streaming');
			expect(new Bqn().stdinMode).toBe('streaming');
			expect(new ClojureScript().stdinMode).toBe('streaming');
			expect(new Forth().stdinMode).toBe('streaming');
			expect(new Gleam().stdinMode).toBe('streaming');
			expect(new J().stdinMode).toBe('streaming');
			expect(new Janet().stdinMode).toBe('streaming');
			expect(new Julia().stdinMode).toBe('streaming');
			expect(new Nim().stdinMode).toBe('streaming');
			expect(new Pascal().stdinMode).toBe('streaming');
			expect(new Perl().stdinMode).toBe('streaming');
			expect(new Prolog().stdinMode).toBe('streaming');
			expect(new Tcl().stdinMode).toBe('streaming');
			await sandbox.load();

			const run = sandbox.run('print("prompt"); read()', false);
			await vi.waitFor(() => expect(messages.some((message) => message.run)).toBe(true));
			const runMessage = messages.find((message) => message.run);
			expect(runMessage).toMatchObject({
				run: true,
				stdin: undefined,
				stdinEof: false,
				stdinChannel: {
					protocol: 'wasm-idle-static-stdin-ring',
					protocolVersion: 1
				}
			});

			sandbox.write('after prompt\n');
			const control = new Int32Array(
				runMessage.stdinChannel.buffer,
				0,
				STATIC_STDIN_RING_CONTROL_SLOTS
			);
			expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe(13);
			expect(messages).toEqual([runMessage]);

			sandbox.eof();
			expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);
			workerInstances[0].onmessage?.({
				data: { results: true, runId: runMessage.runId }
			} as MessageEvent<any>);
			await expect(run).resolves.toBe(true);
		});
	});

	it('falls back to prebuffered stdin without cross-origin isolation', async () => {
		await withCrossOriginIsolation(false, async () => {
			const sandbox = createStreamingTestSandbox();
			expect(sandbox.stdinMode).toBe('prebuffered');
			await sandbox.load();
			const run = sandbox.run('read()', false);
			await Promise.resolve();
			expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

			sandbox.write('fallback\n');
			sandbox.eof();
			await expect(run).resolves.toBe(true);
			expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ stdin: 'fallback\n', stdinEof: true })
			);
		});
	});

	it('loads Prolog runtime urls and forwards stdin to the SWI-Prolog worker', async () => {
		const sandbox = new Prolog();
		const outputs: string[] = [];
		const code = 'main :- read_line_to_string(user_input, Line), format("~w~n", [Line]).';
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			prolog: {
				baseUrl: '/wasm-prolog/',
				workerUrl: '/wasm-prolog/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'], {
				activePath: 'main.prolog',
				stdin: '27\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-prolog/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: expect.stringMatching(/^static-\d+$/),
				baseUrl: 'http://localhost:3000/wasm-prolog/',
				code,
				args: ['demo'],
				stdin: '27\n',
				activePath: 'main.prolog'
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
	});

	it('uses a module worker and manifest url for Gleam', async () => {
		const sandbox = new Gleam();
		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(
				'import wasm_idle/stdin\npub fn main() { stdin.read_line() }',
				false,
				true,
				undefined,
				[],
				{
					stdin: '42\n'
				}
			)
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/absproxy/5173/wasm-gleam/runner-worker.js'
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/absproxy/5173/wasm-gleam/',
				manifestUrl:
					'http://localhost:3000/absproxy/5173/wasm-gleam/source-manifest.v1.json',
				stdin: '42\n'
			})
		);
	});

	it('loads Perl runtime urls and forwards stdin to the WebPerl worker', async () => {
		const sandbox = new Perl();
		await sandbox.load({
			perl: {
				baseUrl: '/wasm-perl/',
				workerUrl: '/wasm-perl/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('my $line = <STDIN>; print $line;', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-perl/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-perl/',
				stdin: 'ok\n',
				activePath: 'main.pl'
			})
		);
	});

	it('loads Tcl runtime urls and forwards stdin to the Wacl worker', async () => {
		const sandbox = new Tcl();
		await sandbox.load({
			tcl: {
				baseUrl: '/wasm-tcl/',
				workerUrl: '/wasm-tcl/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('gets stdin line; puts $line', false, true, undefined, ['demo'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-tcl/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-tcl/',
				args: ['demo'],
				stdin: 'ok\n',
				activePath: 'main.tcl'
			})
		);
	});

	it('loads AWK runtime urls and forwards stdin to the GoAWK worker', async () => {
		const sandbox = new Awk();
		await sandbox.load({
			awk: {
				baseUrl: '/wasm-awk/',
				workerUrl: '/wasm-awk/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('{ print $0 }', false, true, undefined, ['demo=1'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-awk/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-awk/',
				args: ['demo=1'],
				stdin: 'ok\n',
				activePath: 'main.awk'
			})
		);
	});

	it('loads Pascal runtime urls and forwards stdin to the pas2js worker', async () => {
		const sandbox = new Pascal();
		await sandbox.load({
			pascal: {
				baseUrl: '/wasm-pascal/',
				workerUrl: '/wasm-pascal/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run(
				'program main; var n: integer; begin ReadLn(n); WriteLn(n); end.',
				false,
				true,
				undefined,
				[],
				{
					stdin: 'ok\n'
				}
			)
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-pascal/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-pascal/',
				stdin: 'ok\n',
				activePath: 'main.pas'
			})
		);
	});

	it('loads ClojureScript runtime urls and forwards stdin, args, and workspace files', async () => {
		const sandbox = new ClojureScript();
		const code = `(ns wasm-idle.main (:require [wasm-idle.runtime :as runtime]))
(println (runtime/read-line))`;
		await sandbox.load({
			clojurescript: {
				baseUrl: '/wasm-clojurescript/',
				workerUrl: '/wasm-clojurescript/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'], {
				activePath: 'src/wasm_idle/main.cljs',
				stdin: '68\n',
				workspaceFiles: [{ path: 'src/demo.cljs', content: '(ns demo)' }]
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-clojurescript/runner-worker.js?v=test'
		);
		expect(workerInstances[0].options).toBeUndefined();
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-clojurescript/',
				code,
				args: ['demo'],
				stdin: '68\n',
				activePath: 'src/wasm_idle/main.cljs',
				workspaceFiles: [{ path: 'src/demo.cljs', content: '(ns demo)' }]
			})
		);
	});

	it('loads Forth runtime urls and forwards stdin to the WAForth worker', async () => {
		const sandbox = new Forth();
		await sandbox.load({
			forth: {
				baseUrl: '/wasm-forth/',
				workerUrl: '/wasm-forth/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('KEY EMIT', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-forth/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-forth/',
				stdin: 'ok\n',
				activePath: 'main.fth'
			})
		);
	});

	it('loads J runtime urls and forwards stdin to the official J wasm worker', async () => {
		const sandbox = new J();
		await sandbox.load({
			j: {
				baseUrl: '/wasm-j/',
				workerUrl: '/wasm-j/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('input =: 1!:1 [ 1', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-j/runner-worker.js?v=test'
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-j/',
				stdin: 'ok\n',
				activePath: 'main.ijs'
			})
		);
	});

	it('loads BQN runtime urls and forwards stdin to the CBQN worker', async () => {
		const sandbox = new Bqn();
		await sandbox.load({
			bqn: {
				baseUrl: '/wasm-bqn/',
				workerUrl: '/wasm-bqn/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('5+•ParseFloat •GetLine @', false, true, undefined, [], {
				stdin: '68\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-bqn/runner-worker.js?v=test'
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-bqn/',
				stdin: '68\n',
				activePath: 'main.bqn'
			})
		);
	});

	it('loads Janet runtime urls and forwards stdin to the upstream Janet worker', async () => {
		const sandbox = new Janet();
		await sandbox.load({
			janet: {
				baseUrl: '/wasm-janet/',
				workerUrl: '/wasm-janet/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('(print (getline))', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-janet/runner-worker.js?v=test'
		);
		expect(workerInstances[0].options).toEqual({ type: 'module' });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-janet/',
				stdin: 'ok\n',
				activePath: 'main.janet'
			})
		);
	});

	it('loads Julia runtime urls and forwards stdin to the Julia wasm worker', async () => {
		const sandbox = new Julia();
		await sandbox.load({
			julia: {
				baseUrl: '/wasm-julia/',
				workerUrl: '/wasm-julia/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('println(readline())', false, true, undefined, [], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-julia/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-julia/',
				stdin: 'ok\n',
				activePath: 'main.jl'
			})
		);
	});

	it('loads Nim runtime urls and forwards stdin to the Nim wasm compiler worker', async () => {
		const sandbox = new Nim();
		await sandbox.load({
			nim: {
				baseUrl: '/wasm-nim/',
				workerUrl: '/wasm-nim/runner-worker.js?v=test'
			}
		});
		await expect(
			sandbox.run('echo stdin.readLine()', false, true, undefined, ['demo'], {
				stdin: 'ok\n'
			})
		).resolves.toBe(true);

		await expectWorkerBootstrap(
			workerInstances[0],
			'http://localhost:3000/wasm-nim/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-nim/',
				args: ['demo'],
				stdin: 'ok\n',
				activePath: 'main.nim'
			})
		);
	});

	it('resets reused progress sinks and keeps each lifecycle monotonic', async () => {
		onPostMessage = (worker, message) => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						runId: message.runId,
						progress: { percent: 70, stage: 'Compiling and linking Nim output' }
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: {
						runId: message.runId,
						progress: { percent: 20, stage: 'Late stale progress' }
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: { runId: message.runId, results: true }
				} as MessageEvent<any>);
			});
		};
		const progress = { set: vi.fn() };
		const sandbox = new Nim();
		await sandbox.load('/absproxy/5173', '', true, [], {}, progress);
		const loadCalls = progress.set.mock.calls.slice();
		expect(loadCalls[0]).toEqual([0, 'Resolving Nim runtime']);
		const loadValues = loadCalls.map(([value]) => value as number);
		expect(loadValues).toEqual([...loadValues].sort((left, right) => left - right));
		expect(Math.max(...loadValues)).toBeLessThan(1);

		const prepareStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "ok"', true, true, progress)).resolves.toBe(true);
		const prepareCalls = progress.set.mock.calls.slice(prepareStart);
		expect(prepareCalls[0]).toEqual([0, 'Preparing Nim runtime']);
		const prepareValues = prepareCalls.map(([value]) => value as number);
		expect(prepareValues).toEqual([...prepareValues].sort((left, right) => left - right));
		expect(prepareValues.at(-1)).toBe(0.25);
		expect(workerInstances).toHaveLength(1);
		const repeatedLoadProgress = { set: vi.fn() };
		await sandbox.load('/absproxy/5173', '', true, [], {}, repeatedLoadProgress);
		expect(repeatedLoadProgress.set).not.toHaveBeenCalled();

		const firstRunStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "ok"', false, true, progress)).resolves.toBe(true);
		const firstRunCalls = progress.set.mock.calls.slice(firstRunStart);
		expect(firstRunCalls[0]).toEqual([0, 'Starting Nim run']);
		const compileProgress = firstRunCalls.find(
			([, stage]) => stage === 'Compiling and linking Nim output'
		);
		expect(compileProgress?.[0]).toBeCloseTo(0.755);
		expect(progress.set).not.toHaveBeenCalledWith(expect.any(Number), 'Late stale progress');
		const firstRunValues = firstRunCalls.map(([value]) => value as number);
		expect(firstRunValues).toEqual([...firstRunValues].sort((left, right) => left - right));
		expect(firstRunValues.at(-1)).toBe(1);

		const secondRunStart = progress.set.mock.calls.length;
		await expect(sandbox.run('echo "again"', false, true, progress)).resolves.toBe(true);
		const secondRunCalls = progress.set.mock.calls.slice(secondRunStart);
		expect(secondRunCalls[0]).toEqual([0, 'Starting Nim run']);
		const secondRunValues = secondRunCalls.map(([value]) => value as number);
		expect(secondRunValues).toEqual([...secondRunValues].sort((left, right) => left - right));
		expect(secondRunValues).toContain(0.05);
		expect(secondRunValues.at(-1)).toBe(1);
		expect(workerInstances).toHaveLength(2);
	});

	it('settles a throwing worker-ready callback and ignores the retired worker during retry', async () => {
		autoStartWorkers = false;
		const callbackError = new Error('worker-ready progress failed');
		const cleanupError = new Error('startup listener cleanup failed');
		const controller = new AbortController();
		let throwOnReady = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (throwOnReady && stage === 'Prolog worker ready') throw callbackError;
			})
		};
		const sandbox = new Prolog();
		const load = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw cleanupError;
		});
		const retiredWorker = workerInstances[0];
		const staleReady = retiredWorker.onmessage;
		const staleError = retiredWorker.onerror;

		staleReady?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);

		await expect(load).rejects.toBe(callbackError);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		throwOnReady = false;
		const retry = sandbox.load('/absproxy/5173', '', true, [], {}, progress);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const replacementWorker = workerInstances[1];
		staleReady?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		staleError?.(new ErrorEvent('error', { message: 'retired worker failed' }));
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		replacementWorker.onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await expect(retry).resolves.toBeUndefined();
	});

	it('settles successful worker startup when caller-owned signal cleanup throws', async () => {
		autoStartWorkers = false;
		const controller = new AbortController();
		const sandbox = new Prolog();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw new Error('startup listener cleanup failed');
		});

		workerInstances[0].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);

		await expect(load).resolves.toBeUndefined();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('reserves run ownership before the initial progress callback can reenter', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		let nested: Promise<boolean | string> | undefined;
		let reenter = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!reenter || stage !== 'Starting Prolog run') return;
				reenter = false;
				nested = sandbox.run('writeln(nested).', false, true, undefined, [], {
					stdin: ''
				});
			})
		};

		const outer = sandbox.run('writeln(outer).', false, true, progress, [], { stdin: '' });

		expect(nested).toBeDefined();
		await expect(nested).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(outer).resolves.toBe(true);
	});

	it('returns a rejected Promise when the initial run progress callback throws', async () => {
		const callbackError = new Error('initial run progress failed');
		let throwOnStart = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!throwOnStart || stage !== 'Starting Prolog run') return;
				throwOnStart = false;
				throw callbackError;
			})
		};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		let failed: Promise<boolean | string> | undefined;

		expect(() => {
			failed = sandbox.run('writeln(failed).', false, true, progress, [], { stdin: '' });
		}).not.toThrow();
		expect(failed).toBeDefined();
		await expect(failed).rejects.toBe(callbackError);
		await expect(
			sandbox.run('writeln(retry).', false, true, progress, [], { stdin: '' })
		).resolves.toBe(true);
	});

	it('preserves disposal when initial run progress disposes and then throws', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('initial run progress failed after disposal');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage !== 'Starting Prolog run') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(
			sandbox.run('writeln(disposed).', false, true, progress, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('does not dispatch a run after progress reentrantly disposes its worker', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const progress = {
			set: vi.fn((value: number) => {
				if (value === 0.3) void sandbox.dispose();
			})
		};

		await expect(
			sandbox.run('writeln(disposed).', false, true, progress, [], { stdin: '' })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('classifies reentrant termination of a prepare-only run as startup cancellation', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		let terminateOnPrepare = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!terminateOnPrepare || stage !== 'Preparing Prolog runtime') return;
				terminateOnPrepare = false;
				sandbox.terminate();
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects a prepare run asynchronously when signal registration throws and permits retry', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		sandbox.terminate();
		const callbackError = new Error('signal registration failed');
		const removeEventListener = vi.fn();
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(() => {
				throw callbackError;
			}),
			removeEventListener
		} as unknown as AbortSignal;
		let failed: Promise<boolean | string> | undefined;

		expect(() => {
			failed = sandbox.run('', true, true, undefined, [], { signal });
		}).not.toThrow();
		expect(failed).toBeDefined();
		await expect(failed).rejects.toBe(callbackError);
		expect(removeEventListener).toHaveBeenCalledOnce();
		await expect(sandbox.run('', true)).resolves.toBe(true);
	});

	it('cancels an immediately terminated prepare startup without recreating its worker', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		sandbox.terminate();
		const retiredWorker = workerInstances[0];

		const pending = sandbox.run('', true);
		sandbox.terminate();

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances).toEqual([retiredWorker]);
	});

	it('cancels an immediately terminated warm prepare', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		const pending = sandbox.run('', true);
		sandbox.terminate();

		await expect(pending).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toEqual([worker]);
	});

	it('preserves disposal when warm prepare progress disposes and then throws', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const callbackError = new Error('warm prepare progress failed after disposal');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage !== 'Prolog worker ready') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('cancels warm prepare when ready progress reentrantly terminates it', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage === 'Prolog worker ready') sandbox.terminate();
			})
		};

		await expect(sandbox.run('', true, true, progress)).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it.each(['progress', 'output', 'diagnostic'] as const)(
		'settles a throwing runtime %s callback and permits retry',
		async (callbackKind) => {
			onPostMessage = () => {};
			const callbackError = new Error(`${callbackKind} callback failed`);
			let throwCallback = true;
			const progress = {
				set: vi.fn((_value: number, stage?: string) => {
					if (
						throwCallback &&
						callbackKind === 'progress' &&
						stage === 'Runtime callback'
					) {
						throw callbackError;
					}
				})
			};
			const output = vi.fn(() => {
				if (throwCallback && callbackKind === 'output') throw callbackError;
			});
			const diagnosticSink = vi.fn(() => {
				if (throwCallback && callbackKind === 'diagnostic') throw callbackError;
			});
			const sandbox = new Prolog();
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnosticSink;
			await sandbox.load('/absproxy/5173');
			const run = sandbox.run('writeln(callback).', false, true, progress, [], {
				stdin: ''
			});
			const outcome = run.catch((error) => error);
			await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
			const worker = workerInstances[0];
			const diagnostic = {
				lineNumber: 1,
				severity: 'warning' as const,
				message: 'runtime warning'
			};

			worker.onmessage?.({
				data: {
					runId: worker.lastRunId,
					progress: { percent: 50, stage: 'Runtime callback' },
					output: 'callback output\n',
					diagnostic,
					results: true
				}
			} as MessageEvent<any>);

			await expect(outcome).resolves.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(output).toHaveBeenCalledTimes(callbackKind === 'progress' ? 0 : 1);
			expect(diagnosticSink).toHaveBeenCalledTimes(callbackKind === 'diagnostic' ? 1 : 0);

			throwCallback = false;
			onPostMessage = null;
			await expect(
				sandbox.run('writeln(retry).', false, true, progress, [], { stdin: '' })
			).resolves.toBe(true);
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('rejects when completion progress throws even if worker cleanup also fails', async () => {
		onPostMessage = () => {};
		const callbackError = new Error('completion progress failed');
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (stage === 'Prolog run complete') throw callbackError;
			})
		};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(complete).', false, true, progress, [], { stdin: '' });
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		Object.defineProperty(worker, 'onmessage', {
			configurable: true,
			get: () => handler,
			set: () => {
				throw new Error('worker handler cleanup failed');
			}
		});
		worker.terminate.mockImplementationOnce(() => {
			throw new Error('worker cleanup failed');
		});

		handler?.({
			data: { runId: worker.lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('preserves a replacement run when completion progress terminates and then throws', async () => {
		onPostMessage = () => {};
		const callbackError = new Error('stale completion callback failed');
		const sandbox = new Prolog();
		let replacement: Promise<boolean | string> | undefined;
		let replaceOnCompletion = true;
		const progress = {
			set: vi.fn((_value: number, stage?: string) => {
				if (!replaceOnCompletion || stage !== 'Prolog run complete') return;
				replaceOnCompletion = false;
				sandbox.terminate();
				replacement = sandbox.run('writeln(replacement).', false, true, progress, [], {
					stdin: ''
				});
				throw callbackError;
			})
		};
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, progress, [], { stdin: '' });
		const firstOutcome = first.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		staleHandler?.({
			data: { runId: retiredWorker.lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(firstOutcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const replacementWorker = workerInstances[1];
		await vi.waitFor(() => expect(replacementWorker.postMessage).toHaveBeenCalledOnce());
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		expect(replacement).toBeDefined();

		staleHandler?.({
			data: { runId: retiredWorker.lastRunId, results: true }
		} as MessageEvent<any>);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		replacementWorker.onmessage?.({
			data: { runId: replacementWorker.lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(replacement).resolves.toBe(true);
	});

	it('rejects an overlapping run while worker startup is pending', async () => {
		autoStartWorkers = false;
		const sandbox = new Prolog();
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		let firstSettled = false;
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		void first.finally(() => {
			firstSettled = true;
		});
		const overlapping = sandbox.run('writeln(second).', false, true, undefined, [], {
			stdin: ''
		});

		await expect(overlapping).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PROLOG',
			recoverable: true
		});
		expect(firstSettled).toBe(false);

		workerInstances[0].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await load;
		await expect(first).resolves.toBe(true);
	});

	it('settles a shared pending startup when its active run is cancelled', async () => {
		autoStartWorkers = false;
		const sandbox = new Prolog();
		const loadOutcome = sandbox.load('/absproxy/5173').catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const runOutcome = sandbox
			.run('writeln(cancelled).', false, true, undefined, [], {
				stdin: '',
				signal: controller.signal
			})
			.catch((error) => error);

		controller.abort(new Error('cancel shared startup'));

		const runError = await runOutcome;
		await expect(loadOutcome).resolves.toBe(runError);
		expect(runError).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		const retry = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		workerInstances[1].onmessage?.({
			data: { __wasmIdleStaticWorkerReady: true }
		} as MessageEvent<any>);
		await expect(retry).resolves.toBeUndefined();
	});

	it('ignores a stale abort listener when cleanup fails and a replacement awaits stdin', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const controller = new AbortController();
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
			throw new Error('run listener cleanup failed');
		});
		const first = sandbox.run('writeln(first).', false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(first).resolves.toBe(true);

		const second = sandbox.run(
			'main :- read_line_to_string(user_input, Line), writeln(Line).',
			false
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		await Promise.resolve();
		controller.abort(new Error('late stale abort'));
		sandbox.write('replacement\n');
		sandbox.eof();
		await vi.waitFor(() => expect(workerInstances[1].postMessage).toHaveBeenCalledOnce());
		workerInstances[1].onmessage?.({
			data: { runId: workerInstances[1].lastRunId, results: true }
		} as MessageEvent<any>);

		await expect(second).resolves.toBe(true);
	});

	it('rejects an overlapping run while the first run waits for stdin', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		const first = sandbox.run(code, false);
		await Promise.resolve();

		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

		sandbox.write('first\n');
		sandbox.eof();
		await expect(first).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
	});

	it('rejects an overlapping run while the worker is executing', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });

		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(first).resolves.toBe(true);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('ignores uncorrelated and stale messages until the active run responds', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(current).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		let settled = false;
		void run.finally(() => {
			settled = true;
		});
		workerInstances[0].onmessage?.({
			data: { output: 'missing-run-id\n', results: true }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId: 'static-stale', output: 'stale\n', results: true }
		} as MessageEvent<any>);
		await Promise.resolve();

		expect(settled).toBe(false);
		expect(output).not.toHaveBeenCalled();
		const runId = workerInstances[0].lastRunId;
		expect(runId).toMatch(/^static-\d+$/);
		workerInstances[0].onmessage?.({
			data: { runId, output: 'current\n' }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId, results: true }
		} as MessageEvent<any>);

		await expect(run).resolves.toBe(true);
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('current\n');
	});

	it('cancels a static run while it is waiting for stdin', async () => {
		const controller = new AbortController();
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		const run = sandbox.run(code, false, true, undefined, [], {
			signal: controller.signal
		});
		const outcome = run.catch((error) => error);
		await Promise.resolve();
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();

		controller.abort(new Error('cancel stdin wait'));
		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run at its aggregate execution deadline', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(slow).', false, true, undefined, [], {
			stdin: '',
			limits: { compileTimeoutMs: 5, runTimeoutMs: 5 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'PROLOG',
			timeoutMs: 10
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run before emitting output beyond its UTF-8 byte limit', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(output).', false, true, undefined, [], {
			stdin: '',
			limits: { maxOutputBytes: 4 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, output: 'ééé' }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'PROLOG',
			actual: 6,
			limit: 4
		});
		expect(output).not.toHaveBeenCalled();
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static run when its diagnostic count exceeds the limit', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		const oncompilerdiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		await sandbox.load('/absproxy/5173');
		const run = sandbox.run('writeln(diagnostics).', false, true, undefined, [], {
			stdin: '',
			limits: { maxDiagnostics: 1 }
		});
		const outcome = run.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		const diagnostic = {
			lineNumber: 1,
			severity: 'warning' as const,
			message: 'test diagnostic'
		};
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, diagnostic }
		} as MessageEvent<any>);
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, diagnostic }
		} as MessageEvent<any>);

		await expect(outcome).resolves.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'PROLOG',
			actual: 2,
			limit: 1
		});
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
		expect(oncompilerdiagnostic).toHaveBeenCalledWith(diagnostic);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects unsafe static workspace paths before dispatch', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('writeln(unsafe).', false, true, undefined, [], {
				activePath: '../main.prolog',
				workspaceFiles: [{ path: 'safe.prolog', content: '' }]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path',
			path: '../main.prolog'
		});
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('normalizes static workspace paths and enforces the aggregate byte limit', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('writeln(ok).', false, true, undefined, [], {
				activePath: 'src\\main.prolog',
				workspaceFiles: [{ path: 'src\\helper.prolog', content: 'helper.' }]
			})
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				activePath: 'src/main.prolog',
				workspaceFiles: [{ path: 'src/helper.prolog', content: 'helper.' }]
			})
		);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('12345', false, true, undefined, [], {
				limits: { maxWorkspaceBytes: 4 }
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'file-size-limit',
			actual: 5,
			limit: 4
		});
		expect(workerInstances[1].postMessage).not.toHaveBeenCalled();
	});

	it('releases the active-run slot after kill for an immediate rerun', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		const first = sandbox.run('writeln(first).', false, true, undefined, [], { stdin: '' });
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());

		sandbox.kill();
		await expect(first).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'execute',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		onPostMessage = null;
		await expect(
			sandbox.run('writeln(second).', false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('buffers every stdin chunk until EOF and preserves explicit empty stdin', async () => {
		const sandbox = new Prolog();
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		await sandbox.load('/absproxy/5173');

		const run = sandbox.run(code, false);
		sandbox.write('first\n');
		await Promise.resolve();
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		sandbox.write('second\n');
		sandbox.eof();
		await expect(run).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				stdin: 'first\nsecond\n',
				stdinEof: true
			})
		);

		await sandbox.load('/absproxy/5173');
		const explicitInputWithoutPattern = sandbox.run('writeln(ok).', false);
		sandbox.write('still forwarded\n');
		sandbox.eof();
		await expect(explicitInputWithoutPattern).resolves.toBe(true);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'still forwarded\n', stdinEof: true })
		);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, false, true, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
		expect(workerInstances[2].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: '', stdinEof: true })
		);
	});

	it('does not leak stdin queued before or during an explicit-input run', async () => {
		onPostMessage = () => {};
		const sandbox = new Prolog();
		const code = 'main :- read_line_to_string(user_input, Line), writeln(Line).';
		await sandbox.load('/absproxy/5173');
		sandbox.write('queued before the run\n');
		sandbox.eof();

		const explicitRun = sandbox.run(code, false, true, undefined, [], {
			stdin: 'explicit input\n'
		});
		await vi.waitFor(() => expect(workerInstances[0].postMessage).toHaveBeenCalledOnce());
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'explicit input\n', stdinEof: true })
		);
		sandbox.write('queued during the run\n');
		sandbox.eof();
		workerInstances[0].onmessage?.({
			data: { runId: workerInstances[0].lastRunId, results: true }
		} as MessageEvent<any>);
		await expect(explicitRun).resolves.toBe(true);

		onPostMessage = null;
		await sandbox.load('/absproxy/5173');
		const nextRun = sandbox.run(code, false);
		await Promise.resolve();
		expect(workerInstances[1].postMessage).not.toHaveBeenCalled();

		sandbox.write('fresh input\n');
		sandbox.eof();
		await expect(nextRun).resolves.toBe(true);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'fresh input\n', stdinEof: true })
		);
	});

	it('rejects a pre-cancelled static worker load before fetching', async () => {
		const controller = new AbortController();
		controller.abort(new Error('cancel before load'));
		const sandbox = new Prolog();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it.each([
		[
			'an unsupported scheme',
			'data:text/javascript,postMessage({})',
			'Unsafe worker URL test worker script URL must use HTTP(S)'
		],
		[
			'credentials',
			'https://user:secret@assets.example.test/runtime/worker.js',
			'Unsafe worker URL test worker script URL must not include credentials'
		],
		[
			'a fragment',
			'https://assets.example.test/runtime/worker.js#token',
			'Unsafe worker URL test worker script URL must not include a fragment'
		]
	])(
		'rejects a static worker URL containing %s before fetching',
		async (_kind, workerUrl, message) => {
			const sandbox = new StaticWorkerRuntimeSandbox({
				languageId: 'UNSAFE_WORKER_URL_TEST',
				displayName: 'Unsafe worker URL test',
				defaultActivePath: 'main.txt',
				stdin: { mode: 'none' },
				resolveRuntimeAssets: () => ({
					baseUrl: 'https://assets.example.test/runtime/',
					workerUrl
				})
			});

			const outcome = await sandbox.load().catch((error) => error);
			expect(outcome).toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'configuration',
				runtimeId: 'UNSAFE_WORKER_URL_TEST',
				message
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('aborts a static worker download at its asset deadline', async () => {
		let fetchSignal: AbortSignal | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			fetchSignal = init?.signal ?? undefined;
			return new Promise((_resolve, reject) => {
				fetchSignal?.addEventListener(
					'abort',
					() => reject(fetchSignal?.reason ?? new DOMException('Aborted', 'AbortError')),
					{ once: true }
				);
			});
		});
		const sandbox = new Prolog();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { assetTimeoutMs: 5 }
			})
		).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			runtimeId: 'PROLOG',
			timeoutMs: 5
		});
		expect(fetchSignal?.aborted).toBe(true);
		expect(workerInstances).toHaveLength(0);
	});

	it('enforces the asset deadline when worker-script fetch ignores its signal', async () => {
		let markFetchStarted!: () => void;
		const fetchStarted = new Promise<void>((resolve) => {
			markFetchStarted = resolve;
		});
		let resolveFetch!: (response: Response) => void;
		const fetchPending = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		let fetchSignal: AbortSignal | undefined;
		let addEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let removeEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			fetchSignal = init?.signal ?? undefined;
			if (fetchSignal) {
				addEventListener = vi.spyOn(fetchSignal, 'addEventListener');
				removeEventListener = vi.spyOn(fetchSignal, 'removeEventListener');
			}
			markFetchStarted();
			return fetchPending;
		});
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const lateResponse = {
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { cancel, getReader }
		} as unknown as Response;
		const progress = { set: vi.fn() };
		const sandbox = new Prolog();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ limits: { assetTimeoutMs: 5 } },
			progress
		);
		let guard: ReturnType<typeof setTimeout> | undefined;

		try {
			await fetchStarted;
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					guard = setTimeout(() => resolve({ status: 'pending' }), 100);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'TimeoutError',
					code: 'timeout',
					phase: 'asset',
					runtimeId: 'PROLOG',
					timeoutMs: 5
				}
			});
			expect(fetchSignal?.aborted).toBe(true);
			const abortRegistration = addEventListener?.mock.calls.find(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
			resolveFetch(lateResponse);
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(fetchSignal?.reason));
			expect(getReader).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
		} finally {
			if (guard) clearTimeout(guard);
			resolveFetch(lateResponse);
			await loading.catch(() => {});
		}
	});

	it('cancels stalled bodyless worker-script materialization promptly', async () => {
		let markMaterializationStarted!: () => void;
		const materializationStarted = new Promise<void>((resolve) => {
			markMaterializationStarted = resolve;
		});
		let resolveArrayBuffer!: (value: ArrayBuffer) => void;
		const arrayBufferPending = new Promise<ArrayBuffer>((resolve) => {
			resolveArrayBuffer = resolve;
		});
		const arrayBuffer = vi.fn(() => {
			markMaterializationStarted();
			return arrayBufferPending;
		});
		let phaseSignal: AbortSignal | undefined;
		let phaseAddEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let phaseRemoveEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			phaseSignal = init?.signal ?? undefined;
			if (phaseSignal) {
				phaseAddEventListener = vi.spyOn(phaseSignal, 'addEventListener');
				phaseRemoveEventListener = vi.spyOn(phaseSignal, 'removeEventListener');
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers(),
				body: null,
				arrayBuffer
			} as unknown as Response);
		});
		const controller = new AbortController();
		const reason = new Error('stop bodyless worker-script read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = { set: vi.fn() };
		const sandbox = new Prolog();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await materializationStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'CancelledError',
					code: 'cancelled',
					phase: 'asset',
					runtimeId: 'PROLOG',
					cause: reason
				}
			});
			expect(phaseSignal?.aborted).toBe(true);
			const phaseAbortRegistrations = phaseAddEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(phaseAbortRegistrations).toHaveLength(2);
			for (const registration of phaseAbortRegistrations ?? []) {
				expect(phaseRemoveEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			const callerAbortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			for (const registration of callerAbortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await Promise.resolve();
			await Promise.resolve();
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
			expect(workerInstances).toHaveLength(0);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			await loading.catch(() => {});
		}
	});

	it.each([
		['while cancellation and the read remain pending', false],
		['when cancellation settles the read first', true]
	])('cancels a stalled worker-script stream read %s', async (_case, settleReadOnCancel) => {
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let resolveRead!: (result: { done: true; value: undefined }) => void;
		const readPending = new Promise<{ done: true; value: undefined }>((resolve) => {
			resolveRead = resolve;
		});
		const read = vi.fn(() => {
			markReadStarted();
			return readPending;
		});
		let resolveCancel!: () => void;
		const cancelPending = new Promise<void>((resolve) => {
			resolveCancel = resolve;
		});
		const cancel = vi.fn(() => {
			if (settleReadOnCancel) {
				resolveRead({ done: true, value: undefined });
				return Promise.resolve();
			}
			return cancelPending;
		});
		const releaseLock = vi.fn();
		let phaseSignal: AbortSignal | undefined;
		let phaseAddEventListener: ReturnType<typeof vi.spyOn> | undefined;
		let phaseRemoveEventListener: ReturnType<typeof vi.spyOn> | undefined;
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			phaseSignal = init?.signal ?? undefined;
			if (phaseSignal) {
				phaseAddEventListener = vi.spyOn(phaseSignal, 'addEventListener');
				phaseRemoveEventListener = vi.spyOn(phaseSignal, 'removeEventListener');
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers(),
				body: { getReader: () => ({ cancel, read, releaseLock }) }
			} as unknown as Response);
		});
		const controller = new AbortController();
		const reason = new Error('stop worker-script stream read');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = { set: vi.fn() };
		const sandbox = new Prolog();
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await readStarted;
			controller.abort(reason);
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, error: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toMatchObject({
				status: 'rejected',
				error: {
					name: 'CancelledError',
					code: 'cancelled',
					phase: 'asset',
					runtimeId: 'PROLOG',
					cause: reason
				}
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(cancel).toHaveBeenCalledWith(reason);
			expect(releaseLock).toHaveBeenCalledOnce();
			const phaseAbortRegistrations = phaseAddEventListener?.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			expect(phaseAbortRegistrations).toHaveLength(2);
			for (const registration of phaseAbortRegistrations ?? []) {
				expect(phaseRemoveEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			const callerAbortRegistrations = addEventListener.mock.calls.filter(
				([type]) => type === 'abort'
			);
			for (const registration of callerAbortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}
			expect(progress.set).not.toHaveBeenCalledWith(0.2, 'Prolog worker downloaded');
			expect(workerInstances).toHaveLength(0);
		} finally {
			if (timeout) clearTimeout(timeout);
			resolveCancel();
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	});

	it('preloads static worker scripts with least-authority request options', async () => {
		const sandbox = new Prolog();

		await sandbox.load('/absproxy/5173');

		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:3000/absproxy/5173/wasm-prolog/runner-worker.js',
			expect.objectContaining({
				cache: 'force-cache',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			})
		);
	});

	it.each([
		['relative', 'runner-worker.js'],
		['substituted', 'https://evil.example/runner-worker.js']
	])(
		'rejects a %s static worker final URL before reading its body',
		async (_kind, responseUrl) => {
			const cancel = vi.fn(async () => undefined);
			const getReader = vi.fn();
			const arrayBuffer = vi.fn();
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: responseUrl,
				headers: new Headers(),
				body: { cancel, getReader },
				arrayBuffer
			} as unknown as Response);
			const sandbox = new Prolog();

			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'PROLOG'
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it.each(['pending', 'throw', 'reject'] as const)(
		'reports failed static worker responses without awaiting %s cancellation',
		async (cancellationMode) => {
			let resolveCancellation!: () => void;
			const stalledCancellation = new Promise<void>((resolve) => {
				resolveCancellation = resolve;
			});
			const cancel = vi.fn((reason?: unknown) => {
				if (cancellationMode === 'throw') {
					throw new Error('static worker response cancellation threw');
				}
				if (cancellationMode === 'reject') {
					return Promise.reject(
						new Error('static worker response cancellation rejected')
					);
				}
				return stalledCancellation;
			});
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 503,
				url: '',
				headers: new Headers(),
				body: { cancel }
			} as unknown as Response);
			const sandbox = new Prolog();
			const loading = sandbox.load('/absproxy/5173');
			let timeout: ReturnType<typeof setTimeout> | undefined;

			try {
				const outcome = await Promise.race([
					loading.then(
						(value) => ({ status: 'resolved' as const, value }),
						(error) => ({ status: 'rejected' as const, reason: error as unknown })
					),
					new Promise<{ status: 'pending' }>((resolve) => {
						timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
					})
				]);

				expect(outcome.status).toBe('rejected');
				if (outcome.status !== 'rejected')
					throw new Error('expected worker load to reject');
				expect(outcome.reason).toMatchObject({
					name: 'AssetNotFoundError',
					code: 'asset-not-found',
					phase: 'asset',
					runtimeId: 'PROLOG'
				});
				expect(cancel).toHaveBeenCalledOnce();
				expect(cancel.mock.calls[0]?.[0]).toBe(outcome.reason);
				expect(workerInstances).toHaveLength(0);
			} finally {
				if (timeout) clearTimeout(timeout);
				resolveCancellation();
				await loading.catch(() => {});
			}
		}
	);

	it.each(['', '-1', '1.5', '1e2', '3, 3', '9007199254740992'])(
		'rejects an invalid static worker Content-Length before reading: %s',
		async (contentLength) => {
			const cancel = vi.fn(async () => undefined);
			const getReader = vi.fn();
			const arrayBuffer = vi.fn();
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				status: 200,
				url: '',
				headers: new Headers({ 'content-length': contentLength }),
				body: { cancel, getReader },
				arrayBuffer
			} as unknown as Response);
			const sandbox = new Prolog();

			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol',
				phase: 'asset',
				runtimeId: 'PROLOG'
			});
			expect(cancel).toHaveBeenCalledOnce();
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('rejects an oversized static worker script before reading its body', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response('small test body', {
				headers: { 'content-length': '1024' }
			})
		);
		const sandbox = new Prolog();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { maxAssetBytes: 32 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			phase: 'asset',
			runtimeId: 'PROLOG',
			actual: 1024,
			limit: 32
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('cancels an unknown-length worker-script stream after its byte limit', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(64)));
		const sandbox = new Prolog();

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { maxAssetBytes: 32 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			phase: 'asset',
			runtimeId: 'PROLOG',
			actual: 64,
			limit: 32
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('releases a successful static worker response reader', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
			.mockResolvedValueOnce({ done: true, value: undefined });
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { getReader: () => ({ cancel, read, releaseLock }) }
		} as unknown as Response);
		const sandbox = new Prolog();

		await sandbox.load('/absproxy/5173');

		expect(cancel).not.toHaveBeenCalled();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('cancels and releases a static worker reader when streaming fails', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn().mockRejectedValueOnce(new Error('worker stream failed'));
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			url: '',
			headers: new Headers(),
			body: { getReader: () => ({ cancel, read, releaseLock }) }
		} as unknown as Response);
		const sandbox = new Prolog();

		await expect(sandbox.load('/absproxy/5173')).rejects.toThrow(
			'Prolog worker script failed to load: worker stream failed'
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves disposal when initial load progress disposes and then throws', async () => {
		const sandbox = new Prolog();
		const callbackError = new Error('initial load progress failed');
		const progress = {
			set: vi.fn((value: number, stage?: string) => {
				if (value !== 0 || stage !== 'Resolving Prolog runtime') return;
				void sandbox.dispose();
				throw callbackError;
			})
		};

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {}, progress)
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it.each([0.05, 0.22])(
		'preserves disposal and cleans the asset deadline at %s load progress',
		async (disposeAt) => {
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
			const sandbox = new Prolog();
			const callbackError = new Error(`load progress ${disposeAt} failed`);
			const progress = {
				set: vi.fn((value: number) => {
					if (value !== disposeAt) return;
					void sandbox.dispose();
					throw callbackError;
				})
			};

			await expect(
				sandbox.load(
					'/absproxy/5173',
					'',
					true,
					[],
					{ limits: { assetTimeoutMs: 12_345 } },
					progress
				)
			).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			const assetTimerIndex = setTimeoutSpy.mock.calls.findIndex(
				([, delay]) => delay === 12_345
			);
			expect(assetTimerIndex).toBeGreaterThanOrEqual(0);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(
				setTimeoutSpy.mock.results[assetTimerIndex]?.value
			);
			expect(workerInstances).toHaveLength(0);
		}
	);

	it('does not start a fetch when signal registration reentrantly disposes the sandbox', async () => {
		const sandbox = new Prolog();
		const removeEventListener = vi.fn();
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(() => {
				void sandbox.dispose();
			}),
			removeEventListener
		} as unknown as AbortSignal;

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal })
		).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(removeEventListener).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves disposal when worker construction reenters and termination throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		let sandbox!: Prolog;
		class ReentrantWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				this.terminate.mockImplementation(() => {
					throw new Error('worker termination failed');
				});
				void sandbox.dispose();
			}
		}
		vi.stubGlobal('Worker', ReentrantWorker);

		try {
			sandbox = new Prolog();
			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			expect(workerInstances).toHaveLength(1);
			expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
			expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('preserves disposal when a reentrant worker constructor throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		let sandbox!: Prolog;
		class ReentrantThrowingWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				void sandbox.dispose();
				throw new Error('worker construction failed');
			}
		}
		vi.stubGlobal('Worker', ReentrantThrowingWorker);

		try {
			sandbox = new Prolog();
			await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'PROLOG'
			});
			expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('cleans startup state when a worker handler setter throws', async () => {
		autoStartWorkers = false;
		const previousWorker = globalThis.Worker;
		const handlerSetter = vi.fn(() => {
			throw new Error('worker handler assignment failed');
		});
		class ThrowingHandlerWorker extends MockWorker {
			constructor(url: string, options?: WorkerOptions) {
				super(url, options);
				Object.defineProperty(this, 'onerror', {
					configurable: true,
					get: () => null,
					set: handlerSetter
				});
			}
		}
		vi.stubGlobal('Worker', ThrowingHandlerWorker);
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

		try {
			const sandbox = new Prolog();
			await expect(
				sandbox.load('/absproxy/5173', '', true, [], {
					limits: { startupTimeoutMs: 23_456 }
				})
			).rejects.toThrow('worker handler assignment failed');
			const startupTimerIndex = setTimeoutSpy.mock.calls.findIndex(
				([, delay]) => delay === 23_456
			);
			expect(startupTimerIndex).toBeGreaterThanOrEqual(0);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(
				setTimeoutSpy.mock.results[startupTimerIndex]?.value
			);
			expect(handlerSetter).toHaveBeenCalledTimes(2);
			expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		} finally {
			vi.stubGlobal('Worker', previousWorker);
		}
	});

	it('aborts a pending worker download and rejects later use after idempotent disposal', async () => {
		let fetchSignal: AbortSignal | undefined;
		vi.mocked(fetch).mockImplementationOnce(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					fetchSignal = init?.signal ?? undefined;
					fetchSignal?.addEventListener('abort', () => reject(fetchSignal?.reason), {
						once: true
					});
				})
		);
		const sandbox = new Prolog();
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(fetchSignal).toBeDefined());

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();

		expect(secondDisposal).toBe(firstDisposal);
		await expect(load).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		await expect(firstDisposal).resolves.toBeUndefined();
		expect(fetchSignal?.aborted).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		await expect(sandbox.run('writeln(ok).', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		sandbox.write('ignored after disposal\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('detaches a pending worker bootstrap exactly once when disposed', async () => {
		autoStartWorkers = false;
		const sandbox = new Prolog();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		const load = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const bootstrapUrl = worker.url;

		await sandbox.dispose();

		await expect(load).rejects.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PROLOG'
		});
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(bootstrapUrl);
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		sandbox.terminate();
		await sandbox.clear();
		await sandbox.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('settles a prebuffered stdin waiter with the disposal reason', async () => {
		await withCrossOriginIsolation(false, async () => {
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const run = sandbox.run('read()', false);
			await vi.waitFor(() => expect(sandbox.stdinWaiters).toHaveLength(1));

			await sandbox.dispose();

			await expect(run).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(sandbox.stdinWaiters).toEqual([]);
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('cancels an active streaming stdin ring when disposed', async () => {
		await withCrossOriginIsolation(true, async () => {
			const messages: any[] = [];
			onPostMessage = (_worker, message) => messages.push(message);
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const run = sandbox.run('read()', false);
			await vi.waitFor(() => expect(messages.some((message) => message.run)).toBe(true));
			const runMessage = messages.find((message) => message.run);
			const control = new Int32Array(
				runMessage.stdinChannel.buffer,
				0,
				STATIC_STDIN_RING_CONTROL_SLOTS
			);

			await sandbox.dispose();

			await expect(run).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(Atomics.load(control, STATIC_STDIN_RING_CANCELLED_INDEX)).toBe(1);
			expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);
			expect(worker.onmessage).toBeNull();
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('preserves disposal when a streaming stdin getter disposes and then throws', async () => {
		await withCrossOriginIsolation(true, async () => {
			const sandbox = createStreamingTestSandbox();
			await sandbox.load();
			const worker = workerInstances[0];
			const options = {
				get stdin(): string {
					void sandbox.dispose();
					throw new Error('stdin getter failed after disposal');
				}
			};

			await expect(
				sandbox.run('read()', false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: 'STREAMING_STDIN_TEST'
			});
			expect(worker.postMessage).not.toHaveBeenCalled();
			expect(worker.terminate).toHaveBeenCalledOnce();
		});
	});

	it('terminates a pending worker startup when its signal is aborted', async () => {
		autoStartWorkers = false;
		const controller = new AbortController();
		const sandbox = new Prolog();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		const outcome = load.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		controller.abort(new Error('cancel startup'));

		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('reports manual termination of pending startup as typed cancellation', async () => {
		autoStartWorkers = false;
		const sandbox = new Prolog();
		const outcome = sandbox.load('/absproxy/5173').catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		sandbox.terminate();

		await expect(outcome).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'startup',
			runtimeId: 'PROLOG'
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('terminates a static worker that misses its startup deadline', async () => {
		autoStartWorkers = false;
		const sandbox = new Prolog();
		const load = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { startupTimeoutMs: 5 }
		});
		const outcome = load.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		await expect(outcome).resolves.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'PROLOG',
			timeoutMs: 5
		});
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects worker script download and bootstrap import failures', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
		const missingScript = new Prolog();
		await expect(missingScript.load('/absproxy/5173')).rejects.toThrow(
			'Prolog worker script failed to load: HTTP 404'
		);
		expect(workerInstances).toHaveLength(0);

		autoStartWorkers = false;
		const invalidScript = new Prolog();
		const load = invalidScript.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		workerInstances[0].onerror?.(
			new ErrorEvent('error', {
				message: 'Unexpected token',
				filename: '/wasm-prolog/runner-worker.js',
				lineno: 3,
				colno: 7
			})
		);
		await expect(load).rejects.toThrow(
			'Prolog worker script error: Unexpected token (/wasm-prolog/runner-worker.js:3:7)'
		);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects the active run when its worker crashes', async () => {
		const sandbox = new Prolog();
		await sandbox.load('/absproxy/5173');
		onPostMessage = (worker) => {
			queueMicrotask(() => {
				worker.onerror?.(
					new ErrorEvent('error', {
						message: 'runtime crashed',
						filename: '/wasm-prolog/runner-worker.js',
						lineno: 9,
						colno: 2
					})
				);
			});
		};

		await expect(
			sandbox.run('writeln(ok).', false, true, undefined, [], { stdin: '' })
		).rejects.toBe(
			'Prolog worker script error: runtime crashed (/wasm-prolog/runner-worker.js:9:2)'
		);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
	});
});
