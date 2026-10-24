// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { compilePythonBytecode } from './pythonCompile';
import { createPythonStdio } from './pythonStdio';

describe('Python bytecode on the pinned real Pyodide', () => {
	let runtime: PyodideInterface;
	const limit = 1024 * 1024;
	const temporaryCompiles = () =>
		runtime.FS.readdir('/tmp')
			.filter((name: string) => name.startsWith('wasm-idle-pyc-'))
			.sort();

	beforeAll(async () => {
		runtime = await loadPyodide();
	}, 120_000);

	it('returns deterministic checked-hash bytecode without executing or importing source', () => {
		const before = temporaryCompiles();
		const packageLoader = vi.spyOn(runtime, 'loadPackagesFromImports');
		const source = [
			'import wasm_idle_dependency_that_is_not_installed',
			'raise RuntimeError("source must not run")',
			'open("/tmp/wasm-idle-source-ran", "w").write("unexpected")'
		].join('\n');
		try {
			const first = compilePythonBytecode(runtime, source, 'nested/한글.py', 0, limit);
			const second = compilePythonBytecode(runtime, source, 'nested/한글.py', 0, limit);
			expect(first.path).toBe('nested/한글.pyc');
			expect(first.data).toBeInstanceOf(Uint8Array);
			expect(first.data).toEqual(second.data);
			expect(first.data.buffer).not.toBe(second.data.buffer);
			expect(first.data.byteLength).toBeGreaterThan(16);
			expect(Buffer.from(first.data.subarray(0, 4)).toString('hex')).toBe(first.magicNumber);
			expect(new DataView(first.data.buffer).getUint32(4, true)).toBe(3);
			expect(first.pythonVersion).toBe(
				runtime.runPython('__import__("platform").python_version()')
			);
			expect(first.cacheTag).toBe(
				runtime.runPython('__import__("sys").implementation.cache_tag')
			);
			expect(packageLoader).not.toHaveBeenCalled();
			expect(
				runtime.runPython(
					'"wasm_idle_dependency_that_is_not_installed" in __import__("sys").modules'
				)
			).toBe(false);
			expect(
				runtime.runPython('__import__("os").path.exists("/tmp/wasm-idle-source-ran")')
			).toBe(false);
			expect(temporaryCompiles()).toEqual(before);
		} finally {
			packageLoader.mockRestore();
		}
	});

	it('executes the exported file without source and preserves Unicode stdin and stdout', () => {
		const output: string[] = [];
		const artifact = compilePythonBytecode(
			runtime,
			'value = input("입력: ")\nprint("출력:", value)',
			'nested/main.py',
			0,
			limit
		);
		const path = '/tmp/wasm-idle-bytecode-only.pyc';
		runtime.FS.writeFile(path, artifact.data);
		const stdio = createPythonStdio(runtime, {
			initialInput: '한글🙂\n',
			readInput: () => null,
			emit: (text) => output.push(text)
		});
		try {
			expect(temporaryCompiles()).toEqual([]);
			expect(runtime.runPython('__import__("os").path.exists("nested/main.py")')).toBe(false);
			runtime.runPython(
				`import runpy\nrunpy.run_path(${JSON.stringify(path)}, run_name="__main__")\nNone`
			);
			stdio.flush();
			expect(output.join('')).toBe('입력: 출력: 한글🙂\n');
		} finally {
			stdio.close();
			runtime.FS.unlink(path);
			runtime.setStdin({ stdin: () => null });
			runtime.setStdout({ batched: () => {} });
		}
	});

	it.each([
		['if', 'SyntaxError'],
		['await action()', 'outside function']
	])('rejects invalid source %s and cleans temporary files', (source, message) => {
		const before = temporaryCompiles();
		expect(() => compilePythonBytecode(runtime, source, 'nested/error.py', 0, limit)).toThrow(
			message
		);
		expect(temporaryCompiles()).toEqual(before);
		expect(() => compilePythonBytecode(runtime, 'pass', 'recovery.py', 0, limit)).not.toThrow();
	});

	it('reports the logical source filename in syntax errors', () => {
		expect(() => compilePythonBytecode(runtime, 'if', 'nested/한글.py', 0, limit)).toThrow(
			'nested/한글.py'
		);
	});

	it.each([
		['# coding: latin-1\nvalue = "é"', 'é'],
		['\ufeff# coding: utf-8\nvalue = "한글🙂"', '한글🙂'],
		['# 한글\n# coding: cp949\nvalue = "한글"', '한글'],
		['# coding: cp949 한글\nvalue = "한글"', '한글'],
		['# 日本語\n# coding: shift_jis\nvalue = "日本語"', '日本語'],
		['# Á€\n# coding: cp1252\nvalue = "Á€"', 'Á€'],
		['value = "한글"\n# coding: ascii', '한글'],
		['# 한글\n# comment\n# coding: ascii\nvalue = "한글"', '한글'],
		['\ufeffvalue = "한글🙂"', '한글🙂']
	])('preserves Unicode source under its declared encoding: %s', (source, expected) => {
		const artifact = compilePythonBytecode(runtime, source, 'encoding.py', 0, limit);
		const path = '/tmp/wasm-idle-bytecode-encoding.pyc';
		runtime.FS.writeFile(path, artifact.data);
		try {
			expect(
				runtime.runPython(`__import__("runpy").run_path(${JSON.stringify(path)})["value"]`)
			).toBe(expected);
		} finally {
			runtime.FS.unlink(path);
		}
	});

	it.each([
		['\ufeff# coding: cp949\nvalue = "한글"', 'encoding problem'],
		['# coding: wasm_idle_unknown_encoding\npass', 'unknown encoding']
	])('rejects an invalid encoding declaration: %s', (source, message) => {
		const before = temporaryCompiles();
		expect(() => compilePythonBytecode(runtime, source, 'encoding.py', 0, limit)).toThrow(
			message
		);
		expect(temporaryCompiles()).toEqual(before);
	});

	it('rejects source characters that cannot be represented by its coding cookie', () => {
		const before = temporaryCompiles();
		expect(() =>
			compilePythonBytecode(runtime, '# coding: ascii\nvalue = "é"', 'encoding.py', 0, limit)
		).toThrow('UnicodeEncodeError');
		expect(temporaryCompiles()).toEqual(before);
	});

	it('applies CPython optimization levels to assertions, __debug__, and docstrings', () => {
		const path = '/tmp/wasm-idle-bytecode-optimize.pyc';
		const source = '"module documentation"\nvalue = __debug__\nassert False';
		try {
			for (const optimize of [0, 1, 2] as const) {
				const artifact = compilePythonBytecode(
					runtime,
					source,
					'logical.py',
					optimize,
					limit
				);
				runtime.FS.writeFile(path, artifact.data);
				const metadata = JSON.parse(
					runtime.runPython(`
import json, marshal
with open(${JSON.stringify(path)}, "rb") as bytecode_file:
    bytecode_file.read(16)
    compiled_code = marshal.load(bytecode_file)
scope = {}
assertion = False
try:
    exec(compiled_code, scope)
except AssertionError:
    assertion = True
json.dumps({"assertion": assertion, "debug": scope["value"],
            "doc": scope.get("__doc__"), "filename": compiled_code.co_filename})
`)
				);
				expect(metadata).toEqual({
					assertion: optimize === 0,
					debug: optimize === 0,
					doc: optimize < 2 ? 'module documentation' : null,
					filename: 'logical.py'
				});
			}
		} finally {
			runtime.FS.unlink(path);
		}
	});

	it('rejects oversized bytecode before copying it to the host and cleans temporary files', () => {
		const before = temporaryCompiles();
		expect(() => compilePythonBytecode(runtime, 'value = "large"', 'main.py', 0, 16)).toThrow(
			'limit is 16'
		);
		expect(() => compilePythonBytecode(runtime, 'pass', 'main.py', 0, 16)).toThrowError(
			expect.objectContaining({ code: 'output-limit', phase: 'compile', limit: 16 })
		);
		expect(temporaryCompiles()).toEqual(before);
		const artifact = compilePythonBytecode(runtime, 'pass', 'main.py', 0, limit);
		expect(() =>
			compilePythonBytecode(runtime, 'pass', 'main.py', 0, artifact.data.byteLength)
		).not.toThrow();
		expect(temporaryCompiles()).toEqual(before);
	});

	it('releases Python proxies after success, compiler failure, and byte-limit failure', () => {
		const toPy = vi.spyOn(runtime, 'toPy');
		const runPython = vi.spyOn(runtime, 'runPython');
		try {
			compilePythonBytecode(runtime, 'pass', 'main.py', 0, limit);
			expect(() => compilePythonBytecode(runtime, 'if', 'main.py', 0, limit)).toThrow();
			expect(() => compilePythonBytecode(runtime, 'pass', 'main.py', 0, 1)).toThrow();
			expect(toPy.mock.results).toHaveLength(3);
			for (const result of toPy.mock.results)
				expect(() => result.value.toJs()).toThrow(/destroyed/);
			expect(() => runPython.mock.results[0].value.toJs()).toThrow(/destroyed/);
		} finally {
			toPy.mockRestore();
			runPython.mockRestore();
		}
		// The bridge namespace never enters the persistent Python globals.
		expect(
			runtime.runPython('"compile_bytecode" in globals() or "byte_limit" in globals()')
		).toBe(false);
		expect(temporaryCompiles()).toEqual([]);
	});
});
