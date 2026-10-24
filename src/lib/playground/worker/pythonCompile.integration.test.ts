// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import type { PythonCompileOptions } from '../pythonCompileOptions';
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

	it.each([
		['default', {}, 3, undefined],
		['checked hash', { invalidationMode: 'checked-hash' }, 3, undefined],
		['unchecked hash', { invalidationMode: 'unchecked-hash' }, 1, undefined],
		['timestamp default', { invalidationMode: 'timestamp' }, 0, 0],
		['timestamp zero', { invalidationMode: 'timestamp', timestamp: 0 }, 0, 0],
		[
			'timestamp custom',
			{ invalidationMode: 'timestamp', timestamp: 1_700_000_123 },
			0,
			1_700_000_123
		],
		[
			'timestamp uint32 maximum',
			{ invalidationMode: 'timestamp', timestamp: 0xffffffff },
			0,
			0xffffffff
		]
	] as const)(
		'writes the CPython header and executable payload for %s',
		(_name, options, flags, timestamp) => {
			const source = '# coding: latin-1\r\nvalue = "é"\r\n';
			const artifact = compilePythonBytecode(
				runtime,
				source,
				'encoding.py',
				0,
				limit,
				options
			);
			const path = '/tmp/wasm-idle-bytecode-invalidation.pyc';
			runtime.FS.writeFile(path, artifact.data);
			const globals = runtime.toPy({ source, path });
			try {
				const expected = JSON.parse(
					runtime.runPython(
						`
import importlib.util, json, runpy
encoded = source.encode("latin-1")
json.dumps({"hash": importlib.util.source_hash(encoded).hex(), "size": len(encoded),
            "value": runpy.run_path(path)["value"]})
`,
						{ globals }
					)
				);
				const header = new DataView(artifact.data.buffer, artifact.data.byteOffset, 16);
				expect(header.getUint32(4, true)).toBe(flags);
				if (timestamp === undefined) {
					expect(Buffer.from(artifact.data.subarray(8, 16)).toString('hex')).toBe(
						expected.hash
					);
				} else {
					expect(header.getUint32(8, true)).toBe(timestamp);
					expect(header.getUint32(12, true)).toBe(expected.size);
					expect(expected.size).not.toBe(new TextEncoder().encode(source).byteLength);
				}
				expect(expected.value).toBe('é');
			} finally {
				globals.destroy();
				runtime.FS.unlink(path);
			}
		}
	);

	it('is reproducible across independent runtimes, clocks, and SOURCE_DATE_EPOCH values', async () => {
		const independent = await loadPyodide();
		const interpreters = [runtime, independent];
		const scopes = interpreters.map((interpreter, index) => {
			const globals = interpreter.toPy({ epoch: String(1_500_000_000 + index) });
			interpreter.runPython(
				`
import os
previous_epoch = os.environ.get("SOURCE_DATE_EPOCH")
os.environ["SOURCE_DATE_EPOCH"] = epoch
`,
				{ globals }
			);
			return globals;
		});
		const clock = vi.spyOn(Date, 'now');
		const source =
			'def accepts(value):\n    return value in {"red", "green", "blue", "한글"}\n';
		const options: Array<Pick<PythonCompileOptions, 'invalidationMode' | 'timestamp'>> = [
			{},
			{ invalidationMode: 'checked-hash' },
			{ invalidationMode: 'unchecked-hash' },
			{ invalidationMode: 'timestamp' },
			{ invalidationMode: 'timestamp', timestamp: 1_700_000_123 }
		];
		try {
			for (const option of options) {
				clock.mockReturnValue(1_000_000_000_000);
				const first = compilePythonBytecode(
					runtime,
					source,
					'reproducible.py',
					0,
					limit,
					option
				);
				clock.mockReturnValue(2_000_000_000_000);
				const second = compilePythonBytecode(
					independent,
					source,
					'reproducible.py',
					0,
					limit,
					option
				);
				expect(second.data).toEqual(first.data);
				const header = new DataView(first.data.buffer, first.data.byteOffset, 16);
				expect(header.getUint32(4, true)).toBe(
					option.invalidationMode === 'timestamp'
						? 0
						: option.invalidationMode === 'unchecked-hash'
							? 1
							: 3
				);
				if (option.invalidationMode === 'timestamp')
					expect(header.getUint32(8, true)).toBe(option.timestamp ?? 0);
			}
		} finally {
			clock.mockRestore();
			for (const [index, interpreter] of interpreters.entries()) {
				interpreter.runPython(
					`
if previous_epoch is None:
    os.environ.pop("SOURCE_DATE_EPOCH", None)
else:
    os.environ["SOURCE_DATE_EPOCH"] = previous_epoch
`,
					{ globals: scopes[index] }
				);
				scopes[index].destroy();
			}
		}
	}, 120_000);

	it('validates invalidation options before allocating Python proxies or temporary files', () => {
		const before = temporaryCompiles();
		const toPy = vi.spyOn(runtime, 'toPy');
		try {
			for (const options of [
				{ invalidationMode: 'unknown' },
				{ invalidationMode: null },
				{ timestamp: 0 },
				{ invalidationMode: 'checked-hash', timestamp: 0 },
				{ invalidationMode: 'unchecked-hash', timestamp: 0 },
				{ invalidationMode: 'timestamp', timestamp: null },
				{ invalidationMode: 'timestamp', timestamp: '123' },
				{ invalidationMode: 'timestamp', timestamp: -1 },
				{ invalidationMode: 'timestamp', timestamp: 0.5 },
				{ invalidationMode: 'timestamp', timestamp: 0x100000000 },
				{ invalidationMode: 'timestamp', timestamp: Number.NaN },
				{ invalidationMode: 'timestamp', timestamp: Number.POSITIVE_INFINITY }
			]) {
				expect(() =>
					compilePythonBytecode(
						runtime,
						'pass',
						'main.py',
						0,
						limit,
						options as Pick<PythonCompileOptions, 'invalidationMode' | 'timestamp'>
					)
				).toThrow();
			}
			expect(toPy).not.toHaveBeenCalled();
			expect(temporaryCompiles()).toEqual(before);
		} finally {
			toPy.mockRestore();
		}
	});

	it.each(['unchecked-hash', 'timestamp'] as const)(
		'cleans failed %s compiles and recovers',
		(invalidationMode) => {
			const before = temporaryCompiles();
			const options = { invalidationMode };
			expect(() =>
				compilePythonBytecode(runtime, 'if', 'error.py', 0, limit, options)
			).toThrow('SyntaxError');
			expect(() =>
				compilePythonBytecode(runtime, 'pass', 'large.py', 0, 16, options)
			).toThrowError(
				expect.objectContaining({ code: 'output-limit', phase: 'compile', limit: 16 })
			);
			expect(temporaryCompiles()).toEqual(before);
			expect(() =>
				compilePythonBytecode(runtime, 'pass', 'recovery.py', 0, limit, options)
			).not.toThrow();
			expect(temporaryCompiles()).toEqual(before);
		}
	);

	it('removes temporary files when setting the timestamp fails', () => {
		const before = temporaryCompiles();
		const globals = runtime.toPy({});
		runtime.runPython(
			`
import os
original_utime = os.utime
def fail_utime(*args, **kwargs):
    raise OSError("setting source timestamp failed")
os.utime = fail_utime
`,
			{ globals }
		);
		try {
			expect(() =>
				compilePythonBytecode(runtime, 'pass', 'main.py', 0, limit, {
					invalidationMode: 'timestamp'
				})
			).toThrow('setting source timestamp failed');
			expect(temporaryCompiles()).toEqual(before);
		} finally {
			runtime.runPython('os.utime = original_utime', { globals });
			globals.destroy();
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
		['LF second-line cookie', '\n# coding: latin-1\nvalue = "é"', 'latin-1', 'é'],
		['CRLF second-line cookie', '\r\n# coding: latin-1\r\nvalue = "é"', 'latin-1', 'é'],
		['CR second-line cookie', '\r# coding: latin-1\rvalue = "é"', 'latin-1', 'é'],
		[
			'CR ignored third-line cookie',
			'# comment\r# comment\r# coding: ascii\rvalue = "é"',
			'utf-8',
			'é'
		],
		['UTF-7 C++ header', '# C++\n# coding: utf-7\nvalue = "é"', 'utf-7', 'é'],
		[
			'CR UTF-8 BOM and second-line cookie',
			'\ufeff\r# coding: utf-8\rvalue = "한글🙂"',
			'utf-8',
			'한글🙂'
		],
		[
			'UTF-8 BOM and normalized UTF_8 cookie',
			'\ufeff# coding: UTF_8\nvalue = "한글🙂"',
			'utf-8',
			'한글🙂'
		]
	])('preserves encoding and exact source hash for %s', (_name, source, encoding, expected) => {
		const artifact = compilePythonBytecode(runtime, source, 'encoding.py', 0, limit);
		const path = '/tmp/wasm-idle-bytecode-encoding-hash.pyc';
		runtime.FS.writeFile(path, artifact.data);
		const globals = runtime.toPy({ source, encoding, path });
		try {
			const metadata = JSON.parse(
				runtime.runPython(
					`
import importlib.util, json, runpy
json.dumps({
    "value": runpy.run_path(path)["value"],
    "sourceHash": importlib.util.source_hash(source.encode(encoding)).hex(),
})
`,
					{ globals }
				)
			);
			expect(metadata.value).toBe(expected);
			expect(Buffer.from(artifact.data.subarray(8, 16)).toString('hex')).toBe(
				metadata.sourceHash
			);
		} finally {
			globals.destroy();
			runtime.FS.unlink(path);
		}
	});

	it.each([
		['\ufeff# coding: cp949\nvalue = "한글"', 'encoding problem'],
		['\ufeff\r# coding: latin-1\rvalue = "é"', 'encoding problem'],
		['\ufeff# coding: utf8\nvalue = "한글🙂"', 'encoding problem'],
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
