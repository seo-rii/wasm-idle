// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';

it('connects cached user scopes to __main__ for import and pickle, then restores the interpreter module', async () => {
	const runtime = await loadPyodide();
	const originalMain = runtime.runPython('import sys\nid(sys.modules["__main__"])');
	const helpers = createPythonExecutionHelpers(runtime, '');
	const values: string[] = [];
	try {
		const source = `import __main__, pickle, asyncio
value = globals().get("value", 0) + 1
class Record:
    pass
record = Record()
record.value = value
assert __main__.__dict__ is globals()
await asyncio.sleep(0)
restored = pickle.loads(pickle.dumps(record))
assert type(restored) is Record
print(restored.value, __main__.value)`;
		for (let i = 0; i < 2; i++) {
			await helpers.run(
				source,
				'main.py',
				() => {},
				undefined,
				(...parts) => values.push(parts.join(':'))
			);
			expect(runtime.runPython('id(sys.modules["__main__"])')).toBe(originalMain);
		}
		await expect(
			helpers.run('raise RuntimeError("user failure")', 'failure.py', () => {})
		).rejects.toThrow('user failure');
		expect(runtime.runPython('id(sys.modules["__main__"])')).toBe(originalMain);
		await expect(helpers.run('if', 'syntax.py', () => {})).rejects.toThrow('SyntaxError');
		expect(runtime.runPython('id(sys.modules["__main__"])')).toBe(originalMain);
		expect(values).toEqual(['1:1', '1:1']);
	} finally {
		helpers.dispose();
	}
}, 120_000);
