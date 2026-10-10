#!/usr/bin/env node
// Build the unchanged upstream APECode package with pinned metadata and ZIP timestamps.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, 'runtimes', 'esolangs', 'apecode');
export const APECODE_STATIC_DIR = path.join(root, 'static', 'wasm-apecode');

export const APECODE_UPSTREAM_SOURCE = Object.freeze({
	project: 'seo-rii/apecode',
	commit: 'c7ae98d3dfc1713ecc800422a4c815628776e1e2',
	version: '0.1.0',
	url: 'https://codeload.github.com/seo-rii/apecode/tar.gz/c7ae98d3dfc1713ecc800422a4c815628776e1e2',
	fileName: 'apecode-c7ae98d3dfc1713ecc800422a4c815628776e1e2.tar.gz',
	bytes: 7277,
	sha256: '0ff71e149ec49a94211bb44b6a3d55e1290acb1387ca4f5f76a8f42f568ae629'
});

export const APECODE_LICENSE_NOTICE_RECEIPT = Object.freeze({
	fileName: 'UPSTREAM-LICENSE-NOTICE.txt',
	bytes: 469,
	sha256: 'a8712f9407baa9a6db8b8bce91475c42b0e975080782719522e2d83abe840669'
});

/** Must match WASM_APECODE_WHEELS in src/lib/playground/wasmApecodeVersion.ts. */
export const APECODE_WHEEL_RECEIPTS = Object.freeze([
	Object.freeze({
		fileName: 'apecode-0.1.0-py3-none-any.whl',
		bytes: 7484,
		sha256: '30aecb8eeff9a40cd55bb5fe5c18104f6c8308bdba9e71ac0b95d077badae30c'
	})
]);

const APECODE_BUILD_CONSTRAINTS = 'setuptools==84.0.0\n';
const APECODE_SOURCE_DATE_EPOCH = '315532800';

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
		language: 'APECODE',
		runtime: 'Original APECode interpreter on Pyodide',
		upstream: APECODE_UPSTREAM_SOURCE,
		license: { status: 'not-declared-by-upstream', notice: APECODE_LICENSE_NOTICE_RECEIPT },
		build: {
			backend: 'setuptools==84.0.0',
			sourceDateEpoch: APECODE_SOURCE_DATE_EPOCH,
			command: [
				'uv',
				'build',
				'--wheel',
				'--no-config',
				'--build-constraint',
				'build-constraints.txt',
				'--out-dir',
				'dist',
				APECODE_UPSTREAM_SOURCE.fileName
			],
			modifications: []
		},
		wheels: APECODE_WHEEL_RECEIPTS
	};
}

async function pinnedInputs() {
	const sourcePath = path.join(runtimeDir, 'vendor', APECODE_UPSTREAM_SOURCE.fileName);
	assertReceipt(await readFile(sourcePath), APECODE_UPSTREAM_SOURCE);
	const notice = await readFile(path.join(runtimeDir, APECODE_LICENSE_NOTICE_RECEIPT.fileName));
	assertReceipt(notice, APECODE_LICENSE_NOTICE_RECEIPT);
	return { sourcePath, notice };
}

/** Verify committed inputs and artifacts without a network request or Python toolchain. */
export async function checkApecodeWheels(staticDir = APECODE_STATIC_DIR) {
	const { notice } = await pinnedInputs();
	for (const receipt of APECODE_WHEEL_RECEIPTS) {
		assertReceipt(await readFile(path.join(staticDir, receipt.fileName)), receipt);
	}
	const distributedNotice = await readFile(
		path.join(staticDir, APECODE_LICENSE_NOTICE_RECEIPT.fileName)
	);
	assertReceipt(distributedNotice, APECODE_LICENSE_NOTICE_RECEIPT);
	if (!distributedNotice.equals(notice)) {
		throw new Error(
			'APECode distributed upstream license notice differs from the original notice'
		);
	}
	const actual = JSON.parse(await readFile(path.join(staticDir, 'runtime-build.json'), 'utf8'));
	if (JSON.stringify(actual) !== JSON.stringify(buildReceipt())) {
		throw new Error('APECode runtime build receipt differs from the pinned build');
	}
}

/** Rebuild in isolation and require exact identity before writing runtime artifacts. */
export async function syncApecodeWheels(staticDir = APECODE_STATIC_DIR) {
	const { sourcePath, notice } = await pinnedInputs();
	const work = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-apecode-'));
	try {
		const constraintsPath = path.join(work, 'build-constraints.txt');
		await writeFile(constraintsPath, APECODE_BUILD_CONSTRAINTS);
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
				env: { ...process.env, SOURCE_DATE_EPOCH: APECODE_SOURCE_DATE_EPOCH }
			}
		);
		await mkdir(staticDir, { recursive: true });
		for (const receipt of APECODE_WHEEL_RECEIPTS) {
			const wheel = await readFile(path.join(outDir, receipt.fileName));
			assertReceipt(wheel, receipt);
			await writeFile(path.join(staticDir, receipt.fileName), wheel);
		}
		await writeFile(path.join(staticDir, APECODE_LICENSE_NOTICE_RECEIPT.fileName), notice);
		await writeFile(
			path.join(staticDir, 'runtime-build.json'),
			`${JSON.stringify(buildReceipt(), null, 2)}\n`
		);
		await checkApecodeWheels(staticDir);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		await checkApecodeWheels();
		console.log('static/wasm-apecode source and wheels match their pinned receipts');
	} else {
		await syncApecodeWheels();
		console.log(`Synced APECode wheels into ${APECODE_STATIC_DIR}`);
	}
}
