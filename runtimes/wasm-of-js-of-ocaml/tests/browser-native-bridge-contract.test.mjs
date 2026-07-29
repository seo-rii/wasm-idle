import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');

test('browser-native worker runs static Binaryen tools without the Binaryen API bridge', async () => {
	const workerSource = await readFile(
		path.join(projectRoot, 'browser-harness', 'native-tool-worker.ts'),
		'utf8'
	);
	const dispatcherSource = await readFile(
		path.join(projectRoot, 'runtime', 'system-dispatch-browser-worker.ts'),
		'utf8'
	);
	const compilerSource = await readFile(
		path.join(projectRoot, 'src', 'compiler-worker.ts'),
		'utf8'
	);
	const typesSource = await readFile(path.join(projectRoot, 'src', 'types.ts'), 'utf8');

	assert.match(workerSource, /type BinaryenToolAssets = \{/);
	assert.match(workerSource, /request\.binaryenTools/);
	assert.match(
		workerSource,
		/runBinaryenTool\(runtimeGlobal,\s*command,\s*binaryenToolSources\)/
	);
	assert.doesNotMatch(workerSource, /\/api\/binaryen-command/);
	assert.doesNotMatch(workerSource, /__binaryen_tool_source_cache/);
	assert.doesNotMatch(workerSource, /XMLHttpRequest/);
	assert.doesNotMatch(workerSource, /node:fs\/promises/);
	assert.doesNotMatch(workerSource, /credentials:\s*'same-origin'/);
	assert.match(workerSource, /async function materializeBinaryenToolSources\(/);
	assert.match(
		workerSource,
		/fetchBrowserToolAsset\(\s*toolAsset\.url,\s*`browser-native Binaryen tool \$\{displayName\}`/u
	);
	assert.match(workerSource, /receipt: toolAsset/);
	assert.match(workerSource, /fastMode\s*\? \['wasm_merge'\]/u);
	assert.match(workerSource, /new Function\(`\$\{toolAsset\.source\}/);
	assert.match(
		workerSource,
		/const activeBinaryenCliRuntime = runtimeGlobal\['__binaryen_cli_runtime'\]/
	);
	assert.match(workerSource, /activeBinaryenCliRuntime\?\.FS\?\.quit\?\.\(\);/);
	assert.match(workerSource, /WASM_OF_JS_OF_OCAML_BROWSER_FAST_BINARYEN/);
	assert.match(
		workerSource,
		/parsed\.toolName === 'wasm-metadce' \|\| parsed\.toolName === 'wasm-opt'/
	);
	assert.match(dispatcherSource, /binaryenTools\?: \{/);
	assert.match(dispatcherSource, /type BrowserNativeManifestAsset = BrowserToolAssetDescriptor/);
	assert.match(dispatcherSource, /options\.manifest\.binaryenTools/);
	assert.match(dispatcherSource, /env\['WASM_OF_JS_OF_OCAML_BROWSER_FAST_BINARYEN'\] \|\| '1'/);
	assert.match(typesSource, /export type WasmBinaryenMode = 'fast' \| 'full';/);
	assert.match(compilerSource, /const wasmBinaryenMode = request\.wasmBinaryenMode \|\| 'fast';/);
	assert.match(compilerSource, /wasmBinaryenMode === 'full' \? '0' : '1'/);
});

test('browser-native dispatcher keeps backend preloads lean', async () => {
	const dispatcherSource = await readFile(
		path.join(projectRoot, 'runtime', 'system-dispatch-browser-worker.ts'),
		'utf8'
	);

	assert.match(
		dispatcherSource,
		/const selectedPackages = command === 'ocamlc' \? packages : \[\];/
	);
	assert.match(dispatcherSource, /!file\.path\.includes\('\/compiler-libs\/'\)/);
	assert.doesNotMatch(dispatcherSource, /command === 'ocamlc' \? packages : manifest\.packages/);
});

test('browser-native dispatcher transfers transient preload buffers to the tool worker', async () => {
	const dispatcherSource = await readFile(
		path.join(projectRoot, 'runtime', 'system-dispatch-browser-worker.ts'),
		'utf8'
	);

	assert.match(dispatcherSource, /const transferPreloadBuffers = request\.preloadFiles\.flatMap/);
	assert.match(dispatcherSource, /\},\s*transferPreloadBuffers\s*\);/u);
});

test('browser-native worker applies one bounded budget to compiler and preload inputs', async () => {
	const workerSource = await readFile(
		path.join(projectRoot, 'browser-harness', 'native-tool-worker.ts'),
		'utf8'
	);
	const dispatcherSource = await readFile(
		path.join(projectRoot, 'runtime', 'system-dispatch-browser-worker.ts'),
		'utf8'
	);
	const materializeStart = workerSource.indexOf('async function materializePreloadFiles');
	const materializeEnd = workerSource.indexOf(
		"self.addEventListener('message'",
		materializeStart
	);
	assert.notEqual(materializeStart, -1);
	assert.notEqual(materializeEnd, -1);
	const materializeSource = workerSource.slice(materializeStart, materializeEnd);

	assert.match(workerSource, /const inputBudget = createBrowserToolInputBudget\(\);/);
	assert.match(workerSource, /materializePreloadFiles\(request\.preloadFiles, inputBudget\)/);
	assert.match(
		workerSource,
		/fetchBrowserToolAsset\(\s*request\.tool\.url,[\s\S]*?inputBudget,[\s\S]*?receipt: request\.tool/u
	);
	assert.match(workerSource, /receipt: preloadFile\.receipt/);
	assert.match(workerSource, /receipt: toolAsset/);
	assert.match(dispatcherSource, /receipt: manifest\.findlibConf/);
	assert.match(materializeSource, /accountBrowserToolInputBytes\(budget, label,/);
	assert.doesNotMatch(workerSource, /await toolResponse\.text\(\)/);
	assert.doesNotMatch(materializeSource, /new Uint8Array\(await response\.arrayBuffer\(\)\)/);
});
