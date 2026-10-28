// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Python debug tracer source', () => {
	it('keeps bytes preview and hidden-local filtering in the injected debug script', () => {
		const source = readFileSync('src/lib/playground/worker/python.ts', 'utf8');

		const trace = readFileSync('src/lib/playground/worker/pythonDebug.ts', 'utf8');
		const preview = readFileSync('src/lib/playground/worker/pythonDebugPreview.ts', 'utf8');
		expect(trace).toContain('${PYTHON_DEBUG_PREVIEW}');
		expect(preview).toContain('if kind in (bytes, bytearray, str):');
		expect(preview).toContain('prefix = value[:32]');
		expect(trace).toContain('name.startswith(".")');
		expect(preview).not.toContain('sorted(list(value), key = repr)');
		expect(source).toContain('sys.settrace(None)');
		expect(trace).toContain('if command != 5:');
		expect(trace).toContain('expression = __wasm_idle_debug_bridge.readWatch()');
		expect(trace).toContain('__wasm_idle_debug_bridge.writeWatch(result)');
	});

	it('can execute a wrapper file while tracing a separate debug file', () => {
		const source = readFileSync('src/lib/playground/worker/python.ts', 'utf8');

		const trace = readFileSync('src/lib/playground/worker/pythonDebug.ts', 'utf8');
		expect(source).toContain('activePath,');
		expect(source).toContain('debugPath,');
		expect(source).toMatch(
			/const executionFilename =\s*normalizeWorkspacePath\(activePath \|\| ''\) \|\|\s*\(isHy \? '__wasm_idle_user__\.hy' : '__wasm_idle_user__\.py'\);/
		);
		expect(source).toMatch(
			/const debugFilename = normalizeWorkspacePath\(debugPath \|\| ''\) \|\| executionFilename;/
		);
		expect(trace).toContain('__wasm_idle_debug_os.path.abspath(__wasm_idle_debug_filename)');
		expect(trace).toContain('current.f_code.co_filename in __wasm_idle_debug_source_filenames');
		expect(trace).toContain(
			'frame.f_code.co_filename not in __wasm_idle_debug_source_filenames'
		);
		expect(source).toMatch(
			/compile\(\s*\$\{JSON\.stringify\(code\)\},\s*\$\{executionFilenameLiteral\},\s*"exec",\s*flags = ast\.PyCF_ALLOW_TOP_LEVEL_AWAIT,?\s*\)/
		);
	});
});
