#!/usr/bin/env node
// Reproduces static/wasm-hy/ from pinned upstream PyPI sources.
//
// funcparserlib ships an upstream pure-Python wheel. Hy 1.3.1 is published only as an sdist, so the
// wheel is rebuilt with a pinned setuptools and SOURCE_DATE_EPOCH; the resulting bytes must match the
// committed receipt. `--check` only verifies the committed wheels and never touches the network.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HY_STATIC_DIR = path.join(root, 'static', 'wasm-hy');
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const HY_UPSTREAM_SOURCES = Object.freeze({
	hySdist: {
		url: 'https://files.pythonhosted.org/packages/source/h/hy/hy-1.3.1.tar.gz',
		fileName: 'hy-1.3.1.tar.gz',
		bytes: 126935,
		sha256: 'cf7b85fc59079b5da794c7ecaafc6a6e9140f73305af03836c3d52cf978b6645'
	},
	funcparserlibWheel: {
		url: 'https://files.pythonhosted.org/packages/py2.py3/f/funcparserlib/funcparserlib-1.0.1-py2.py3-none-any.whl',
		fileName: 'funcparserlib-1.0.1-py2.py3-none-any.whl',
		bytes: 17842,
		sha256: '95da15d3f0d00b9b6f4bf04005c708af3faa115f7b45692ace064ebe758c68e8'
	}
});

/** Committed wheels; must equal WASM_HY_WHEELS in src/lib/playground/wasmHyVersion.ts. */
export const HY_WHEEL_RECEIPTS = Object.freeze([
	{
		fileName: 'funcparserlib-1.0.1-py2.py3-none-any.whl',
		bytes: 17842,
		sha256: '95da15d3f0d00b9b6f4bf04005c708af3faa115f7b45692ace064ebe758c68e8'
	},
	{
		fileName: 'hy-1.3.1-py3-none-any.whl',
		bytes: 122343,
		sha256: 'fef54e98b2080cd3993d5ce5a4310ef2b0fc756c972203b86fedc0e0f2908f53'
	}
]);

const HY_BUILD_CONSTRAINTS = 'setuptools==84.0.0\n';
const HY_SOURCE_DATE_EPOCH = '315532800';

/** @param {Uint8Array} bytes @param {{ fileName: string; bytes: number; sha256: string }} receipt */
export function assertReceipt(bytes, receipt) {
	const actual = { bytes: bytes.length, sha256: sha256(bytes) };
	if (actual.bytes !== receipt.bytes || actual.sha256 !== receipt.sha256) {
		throw new Error(
			`${receipt.fileName} receipt mismatch: expected ${receipt.bytes} bytes/${receipt.sha256}, got ${actual.bytes} bytes/${actual.sha256}`
		);
	}
}

export async function checkHyWheels(staticDir = HY_STATIC_DIR) {
	for (const receipt of HY_WHEEL_RECEIPTS) {
		assertReceipt(await readFile(path.join(staticDir, receipt.fileName)), receipt);
	}
}

/** @param {{ url: string; fileName: string; bytes: number; sha256: string }} source */
async function download(source) {
	const response = await fetch(source.url);
	if (!response.ok) throw new Error(`${source.url} failed with HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	assertReceipt(bytes, source);
	return bytes;
}

export async function syncHyWheels(staticDir = HY_STATIC_DIR) {
	const work = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-hy-'));
	try {
		const sdistPath = path.join(work, HY_UPSTREAM_SOURCES.hySdist.fileName);
		await writeFile(sdistPath, await download(HY_UPSTREAM_SOURCES.hySdist));
		const funcparserlib = await download(HY_UPSTREAM_SOURCES.funcparserlibWheel);
		const constraintsPath = path.join(work, 'build-constraints.txt');
		await writeFile(constraintsPath, HY_BUILD_CONSTRAINTS);
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
				sdistPath
			],
			{
				stdio: 'inherit',
				env: { ...process.env, SOURCE_DATE_EPOCH: HY_SOURCE_DATE_EPOCH }
			}
		);
		const hyReceipt = HY_WHEEL_RECEIPTS.find((receipt) => receipt.fileName.startsWith('hy-'));
		if (!hyReceipt) throw new Error('Hy wheel receipt is missing');
		const hyWheel = await readFile(path.join(outDir, hyReceipt.fileName));
		assertReceipt(hyWheel, hyReceipt);
		await mkdir(staticDir, { recursive: true });
		await writeFile(path.join(staticDir, hyReceipt.fileName), hyWheel);
		await writeFile(
			path.join(staticDir, HY_UPSTREAM_SOURCES.funcparserlibWheel.fileName),
			funcparserlib
		);
		await checkHyWheels(staticDir);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) {
		await checkHyWheels();
		console.log('static/wasm-hy wheels match their pinned receipts');
	} else {
		await syncHyWheels();
		console.log(`Synced Hy wheels into ${HY_STATIC_DIR}`);
	}
}
