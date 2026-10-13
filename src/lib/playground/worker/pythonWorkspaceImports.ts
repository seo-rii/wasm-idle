import type { PyodideInterface } from 'pyodide';

export const PYTHON_WORKSPACE_IMPORTS_FACTORY = String.raw`
def __wasm_idle_make_workspace_imports():
    import importlib
    import importlib.machinery
    import importlib.util
    import json
    import os
    import sys

    previous_sources = set()
    previous_paths = set()
    imported_modules = {}
    imported_cache_paths = set()

    class WorkspaceLoader:
        def __init__(self, loader, cache_path):
            self.loader = loader
            self.cache_path = cache_path

        def create_module(self, spec):
            return self.loader.create_module(spec)

        def exec_module(self, module):
            # Remember ownership before user code can remove or retarget its
            # alias, including code executing inside the imported module.
            imported_modules[id(module)] = module
            if self.cache_path is not None:
                imported_cache_paths.add(self.cache_path)
            return self.loader.exec_module(module)

        def __getattr__(self, name):
            return getattr(self.loader, name)

    class WorkspaceFinder:
        def find_spec(self, fullname, path=None, target=None):
            spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
            if spec is None or not isinstance(spec.loader, (
                importlib.machinery.SourceFileLoader,
                importlib.machinery.SourcelessFileLoader,
            )):
                return spec
            filename = spec.origin
            if not isinstance(filename, str):
                return spec
            if filename.endswith(".pyc"):
                try:
                    filename = importlib.util.source_from_cache(filename)
                except ValueError:
                    return spec
            filename = os.path.abspath(filename)
            if filename in previous_sources or os.path.realpath(filename) in previous_paths:
                # Resolve the cache while the alias still names this source.
                # Resolving it at cleanup could delete another directory's cache.
                cache_path = os.path.realpath(spec.cached) if spec.cached else None
                spec.loader = WorkspaceLoader(spec.loader, cache_path)
            return spec

    # Preserve custom finders ahead of normal filesystem imports. The wrapper
    # delegates the standard file loader's resource and source APIs unchanged.
    for index, finder in enumerate(sys.meta_path):
        if finder is importlib.machinery.PathFinder:
            sys.meta_path.insert(index, WorkspaceFinder())
            break

    def invalidate(paths_json):
        nonlocal previous_sources, previous_paths
        current_sources = {os.path.abspath(path) for path in json.loads(paths_json)}
        current_paths = {os.path.realpath(path) for path in current_sources}
        # Retain both identities so a removed or renamed supplied symlink still
        # owns its lexical imports and the physical source it pointed to.
        workspace_sources = previous_sources | current_sources
        workspace_paths = previous_paths | current_paths
        cache_sources = workspace_sources | workspace_paths
        # Only modules backed by supplied workspace files belong to this run.
        # Keep interpreter, standard-library and installed-package state intact.
        for name, module in list(sys.modules.items()):
            if module is None or imported_modules.get(id(module)) is not module:
                filename = getattr(module, "__file__", None)
                if not isinstance(filename, str):
                    continue
                if filename.endswith(".pyc"):
                    try:
                        filename = importlib.util.source_from_cache(filename)
                    except ValueError:
                        continue
                filename = os.path.abspath(filename)
                if filename not in workspace_sources and os.path.realpath(filename) not in workspace_paths:
                    continue
                # Handle modules loaded before this workspace boundary as well.
                cache_sources.add(filename)
            sys.modules.pop(name, None)
            parent_name, _, child_name = name.rpartition(".")
            parent = sys.modules.get(parent_name)
            if parent is not None and getattr(parent, child_name, None) is module:
                delattr(parent, child_name)
        # Rewrites can have the same size and timestamp; invalidate their bytecode,
        # too, so removing sys.modules cannot reload an obsolete cached source.
        cache_paths = imported_cache_paths | {
            importlib.util.cache_from_source(filename)
            for filename in cache_sources if filename.endswith(".py")
        }
        for cache_path in cache_paths:
            try:
                os.unlink(cache_path)
            except (FileNotFoundError, NotADirectoryError):
                # Python imports also tolerate an unavailable cache parent.
                pass
        importlib.invalidate_caches()
        imported_modules.clear()
        imported_cache_paths.clear()
        previous_sources = current_sources
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
