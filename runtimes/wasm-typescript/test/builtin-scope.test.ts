import { describe, expect, it } from 'vitest';
import { compileTypeScript, executeBrowserTypeScriptArtifact } from '../src/index.js';

describe('builtin bindings in guest scope', () => {
	it('preserves native execution of long expressions without lexical collisions', async () => {
		const code = `console.log(${Array(6000).fill('1').join('+')});`;
		expect(
			await executeBrowserTypeScriptArtifact({
				javascript: code,
				source: code,
				language: 'javascript',
				fileName: 'native-body.js'
			})
		).toMatchObject({
			exitCode: 0,
			stdout: '6000\n',
			stderr: ''
		});
	});

	it('preserves native source locations for an error on the first guest line', async () => {
		const code = "const Buffer = 42; throw new Error('original location');";
		const fileName = 'source-line.js';
		const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
		let nativeLocation: string | undefined;
		try {
			await new AsyncFunction(`${code}\n//# sourceURL=${fileName}`)();
		} catch (error) {
			nativeLocation = (error as Error).stack?.match(/source-line\.js:\d+:\d+/u)?.[0];
		}
		expect(nativeLocation).toBeTruthy();
		const compiled = await compileTypeScript({ language: 'javascript', code, fileName });
		const result = await executeBrowserTypeScriptArtifact(compiled.artifact!);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(nativeLocation);
	});

	it('preserves hoisted function declarations sharing a parameter binding', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: 'console.log(require === arguments[0]); function require() {}'
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'true\n',
			stderr: ''
		});
	});

	it.each([
		{
			code: "class Buffer { static value = 'local'; } console.log(Buffer.value, arguments[5].from('kept').toString());",
			stdout: 'local kept\n'
		},
		{
			code: "const { process, nested: { Buffer }, ...console } = { process: 'local', nested: { Buffer: 42 }, extra: 'rest' }; arguments[4].log(process, Buffer, console.extra);",
			stdout: 'local 42 rest\n'
		},
		{
			code: "let [process, ...Buffer] = ['local', 1, 2]; console.log(process, Buffer.join(','));",
			stdout: 'local 1,2\n'
		},
		{ code: 'const { Buffer = 7 } = {}; console.log(Buffer);', stdout: '7\n' },
		{
			code: "const { Buffer: B } = require('buffer'); console.log(B === Buffer);",
			stdout: 'true\n'
		}
	])('allows lexical class and destructuring bindings: $code', async ({ code, stdout }) => {
		const result = await compileTypeScript({ language: 'javascript', code });
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout,
			stderr: ''
		});
	});

	it('keeps generated parameter names away from identifiers and evaluated string literals', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: "const Buffer = 42; console.log(typeof __wasmTypeScriptParameter_0, eval('typeof __wasmTypeScriptParameter_1'), eval('typeof __wasmTypeScriptParameter_\\u0032'));"
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'undefined undefined undefined\n',
			stderr: ''
		});
	});

	it('retains injected values when var redeclares their bindings', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: "var console; var process; console.log('ok', process.platform);"
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'ok browser\n',
			stderr: ''
		});
	});

	it('preserves sloppy-mode parameter and arguments aliasing', async () => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: 'const original = console; const replacement = {}; arguments[4] = replacement; original.log(console === replacement); console = {}; original.log(arguments[4] === console);'
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: 'true\ntrue\n',
			stderr: ''
		});
	});

	it.each([
		{ prefix: "''; 'use strict';", strict: true },
		{
			prefix: '// leading comment\n"another directive"; /* gap */ "use strict";',
			strict: true
		},
		{ prefix: '"use\\x20strict";', strict: false },
		{ prefix: '("use strict");', strict: false },
		{ prefix: '"use strict"\n+ "";', strict: false }
	])('retains directive semantics for $prefix', async ({ prefix, strict }) => {
		const result = await compileTypeScript({
			language: 'javascript',
			code: `${prefix}\nconst Buffer = 42; console.log(this === undefined, Buffer);`
		});
		expect(await executeBrowserTypeScriptArtifact(result.artifact!)).toMatchObject({
			exitCode: 0,
			stdout: `${strict} 42\n`,
			stderr: ''
		});
	});

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
