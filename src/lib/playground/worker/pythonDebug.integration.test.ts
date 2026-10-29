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

it('follows real Pyodide loop line events through every iteration and the following line', async () => {
	const runtime = await loadPyodide();
	const helpers = createPythonDebugHelpers(runtime, '');
	const reference: [number, number | null][] = JSON.parse(
		runtime.runPython(`
import json
import sys
__loop_code = compile('value = 0\\nwhile value < 3: value += 1\\nfinished = value\\n', 'loop.py', 'exec')
__loop_events = []
def __loop_observe(frame, event, arg):
    if frame.f_code is __loop_code:
        if event == 'line':
            __loop_events.append((frame.f_lineno, frame.f_locals.get('value')))
        return __loop_observe
    return None
try:
    sys.settrace(__loop_observe)
    exec(__loop_code, {})
finally:
    sys.settrace(None)
json.dumps(__loop_events)
`)
	);
	expect(reference[0]).toEqual([1, null]);
	expect(reference.at(-1)).toEqual([3, 3]);
	expect(reference.filter(([line, value]) => line === 2 && value! < 3)).toEqual([
		[2, 0],
		[2, 1],
		[2, 2]
	]);
	try {
		for (const [command, reason] of [
			[1, 'breakpoint'],
			[2, 'step'],
			[3, 'nextLine']
		] as const) {
			const lines = command === 1 ? [2] : [];
			const pauses: [number, string][] = [];
			const values: [number, number | null][] = [];
			const bridge = {
				state: { version: 0 },
				readBreakpoints: (known: number) =>
					known === 0 ? null : JSON.stringify({ version: 0, lines }),
				pause: (line: number, pauseReason: string, localsJson: string) => {
					const locals: { name: string; value: string }[] = JSON.parse(localsJson);
					const value = locals.find((local) => local.name === 'value');
					pauses.push([line, pauseReason]);
					values.push([line, value ? Number(value.value) : null]);
					return pauses.length;
				},
				wait: () => command,
				readWatch: () => '',
				writeWatch: () => {}
			};
			const trace = helpers.createTrace(
				'loop.py',
				JSON.stringify(lines),
				command !== 1,
				bridge
			);
			runtime.globals.set('__loop_trace', trace);
			try {
				expect(
					runtime.runPython(`
__loop_scope = {}
try:
    sys.settrace(__loop_trace)
    exec(__loop_code, __loop_scope)
finally:
    sys.settrace(None)
__loop_scope['finished']
`)
				).toBe(3);
				const expected =
					command === 1 ? reference.filter(([line]) => line === 2) : reference;
				expect(values).toEqual(expected);
				expect(pauses).toEqual(
					expected.map(([line], index) => [
						line,
						command !== 1 && index === 0 ? 'entry' : reason
					])
				);
			} finally {
				runtime.globals.delete('__loop_trace');
				trace.destroy();
			}
		}
	} finally {
		runtime.runPython('sys.settrace(None)');
		helpers.dispose();
	}
}, 120_000);
