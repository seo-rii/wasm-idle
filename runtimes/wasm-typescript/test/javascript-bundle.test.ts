import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
let javascript: any;
let typescript: any;

beforeAll(async () => {
	await promisify(execFile)(process.execPath, ['scripts/build.mjs'], { cwd: root });
	javascript = await import(/* @vite-ignore */ new URL('../dist/javascript.js', import.meta.url).href);
	typescript = await import(/* @vite-ignore */ new URL('../dist/index.js', import.meta.url).href);
}, 30_000);

async function run(runtime: any, code: string, options: Record<string, unknown> = {}, language = 'javascript') {
	const compiler = await runtime.createTypeScriptCompiler();
	const result = await compiler.compile({ code, language });
	expect(result.success, result.stderr).toBe(true);
	const execution = await runtime.executeBrowserTypeScriptArtifact(result.artifact, options);
	expect(execution.exitCode, execution.stderr).toBe(0);
	return execution;
}

it('produces a substantially smaller, self-contained JavaScript entry', async () => {
	const [small, full] = await Promise.all([
		readFile(new URL('../dist/javascript.js', import.meta.url)),
		readFile(new URL('../dist/index.js', import.meta.url))
	]);
	expect(small.byteLength).toBeLessThan(full.byteLength / 4);
});

it('runs real JavaScript and standard output through the unchanged runner', async () => {
	const result = await run(javascript, 'console.log(21 * 2);');
	expect(result.stdout).toBe('42\n');
});

it('preserves stdin and the existing fs builtin', async () => {
	let input: string | null = '19 23\n';
	const result = await run(javascript,
		'const fs = require("fs"); console.log(fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number).reduce((a,b)=>a+b,0));',
		{ stdin: () => { const next = input; input = null; return next; } });
	expect(result.stdout).toBe('42\n');
});

it('preserves Unicode and buffer builtin semantics in both bundles', async () => {
	for (const runtime of [javascript, typescript]) {
		// Buffer is already an injected global in the existing runner.
		const result = await run(runtime, 'const { Buffer: B } = require("buffer"); console.log(B.from("안녕").toString("utf8"));');
		expect(result.stdout).toBe('안녕\n');
	}
});

it('reports unsupported TypeScript explicitly rather than silently ignoring types', async () => {
	const compiler = await javascript.createTypeScriptCompiler();
	const result = await compiler.compile({ code: 'const value: number = 42;', language: 'typescript' });
	expect(result.success).toBe(false);
	expect(result.stderr).toContain('full TypeScript runtime');
});

it('keeps actual SWC transformation available in the full TypeScript entry', async () => {
	const result = await run(typescript, 'const value: number = 42; console.log(value);', {}, 'typescript');
	expect(result.stdout).toBe('42\n');
});

it('preserves unsupported-import diagnostics in both bundles', async () => {
	for (const runtime of [javascript, typescript]) {
		const compiler = await runtime.createTypeScriptCompiler();
		const result = await compiler.compile({ code: 'import x from "external-module";', language: 'javascript' });
		expect(result.success).toBe(false);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	}
});
