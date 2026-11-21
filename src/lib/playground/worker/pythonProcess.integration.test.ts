// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';

it('restores added, deleted and changed environment entries after a failed script', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	runtime.runPython("import os\nos.environ.update(EXISTING='initial', REMOVED='keep')");
	try {
		await expect(helpers.run(`import os
os.environ["ADDED"] = "only this run"
os.environ["EXISTING"] = "changed"
del os.environ["REMOVED"]
os.environ = {}
raise ValueError("failure after environment changes")`, 'change.py', () => {})).rejects.toThrow('failure after environment changes');
		const values: string[] = [];
		await helpers.run(
			'import os\nprint((os.getenv("ADDED"), os.getenv("EXISTING"), os.getenv("REMOVED")))',
			'check.py', () => {}, undefined, (value) => values.push(String(value))
		);
		expect(values).toEqual(["(None, 'initial', 'keep')"]);
	} finally {
		helpers.dispose();
	}
}, 120_000);
