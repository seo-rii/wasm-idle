import { describe, expect, it } from 'vitest';
import { compileTypeScript, executeBrowserTypeScriptArtifact } from '../src/index.js';

describe('builtin import syntax', () => {
	it('accepts new.target in the native async function body and its arrow functions', async () => {
		const compiled = await compileTypeScript({
			language: 'javascript',
			code: 'const target = () => new.target; console.log(new.target === undefined, target() === undefined);'
		});
		expect(compiled.success).toBe(true);
		expect(await executeBrowserTypeScriptArtifact(compiled.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'true true\n',
			stderr: ''
		});
	});

	it('rejects source that escapes the synthetic function body', async () => {
		const compiled = await compileTypeScript({
			language: 'javascript',
			code: '}\nasync function escaped() {'
		});
		expect(compiled.success).toBe(false);
		expect(compiled.diagnostics[0]).toMatchObject({ lineNumber: 1, columnNumber: 1 });
	});

	it('reports parser errors in original source coordinates', async () => {
		const compiled = await compileTypeScript({
			language: 'javascript',
			code: '// header\nconst = 1;'
		});
		expect(compiled.success).toBe(false);
		expect(compiled.diagnostics[0]).toMatchObject({ lineNumber: 2, columnNumber: 7 });
		expect(compiled.stderr).toContain('(2:6)');
	});

	it.each([
		{ name: 'LF', newline: '\n' },
		{ name: 'CRLF', newline: '\r\n' },
		{ name: 'CR', newline: '\r' },
		{ name: 'line separator', newline: '\u2028' },
		{ name: 'paragraph separator', newline: '\u2029' }
	])('preserves runtime error lines after imports with $name', async ({ newline }) => {
		const fileName = 'import-lines.js';
		const following = `${newline}throw new Error('after import');`;
		const code = `import {${newline}readFileSync as read${newline}} from 'fs';${following}`;
		const compiled = await compileTypeScript({ language: 'javascript', code, fileName });
		expect(compiled.success).toBe(true);
		expect(compiled.artifact!.javascript.endsWith(following)).toBe(true);
		const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
		let nativeLocation: string | undefined;
		try {
			await new AsyncFunction(
				`${newline.repeat(2)}${following}\n//# sourceURL=${fileName}`
			)();
		} catch (error) {
			nativeLocation = (error as Error).stack?.match(/import-lines\.js:\d+:\d+/u)?.[0];
		}
		expect(nativeLocation).toBeTruthy();
		const result = await executeBrowserTypeScriptArtifact(compiled.artifact!);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(nativeLocation);
	});

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
