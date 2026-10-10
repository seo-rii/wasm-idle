// @vitest-environment node
import { readFileSync } from 'node:fs';
import { loadPyodide } from 'pyodide';
import { expect, it } from 'vitest';
import { PYTHON_DEBUG_PREVIEW } from './pythonDebugPreview';

it('continues real Pyodide tracing when the unchanged breakpoint bridge returns JavaScript null', async () => {
	const runtime = await loadPyodide();
	const source = readFileSync(new URL('./python.ts', import.meta.url), 'utf8');
	let trace = source.slice(source.indexOf('__wasm_idle_debug_breakpoints = set('), source.indexOf('sys.settrace(__wasm_idle_debug_trace)'));
	for (const [key, value] of Object.entries({
		'${normalizedBreakpoints}': '[]',
		"${pauseOnEntry ? 'True' : 'False'}": 'False',
		'${debugFilenameLiteral}': '"user.py"',
		'${debugPauseName}': 'pause', '${debugWaitName}': 'wait',
		'${debugReadWatchName}': 'read_watch', '${debugWriteWatchName}': 'write_watch',
		'${debugReadBreakpointsName}': 'read_breakpoints', '${PYTHON_DEBUG_PREVIEW}': PYTHON_DEBUG_PREVIEW
	})) trace = trace.replaceAll(key, value);
	expect(trace).not.toContain('${');
	let version = 0;
	let lines: number[] = [];
	const pauses: number[] = [];
	runtime.registerJsModule('debug_bridge', {
		read_breakpoints: (known: number) => known === version ? null : JSON.stringify({ version, lines }),
		pause: (line: number) => pauses.push(line), wait: () => 1,
		read_watch: () => '', write_watch: () => {}
	});
	try {
		runtime.runPython(`import sys, json\nfrom debug_bridge import read_breakpoints, pause, wait, read_watch, write_watch\n${trace}`);
		const run = () => runtime.runPython('scope = {}\ntry:\n    sys.settrace(__wasm_idle_debug_trace)\n    exec(compile("x = 1\\nx += 1\\nx += 1", "user.py", "exec"), scope)\nfinally:\n    sys.settrace(None)\nscope["x"]');
		expect(run()).toBe(3);
		expect(pauses).toEqual([]);
		version++;
		lines = [2];
		expect(run()).toBe(3);
		expect(pauses).toEqual([2]);
	} finally { runtime.runPython('sys.settrace(None)'); runtime.unregisterJsModule('debug_bridge'); }
}, 120_000);
