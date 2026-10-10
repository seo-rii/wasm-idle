#!/usr/bin/env node
// Rebuild the original, dependency-free aheui package with pinned setuptools and ZIP timestamps.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, 'runtimes', 'esolangs', 'aheui');
export const AHEUI_STATIC_DIR = path.join(root, 'static', 'wasm-aheui');

export const AHEUI_UPSTREAM_SOURCE = Object.freeze({
	project: 'aheui/rpaheui',
	commit: 'd11187ebcc40ff3f17ebf93c03275f2d85da5b79',
	version: '1.2.5',
	url: 'https://files.pythonhosted.org/packages/22/2b/590f8e8e9eeb2776fa6c0266f5ba7cc036cba9f73044f2bf99fa7cc80519/aheui-1.2.5.tar.gz',
	fileName: 'aheui-1.2.5.tar.gz',
	bytes: 25115,
	sha256: '641ecefacd92ca3304291f3c0abde24ca7189d1376f68bd55f1271cfe22a7256'
});

export const AHEUI_LICENSE_RECEIPT = Object.freeze({
	id: 'BSD-2-Clause',
	source: 'aheui-1.2.5/LICENSE',
	fileName: 'LICENSE.txt',
	bytes: 1327,
	sha256: 'f4e9082dee3473831e61076e7791220adf17375c59f7ea13835679b44a0cc493'
});

/** Must match WASM_AHEUI_WHEELS in src/lib/playground/wasmAheuiVersion.ts. */
export const AHEUI_WHEEL_RECEIPTS = Object.freeze([
	Object.freeze({
		fileName: 'aheui-1.2.5-py3-none-any.whl',
		bytes: 24259,
		sha256: '118d21234ba7e8252542286c825d01ea078b3b9468b56afdd1fae28238f869a3'
	})
]);

const AHEUI_BUILD_CONSTRAINTS = 'setuptools==84.0.0\n';
const AHEUI_SOURCE_DATE_EPOCH = '315532800';

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
		language: 'AHEUI',
		runtime: 'rpaheui on Pyodide',
		upstream: AHEUI_UPSTREAM_SOURCE,
		license: AHEUI_LICENSE_RECEIPT,
		build: {
			backend: 'setuptools==84.0.0',
			sourceDateEpoch: AHEUI_SOURCE_DATE_EPOCH,
			command: [
				'uv',
				'build',
				'--wheel',
				'--no-config',
				'--build-constraint',
				'build-constraints.txt',
				'--out-dir',
				'dist',
				AHEUI_UPSTREAM_SOURCE.fileName
			],
			modifications: []
		},
		wheels: AHEUI_WHEEL_RECEIPTS
	};
}

async function pinnedInputs() {
	const sourcePath = path.join(runtimeDir, 'vendor', AHEUI_UPSTREAM_SOURCE.fileName);
	const source = await readFile(sourcePath);
	assertReceipt(source, AHEUI_UPSTREAM_SOURCE);
	const license = await readFile(path.join(runtimeDir, 'LICENSE'));
	assertReceipt(license, AHEUI_LICENSE_RECEIPT);
	return { sourcePath, license };
}

/** Verify committed artifacts and source without a network request or Python toolchain. */
export async function checkAheuiWheels(staticDir = AHEUI_STATIC_DIR) {
	const { license } = await pinnedInputs();
	for (const receipt of AHEUI_WHEEL_RECEIPTS) {
		assertReceipt(await readFile(path.join(staticDir, receipt.fileName)), receipt);
	}
	assertReceipt(await readFile(path.join(staticDir, 'LICENSE.txt')), AHEUI_LICENSE_RECEIPT);
	if (!(await readFile(path.join(staticDir, 'LICENSE.txt'))).equals(license)) {
		throw new Error('Aheui distributed license differs from the original license');
	}
	const actual = JSON.parse(await readFile(path.join(staticDir, 'runtime-build.json'), 'utf8'));
	if (JSON.stringify(actual) !== JSON.stringify(buildReceipt())) {
		throw new Error('Aheui runtime build receipt differs from the pinned build');
	}
}

/** Rebuild in isolation and require byte-for-byte identity before writing runtime artifacts. */
export async function syncAheuiWheels(staticDir = AHEUI_STATIC_DIR) {
	const { sourcePath, license } = await pinnedInputs();
	const work = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-aheui-'));
	try {
		const constraintsPath = path.join(work, 'build-constraints.txt');
		await writeFile(constraintsPath, AHEUI_BUILD_CONSTRAINTS);
		const outDir = path.join(work, 'dist');
		execFileSync(
			'uv',
			[
				'build',
				'--wheel',
				'--no-config',
				'--build-constraint',
				constraintsPath,
				'--out-dir',
				outDir,
				sourcePath
			],
			{
				stdio: 'inherit',
				env: { ...process.env, SOURCE_DATE_EPOCH: AHEUI_SOURCE_DATE_EPOCH }
			}
		);
		await mkdir(staticDir, { recursive: true });
		for (const receipt of AHEUI_WHEEL_RECEIPTS) {
			const wheel = await readFile(path.join(outDir, receipt.fileName));
			assertReceipt(wheel, receipt);
			await writeFile(path.join(staticDir, receipt.fileName), wheel);
		}
		await writeFile(path.join(staticDir, 'LICENSE.txt'), license);
		await writeFile(
			path.join(staticDir, 'runtime-build.json'),
			`${JSON.stringify(buildReceipt(), null, 2)}\n`
		);
		await checkAheuiWheels(staticDir);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		await checkAheuiWheels();
		console.log('static/wasm-aheui source and wheels match their pinned receipts');
	} else {
		await syncAheuiWheels();
		console.log(`Synced Aheui wheels into ${AHEUI_STATIC_DIR}`);
	}
}
