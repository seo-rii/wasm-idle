#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'static/wasm-sed');

export const SED_WASM_RECEIPT = Object.freeze({
	fileName: 'busybox.wasm',
	bytes: 634885,
	sha256: '30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40',
	url: 'https://raw.githubusercontent.com/seo-rii/wasm-idle/43241f14b7bd2257bbafb7426d52bc97f722a489/_ci/container/262d153656a34ecedced185e21010b6c45e1f16697a6cf27a5c9337db57e165b/container-app/objects/30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40/busybox.wasm'
});
const licenseReceipt = {
	fileName: 'LICENSE.txt',
	bytes: 18348,
	sha256: 'bbfc9843646d483c334664f651c208b9839626891d8f17604db2146962f43548'
};

/**
 * @param {Uint8Array} bytes
 * @param {{ fileName: string; bytes: number; sha256: string }} receipt
 */
export function verifySedAsset(bytes, receipt = SED_WASM_RECEIPT) {
	if (
		bytes.length !== receipt.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== receipt.sha256
	) {
		throw new Error(`sed ${receipt.fileName} does not match its pinned receipt`);
	}
}

async function buildReceipt() {
	const source = JSON.parse(
		await readFile(path.join(root, 'runtimes/wasm-busybox/manifest.json'), 'utf8')
	);
	return {
		schemaVersion: 1,
		language: 'SED',
		runtime: 'Unchanged BusyBox sed applet from the reviewed container WASI build',
		producer: {
			repository: 'https://github.com/seo-rii/wasm-idle',
			revision: '8ead09726cfed3c758c9a6b827bf1fa020549dd4',
			receiptSha256: 'a726fa35c9959dbe85c9dfec17ddad9004ef43c403658d71c2080180afa084ad'
		},
		source: source.source,
		config: source.config,
		patches: source.patches,
		license: { spdx: 'GPL-2.0-only', ...licenseReceipt },
		artifact: SED_WASM_RECEIPT,
		execution: {
			argv: ['sed', '-f', '<activePath>', '...programArgs'],
			filesystem: 'private source snapshot; existing files readonly; writes are not exported',
			cwd: '/',
			storedModes: 'unsupported; explicit negative WASI errno',
			inPlace: 'rejected by upstream WASI profile'
		}
	};
}

export async function checkSedRuntime(directory = staticDir) {
	verifySedAsset(await readFile(path.join(directory, 'busybox.wasm')));
	verifySedAsset(await readFile(path.join(directory, 'LICENSE.txt')), licenseReceipt);
	const actual = JSON.parse(await readFile(path.join(directory, 'runtime-build.json'), 'utf8'));
	if (JSON.stringify(actual) !== JSON.stringify(await buildReceipt())) {
		throw new Error('sed provenance differs from the pinned source/configuration');
	}
}

async function downloadPinnedRuntime() {
	const response = await fetch(SED_WASM_RECEIPT.url);
	if (!response.ok || !response.body)
		throw new Error(`sed download failed: HTTP ${response.status}`);
	const reader = response.body.getReader();
	const chunks = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > SED_WASM_RECEIPT.bytes)
				throw new Error('sed download exceeds pinned size');
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks);
}

/** @param {{ directory?: string; source?: string }} options */
export async function syncSedRuntime({ directory = staticDir, source } = {}) {
	let bytes;
	if (source) bytes = await readFile(source);
	else {
		try {
			bytes = await readFile(path.join(directory, 'busybox.wasm'));
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
				throw error;
			bytes = await downloadPinnedRuntime();
		}
	}
	verifySedAsset(bytes);
	const license = await readFile(path.join(root, 'runtimes/wasm-sed/LICENSE.txt'));
	verifySedAsset(license, licenseReceipt);
	await mkdir(directory, { recursive: true });
	await writeFile(path.join(directory, 'busybox.wasm'), bytes);
	await writeFile(path.join(directory, 'LICENSE.txt'), license);
	await writeFile(
		path.join(directory, 'runtime-build.json'),
		JSON.stringify(await buildReceipt(), null, 2) + '\n'
	);
	await checkSedRuntime(directory);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes('--check')) await checkSedRuntime();
	else {
		const sourceIndex = process.argv.indexOf('--source');
		await syncSedRuntime({
			source: sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined
		});
	}
	console.log('sed interpreter, license and provenance match the pinned BusyBox release');
}
