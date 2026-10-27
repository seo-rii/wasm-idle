import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const { chromium } = require('playwright-core');
const [candidateDir, reportPath, ...extra] = process.argv.slice(2);
assert(
	candidateDir && reportPath && !extra.length,
	'Usage: node scripts/probe-wasm-teavm-candidate.mjs <candidate-dir> <report.json>'
);
const dist = path.join(candidateDir, 'dist');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceFile = (file) => {
	try {
		return readFileSync(path.join(repo, file), 'utf8');
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		// Sparse producer worktrees can read the same tracked fixtures without expanding the app checkout.
		return execFileSync('git', ['show', `HEAD:${file}`], { cwd: repo, encoding: 'utf8' });
	}
};
const fixtureSource = sourceFile('src/lib/playground/java.integration.test.ts');
const parsed = ts.createSourceFile(
	'java.integration.test.ts',
	fixtureSource,
	ts.ScriptTarget.Latest,
	true
);
let fixtures;
function visit(node) {
	if (
		ts.isVariableDeclaration(node) &&
		node.name.getText(parsed) === 'cases' &&
		node.initializer &&
		ts.isArrayLiteralExpression(node.initializer) &&
		node.initializer.getText(parsed).includes('runtime annotations and ServiceLoader')
	) {
		fixtures = vm.runInNewContext(
			`(${node.initializer.getText(parsed)})`,
			{},
			{ timeout: 1000 }
		);
	}
	ts.forEachChild(node, visit);
}
visit(parsed);
assert(fixtures?.length > 10, 'expected existing Java regression cases');
const helperSources = {};
function loadTs(file, dependencies = {}) {
	const input = sourceFile(file);
	helperSources[file] = hash(input);
	const module = { exports: {} };
	const code = ts.transpileModule(input, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	}).outputText;
	vm.runInNewContext(code, {
		exports: module.exports,
		module,
		TextEncoder,
		Uint8Array,
		Int8Array,
		require(id) {
			assert(id in dependencies, `unknown helper dependency ${id}`);
			return dependencies[id];
		}
	});
	return module.exports;
}
const snapshot = loadTs('src/lib/playground/javaStdin.ts');
const stdinHelpers = loadTs('src/lib/playground/javaRuntimeStdin.ts', { './javaStdin': snapshot });
fixtures = fixtures.map((fixture) => {
	const injection = stdinHelpers.prepareJavaRuntimeStdinInjection(fixture.code);
	const sources = { 'Main.java': injection.transformedCode };
	if (injection.helperSource) sources[injection.helperSourcePath] = injection.helperSource;
	return {
		name: fixture.name,
		sources,
		stdin: fixture.stdin ?? '',
		expected: fixture.expected,
		mainClass: 'Main'
	};
});
const upstreamCases = path.join(candidateDir, 'source/compiler/src/test/cases');
for (const entry of await readdir(upstreamCases, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const caseDir = path.join(upstreamCases, entry.name);
	const names = await readdir(caseDir);
	if (names.includes('disabled.txt')) continue;
	const sources = {};
	async function addSources(dir, relative = '') {
		for (const item of await readdir(dir, { withFileTypes: true })) {
			if (item.isDirectory())
				await addSources(path.join(dir, item.name), path.posix.join(relative, item.name));
			else if (item.name.endsWith('.java'))
				sources[path.posix.join(relative, item.name)] = await readFile(
					path.join(dir, item.name),
					'utf8'
				);
		}
	}
	await addSources(caseDir);
	fixtures.push({
		name: `upstream/${entry.name}`,
		sources,
		stdin: '',
		expected: await readFile(path.join(caseDir, 'expected.txt'), 'utf8'),
		mainClass: 'Main'
	});
}
const assets = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compiler.wasm-deobfuscator.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
];
const receipts = {};
for (const name of assets) {
	const bytes = await readFile(path.join(dist, name));
	receipts[name] = { bytes: bytes.length, sha256: hash(bytes) };
}
const inputBytes = await readFile(path.join(candidateDir, 'candidate-inputs.lock.json'));
const inputs = JSON.parse(inputBytes);
const report = {
	format: 'wasm-idle-teavm-candidate-browser-v1',
	profileId: inputs.profileId,
	inputs: { bytes: inputBytes.length, sha256: hash(inputBytes) },
	probeSha256: hash(await readFile(fileURLToPath(import.meta.url))),
	sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: repo,
		encoding: 'utf8'
	}).trim(),
	assets: receipts,
	fixtureSource: {
		path: 'src/lib/playground/java.integration.test.ts',
		sha256: hash(fixtureSource)
	},
	helperSources,
	cases: [],
	pageErrors: []
};
const server = createServer(async (request, response) => {
	try {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		if (pathname === '/') {
			response.setHeader('Content-Type', 'text/html');
			response.end(
				'<!doctype html><meta charset="utf-8"><title>TeaVM candidate probe</title>'
			);
			return;
		}
		const name = pathname.replace(/^\/assets\//, '');
		if (!assets.includes(name)) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.setHeader(
			'Content-Type',
			name.endsWith('.js')
				? 'text/javascript'
				: name.endsWith('.wasm')
					? 'application/wasm'
					: 'application/octet-stream'
		);
		response.end(await readFile(path.join(dist, name)));
	} catch (error) {
		response.writeHead(500);
		response.end(String(error));
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browserTmp = await mkdtemp(path.join(os.tmpdir(), 'teavm-candidate-browser-'));
let browser;
let watchdog;
try {
	browser = await chromium.launch({
		headless: true,
		env: { ...process.env, TMPDIR: browserTmp }
	});
	report.browser = browser.version();
	watchdog = setTimeout(() => {
		report.timedOut = true;
		console.error('TeaVM candidate probe exceeded its ten-minute deadline');
		void browser.close();
	}, 600_000);
	const page = await browser.newPage();
	page.on('pageerror', (error) => report.pageErrors.push(String(error)));
	await page.goto(base);
	await page.evaluate(async () => {
		const { load } = await import('/assets/compiler.wasm-runtime.js');
		const binary = async (name) =>
			new Int8Array(await (await fetch(`/assets/${name}`)).arrayBuffer());
		const [module, sdk, classlib] = await Promise.all([
			load(new URL('/assets/compiler.wasm', location.href).href, {
				stackDeobfuscator: { enabled: false }
			}),
			binary('compile-classlib-teavm.bin'),
			binary('runtime-classlib-teavm.bin')
		]);
		globalThis.candidate = { load, exports: module.exports, sdk, classlib };
	});
	for (const fixture of fixtures) {
		const started = Date.now();
		const result = await page.evaluate(async (fixture) => {
			const { load, exports, sdk, classlib } = globalThis.candidate;
			const compiler = exports.createCompiler();
			const diagnostics = [];
			compiler.onDiagnostic((d) =>
				diagnostics.push({
					severity: d.severity,
					message: String(d.message ?? ''),
					type: d.type
				})
			);
			compiler.setSdk(sdk);
			compiler.setTeaVMClasslib(classlib);
			for (const [name, content] of Object.entries(fixture.sources))
				compiler.addSourceFile(name, content);
			if (!compiler.compile()) return { status: 'javac-failed', diagnostics };
			if (!compiler.generateWebAssembly({ outputName: 'app', mainClass: fixture.mainClass }))
				return { status: 'teavm-failed', diagnostics };
			const bytes = new Int8Array(new TextEncoder().encode(fixture.stdin));
			let position = 0;
			globalThis.wasmIdleJavaStdin = {
				readChunk() {
					if (position >= bytes.length) return null;
					const chunk = bytes.slice(position, position + 7);
					position += chunk.length;
					return chunk;
				},
				readByte() {
					return position >= bytes.length ? -1 : bytes[position++] & 255;
				}
			};
			let stdout = '',
				stderr = '';
			try {
				const app = await load(compiler.getWebAssemblyOutputFile('app.wasm'), {
					installImports(imports) {
						imports.teavmConsole.putcharStdout = (c) =>
							(stdout += String.fromCharCode(c));
						imports.teavmConsole.putcharStderr = (c) =>
							(stderr += String.fromCharCode(c));
					},
					stackDeobfuscator: { enabled: false }
				});
				const sections = WebAssembly.Module.customSections(app.module, 'teavm_line');
				if (sections.length !== 1) throw Error('Missing embedded Java source locations');
				const lines = new Uint8Array(sections[0]);
				let cursor = 0,
					depth = 0,
					starts = 0,
					ends = 0;
				while (cursor < lines.length) {
					const op = lines[cursor++];
					if (op === 0) {
						depth++;
						starts++;
					}
					if (op === 1) {
						depth--;
						ends++;
					}
					if (depth < 0) throw Error('Java debug scope ended without a start');
					if (op === 0 || op === 2 || op === 3 || op === 4) {
						let byte;
						do {
							if (cursor >= lines.length) throw Error('Truncated Java debug operand');
							byte = lines[cursor++];
						} while (byte & 128);
					} else if (op !== 1 && op < 10) throw Error('Unknown Java debug opcode');
				}
				if (depth || !starts)
					throw Error(`Unbalanced Java debug scopes: ${starts} starts, ${ends} ends`);
				await app.exports.main([]);
				return {
					status: 'ok',
					stdout,
					stderr,
					diagnostics,
					stdinBytes: position,
					debugScopes: { starts, ends }
				};
			} catch (error) {
				return {
					status: 'runtime-failed',
					stdout,
					stderr,
					diagnostics,
					error: String(error),
					stack: error.stack
				};
			} finally {
				delete globalThis.wasmIdleJavaStdin;
			}
		}, fixture);
		report.cases.push({
			name: fixture.name,
			milliseconds: Date.now() - started,
			expected: fixture.expected,
			...result
		});
		await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
		console.log(
			JSON.stringify({
				name: fixture.name,
				status: result.status,
				milliseconds: Date.now() - started,
				matches: result.stdout === fixture.expected
			})
		);
	}
	assert.equal(report.pageErrors.length, 0, 'no page errors');
	const failed = report.cases.filter(
		(entry) => entry.status !== 'ok' || entry.stdout !== entry.expected || entry.stderr
	);
	assert.equal(failed.length, 0, `failed cases: ${failed.map((entry) => entry.name).join(', ')}`);
} finally {
	clearTimeout(watchdog);
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
	await rm(browserTmp, { recursive: true, force: true });
	await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
