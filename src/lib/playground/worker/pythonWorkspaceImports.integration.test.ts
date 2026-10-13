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

it('reloads modules when their bytecode cache parent is a file and still reports unexpected cleanup failures', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	const paths = ['wid_cache_parent/__init__.py', 'wid_cache_parent/__pycache__'];
	runtime.FS.mkdir('wid_cache_parent');
	runtime.FS.writeFile('wid_cache_parent/__pycache__', 'bytecode cache unavailable');
	for (const value of [1, 2, 3]) {
		invalidate(paths);
		runtime.FS.writeFile('wid_cache_parent/__init__.py', `VALUE = ${value}\n`);
		expect(runtime.runPython('import wid_cache_parent\nwid_cache_parent.VALUE')).toBe(value);
	}
	expect(() => invalidate([])).not.toThrow();
	expect(runtime.runPython('"wid_cache_parent" in __import__("sys").modules')).toBe(false);

	runtime.runPython(`from unittest.mock import patch
__wid_cache_unlink_patch = patch("os.unlink", side_effect=PermissionError("cache cleanup denied"))
__wid_cache_unlink_patch.start()`);
	try {
		expect(() => invalidate(paths)).toThrow('PermissionError');
	} finally {
		runtime.runPython('__wid_cache_unlink_patch.stop()');
	}
}, 120_000);

it('reloads workspace package and file symlink imports with unchanged source size and timestamps', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	const helpers = createPythonExecutionHelpers(runtime, '');
	const paths = ['wid_symlink_real/__init__.py', 'wid_symlink_real/helper.py'];
	const values: string[] = [];
	runtime.FS.mkdir('wid_symlink_real');
	runtime.FS.writeFile('wid_symlink_real/__init__.py', '');
	runtime.FS.mkdir('wid_generated');
	runtime.FS.writeFile('wid_generated/state.py', 'STATE = object()\n');
	runtime.runPython(`import os
import sys
import math
sys.dont_write_bytecode = False
import wid_generated.state
os.symlink("wid_symlink_real", "wid_symlink_alias")
os.symlink("wid_symlink_real/helper.py", "wid_symlink_file.py")`);
	const mathId = runtime.runPython('id(math)');
	const generatedId = runtime.runPython('id(wid_generated.state.STATE)');
	try {
		for (const value of [1, 2, 3]) {
			invalidate(paths);
			runtime.FS.writeFile('wid_symlink_real/helper.py', `VALUE = ${value}\n`);
			runtime.runPython('os.utime("wid_symlink_real/helper.py", (100, 100))');
			await helpers.run(
				`from wid_symlink_alias import helper
import wid_symlink_real.helper as direct
import wid_symlink_file as file_alias
print(helper.VALUE, direct.VALUE, file_alias.VALUE)`,
				'main.py',
				() => {},
				undefined,
				(...parts) => values.push(parts.join(':'))
			);
			expect(runtime.runPython('id(math)')).toBe(mathId);
			expect(runtime.runPython('id(wid_generated.state.STATE)')).toBe(generatedId);
		}
		expect(values).toEqual(['1:1:1', '2:2:2', '3:3:3']);
		expect(
			runtime.runPython(
				'os.path.isfile(__import__("importlib").util.cache_from_source("wid_symlink_file.py"))'
			)
		).toBe(true);
		invalidate([]);
		expect(
			runtime.runPython(`import sys
all(name not in sys.modules for name in (
    "wid_symlink_real", "wid_symlink_real.helper", "wid_symlink_alias",
    "wid_symlink_alias.helper", "wid_symlink_file"
))`)
		).toBe(true);
		expect(
			runtime.runPython(
				'os.path.exists(__import__("importlib").util.cache_from_source("wid_symlink_file.py"))'
			)
		).toBe(false);
		expect(runtime.runPython('id(wid_generated.state.STATE)')).toBe(generatedId);
		expect(runtime.FS.isDir(runtime.FS.stat('wid_generated').mode)).toBe(true);
	} finally {
		helpers.dispose();
	}
}, 120_000);

it('remembers the physical source behind a supplied symlink and clears retained namespace child aliases after removal', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	runtime.FS.mkdir('wid_physical_namespace');
	runtime.runPython(`import os
os.symlink("wid_physical_namespace", "wid_supplied_namespace")`);
	let aliasParentId: number | undefined;
	let directParentId: number | undefined;
	for (const value of [1, 2]) {
		invalidate(['wid_supplied_namespace/helper.py']);
		runtime.FS.writeFile('wid_supplied_namespace/helper.py', `VALUE = ${value}\n`);
		runtime.runPython('os.utime("wid_supplied_namespace/helper.py", (100, 100))');
		expect(
			runtime.runPython(`from wid_supplied_namespace import helper
from wid_physical_namespace import helper as direct
helper.VALUE == direct.VALUE == ${value}`)
		).toBe(true);
		const aliasId = runtime.runPython('id(__import__("wid_supplied_namespace"))');
		const directId = runtime.runPython('id(__import__("wid_physical_namespace"))');
		if (value === 1) {
			aliasParentId = aliasId;
			directParentId = directId;
		} else {
			expect(aliasId).toBe(aliasParentId);
			expect(directId).toBe(directParentId);
		}
	}
	runtime.FS.rename('wid_supplied_namespace', 'wid_renamed_namespace');
	invalidate([]);
	expect(
		runtime.runPython(`import sys
(
"wid_supplied_namespace.helper" not in sys.modules
and "wid_physical_namespace.helper" not in sys.modules
and not hasattr(sys.modules["wid_supplied_namespace"], "helper")
and not hasattr(sys.modules["wid_physical_namespace"], "helper")
)`)
	).toBe(true);
	expect(runtime.runPython('id(__import__("wid_physical_namespace"))')).toBe(directParentId);
	expect(runtime.FS.isDir(runtime.FS.stat('wid_renamed_namespace').mode)).toBe(true);
}, 120_000);

it.each(['removed', 'retargeted'])(
	'invalidates a workspace module when its non-supplied file alias is %s after import',
	async (change) => {
		const runtime = await loadPyodide();
		const invalidate = createPythonWorkspaceImports(runtime);
		invalidate(['wid_owned.py']);
		runtime.FS.writeFile('wid_owned.py', 'VALUE = 1\n');
		runtime.FS.writeFile('wid_generated.py', 'VALUE = 9\n');
		runtime.runPython(`import importlib
import os
import sys
sys.dont_write_bytecode = False
import wid_generated
os.symlink("wid_owned.py", "wid_dynamic_alias.py")
import wid_dynamic_alias
os.unlink("wid_dynamic_alias.py")`);
		const generatedId = runtime.runPython('id(wid_generated)');
		if (change === 'retargeted') {
			runtime.runPython('os.symlink("wid_generated.py", "wid_dynamic_alias.py")');
		}
		invalidate(['wid_owned.py']);
		runtime.FS.writeFile('wid_owned.py', 'VALUE = 2\n');
		expect(runtime.runPython('"wid_dynamic_alias" in sys.modules')).toBe(false);
		expect(runtime.runPython('id(wid_generated)')).toBe(generatedId);
		expect(
			runtime.runPython(
				'os.path.exists(importlib.util.cache_from_source("wid_dynamic_alias.py"))'
			)
		).toBe(false);
		if (change === 'retargeted') {
			expect(runtime.runPython('import wid_dynamic_alias\nwid_dynamic_alias.VALUE')).toBe(9);
		} else {
			expect(() => runtime.runPython('import wid_dynamic_alias')).toThrow(
				'ModuleNotFoundError'
			);
		}
	},
	120_000
);

it('clears an imported namespace child after its directory alias changes inside the child import', async () => {
	const runtime = await loadPyodide();
	const invalidate = createPythonWorkspaceImports(runtime);
	runtime.FS.mkdir('wid_owned_namespace');
	runtime.FS.mkdir('wid_generated_namespace');
	runtime.FS.writeFile('wid_generated_namespace/helper.py', 'VALUE = 9\n');
	invalidate(['wid_owned_namespace/helper.py']);
	runtime.FS.writeFile(
		'wid_owned_namespace/helper.py',
		`import os
VALUE = 1
os.unlink("wid_retargeted_namespace")
os.symlink("wid_generated_namespace", "wid_retargeted_namespace")`
	);
	runtime.runPython(`import importlib
import os
import sys
sys.dont_write_bytecode = False
import wid_generated_namespace.helper
os.symlink("wid_owned_namespace", "wid_retargeted_namespace")
from wid_retargeted_namespace import helper`);
	const namespaceId = runtime.runPython('id(sys.modules["wid_retargeted_namespace"])');
	const generatedId = runtime.runPython('id(wid_generated_namespace.helper)');
	const generatedCache = runtime.runPython(
		'os.path.isfile(importlib.util.cache_from_source("wid_generated_namespace/helper.py"))'
	);
	expect(generatedCache).toBe(true);
	invalidate(['wid_owned_namespace/helper.py']);
	expect(runtime.runPython('"wid_retargeted_namespace.helper" in sys.modules')).toBe(false);
	expect(runtime.runPython('hasattr(sys.modules["wid_retargeted_namespace"], "helper")')).toBe(
		false
	);
	expect(runtime.runPython('id(sys.modules["wid_retargeted_namespace"])')).toBe(namespaceId);
	expect(runtime.runPython('id(wid_generated_namespace.helper)')).toBe(generatedId);
	expect(
		runtime.runPython(
			'os.path.isfile(importlib.util.cache_from_source("wid_generated_namespace/helper.py"))'
		)
	).toBe(true);
	expect(runtime.runPython('from wid_retargeted_namespace import helper\nhelper.VALUE')).toBe(9);
}, 120_000);

it('preserves custom finder precedence, blocked imports and workspace loader resource APIs', async () => {
	const runtime = await loadPyodide();
	runtime.runPython(`import importlib.abc
import importlib.machinery
import importlib.util
import sys
class CustomLoader(importlib.abc.Loader):
    def exec_module(self, module):
        module.VALUE = 91
class CustomFinder:
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "wid_custom":
            return importlib.util.spec_from_loader(fullname, CustomLoader())
sys.meta_path.insert(sys.meta_path.index(importlib.machinery.PathFinder), CustomFinder())
sys.modules["wid_blocked_import"] = None`);
	const invalidate = createPythonWorkspaceImports(runtime);
	const paths = ['wid_resources/__init__.py', 'wid_resources/payload.txt', 'wid_custom.py'];
	invalidate(paths);
	runtime.FS.mkdir('wid_resources');
	runtime.FS.writeFile('wid_resources/__init__.py', 'VALUE = 7\n');
	runtime.FS.writeFile('wid_resources/payload.txt', 'workspace resource\n');
	runtime.FS.writeFile('wid_custom.py', 'VALUE = -1\n');
	expect(runtime.runPython('import wid_custom\nwid_custom.VALUE')).toBe(91);
	const customId = runtime.runPython('id(wid_custom)');
	expect(
		runtime.runPython(`import wid_resources
loader = wid_resources.__loader__
(
    loader.get_source("wid_resources") == "VALUE = 7\\n"
    and loader.get_data(wid_resources.__file__.replace("__init__.py", "payload.txt")) == b"workspace resource\\n"
    and loader.get_resource_reader("wid_resources").open_resource("payload.txt").read() == b"workspace resource\\n"
)`)
	).toBe(true);
	invalidate(paths);
	expect(runtime.runPython('"wid_resources" in sys.modules')).toBe(false);
	expect(runtime.runPython('id(wid_custom)')).toBe(customId);
	expect(
		runtime.runPython(
			'"wid_blocked_import" in sys.modules and sys.modules["wid_blocked_import"] is None'
		)
	).toBe(true);
}, 120_000);
