import { describe, expect, it } from 'vitest';
import { compileTypeScript, executeBrowserTypeScriptArtifact } from '../src/index.js';

describe('builtin import syntax', () => {
	it.each([
		"console.log(`한글🙂\nimport fs from 'fs';\n\\0끝`);",
		"console.log(`\nimport fs from 'fs';\nexport default 7;\n`);",
		"/*\nimport helper from './helper';\nexport default 1;\n*/\nconsole.log('ok');",
		"const text = `prefix\nimport 'node:fs';\nsuffix`; console.log(text);"
	])('preserves source text outside real import declarations: %s', async (code) => {
		const compiled = await compileTypeScript({ code, language: 'javascript' });
		expect(compiled.success).toBe(true);
		expect(compiled.artifact?.javascript).toBe(code);
		const expected: string[] = [];
		new Function('console', code)({ log: (value: string) => expected.push(value + '\n') });
		const result = await executeBrowserTypeScriptArtifact(compiled.artifact!);
		expect(result).toMatchObject({ exitCode: 0, stdout: expected.join(''), stderr: '' });
	});

	it('lowers same-line imports and commented, multiline named imports', async () => {
		const compiled = await compileTypeScript({
			language: 'javascript',
			code: "import fs from 'fs'; import * as path from 'path';\nimport {\n/* import is syntax only here */ readFileSync as read\n} from 'node:fs';\nconsole.log(read(path.join('data', 'n.txt'), 'utf8')); console.log(fs.existsSync('data/n.txt'));"
		});
		expect(compiled.success).toBe(true);
		const result = await executeBrowserTypeScriptArtifact(compiled.artifact!, {
			files: [{ path: 'data/n.txt', content: '42' }]
		});
		expect(result).toMatchObject({ exitCode: 0, stdout: '42\ntrue\n', stderr: '' });
	});

	it.each(["import helper from './helper';", 'export const value = 1;'])(
		'rejects actual unsupported module syntax: %s',
		async (statement) => {
			const compiled = await compileTypeScript({
				language: 'javascript',
				code: `// header\n${statement}`
			});
			expect(compiled.success).toBe(false);
			expect(compiled.diagnostics[0]).toMatchObject({ lineNumber: 2, columnNumber: 1 });
			expect(compiled.stderr).toContain('Only Node builtin imports');
		}
	);

	it('retains native script execution with top-level await and return', async () => {
		const code = "console.log(await Promise.resolve('ok')); return;";
		const compiled = await compileTypeScript({ language: 'javascript', code });
		expect(compiled.success).toBe(true);
		expect(compiled.artifact?.javascript).toBe(code);
		expect(await executeBrowserTypeScriptArtifact(compiled.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'ok\n'
		});
	});
});
