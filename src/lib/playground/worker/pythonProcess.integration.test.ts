// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';

it('restores added, deleted and changed environment entries after a failed script', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	runtime.runPython("import os\nos.environ.update(EXISTING='initial', REMOVED='keep')");
	try {
		await expect(
			helpers.run(
				`import os
os.environ["ADDED"] = "only this run"
os.environ["EXISTING"] = "changed"
del os.environ["REMOVED"]
os.environ = {}
raise ValueError("failure after environment changes")`,
				'change.py',
				() => {}
			)
		).rejects.toThrow('failure after environment changes');
		const values: string[] = [];
		await helpers.run(
			'import os\nprint((os.getenv("ADDED"), os.getenv("EXISTING"), os.getenv("REMOVED")))',
			'check.py',
			() => {},
			undefined,
			(value) => values.push(String(value))
		);
		expect(values).toEqual(["(None, 'initial', 'keep')"]);
	} finally {
		helpers.dispose();
	}
}, 120_000);

it('runs only the script’s exit handlers in LIFO order before restoring process state', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	const output: string[] = [];
	const run = (source: string) =>
		helpers.run(
			source,
			'app.py',
			() => {},
			undefined,
			(value) => output.push(String(value))
		);
	runtime.runPython('import atexit\nhost_runs = []\natexit.register(host_runs.append, "host")');
	const baseline = runtime.runPython('atexit._ncallbacks()');
	try {
		const status = await run(`import atexit, os, sys
os.environ["ON_EXIT"] = "still available"
@atexit.register
def first():
    print(os.environ["ON_EXIT"])
def removed():
    print("unexpected")
atexit.register(removed)
atexit.register(removed)
atexit.unregister(removed)
atexit.register(print, "last")
sys.exit(7)`);
		expect(status).toBe(7);
		expect(output).toEqual(['last', 'still available']);
		await expect(
			run(
				'import atexit\natexit.register(print, "after failure")\nraise ValueError("script error")'
			)
		).rejects.toThrow('script error');
		expect(output).toEqual(['last', 'still available', 'after failure']);
		await run('print("new run")');
		expect(output.at(-1)).toBe('new run');
		expect(runtime.runPython('atexit._ncallbacks()')).toBe(baseline);
		expect(runtime.runPython('len(host_runs)')).toBe(0);
	} finally {
		helpers.dispose();
	}
}, 120_000);
