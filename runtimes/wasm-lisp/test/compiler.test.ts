import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const nativeFetch = globalThis.fetch.bind(globalThis);

beforeAll(() => {
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url.startsWith('file:')) {
			const bytes = await readFile(fileURLToPath(url));
			return new Response(bytes, {
				status: 200,
				headers: {
					'content-type': url.endsWith('.wasm')
						? 'application/wasm'
						: 'application/octet-stream'
				}
			});
		}
		return nativeFetch(input, init);
	};
});

afterAll(() => {
	globalThis.fetch = nativeFetch;
});

async function loadRuntime() {
	return await import(pathToFileURL(path.join(runtimeRoot, 'index.js')).href);
}

async function createCompiler() {
	const runtime = await loadRuntime();
	const compiler = await runtime.createLispCompiler({
		runtimeBaseUrl: pathToFileURL(`${runtimeRoot}/`)
	});
	return { runtime, compiler };
}

async function createCompilerWithFetch(fetchImpl: typeof fetch, maxAssetBytes: number) {
	const runtime = await loadRuntime();
	return await runtime.createLispCompiler({
		runtimeBaseUrl: pathToFileURL(`${runtimeRoot}/`),
		fetch: fetchImpl,
		maxAssetBytes
	});
}

describe('wasm-lisp Puppy Scheme runtime', () => {
	it('rejects a pre-aborted compile without fetching a core module', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('unexpected core-module fetch');
		});
		const compiler = await createCompilerWithFetch(fetchImpl, 1024);
		const controller = new AbortController();
		const reason = new Error('stop before compilation');
		controller.abort(reason);

		await expect(
			compiler.compile({ code: '(display 1)', signal: controller.signal })
		).rejects.toBe(reason);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('cancels a streamed core module with the caller signal and permits a clean retry', async () => {
		let fetchCount = 0;
		let requestSignal: AbortSignal | null | undefined;
		let cancelReason: unknown;
		let resolveBlockedRead:
			| ((result: ReadableStreamReadResult<Uint8Array>) => void)
			| undefined;
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		const reader = {
			read: vi.fn(() => {
				if (reader.read.mock.calls.length === 1) {
					return Promise.resolve({ done: false, value: new Uint8Array([0]) });
				}
				markReadStarted();
				return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
					resolveBlockedRead = resolve;
				});
			}),
			cancel: vi.fn(async (reason: unknown) => {
				cancelReason = reason;
				resolveBlockedRead?.({ done: true, value: undefined });
			}),
			releaseLock: vi.fn()
		};
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			fetchCount += 1;
			if (fetchCount === 1) {
				requestSignal = init?.signal;
				const response = new Response(null);
				Object.defineProperty(response, 'body', {
					value: { getReader: () => reader }
				});
				return response;
			}
			const url =
				typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			return new Response(await readFile(fileURLToPath(url)));
		});
		const compiler = await createCompilerWithFetch(fetchImpl, 128 * 1024 * 1024);
		const controller = new AbortController();
		const reason = new Error('stop streamed core load');
		const abortedCompile = compiler.compile({
			code: '(display 1)',
			signal: controller.signal
		});

		await readStarted;
		controller.abort(reason);
		await expect(abortedCompile).rejects.toBe(reason);
		expect(requestSignal).toBe(controller.signal);
		expect(reader.cancel).toHaveBeenCalledWith(reason);
		expect(cancelReason).toBe(reason);
		expect(reader.releaseLock).toHaveBeenCalledOnce();

		const retried = await compiler.compile({ code: '(display 1)' });
		expect(retried.success).toBe(true);
		expect(fetchCount).toBeGreaterThan(1);
	});

	it('rejects promptly when a bodyless core-module read is aborted', async () => {
		let markArrayBufferStarted!: () => void;
		const arrayBufferStarted = new Promise<void>((resolve) => {
			markArrayBufferStarted = resolve;
		});
		let releaseArrayBuffer!: () => void;
		const arrayBufferRelease = new Promise<void>((resolve) => {
			releaseArrayBuffer = resolve;
		});
		const fetchImpl = vi.fn(async () => {
			const response = new Response(null);
			Object.defineProperty(response, 'arrayBuffer', {
				value: async () => {
					markArrayBufferStarted();
					await arrayBufferRelease;
					return new Uint8Array([0, 0x61, 0x73, 0x6d]).buffer;
				}
			});
			return response;
		});
		const compiler = await createCompilerWithFetch(fetchImpl, 1024);
		const controller = new AbortController();
		const reason = new Error('stop bodyless core load');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const compile = compiler.compile({ code: '(display 1)', signal: controller.signal });

		await arrayBufferStarted;
		vi.useFakeTimers();
		controller.abort(reason);
		try {
			const outcome = Promise.race([
				compile.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setTimeout(() => resolve({ status: 'pending' }), 1);
				})
			]);
			await vi.advanceTimersByTimeAsync(1);

			expect(await outcome).toEqual({ status: 'rejected', reason });
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		} finally {
			releaseArrayBuffer();
			await compile.catch(() => {});
			vi.useRealTimers();
		}
	});

	it('bounds streamed compiler assets and omits ambient request authority', async () => {
		let requestInit: RequestInit | undefined;
		let cancelled = false;
		const compiler = await createCompilerWithFetch(async (_input, init) => {
			requestInit = init;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array([0, 1, 2, 3, 4]));
					},
					cancel() {
						cancelled = true;
					}
				})
			);
		}, 4);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).toContain('exceeds the 4 byte download limit');
		expect(cancelled).toBe(true);
		expect(requestInit).toMatchObject({
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
	});

	it('rejects oversized declared assets before reading their bodies', async () => {
		let cancelled = false;
		const compiler = await createCompilerWithFetch(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						cancel() {
							cancelled = true;
						}
					}),
					{ headers: { 'content-length': '5' } }
				),
			4
		);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).toContain('exceeds the 4 byte download limit');
		expect(cancelled).toBe(true);
	});

	it.each([
		['empty', ''],
		['negative', '-1'],
		['fractional', '1.5'],
		['exponential', '1e2'],
		['duplicate', '2, content-length-secret'],
		['unsafe', '9007199254740992']
	])('rejects a %s Content-Length before reading and cancels the body', async (_case, value) => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const fetchImpl = vi.fn(
			async () =>
				({
					ok: true,
					url: '',
					headers: new Headers({ 'content-length': value }),
					body: { cancel, getReader }
				}) as unknown as Response
		);
		const compiler = await createCompilerWithFetch(fetchImpl, 1024);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).toBe('wasm-lisp runtime asset has an invalid Content-Length');
		if (value) expect(compiled.stderr).not.toContain(value);
		expect(getReader).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledTimes(fetchImpl.mock.calls.length);
	});

	it('allows a zero Content-Length declaration', async () => {
		const compiler = await createCompilerWithFetch(
			async () => new Response(null, { headers: { 'content-length': '0' } }),
			1024
		);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).not.toContain('invalid Content-Length');
	});

	it('rejects runtime responses from a substituted final URL', async () => {
		let cancelled = false;
		const secret = 'signed-query-secret';
		const compiler = await createCompilerWithFetch(async () => {
			const response = new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						cancelled = true;
					}
				})
			);
			Object.defineProperty(response, 'url', {
				value: `https://cdn.example.invalid/substituted.wasm?signature=${secret}`
			});
			return response;
		}, 4);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).toContain('unexpected final URL');
		expect(compiled.stderr).not.toContain(secret);
		expect(cancelled).toBe(true);
	});

	it('rejects malformed final URLs before reading and cancels every response', async () => {
		const cancel = vi.fn(async () => {});
		const getReader = vi.fn();
		const invalidFinalUrl = '://invalid-final-url-secret';
		const fetchImpl = vi.fn(
			async () =>
				({
					ok: true,
					url: invalidFinalUrl,
					headers: new Headers(),
					body: { cancel, getReader }
				}) as unknown as Response
		);
		const compiler = await createCompilerWithFetch(fetchImpl, 1024);

		const compiled = await compiler.compile({ code: '(display 1)' });

		expect(compiled.success).toBe(false);
		expect(compiled.stderr).toContain('wasm-lisp runtime asset returned an invalid final URL');
		expect(compiled.stderr).not.toContain(invalidFinalUrl);
		expect(getReader).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledTimes(fetchImpl.mock.calls.length);
	});

	it('rejects invalid runtime asset byte limits', async () => {
		const runtime = await loadRuntime();

		await expect(
			runtime.createLispCompiler({
				runtimeBaseUrl: pathToFileURL(`${runtimeRoot}/`),
				maxAssetBytes: -1
			})
		).rejects.toThrow('maxAssetBytes must be a non-negative safe integer');
	});

	it.each([
		['unsupported schemes', 'data:text/javascript,export default {}', 'scheme'],
		['embedded credentials', 'https://user:secret@example.invalid/runtime/', 'credentials'],
		['fragments', 'https://example.invalid/runtime/#compiler', 'fragments']
	])('rejects runtime base URLs with %s', async (_case, runtimeBaseUrl, expectedMessage) => {
		const runtime = await loadRuntime();

		await expect(runtime.createLispCompiler({ runtimeBaseUrl })).rejects.toThrow(
			expectedMessage
		);
	});

	it('runs the upstream WASM compiler and executes a macro-heavy recursive program', async () => {
		const { runtime, compiler } = await createCompiler();
		const source = `
(define (fact n)
  (if (<= n 1) 1 (* n (fact (- n 1)))))
(define-syntax twice
  (syntax-rules ()
    ((_ expr) (+ expr expr))))
(display (twice (fact 5)))
(newline)
`;

		const compiled = await compiler.compile({ code: source, fileName: 'main.scm' });

		expect(compiled.success).toBe(true);
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.artifact?.format).toBe('component');
		expect(compiled.artifact?.component.byteLength).toBeGreaterThan(1000);

		const execution = await runtime.executeBrowserLispArtifact(compiled.artifact);

		expect(execution).toEqual({
			exitCode: 0,
			stdout: '240\n',
			stderr: ''
		});
	});

	it('passes command-line arguments into compiled Scheme components', async () => {
		const { runtime, compiler } = await createCompiler();
		const compiled = await compiler.compile({
			code: '(display (car (cdr (command-line)))) (newline)',
			fileName: 'args.scm'
		});

		expect(compiled.success).toBe(true);

		const execution = await runtime.executeBrowserLispArtifact(compiled.artifact, {
			args: ['alpha']
		});

		expect(execution.stdout).toBe('alpha\n');
	});

	it('supports include files through the browser-side WASI filesystem shim', async () => {
		const { runtime, compiler } = await createCompiler();
		const compiled = await compiler.compile({
			code: '(include "lib.scm") (display (square 7)) (newline)',
			fileName: 'main.scm',
			files: [
				{
					path: 'lib.scm',
					content: '(define (square x) (* x x))'
				}
			]
		});

		expect(compiled.success).toBe(true);

		const execution = await runtime.executeBrowserLispArtifact(compiled.artifact);

		expect(execution.stdout).toBe('49\n');
	});

	it('returns compiler diagnostics when Puppy rejects invalid Scheme', async () => {
		const { compiler } = await createCompiler();

		const compiled = await compiler.compile({
			code: '(unknown-fn 1)',
			fileName: 'bad.scm'
		});

		expect(compiled.success).toBe(false);
		expect(compiled.artifact).toBeUndefined();
		expect(compiled.stderr).toContain("cannot compile call to 'unknown-fn'");
		expect(compiled.diagnostics).toEqual([
			expect.objectContaining({
				fileName: 'bad.scm',
				lineNumber: 1,
				severity: 'error',
				message: expect.stringContaining("cannot compile call to 'unknown-fn'")
			})
		]);
	});
});
