import type { PyodideInterface } from 'pyodide';

export const PYTHON_SCRIPT_PROCESS = String.raw`
def __wasm_idle_make_script_process():
    import atexit
    import os
    import sys
    import sysconfig
    import traceback
    from contextlib import contextmanager

    # Python and installed packages remain loaded between runs. Their shutdown
    # hooks (including weakref.finalize's lazy dispatcher) belong to the interpreter.
    paths = sysconfig.get_paths()
    libraries = {paths[key] for key in ("stdlib", "platstdlib", "purelib", "platlib")}
    if getattr(sys, "_stdlib_dir", None):
        libraries.add(sys._stdlib_dir)  # Pyodide ships its standard library in a zip.
    prefixes = tuple(os.path.realpath(path) + os.sep for path in libraries)

    def interpreter_module(namespace):
        origin = getattr(namespace.get("__spec__"), "origin", None)
        return origin in ("built-in", "frozen") or (
            isinstance(origin, str) and os.path.realpath(origin).startswith(prefixes)
        )

    @contextmanager
    def script_exit_callbacks():
        # Pyodide keeps the interpreter alive. Its own native atexit callbacks
        # must survive completion of the individual script.
        callbacks = []
        previous_register, previous_unregister = atexit.register, atexit.unregister

        def register(callback, /, *args, **kwargs):
            if interpreter_module(sys._getframe(1).f_globals):
                return previous_register(callback, *args, **kwargs)
            if atexit.register is not register:
                # An imported module may retain this function across runs.
                return atexit.register(callback, *args, **kwargs)
            if not callable(callback):
                raise TypeError("the first argument must be callable")
            callbacks.append((callback, args, kwargs))
            return callback

        def unregister(callback, /):
            if interpreter_module(sys._getframe(1).f_globals):
                return previous_unregister(callback)
            if atexit.unregister is not unregister:
                return atexit.unregister(callback)
            callbacks[:] = [entry for entry in callbacks if entry[0] != callback]

        atexit.register, atexit.unregister = register, unregister
        try:
            yield
        finally:
            try:
                while callbacks:
                    callback, args, kwargs = callbacks.pop()
                    try:
                        callback(*args, **kwargs)
                    except BaseException as error:
                        # Callback failures do not cancel the remaining handlers
                        # or replace the process's exit status.
                        try:
                            sys.stderr.write(f"Exception ignored in atexit callback {callback!r}:\n")
                            traceback.print_exception(error)
                        except BaseException:
                            pass
            finally:
                atexit.register, atexit.unregister = previous_register, previous_unregister

    @contextmanager
    def script_process(filename):
        previous_argv, previous_cwd = sys.argv, os.getcwd()
        environment = os.environ
        previous_environment = environment.copy()
        status = [0]
        sys.argv = [filename]
        try:
            with script_exit_callbacks():
                try:
                    yield status
                except SystemExit as stop:
                    code = stop.code
                    if isinstance(code, int):
                        value = int.__index__(code)
                        status[0] = value & 255 if -(1 << 63) <= value < (1 << 63) else 255
                    elif code is not None:
                        sys.stderr.write(str(code) + "\n")
                        status[0] = 1
        finally:
            sys.argv = previous_argv
            os.environ = environment
            for name in environment.keys() - previous_environment.keys():
                del environment[name]
            for name, value in previous_environment.items():
                if environment.get(name) != value:
                    environment[name] = value
            os.chdir(previous_cwd)
    return script_process

__wasm_idle_script_process = __wasm_idle_make_script_process()
`;

export const PYTHON_EXECUTION_FACTORY = PYTHON_SCRIPT_PROCESS + String.raw`
def __wasm_idle_make_execution_helpers(image_source, max_entries=8, max_bytes=4194304,
                                        max_import_entries=32, max_import_bytes=2097152):
    import ast
    import builtins
    import inspect
    import marshal
    import os
    import sys
    import types
    from collections import OrderedDict
    from pyodide.code import find_imports

    compile_source = builtins.compile
    evaluate = builtins.eval
    execute = builtins.exec
    image_scope = globals()
    image_code = compile_source(image_source, "<wasm-idle-image-hook>", "exec", dont_inherit=True)
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT

    class BoundedCache:
        def __init__(self, entries, budget):
            self.entries, self.budget = max(0, entries), max(0, budget)
            self.values = OrderedDict()
            self.bytes = self.hits = self.misses = 0

        def get(self, key):
            entry = self.values.get(key)
            if entry is None:
                self.misses += 1
                return None
            self.values.move_to_end(key)
            self.hits += 1
            return entry[0]

        def put(self, key, value, weight):
            old = self.values.pop(key, None)
            if old is not None:
                self.bytes -= old[1]
            if self.entries == 0 or weight > self.budget:
                return
            while self.values and (len(self.values) >= self.entries or self.bytes + weight > self.budget):
                _, (_, size) = self.values.popitem(last=False)
                self.bytes -= size
            self.values[key] = (value, weight)
            self.bytes += weight

        def info(self):
            return {"entries": len(self.values), "accountedBytes": self.bytes,
                    "hits": self.hits, "misses": self.misses}

    code_cache = BoundedCache(max_entries, max_bytes)
    import_cache = BoundedCache(max_import_entries, max_import_bytes)

    def imports(source):
        cached = import_cache.get(source)
        if cached is not None:
            return cached
        # Use Pyodide's parser, including its syntax-error and dotted-import behavior.
        stub = "\n".join("import " + name for name in find_imports(source))
        import_cache.put(source, stub, sys.getsizeof(source) + sys.getsizeof(stub))
        return stub

    async def run(source, filename, ready, input_bridge=None, output_bridge=None):
        previous_input, previous_print = builtins.input, builtins.print
        missing_main = object()
        previous_main = sys.modules.get("__main__", missing_main)
        previous_path = sys.path
        def input_wrapper(prompt=""):
            value = input_bridge(prompt)
            if value is None:
                raise EOFError
            if value.endswith("\r\n"):
                return value[:-2]
            if value.endswith("\n") or value.endswith("\r"):
                return value[:-1]
            return value
        # Native streams remain installed by the worker. Explicit bridges are
        # retained for callers that supply them, without overriding native I/O.
        if input_bridge is not None:
            builtins.input = input_wrapper
        if output_bridge is not None:
            builtins.print = output_bridge
        try:
            # Execute the original guard in the same namespace as the legacy debug/Hy path.
            # The fixed image hook is compiled only once, not parsed with every user run.
            execute(image_code, image_scope, image_scope)
            key = (source, filename, flags, -1)
            compiled = code_cache.get(key)
            if compiled is None:
                compiled = compile_source(source, filename, "exec", flags=flags, dont_inherit=True)
                # This budget accounts source strings and serialized code, not total Wasm heap.
                weight = sys.getsizeof(source) + sys.getsizeof(filename) + len(marshal.dumps(compiled))
                code_cache.put(key, compiled, weight)
            main_module = types.ModuleType("__main__")
            main_module.__file__ = os.path.abspath(filename)
            scope = main_module.__dict__
            sys.modules["__main__"] = main_module
            # Script siblings take precedence; shared workspace-root modules follow.
            run_paths = list(dict.fromkeys((os.path.dirname(os.path.abspath(filename)), os.getcwd())))
            sys.path = run_paths + [path for path in previous_path if path not in run_paths]
            with __wasm_idle_script_process(filename) as status:
                ready()
                result = evaluate(compiled, scope, scope)
                if inspect.isawaitable(result):
                    await result
            return status[0]
        finally:
            sys.path = previous_path
            if previous_main is missing_main:
                sys.modules.pop("__main__", None)
            else:
                sys.modules["__main__"] = previous_main
            sys.settrace(None)
            builtins.input, builtins.print = previous_input, previous_print

    return {"run": run, "imports": imports,
            "info": lambda: {"code": code_cache.info(), "imports": import_cache.info()}}

__wasm_idle_make_execution_helpers
`;

/** Keep compiled helper proxies private and pass run data without interpolating it into Python. */
export function createPythonExecutionHelpers(runtime: PyodideInterface, imageHook: string) {
	const factory = runtime.runPython(PYTHON_EXECUTION_FACTORY);
	let helpers: any;
	try { helpers = factory(imageHook); }
	finally { factory.destroy(); }
	let run: any;
	let imports: any;
	let makeNamespace: any;
	try {
		run = helpers.get('run');
		imports = helpers.get('imports');
		makeNamespace = runtime.runPython('dict');
	} catch (error) {
		run?.destroy();
		imports?.destroy();
		makeNamespace?.destroy();
		throw error;
	} finally { helpers.destroy(); }
	let disposed = false;
	const assertOpen = () => { if (disposed) throw new Error('Python execution helpers are disposed'); };
	return {
		importSource(source: string): string { assertOpen(); return String(imports(source)); },
		async run(source: string, filename: string, ready: () => void, input?: (prompt?: string) => string | null, output?: (...data: any[]) => void) {
			assertOpen();
			const globals = makeNamespace();
			try {
				globals.set('runner', run);
				globals.set('source', source);
				globals.set('filename', filename);
				globals.set('ready', ready);
				if (input) globals.set('input_bridge', input);
				if (output) globals.set('output_bridge', output);
				// JavaScript null is a JsNull proxy in Pyodide, rather than Python None.
				const call = input || output
					? `await runner(source, filename, ready, ${input ? 'input_bridge' : 'None'}, ${output ? 'output_bridge' : 'None'})`
					: 'await runner(source, filename, ready)';
				return (await runtime.runPythonAsync(call, { globals })) as number;
			} finally { globals.destroy(); }
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			run.destroy();
			imports.destroy();
			makeNamespace.destroy();
		}
	};
}
