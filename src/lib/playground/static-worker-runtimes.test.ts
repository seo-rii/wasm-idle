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
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import Tcl from './tcl';

async function expectWorkerBootstrap(worker: MockWorker, targetUrl: string) {
	expect(worker.url).toMatch(/^blob:wasm-idle-worker-/);
	const bootstrap = workerBootstrapBlobs.get(worker.url);
	expect(bootstrap).toBeDefined();
	const source = await bootstrap!.text();
	expect(source).toContain(JSON.stringify(targetUrl));
	expect(source).toContain("['output', 'results', 'error', 'diagnostic', 'progress']");
	expect(source).toContain('runId: __wasmIdleRunId');
	expect(source.indexOf('self.postMessage =')).toBeLessThan(
		source.indexOf(JSON.stringify(targetUrl))
	);
}

describe('static worker backed language sandboxes', () => {
	beforeEach(() => {
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
	});

	it('declares every static-worker stdin transport as prebuffered', () => {
		for (const Runtime of [
			Awk,
			Bqn,
			ClojureScript,
			Forth,
			Gleam,
			J,
			Janet,
			Julia,
			Nim,
			Pascal,
			Perl,
			Prolog,
			Tcl
		]) {
			expect(new Runtime().stdinMode).toBe('prebuffered');
		}
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
		await expect(first).rejects.toBe('Process terminated');
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
