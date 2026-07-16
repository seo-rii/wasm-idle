import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_JS_OF_OCAML_VERSION,
	DEFAULT_OCAML_COMPILER_VERSION,
	DEFAULT_SWITCH_NAME
} from '../scripts/toolchain-defaults.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('shell bootstrap and JavaScript tooling share pinned compiler defaults', async () => {
	const bootstrapSource = await readFile(
		path.join(projectRoot, 'scripts', 'bootstrap-switch.sh'),
		'utf8'
	);
	const bundlePreparationSource = await readFile(
		path.join(projectRoot, 'scripts', 'prepare-browser-native.mjs'),
		'utf8'
	);

	assert.equal(DEFAULT_OCAML_COMPILER_VERSION, '5.4.1');
	assert.equal(DEFAULT_JS_OF_OCAML_VERSION, '6.3.2');
	assert.equal(DEFAULT_SWITCH_NAME, 'wasm-of-js-of-ocaml-5.4.1');
	assert.match(
		bootstrapSource,
		new RegExp(`PINNED_OCAML_VERSION="${DEFAULT_OCAML_COMPILER_VERSION.replaceAll('.', '\\.')}`)
	);
	assert.match(
		bootstrapSource,
		new RegExp(
			`PINNED_JS_OF_OCAML_VERSION="${DEFAULT_JS_OF_OCAML_VERSION.replaceAll('.', '\\.')}`
		)
	);
	assert.match(bootstrapSource, /ocaml-base-compiler\.\$PINNED_OCAML_VERSION/);
	assert.match(bootstrapSource, /js_of_ocaml\.\$PINNED_JS_OF_OCAML_VERSION/);
	assert.match(bootstrapSource, /js_of_ocaml-compiler\.\$PINNED_JS_OF_OCAML_VERSION/);
	assert.match(
		bundlePreparationSource,
		/Filename\.chop_suffix \(Filename\.basename Sys\.argv\.\(i\)\) "\.wat"/
	);
	assert.match(bundlePreparationSource, /runtime_wasm_module_names: runtimeWasmModuleNamesPatch/);
});
