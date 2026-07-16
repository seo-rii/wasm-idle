#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OCAML_RUNTIME_DIR = 'runtimes/wasm-of-js-of-ocaml';

function pnpmCommand() {
	return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(command, args, cwd = REPO_ROOT) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: 'inherit',
			env: process.env
		});
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with code ${String(code)}`}`
				)
			);
		});
	});
}

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

await run(pnpmCommand(), ['--dir', 'runtimes/wasm-typescript', 'build']);
await run(pnpmCommand(), ['--dir', OCAML_RUNTIME_DIR, 'build']);

const ocamlBundleDir = path.join(
	REPO_ROOT,
	'runtimes',
	'wasm-of-js-of-ocaml',
	'.cache',
	'browser-native-bundle'
);
const requiredOcamlBundleFiles = [
	'browser-native-manifest.v1.json',
	'browser-native-runtime-pack.v1.bin.gz',
	'browser-native-runtime-pack.v1.index.json',
	'tools/ocamlc.byte.browser.js',
	'tools/js_of_ocaml.bc.browser.js',
	'tools/wasm_of_ocaml.bc.browser.js',
	'tools/wasm-opt.browser.js',
	'tools/wasm-merge.browser.js',
	'tools/wasm-metadce.browser.js'
];
let hasOcamlBundle = true;
for (const relativePath of requiredOcamlBundleFiles) {
	if (!(await fileExists(path.join(ocamlBundleDir, relativePath)))) {
		hasOcamlBundle = false;
		break;
	}
}

if (process.env.WASM_IDLE_PAGE_FORCE_OCAML_NATIVE === '1' || !hasOcamlBundle) {
	await run(pnpmCommand(), ['--dir', OCAML_RUNTIME_DIR, 'run', 'bootstrap:host-tools']);
	await run(pnpmCommand(), ['--dir', OCAML_RUNTIME_DIR, 'run', 'toolchain:bootstrap']);
	await run(pnpmCommand(), [
		'--dir',
		OCAML_RUNTIME_DIR,
		'exec',
		'node',
		'./scripts/prepare-browser-native.mjs'
	]);
} else {
	console.log(`Using existing wasm-of-js-of-ocaml browser-native bundle at ${ocamlBundleDir}`);
}
