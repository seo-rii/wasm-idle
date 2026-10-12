// @vitest-environment node
import { expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { createPythonWorkspaceFiles } from './pythonWorkspaceFiles';
import { createPythonWorkspaceImports } from './pythonWorkspaceImports';

it('reflects supplied-file deletions and renames while preserving generated output', async () => {
	const runtime = await loadPyodide();
	const sync = createPythonWorkspaceFiles(runtime.FS);
	sync([{ path: 'subdir/input.txt', content: '원본🙂' }]);
	expect(runtime.runPython('open("subdir/input.txt").read()')).toBe('원본🙂');
	runtime.runPython('open("subdir/output.txt", "w").write("generated")');
	sync([{ path: 'subdir/renamed.txt', content: 'renamed' }]);
	expect(() => runtime.runPython('open("subdir/input.txt")')).toThrow('FileNotFoundError');
	expect(runtime.runPython('open("subdir/renamed.txt").read()')).toBe('renamed');
	expect(runtime.runPython('open("subdir/output.txt").read()')).toBe('generated');
	sync([]);
	sync([]);
	expect(() => runtime.runPython('open("subdir/renamed.txt")')).toThrow('FileNotFoundError');
	expect(runtime.runPython('open("subdir/output.txt").read()')).toBe('generated');
}, 120_000);

it('removes both imported-module state and its deleted supplied source on a reused runtime', async () => {
	const runtime = await loadPyodide();
	const writeFiles = createPythonWorkspaceFiles(runtime.FS);
	const invalidate = createPythonWorkspaceImports(runtime);
	const sync = (files: { path: string; content: string }[]) => {
		invalidate(files.map((file) => file.path));
		writeFiles(files);
	};
	sync([{ path: 'wid20_helper.py', content: 'VALUE = 1' }]);
	expect(runtime.runPython('import wid20_helper\nwid20_helper.VALUE')).toBe(1);
	runtime.runPython('open("generated.py", "w").write("VALUE = 2")');
	sync([]);
	expect(() => runtime.runPython('import wid20_helper')).toThrow('ModuleNotFoundError');
	expect(() => runtime.runPython('open("wid20_helper.py")')).toThrow('FileNotFoundError');
	expect(runtime.runPython('import generated\ngenerated.VALUE')).toBe(2);
}, 120_000);

it('tracks absolute ownership if user code changes its cwd or removes an input', async () => {
	const runtime = await loadPyodide();
	const sync = createPythonWorkspaceFiles(runtime.FS);
	sync([{ path: 'input.txt', content: 'first' }]);
	runtime.runPython(
		'import os\nos.mkdir("next")\nos.chdir("next")\nopen("input.txt", "w").write("generated")'
	);
	sync([]);
	expect(runtime.runPython('open("input.txt").read()')).toBe('generated');
	expect(runtime.runPython('os.path.exists("../input.txt")')).toBe(false);
	sync([{ path: 'source.txt', content: 'source' }]);
	runtime.runPython('os.unlink("source.txt")');
	expect(() => sync([])).not.toThrow();
	runtime.FS.mkdir('blocked');
	expect(() =>
		sync([
			{ path: 'partial.txt', content: 'written before failure' },
			{ path: 'blocked', content: 'cannot replace a directory' }
		])
	).toThrow();
	sync([]);
	expect(runtime.runPython('os.path.exists("partial.txt")')).toBe(false);
	expect(runtime.runPython('os.path.isdir("blocked")')).toBe(true);
}, 120_000);
