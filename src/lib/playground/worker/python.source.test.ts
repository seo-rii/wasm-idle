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

	it('loads the Pyodide entry and asm modules through the bounded runtime asset loader', () => {
		expect(source).toContain("importRuntimeAssetModule('pyodide.asm.js')");
		expect(source).toContain("importRuntimeAssetModule(\n\t\t'pyodide.mjs'");
		expect(source).toContain('loadWorkerRuntimeAsset(asset)');
		expect(source).toContain('/* @vite-ignore */ moduleUrl');
		expect(source).not.toContain("await import('pyodide')");
	});

	it('bounds direct packages to lock-declared files on the version-pinned CDN', () => {
		expect(source).toContain("'https://cdn.jsdelivr.net/pyodide/'");
		expect(source).toContain('resolvePinnedPackageBaseUrl(runtimeModule.version)');
		expect(source).toContain("loadWorkerRuntimeAsset('pyodide-lock.json')");
		expect(source).toContain('parsePythonPackageLock(loadedLock.bytes)');
		expect(source).toContain('configureWorkerRuntimeAssetAllowlist({');
		expect(source).toContain('assets: [...parsedLock.packageAssets]');
		expect(source).toContain('runtimeAssets: directPyodideRuntimeAssets');
		expect(source).toContain('lockFileContents = parsedLock.lock as unknown as Lockfile;');
		expect(source).toContain('...(lockFileContents ? { lockFileContents } : {})');
		expect(source).not.toContain('cdnFallbackUrl');
		expect(source).not.toContain('setCdnUrl');
	});

	it('executes empty source and posts a terminal result', () => {
		expect(source).toContain("else if (typeof code === 'string') {");
		expect(source).not.toContain('else if (code) {');
		expect(source).toMatch(
			/else if \(typeof code === 'string'\) \{[\s\S]*?self\.postMessage\(\{ results: true \}\);/
		);
	});

	it('reports initialization failures instead of leaving the host waiting', () => {
		expect(source).toMatch(
			/if \(load\) \{[\s\S]*?try \{[\s\S]*?await loadPyodide\(baseUrl\);[\s\S]*?catch/
		);
		expect(source).toMatch(
			/else if \(typeof code === 'string'\) \{[\s\S]*?await loadPackages\([\s\S]*?catch[\s\S]*?return;/
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
