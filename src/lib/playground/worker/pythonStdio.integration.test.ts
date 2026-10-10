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
