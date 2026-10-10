#!/usr/bin/env node
// Distribute the unchanged upstream GolfScript interpreter; no Ruby toolchain is needed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, 'runtimes', 'esolangs', 'golfscript');
export const GOLFSCRIPT_STATIC_DIR = path.join(root, 'static', 'wasm-golfscript');

export const GOLFSCRIPT_UPSTREAM_SOURCE = Object.freeze({
	project: 'darrenks/golfscript',
	commit: 'cded542533c2c8f72ab2d5935714f739b0357690',
	url: 'https://raw.githubusercontent.com/darrenks/golfscript/cded542533c2c8f72ab2d5935714f739b0357690/golfscript.rb',
	fileName: 'golfscript.rb',
	bytes: 19231,
	sha256: '84f932a624b19afe6ef2a3ebe09a9b832f765a87460a79cde22323615c468f38'
});

export const GOLFSCRIPT_LICENSE_RECEIPT = Object.freeze({
	fileName: 'LICENSE.txt',
	bytes: 50,
	sha256: '9c3a7b19bfaba2e3d2a16857d7ab43b5448694ed6c11a565d4fb30df02671372'
});

/** @param {Uint8Array} bytes @param {{ fileName: string; bytes: number; sha256: string }} receipt */
export function assertReceipt(bytes, receipt) {
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (bytes.length !== receipt.bytes || digest !== receipt.sha256) {
		throw new Error(
			`${receipt.fileName} receipt mismatch: expected ${receipt.bytes} bytes/${receipt.sha256}, got ${bytes.length} bytes/${digest}`
		);
	}
}

function buildReceipt() {
	return {
		schemaVersion: 1,
		language: 'GOLFSCRIPT',
		runtime: 'Original GolfScript interpreter on the bundled Ruby/WASI VM',
		upstream: GOLFSCRIPT_UPSTREAM_SOURCE,
		license: {
			spdx: 'MIT',
			notice: GOLFSCRIPT_LICENSE_RECEIPT,
			source: 'Unchanged copyright and license declaration from golfscript.rb lines 3–4'
		},
		build: { operation: 'copy-unchanged-upstream', modifications: [] },
		artifacts: [GOLFSCRIPT_UPSTREAM_SOURCE]
	};
}

async function pinnedInputs() {
	const source = await readFile(path.join(runtimeDir, 'vendor', 'golfscript.rb'));
	assertReceipt(source, GOLFSCRIPT_UPSTREAM_SOURCE);
	const license = await readFile(path.join(runtimeDir, 'LICENSE.txt'));
	assertReceipt(license, GOLFSCRIPT_LICENSE_RECEIPT);
	const header = Buffer.from(source.toString('utf8').split('\n').slice(2, 4).join('\n') + '\n');
	if (!header.equals(license)) {
		throw new Error(
			'GolfScript license notice differs from the unchanged upstream source header'
		);
	}
	return { source, license };
}

/** Verify committed source, copyright notice, and artifacts entirely offline. */
export async function checkGolfscriptRuntime(staticDir = GOLFSCRIPT_STATIC_DIR) {
	const { source, license } = await pinnedInputs();
	const distributed = await readFile(path.join(staticDir, 'golfscript.rb'));
	assertReceipt(distributed, GOLFSCRIPT_UPSTREAM_SOURCE);
	if (!distributed.equals(source)) {
		throw new Error(
			'GolfScript distributed interpreter differs from the unchanged upstream source'
		);
	}
	const distributedLicense = await readFile(path.join(staticDir, 'LICENSE.txt'));
	assertReceipt(distributedLicense, GOLFSCRIPT_LICENSE_RECEIPT);
	if (!distributedLicense.equals(license)) {
		throw new Error('GolfScript distributed copyright notice differs from the upstream header');
	}
	const actual = JSON.parse(await readFile(path.join(staticDir, 'runtime-build.json'), 'utf8'));
	if (JSON.stringify(actual) !== JSON.stringify(buildReceipt())) {
		throw new Error('GolfScript runtime receipt differs from the pinned distribution');
	}
}

/** Reproducibly copy only byte-verified inputs and write their provenance receipt. */
export async function syncGolfscriptRuntime(staticDir = GOLFSCRIPT_STATIC_DIR) {
	const { source, license } = await pinnedInputs();
	await mkdir(staticDir, { recursive: true });
	await writeFile(path.join(staticDir, 'golfscript.rb'), source);
	await writeFile(path.join(staticDir, 'LICENSE.txt'), license);
	await writeFile(
		path.join(staticDir, 'runtime-build.json'),
		`${JSON.stringify(buildReceipt(), null, 2)}\n`
	);
	await checkGolfscriptRuntime(staticDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		await checkGolfscriptRuntime();
		console.log(
			'static/wasm-golfscript interpreter and copyright notice match their pinned receipts'
		);
	} else {
		await syncGolfscriptRuntime();
		console.log(`Synced GolfScript interpreter into ${GOLFSCRIPT_STATIC_DIR}`);
	}
}
