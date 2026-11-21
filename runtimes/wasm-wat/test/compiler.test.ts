import { describe, expect, it } from 'vitest';
import { compileWat, createWatCompiler, executeBrowserWatArtifact } from '../src/index';

const answerWat = `(module
  (func (export "answer") (result i32)
    i32.const 45
  )
)`;

describe('wasm-wat compiler runtime', () => {
	it('compiles UTF-8 data and export names and maps diagnostics to editor columns', async () => {
		const code =
			'(module (memory (export "mem") 1) (data (i32.const 0) "안녕🙂") (func (export "café🙂") (result i32) i32.const 42))';
		const result = await compileWat({ code });
		expect(result.diagnostics).toEqual([]);
		const execution = await executeBrowserWatArtifact(result.artifact!);
		expect(execution.stdout).toBe('café🙂=42\n');
		const module = await WebAssembly.compile(Uint8Array.from(result.artifact!.wasm));
		const instance = await WebAssembly.instantiate(module);
		const bytes = new TextEncoder().encode('안녕🙂');
		expect(
			new Uint8Array((instance.exports.mem as WebAssembly.Memory).buffer, 0, bytes.length)
		).toEqual(bytes);

		const invalid = '(module (func (export "안녕🙂") bogus))';
		const diagnostics = (await compileWat({ code: invalid })).diagnostics;
		expect(diagnostics[0]).toMatchObject({
			lineNumber: 1,
			columnNumber: invalid.indexOf('bogus') + 1
		});
	});

	it('compiles WAT to a runnable wasm artifact', async () => {
		const compiler = await createWatCompiler();
		const result = await compiler.compile({
			code: answerWat,
			fileName: 'answer.wat'
		});

		expect(result.success).toBe(true);
		expect(result.diagnostics).toEqual([]);
		expect(result.artifact?.wasm.byteLength).toBeGreaterThan(0);

		const lifecycle: string[] = [];
		const execution = await executeBrowserWatArtifact(result.artifact!, {
			onReady: () => lifecycle.push('ready'),
			stdout: () => lifecycle.push('stdout')
		});
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toBe('answer=45\n');
		expect(lifecycle).toEqual(['ready', 'stdout']);
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
