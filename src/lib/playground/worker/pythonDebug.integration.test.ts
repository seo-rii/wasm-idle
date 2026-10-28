// @vitest-environment node
import { loadPyodide } from 'pyodide';
import { expect, it } from 'vitest';
import { createPythonDebugHelpers } from './pythonDebug';

it('reuses compiled debug helpers on real Pyodide without sharing run state or filenames', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonDebugHelpers(
		runtime,
		`
if not globals().get('__debug_test_image_installed', False):
    __debug_test_image_installed = True
    __debug_test_image_installs = globals().get('__debug_test_image_installs', 0) + 1
`
	);
	let version = 0;
	let lines: number[] = [];
	let commands: number[] = [];
	let snapshots = 0;
	const pauses: { line: number; reason: string }[] = [];
	const codeIdentities: number[] = [];
	const bridge = {
		state: {
			get version() {
				return version;
			}
		},
		readBreakpoints: (known: number) => {
			snapshots++;
			return known === version ? null : JSON.stringify({ version, lines });
		},
		pause: (line: number, reason: string) => {
			pauses.push({ line, reason });
			return pauses.length;
		},
		wait: () => commands.shift() ?? 1,
		readWatch: () => '',
		writeWatch: () => {}
	};
	function run(source: string, filename = 'user.py', pauseOnEntry = false) {
		const trace = helpers.createTrace(filename, JSON.stringify(lines), pauseOnEntry, bridge);
		runtime.globals.set('__test_trace', trace);
		runtime.globals.set('__test_source', source);
		runtime.globals.set('__test_filename', filename);
		try {
			codeIdentities.push(runtime.runPython('id(__test_trace.__code__)'));
			return runtime.runPython(`
import sys
scope = {}
try:
    sys.settrace(__test_trace)
    exec(compile(__test_source, __test_filename, 'exec'), scope)
finally:
    sys.settrace(None)
scope.get('value')
`);
		} finally {
			for (const name of ['__test_trace', '__test_source', '__test_filename'])
				runtime.globals.delete(name);
			trace.destroy();
		}
	}
	try {
		expect(run('value = 1\nvalue += 1\nvalue += 1')).toBe(3);
		expect(pauses).toEqual([]);
		version++;
		lines = [2];
		expect(run('value = 1\nvalue += 1\nvalue += 1')).toBe(3);
		expect(pauses).toEqual([{ line: 2, reason: 'breakpoint' }]);
		// Leave a next command pending at the end of one run; the next run must start clean.
		lines = [];
		version++;
		commands = [3];
		expect(run('value = 7', 'first.py', true)).toBe(7);
		expect(
			run('assert "__wasm_idle_debug_bridge" not in globals()\nvalue = 9', '한글.py')
		).toBe(9);
		expect(pauses.at(-1)).toEqual({ line: 1, reason: 'entry' });
		expect(pauses).toHaveLength(2);
		commands = [-1];
		expect(() => run('value = 10', 'cancel.py', true)).toThrow('KeyboardInterrupt');
		expect(runtime.runPython('sys.gettrace() is None')).toBe(true);
		expect(() => run('raise ValueError("expected")', 'error.py')).toThrow('expected');
		expect(() => run('def :', 'syntax.py')).toThrow('SyntaxError');
		expect(runtime.runPython('sys.gettrace() is None')).toBe(true);
		expect(run('value = 42', 'recovery.py')).toBe(42);
		expect(new Set(codeIdentities).size).toBe(1);
		expect(snapshots).toBe(7); // Once per executed run, not on each unchanged line.
		expect(runtime.runPython('__debug_test_image_installs')).toBe(1);
	} finally {
		runtime.runPython('sys.settrace(None)');
		helpers.dispose();
	}
	helpers.dispose();
	expect(() => helpers.createTrace('disposed.py', '[]', false, bridge)).toThrow('disposed');
}, 120_000);
