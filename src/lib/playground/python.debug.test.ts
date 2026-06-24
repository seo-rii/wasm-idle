// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Python debug tracer source', () => {
	it('keeps bytes preview and hidden-local filtering in the injected debug script', () => {
		const source = readFileSync('src/lib/playground/worker/python.ts', 'utf8');

		expect(source).toContain('if isinstance(value, (bytes, bytearray)):');
		expect(source).toContain('name.startswith(".")');
		expect(source).toContain('sorted(list(value), key = repr)[:6]');
		expect(source).toContain('sys.settrace(None)');
		expect(source).toContain('if command != 5:');
		expect(source).toContain('expression = ${debugReadWatchName}()');
		expect(source).toContain('${debugWriteWatchName}(result)');
	});

	it('can execute a wrapper file while tracing a separate debug file', () => {
		const source = readFileSync('src/lib/playground/worker/python.ts', 'utf8');

		expect(source).toContain('activePath,');
		expect(source).toContain('debugPath,');
		expect(source).toMatch(
			/const executionFilename =\s*normalizeWorkspacePath\(activePath \|\| ''\) \|\| '__wasm_idle_user__\.py';/
		);
		expect(source).toMatch(
			/const debugFilename = normalizeWorkspacePath\(debugPath \|\| ''\) \|\| executionFilename;/
		);
		expect(source).toContain('current.f_code.co_filename == ${debugFilenameLiteral}');
		expect(source).toContain('frame.f_code.co_filename != ${debugFilenameLiteral}');
		expect(source).toContain(
			'compile(${JSON.stringify(code)}, ${executionFilenameLiteral}, "exec", flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)'
		);
	});
});
