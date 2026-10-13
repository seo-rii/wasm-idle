// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';
import { createPythonWorkspaceImports } from './pythonWorkspaceImports';

it('reloads edited workspace modules and their bytecode without resetting the standard library', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	const helpers = createPythonExecutionHelpers(runtime, '');
	const mathId = runtime.runPython('import math\nid(math)');
	const paths = ['wid_helper.py', 'wid_package/__init__.py', 'wid_package/value.py'];
	const values: string[] = [];
	try {
		runtime.FS.mkdir('wid_package');
		runtime.FS.writeFile('wid_package/__init__.py', '');
		const source =
			'import wid_helper\nfrom wid_package import value\nprint(wid_helper.VALUE, value.VALUE)';
		for (const value of [1, 2, 3]) {
			invalidate(paths);
			runtime.FS.writeFile('wid_helper.py', `VALUE = ${value}\n`);
			runtime.FS.writeFile('wid_package/value.py', `VALUE = ${value}\n`);
			// Same source size and mtime would otherwise accept the previous .pyc.
			runtime.runPython(
				'import os\nos.utime("wid_helper.py", (100, 100))\nos.utime("wid_package/value.py", (100, 100))'
			);
			await helpers.run(
				source,
				'main.py',
				() => {},
				undefined,
				(...parts) => values.push(parts.join(':'))
			);
			expect(runtime.runPython('id(math)')).toBe(mathId);
		}
		expect(values).toEqual(['1:1', '2:2', '3:3']);
		invalidate([]);
		expect(runtime.runPython('"wid_helper" in __import__("sys").modules')).toBe(false);
		expect(runtime.runPython('"wid_package.value" in __import__("sys").modules')).toBe(false);
	} finally {
		helpers.dispose();
	}
}, 120_000);

it('removes a cached child attribute from a retained namespace package', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	runtime.FS.mkdir('wid_namespace');
	for (const value of [1, 22222]) {
		invalidate(['wid_namespace/helper.py']);
		runtime.FS.writeFile('wid_namespace/helper.py', `VALUE = ${value}\n`);
		expect(runtime.runPython('from wid_namespace import helper\nhelper.VALUE')).toBe(value);
	}
}, 120_000);
