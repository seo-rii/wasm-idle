import { describe, expect, it } from 'vitest';
import { compileTypeScript, executeBrowserTypeScriptArtifact } from '../src/index.js';

describe('official CoffeeScript browser compiler', () => {
	it('compiles classes, comprehensions and interpolation and runs with stdin, files and arguments', async () => {
		const compiled = await compileTypeScript({
			language: 'coffeescript',
			fileName: 'src/main.coffee',
			code: `
fs = require 'fs'
class Sum
  constructor: (@numbers) ->
  value: -> @numbers.reduce ((a, b) -> a + b), 0
numbers = (Number x for x in fs.readFileSync(0, 'utf8').trim().split /\\s+/)
sum = new Sum numbers
console.log "#{process.argv.at(-1)}=#{sum.value()}"
console.log fs.readFileSync 'data.txt', 'utf8'
`
		});
		expect(compiled.success).toBe(true);
		let stdin: string | null = '1 2 3\n';
		const result = await executeBrowserTypeScriptArtifact(compiled.artifact!, {
			args: ['total'],
			files: [{ path: 'data.txt', content: '한글' }],
			activePath: 'src/main.coffee',
			stdin: () => {
				const chunk = stdin;
				stdin = null;
				return chunk;
			}
		});
		expect(result).toMatchObject({ exitCode: 0, stdout: 'total=6\n한글\n' });
	});
	it('supports builtin import syntax and EOF', async () => {
		const result = await compileTypeScript({
			language: 'coffeescript',
			code: "import fs from 'node:fs'\nconsole.log fs.readFileSync(0, 'utf8').length"
		});
		expect(result.success).toBe(true);
		expect(
			await executeBrowserTypeScriptArtifact(result.artifact!, { stdin: () => null })
		).toMatchObject({ exitCode: 0, stdout: '0\n' });
	});
	it('reports original CoffeeScript file and source position for compiler errors', async () => {
		const result = await compileTypeScript({
			language: 'coffeescript',
			fileName: 'src/broken.coffee',
			code: 'value = 1\nvalue = )'
		});
		expect(result.success).toBe(false);
		expect(result.artifact).toBeUndefined();
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				fileName: 'src/broken.coffee',
				lineNumber: 2,
				columnNumber: 9,
				severity: 'error'
			})
		]);
	});
	it('recognizes literate CoffeeScript and permits an empty comment-only program', async () => {
		const result = await compileTypeScript({
			fileName: 'main.litcoffee',
			code: 'A literate example.\n\n    console.log "literate"\n'
		});
		expect(result.success).toBe(true);
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'literate\n'
		});
		const empty = await compileTypeScript({ language: 'coffeescript', code: '# comment' });
		expect(empty.success).toBe(true);
		expect(await executeBrowserTypeScriptArtifact(empty.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: ''
		});
	});
	it('rejects unsupported external modules explicitly', async () => {
		const result = await compileTypeScript({
			language: 'coffeescript',
			code: "import library from 'external-package'"
		});
		expect(result.success).toBe(false);
		expect(result.stderr).toContain('Only Node builtin imports');
	});
});
