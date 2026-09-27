import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const javascriptUrl = new URL('../dist/javascript.js', import.meta.url).href;
const typescriptUrl = new URL('../dist/index.js', import.meta.url).href;
beforeAll(() => {
	execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: runtimeRoot });
});
function runBundle(moduleUrl: string, body: string) {
	return JSON.parse(
		execFileSync(
			process.execPath,
			['--input-type=module', '-e', body.replace('MODULE_URL', JSON.stringify(moduleUrl))],
			{ cwd: runtimeRoot, encoding: 'utf8' }
		)
	);
}

describe('standalone browser bundles', () => {
	it('runs JavaScript without WebAssembly while retaining stdin, workspace, args and Buffer', () => {
		const result = runBundle(
			javascriptUrl,
			`
			globalThis.WebAssembly = undefined;
			const runtime = await import(MODULE_URL);
			const compiler = await runtime.createTypeScriptCompiler();
			const compiled = await compiler.compile({ language:'javascript', code:
				'const fs = require("fs"); const binary = require("buffer"); console.log(Number(fs.readFileSync(0,"utf8")) + Number(fs.readFileSync("n.txt","utf8"))); console.log(binary.Buffer.from(process.argv.at(-1)).toString());'
			});
			let input = '35'; const events = [];
			const execution = await runtime.executeBrowserTypeScriptArtifact(compiled.artifact, {args:['hello'], files:[{path:'n.txt',content:'7'}], stdin:()=>{const value=input; input=null; return value;}, onReady:()=>events.push('ready'), stdout:()=>events.push('stdout')});
			process.stdout.write(JSON.stringify({success:compiled.success,execution,events}));
		`
		);
		expect(result.success).toBe(true);
		expect(result.execution).toMatchObject({ exitCode: 0, stdout: '42\nhello\n' });
		expect(result.events[0]).toBe('ready');
	});
	it('fails TypeScript requests explicitly rather than partially interpreting them', () => {
		const result = runBundle(
			javascriptUrl,
			`globalThis.WebAssembly=undefined; const runtime=await import(MODULE_URL); process.stdout.write(JSON.stringify(await runtime.compileTypeScript({language:'typescript',code:'const n: number = 42;'})));`
		);
		expect(result.success).toBe(false);
		expect(result.stderr).toContain('JavaScript only');
	});
	it('keeps real SWC in the TypeScript bundle', () => {
		const result = runBundle(
			typescriptUrl,
			`const runtime=await import(MODULE_URL); const result=await runtime.compileTypeScript({language:'typescript',code:'const n: number = 42; console.log(n);'}); process.stdout.write(JSON.stringify(await runtime.executeBrowserTypeScriptArtifact(result.artifact)));`
		);
		expect(result).toMatchObject({ exitCode: 0, stdout: '42\n' });
	});
	it('does not accidentally reintroduce the compiler into the JavaScript payload', () => {
		const javascriptBytes = statSync(new URL(javascriptUrl)).size;
		const typescriptBytes = statSync(new URL(typescriptUrl)).size;
		expect(javascriptBytes).toBeLessThan(100_000);
		expect(javascriptBytes).toBeLessThan(typescriptBytes / 20);
	});
});
