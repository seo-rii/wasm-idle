import type { PyodideInterface } from 'pyodide';

export const PYTHON_EXECUTION_FACTORY = String.raw`
def __wasm_idle_make_execution_helpers(image_source, max_entries=8, max_bytes=4194304,
                                        max_import_entries=32, max_import_bytes=2097152):
    import ast
    import builtins
    import inspect
    import marshal
    import sys
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

    async def run(source, filename, ready, input_bridge, output_bridge):
        previous_input, previous_print = builtins.input, builtins.print
        def input_wrapper(prompt=""):
            value = input_bridge(prompt)
            if value is None:
                raise EOFError
            if value.endswith("\r\n"):
                return value[:-2]
            if value.endswith("\n") or value.endswith("\r"):
                return value[:-1]
            return value
        builtins.input, builtins.print = input_wrapper, output_bridge
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
            scope = {"__name__": "__main__"}
            ready()
            result = evaluate(compiled, scope, scope)
            if inspect.isawaitable(result):
                await result
        finally:
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
		async run(source: string, filename: string, ready: () => void, input: (prompt?: string) => string | null, output: (...data: any[]) => void) {
			assertOpen();
			const globals = makeNamespace();
			try {
				globals.set('runner', run);
				globals.set('source', source);
				globals.set('filename', filename);
				globals.set('ready', ready);
				globals.set('input_bridge', input);
				globals.set('output_bridge', output);
				await runtime.runPythonAsync('await runner(source, filename, ready, input_bridge, output_bridge)', { globals });
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
