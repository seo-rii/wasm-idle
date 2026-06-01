import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('wasm-lisp Puppy Scheme runtime', () => {
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
