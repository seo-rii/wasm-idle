import { describe, expect, it } from 'vitest';
import { compileTypeScript, executeBrowserTypeScriptArtifact } from '../src/index.js';

describe('builtin bindings in guest scope', () => {
	it.each(['javascript', 'typescript'] as const)(
		'supports conventional Buffer and process imports in %s',
		async (language) => {
			const result = await compileTypeScript({
				language,
				code: "import { Buffer } from 'buffer';\nimport process from 'process';\nconsole.log(Buffer.from(process.argv.at(-1)).toString());"
			});
			expect(result.success).toBe(true);
			expect(
				await executeBrowserTypeScriptArtifact(result.artifact!, { args: ['hello'] })
			).toMatchObject({ exitCode: 0, stdout: 'hello\n', stderr: '' });
		}
	);

	it('resolves node:buffer to the same builtin as buffer', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: "import { Buffer as B } from 'node:buffer';\nconsole.log(require('node:buffer') === require('buffer')); console.log(B.from('ok').toString());"
		});
		expect(result.success).toBe(true);
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'true\nok\n',
			stderr: ''
		});
	});

	it('allows local bindings to shadow injected globals and retains top-level return', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: "const Buffer = 42; const process = 'local'; const __dirname = 'here'; console.log(Buffer, process, __dirname); return;"
		});
		expect(result.success).toBe(true);
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: '42 local here\n',
			stderr: ''
		});
	});

	it('preserves a guest strict-mode directive and its this binding', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: "'use strict'; const Buffer = 42; console.log(this === undefined, Buffer);"
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'true 42\n',
			stderr: ''
		});
	});
});
