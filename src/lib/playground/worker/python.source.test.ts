import source from './python.ts?raw';
import { describe, expect, it } from 'vitest';

describe('Python worker source', () => {
	it('strips the submitted line terminator from builtins.input return values', () => {
		expect(source).toContain('def __wasm_idle_input_wrapper(prompt = ""):');
		expect(source).toContain('if value.endswith("\\\\r\\\\n"):');
		expect(source).toContain('value = value[:-2]');
		expect(source).toContain('elif value.endswith("\\\\n") or value.endswith("\\\\r"):');
		expect(source).toContain('value = value[:-1]');
	});

	it('reports Pyodide initialization and package preparation stages', () => {
		expect(source).toContain("postProgress(2, 'Loading Pyodide module');");
		expect(source).toContain("postProgress(100, 'Pyodide runtime ready');");
		expect(source).toContain("postProgress(15, 'Resolving Python imports');");
		expect(source).toContain("postProgress(100, 'Python packages ready');");
	});

	it('loads the Pyodide module from the configured static runtime URL', () => {
		expect(source).toContain('pyodide.mjs');
		expect(source).toContain('/* @vite-ignore */ moduleUrl');
		expect(source).not.toContain("await import('pyodide')");
	});

	it('configures the supported Pyodide package base URL instead of a removed setter', () => {
		expect(source).toContain('loadPyodide({ indexURL: path, packageBaseUrl })');
		expect(source).not.toContain('setCdnUrl');
	});

	it('reports initialization failures instead of leaving the host waiting', () => {
		expect(source).toMatch(
			/if \(load\) \{[\s\S]*?try \{[\s\S]*?await loadPyodide\(baseUrl\);[\s\S]*?catch/
		);
		expect(source).toMatch(
			/else if \(code\) \{[\s\S]*?await loadPackages\([\s\S]*?catch[\s\S]*?return;/
		);
	});

	it('invokes the execution-ready bridge through isolated Python globals and removes it', () => {
		const importedBridge =
			'from js import ${executionReadyName} as __wasm_idle_execution_ready';
		const injectedBridge = '${JSON.stringify(executionReadyName)}: __wasm_idle_execution_ready';
		const invokedBridge = '__wasm_idle_globals.pop(${JSON.stringify(executionReadyName)})()';
		const userEval = '__wasm_idle_result = eval(';

		expect(source).toContain(importedBridge);
		expect(source).toContain(injectedBridge);
		expect(source).toContain(invokedBridge);
		expect(source).toContain('del __wasm_idle_execution_ready');
		expect(source).not.toContain('    ${executionReadyName}()');
		expect(source.indexOf(importedBridge)).toBeLessThan(source.indexOf(injectedBridge));
		expect(source.indexOf(injectedBridge)).toBeLessThan(source.indexOf(invokedBridge));
		expect(source.indexOf(invokedBridge)).toBeLessThan(source.indexOf(userEval));
		expect(source).toMatch(
			/self\[executionReadyName\] = \(\) => \{[\s\S]*?if \(executionReadyReported\) return;[\s\S]*?delete self\[executionReadyName\];[\s\S]*?\};/
		);
	});

	it('refreshes breakpoints from shared state while the debugger is running', () => {
		expect(source).toContain(
			'const debugReadBreakpointsName = `__wasm_idle_python_debug_breakpoints_${ts}`;'
		);
		expect(source).toContain('const version = Atomics.load(debugBufferPyodide, 2);');
		expect(source).toContain('Math.min(Atomics.load(debugBufferPyodide, 3)');
		expect(source).toContain('const line = Atomics.load(debugBufferPyodide, 4 + index);');
		expect(source).toContain('def __wasm_idle_debug_refresh_breakpoints():');
		expect(source).toMatch(
			/if event != "line":[\s\S]*?__wasm_idle_debug_refresh_breakpoints\(\)[\s\S]*?line = frame\.f_lineno/
		);
	});
});
