import type { PyodideInterface } from 'pyodide';

export const PYTHON_WORKSPACE_IMPORTS_FACTORY = String.raw`
def __wasm_idle_make_workspace_imports():
    import importlib
    import importlib.util
    import json
    import os
    import sys

    previous_paths = set()

    def invalidate(paths_json):
        nonlocal previous_paths
        current_paths = {os.path.abspath(path) for path in json.loads(paths_json)}
        workspace_paths = previous_paths | current_paths
        # Only modules backed by supplied workspace files belong to this run.
        # Keep interpreter, standard-library and installed-package state intact.
        for name, module in list(sys.modules.items()):
            filename = getattr(module, "__file__", None)
            if not isinstance(filename, str):
                continue
            if filename.endswith(".pyc"):
                try:
                    filename = importlib.util.source_from_cache(filename)
                except ValueError:
                    continue
            if os.path.abspath(filename) not in workspace_paths:
                continue
            sys.modules.pop(name, None)
            parent_name, _, child_name = name.rpartition(".")
            parent = sys.modules.get(parent_name)
            if parent is not None and getattr(parent, child_name, None) is module:
                delattr(parent, child_name)
        # Rewrites can have the same size and timestamp; invalidate their bytecode,
        # too, so removing sys.modules cannot reload an obsolete cached source.
        for filename in workspace_paths:
            if filename.endswith(".py"):
                try:
                    os.unlink(importlib.util.cache_from_source(filename))
                except (FileNotFoundError, NotADirectoryError):
                    # Python imports also tolerate an unavailable cache parent.
                    pass
        importlib.invalidate_caches()
        previous_paths = current_paths

    return invalidate

__wasm_idle_make_workspace_imports
`;

/** Invalidate imports at the workspace boundary, including prepared and debug runs. */
export function createPythonWorkspaceImports(runtime: PyodideInterface) {
	const factory = runtime.runPython(PYTHON_WORKSPACE_IMPORTS_FACTORY);
	let invalidate: any;
	try {
		invalidate = factory();
	} finally {
		factory.destroy();
	}
	return (paths: string[]) => invalidate(JSON.stringify(paths));
}
