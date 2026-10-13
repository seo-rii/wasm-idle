// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonExecutionHelpers } from './pythonExecution';

it('exposes the active filename and resolves sibling resources on cache misses and hits', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonExecutionHelpers(runtime, '');
	const values: string[] = [];
	runtime.FS.mkdir('한글');
	runtime.FS.writeFile('한글/payload.txt', 'script resource');
	try {
		const source =
			'from pathlib import Path\nprint(__file__)\nprint(Path(__file__).with_name("payload.txt").read_text())';
		for (let i = 0; i < 2; i++) {
			await helpers.run(
				source,
				'한글/main.py',
				() => {},
				undefined,
				(value) => values.push(String(value))
			);
		}
		await helpers.run(
			'print(__file__)',
			'another.py',
			() => {},
			undefined,
			(value) => values.push(String(value))
		);
		expect(values).toEqual([
			'한글/main.py',
			'script resource',
			'한글/main.py',
			'script resource',
			'another.py'
		]);
	} finally {
		helpers.dispose();
	}
}, 120_000);
