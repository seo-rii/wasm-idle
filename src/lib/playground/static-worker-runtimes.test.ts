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
	postMessage = vi.fn((message: any) => {
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'factorial_plus_bonus=27\n', results: true }
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
import Tcl from './tcl';

async function expectWorkerBootstrap(worker: MockWorker, targetUrl: string) {
	expect(worker.url).toMatch(/^blob:wasm-idle-worker-/);
	const bootstrap = workerBootstrapBlobs.get(worker.url);
	expect(bootstrap).toBeDefined();
	expect(await bootstrap!.text()).toContain(JSON.stringify(targetUrl));
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

	it('keeps startup and runtime progress meaningful and monotonic until completion', async () => {
		onPostMessage = (worker, _message) => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						progress: { percent: 70, stage: 'Compiling and linking Nim output' }
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: { progress: { percent: 20, stage: 'Late stale progress' } }
				} as MessageEvent<any>);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		};
		const progress = { set: vi.fn() };
		const sandbox = new Nim();
		await sandbox.load('/absproxy/5173', '', true, [], {}, progress);
		await expect(sandbox.run('echo "ok"', true, true, progress)).resolves.toBe(true);

		const startupValues = progress.set.mock.calls.map(([value]) => value as number);
		expect(startupValues.length).toBeGreaterThan(2);
		expect(Math.max(...startupValues)).toBeLessThan(1);
		expect(workerInstances).toHaveLength(1);
		const repeatedLoadProgress = { set: vi.fn() };
		await sandbox.load('/absproxy/5173', '', true, [], {}, repeatedLoadProgress);
		expect(repeatedLoadProgress.set).not.toHaveBeenCalled();

		await expect(sandbox.run('echo "ok"', false, true, progress)).resolves.toBe(true);

		const compileProgress = progress.set.mock.calls.find(
			([, stage]) => stage === 'Compiling and linking Nim output'
		);
		expect(compileProgress?.[0]).toBeCloseTo(0.755);
		expect(progress.set).not.toHaveBeenCalledWith(expect.any(Number), 'Late stale progress');
		const allValues = progress.set.mock.calls.map(([value]) => value as number);
		expect(allValues).toEqual([...allValues].sort((left, right) => left - right));
		expect(allValues.at(-1)).toBe(1);
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
