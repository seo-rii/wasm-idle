import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { syncWasmOfJsOfOcamlDist } from './sync-wasm-of-js-of-ocaml.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCER_ROOT = path.join(REPO_ROOT, 'runtimes', 'wasm-of-js-of-ocaml');
const producerRequire = createRequire(path.join(PRODUCER_ROOT, 'package.json'));
const execFileAsync = promisify(execFile);

/**
 * Combine receipt-verified native compiler inputs with the tracked, rebuildable
 * browser adapter. Never replace input receipts with hashes of derived output.
 * @param {{ sourceRoot: string; staticDir: string; versionModulePath?: string }} options
 */
export async function prepareOcamlBrowserWrapper({ sourceRoot, staticDir, versionModulePath }) {
	const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-ocaml-wrapper-'));
	try {
		const sourceBrowserDistDir = path.join(temporaryDir, 'browser');
		await execFileAsync(
			process.execPath,
			[
				producerRequire.resolve('typescript/lib/tsc.js'),
				'--project',
				path.join(PRODUCER_ROOT, 'tsconfig.browser-harness.json'),
				'--outDir',
				sourceBrowserDistDir
			],
			{ cwd: PRODUCER_ROOT, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
		);
		return await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir: path.join(sourceRoot, 'wasm-of-js-of-ocaml/browser-native-bundle'),
			targetBrowserDistDir: path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native'),
			targetBundleDir: path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native-bundle'),
			...(versionModulePath ? { versionModulePath } : {})
		});
	} finally {
		await rm(temporaryDir, { recursive: true, force: true });
	}
}
