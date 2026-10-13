// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';

it('searches active-script siblings before root modules and restores sys.path across success and failure', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	const originalPathId = runtime.runPython('import sys, json\nid(sys.path)');
	const originalPath = runtime.runPython('json.dumps(sys.path)');
	const values: string[] = [];
	runtime.FS.mkdir('subdir');
	runtime.FS.writeFile('wid24_helper.py', 'VALUE = 100');
	runtime.FS.writeFile('subdir/wid24_helper.py', 'VALUE = 7');
	runtime.FS.writeFile('wid24_shared.py', 'VALUE = 9');
	const expectRestoredPath = () => {
		expect(runtime.runPython('id(sys.path)')).toBe(originalPathId);
		expect(runtime.runPython('json.dumps(sys.path)')).toBe(originalPath);
	};
	try {
		const source =
			'import wid24_helper, wid24_shared, asyncio\nawait asyncio.sleep(0)\nprint(wid24_helper.VALUE, wid24_shared.VALUE)';
		for (let i = 0; i < 2; i++) {
			await helpers.run(
				source,
				'subdir/main.py',
				() => {},
				undefined,
				(...parts) => values.push(parts.join(':'))
			);
			expectRestoredPath();
		}
		await expect(
			helpers.run(
				'import sys\nsys.path = []\nraise RuntimeError("path failure")',
				'subdir/failure.py',
				() => {}
			)
		).rejects.toThrow('path failure');
		expectRestoredPath();
		await expect(
			helpers.run('pass', 'subdir/ready.py', () => {
				throw new Error('ready failure');
			})
		).rejects.toThrow('ready failure');
		expectRestoredPath();
		await helpers.run(
			'import os, sys\nprint(sys.path[0] == os.getcwd())',
			'main.py',
			() => {},
			undefined,
			(value) => values.push(String(value))
		);
		expectRestoredPath();
		expect(values).toEqual(['7:9', '7:9', 'true']);
	} finally {
		helpers.dispose();
	}
}, 120_000);
