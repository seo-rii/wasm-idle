// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';
import { createPythonStdio, PYTHON_FLUSH_HOOK_FACTORY } from './pythonStdio';

it('runs cached helpers on the pinned real Pyodide with fresh scopes and recovery', async () => {
	const runtime = await loadPyodide();
	const originalPrint = runtime.runPython('id(__import__("builtins").print)');
	const originalInput = runtime.runPython('id(__import__("builtins").input)');
	const helpers = createPythonExecutionHelpers(runtime, '');
	const values: string[] = [];
	let ready = 0;
	try {
		const source = 'value = globals().get("value", 0) + 1\nprint(value)';
		for (let i = 0; i < 3; i++)
			await helpers.run(source, '한글.py', () => ready++, () => null, (value) => values.push(String(value)));
		expect(values).toEqual(['1', '1', '1']);
		await helpers.run('import asyncio\nawait asyncio.sleep(0)\nprint(input("prompt"))', 'await.py', () => ready++, () => '안녕🙂\r\n', (value) => values.push(String(value)));
		expect(values.at(-1)).toBe('안녕🙂');
		expect(helpers.importSource('import math\nfrom collections import deque')).toContain('import math');
		expect(helpers.importSource('import math\nfrom collections import deque')).toContain('import collections');
		await expect(helpers.run('raise ValueError("expected failure")', 'failure.py', () => ready++, () => null, () => {})).rejects.toThrow('expected failure');
		await expect(helpers.run('if', 'syntax.py', () => ready++, () => null, () => {})).rejects.toThrow('SyntaxError');
		expect(runtime.runPython('id(__import__("builtins").print)')).toBe(originalPrint);
		expect(runtime.runPython('id(__import__("builtins").input)')).toBe(originalInput);
		await helpers.run('print(42)', 'recovery.py', () => ready++, () => null, (value) => values.push(String(value)));
		expect(values.at(-1)).toBe('42');
		expect(ready).toBe(6);
	} finally { helpers.dispose(); }
	helpers.dispose();
	expect(() => helpers.importSource('import math')).toThrow('disposed');
}, 120_000);

it('keeps native streams and flush ordering when executing cached user code', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	const install = runtime.runPython(PYTHON_FLUSH_HOOK_FACTORY);
	const originalPrint = runtime.runPython('id(__import__("builtins").print)');
	const output: string[] = [];
	try {
		for (const input of ['one\n', 'two🙂\n']) {
			const io = createPythonStdio(runtime, { initialInput: input, readInput: () => null, emit: (text) => output.push(text) });
			const restore = install(io.flush);
			try {
				await helpers.run('print("prompt:", end="", flush=True)\nprint(input())\nprint("tail", end="")', 'cached.py', () => {});
				io.flush();
				expect(output.join('')).toContain(`prompt:${input}`);
				expect(runtime.runPython('id(__import__("builtins").print)')).toBe(originalPrint);
			} finally { try { restore(); } finally { restore.destroy(); io.close(); } }
		}
		expect(output.join('')).toBe('prompt:one\ntailprompt:two🙂\ntail');
	} finally { helpers.dispose(); install.destroy(); }
}, 120_000);
