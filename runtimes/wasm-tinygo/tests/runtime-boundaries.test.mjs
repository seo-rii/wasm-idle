import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { emitTinyGoCompilerDiagnostics } from '../src/compiler-diagnostics.ts';

test('the TinyGo runtime does not preload cross-runtime assets', async () => {
	const runtimeSource = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');

	assert.doesNotMatch(runtimeSource, /rustRuntime(?:BaseUrl|AssetPacks|ManifestLoaded)/);
	assert.doesNotMatch(runtimeSource, /wasm-rust runtime manifest/);
});

test('TinyGo build tooling owns its LLVM consumer contract locally', async () => {
	const [packageSource, fetchSource, patchSource] = await Promise.all([
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/fetch-emception-worker.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/patch-emception-worker-source.mjs', import.meta.url), 'utf8')
	]);
	const packageJson = JSON.parse(packageSource);

	assert.equal(packageJson.dependencies?.['@seo-rii/wasm-llvm'], undefined);
	assert.match(fetchSource, /scripts\/llvm-contracts\/tinygo\.mjs/u);
	assert.match(patchSource, /scripts\/llvm-contracts\/tinygo\.mjs/u);
	assert.doesNotMatch(`${fetchSource}\n${patchSource}`, /from\s+['"]@seo-rii\/wasm-llvm/u);
});

test('TinyGo compiler diagnostics are emitted only for failed producer results', async () => {
	const runtimeSource = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');

	assert.match(
		runtimeSource,
		/if \(!frontendAnalysisResult\.ok\) \{\s*emitTinyGoCompilerDiagnostics/u
	);
	assert.match(
		runtimeSource,
		/if \(!frontendRealAdapterResult\.ok\) \{\s*emitTinyGoCompilerDiagnostics/u
	);
	assert.match(runtimeSource, /if \(!frontendAnalysisResult\.analysis\) \{/u);
	assert.match(runtimeSource, /if \(!frontendRealAdapterResult\.adapter\) \{/u);
	assert.doesNotMatch(runtimeSource, /if \(!frontend(?:Analysis|RealAdapter)Result\.ok \|\|/u);
});

test('TinyGo compiler diagnostics preserve locations and severity', () => {
	const diagnostics = [];
	emitTinyGoCompilerDiagnostics(
		[
			'/workspace/main.go:4:7: warning: unused value',
			'parse entry source: /workspace/main.go:3:1: expected declaration',
			'note: inferred package metadata\nplain compiler failure',
			42
		],
		(diagnostic) => diagnostics.push(diagnostic)
	);

	assert.deepEqual(diagnostics, [
		{
			message: 'unused value',
			severity: 'warning',
			fileName: '/workspace/main.go',
			lineNumber: 4,
			columnNumber: 7
		},
		{
			message: 'parse entry source: expected declaration',
			severity: 'error',
			fileName: '/workspace/main.go',
			lineNumber: 3,
			columnNumber: 1
		},
		{
			message: 'inferred package metadata',
			severity: 'other',
			fileName: null,
			lineNumber: 1
		},
		{
			message: 'plain compiler failure',
			severity: 'error',
			fileName: null,
			lineNumber: 1
		}
	]);
});

test('TinyGo diagnostic callback failures stop producer reporting', () => {
	const callbackError = new Error('diagnostic callback failed');
	let calls = 0;

	assert.throws(
		() =>
			emitTinyGoCompilerDiagnostics(['first failure', 'second failure'], () => {
				calls += 1;
				throw callbackError;
			}),
		(error) => error === callbackError
	);
	assert.equal(calls, 1);
});

test('TinyGo diagnostic reporting is optional for non-host consumers', () => {
	assert.doesNotThrow(() => emitTinyGoCompilerDiagnostics(['compiler failure'], undefined));
});
