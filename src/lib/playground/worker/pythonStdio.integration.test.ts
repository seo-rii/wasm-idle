// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonStdio, PYTHON_FLUSH_HOOK_FACTORY } from './pythonStdio';

it('preserves native streams, explicit flushes and binary input on real Pyodide', async () => {
	const runtime = await loadPyodide();
	const install = runtime.runPython(PYTHON_FLUSH_HOOK_FACTORY);
	const original = runtime.runPython('str((id(__import__("builtins").print), id(__import__("sys").stdout)))');
	try {
		for (const input of ['', '한글🙂\n', '12345\n'.repeat(10000)]) {
			const output: string[] = [];
			const io = createPythonStdio(runtime, {
				initialInput: input,
				readInput: () => { throw new Error('unexpected interactive input'); },
				emit: (text) => output.push(text), maxChars: 64
			});
			let restore: any;
			try {
				restore = install(io.flush);
				runtime.runPython('print("prompt", end="", flush=True)');
				expect(output.join('')).toBe('prompt');
				runtime.runPython('import sys\nraw=sys.stdin.buffer.read()\nprint(len(raw), sum(raw), sep=":")\nsys.stdout.buffer.write(bytes([0xe9, 0x9f]))\nsys.stdout.buffer.write(bytes([0x93]))\nsys.stdout.buffer.flush()');
				const bytes = new TextEncoder().encode(input);
				expect(output.join('')).toBe(`prompt${bytes.length}:${bytes.reduce((a, b) => a + b, 0)}\n韓`);
				expect(output.every((text) => text.length <= 64)).toBe(true);
				expect(runtime.runPython('str((id(__import__("builtins").print), id(__import__("sys").stdout)))')).toBe(original);
				expect(() => runtime.runPython('raise ValueError("test failure")')).toThrow('test failure');
			} finally {
				try { restore?.(); }
				finally { restore?.destroy(); io.close(); }
			}
		}
	} finally { install.destroy(); }
}, 120_000);

it('recovers native stdout and stderr after a program closes them', async () => {
	const runtime = await loadPyodide();
	const install = runtime.runPython(PYTHON_FLUSH_HOOK_FACTORY);
	const output: string[] = [];
	try {
		for (const code of [
			'import sys\nprint("before")\nsys.stdout.close()\nsys.stderr.close()',
			'import sys\nprint("한글🙂")\nprint("오류", file=sys.stderr)'
		]) {
			const io = createPythonStdio(runtime, {
				initialInput: '', readInput: () => null, emit: (text) => output.push(text)
			});
			const restore = install(io.flush);
			try { runtime.runPython(code); }
			finally { try { restore(); } finally { restore.destroy(); io.close(); } }
		}
		expect(output.join('')).toBe('before\n한글🙂\n오류\n');
		expect(runtime.runPython('not sys.stdout.closed and not sys.stderr.closed')).toBe(true);
	} finally { install.destroy(); }
}, 120_000);

it('restores native output stream configuration without replacing open streams', async () => {
	const runtime = await loadPyodide();
	const install = runtime.runPython(PYTHON_FLUSH_HOOK_FACTORY);
	const original = runtime.runPython('import sys\nstr([(id(s), s.encoding, s.errors, s.line_buffering, s.write_through) for s in (sys.stdout, sys.stderr)])');
	const output: string[] = [];
	try {
		for (const code of [
			'import sys\nsys.stdout.reconfigure(encoding="ascii", errors="replace", newline="\\r\\n", line_buffering=False, write_through=True)\nsys.stderr.reconfigure(encoding="ascii", errors="backslashreplace", newline="\\r\\n", line_buffering=False, write_through=True)\nprint("changed")',
			'import sys\nprint("한글🙂")\nprint("오류", file=sys.stderr)'
		]) {
			const io = createPythonStdio(runtime, {
				initialInput: '', readInput: () => null, emit: (text) => output.push(text)
			});
			const restore = install(io.flush);
			try { runtime.runPython(code); }
			finally { try { restore(); } finally { restore.destroy(); io.close(); } }
			expect(runtime.runPython('str([(id(s), s.encoding, s.errors, s.line_buffering, s.write_through) for s in (sys.stdout, sys.stderr)])')).toBe(original);
		}
		expect(output.join('')).toBe('changed\r\n한글🙂\n오류\n');
	} finally { install.destroy(); }
}, 120_000);

it('discards unread Python input buffers between executions', async () => {
	const runtime = await loadPyodide();
	const install = runtime.runPython(PYTHON_FLUSH_HOOK_FACTORY);
	const output: string[] = [];
	try {
		for (const [input, code] of [
			['old\nleftover\n', 'import sys\nprint(sys.stdin.read(1))'],
			['fresh\n', 'print(input())'],
			['unused\n', 'import sys\nsys.stdin.close()\nraise ValueError("expected")'],
			['recovered\n', 'print(input())']
		]) {
			const io = createPythonStdio(runtime, {
				initialInput: input, readInput: () => null, emit: (text) => output.push(text)
			});
			const restore = install(io.flush);
			try {
				if (input === 'unused\n') expect(() => runtime.runPython(code)).toThrow('expected');
				else runtime.runPython(code);
			} finally {
				try { restore(); } finally { restore.destroy(); io.close(); }
			}
		}
		expect(output.join('')).toBe('o\nfresh\nrecovered\n');
	} finally { install.destroy(); }
}, 120_000);
