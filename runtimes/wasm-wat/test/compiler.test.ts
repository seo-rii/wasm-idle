import { describe, expect, it } from 'vitest';
import { compileWat, createWatCompiler, executeBrowserWatArtifact } from '../src/index';

const answerWat = `(module
  (func (export "answer") (result i32)
    i32.const 45
  )
)`;

describe('wasm-wat compiler runtime', () => {
	it('compiles WAT to a runnable wasm artifact', async () => {
		const compiler = await createWatCompiler();
		const result = await compiler.compile({
			code: answerWat,
			fileName: 'answer.wat'
		});

		expect(result.success).toBe(true);
		expect(result.diagnostics).toEqual([]);
		expect(result.artifact?.wasm.byteLength).toBeGreaterThan(0);

		const execution = await executeBrowserWatArtifact(result.artifact!);
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('answer=45\n');
	});

	it('reports WABT parse diagnostics with source locations', async () => {
		const result = await compileWat({
			code: `(module
  (func (export "broken") (result i32)
    i32.const
  )
)`,
			fileName: 'broken.wat'
		});

		expect(result.success).toBe(false);
		expect(result.artifact).toBeUndefined();
		expect(result.diagnostics[0]).toMatchObject({
			fileName: 'broken.wat',
			lineNumber: 4,
			severity: 'error'
		});
		expect(result.stderr).toContain('unexpected token');
	});
});
