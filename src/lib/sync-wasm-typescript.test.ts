import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmTypeScriptDist } from '../../scripts/sync-wasm-typescript.mjs';
import {
	WASM_TYPESCRIPT_ASSET_VERSION,
	WASM_TYPESCRIPT_MODULE_RECEIPT
} from './playground/wasmTypeScriptVersion';

const temporaryDirectories: string[] = [];
const repositoryRoot = process.cwd();

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-typescript-receipt-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'wasmTypeScriptVersion.ts');
	await mkdir(sourceDir, { recursive: true });
	return { sourceDir, targetDir, versionModulePath };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmTypeScriptDist', () => {
	it('publishes a deterministic logical module receipt and pinned constants', async () => {
		const fixture = await createFixture();
		const moduleSource = 'export const answer = 42;\n';
		const moduleBytes = new TextEncoder().encode(moduleSource);
		const moduleSha256 = createHash('sha256').update(moduleBytes).digest('hex');
		await writeFile(path.join(fixture.sourceDir, 'index.js'), moduleBytes);
		await writeFile(
			path.join(fixture.sourceDir, 'index.d.ts'),
			'export declare const answer = 42;\n'
		);

		const first = await syncWasmTypeScriptDist(fixture);
		const receipt = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')
		);
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');

		expect(receipt).toEqual({
			format: 'wasm-typescript-runtime-build-v1',
			fingerprint: first.fingerprint,
			assets: {
				'index.js': {
					bytes: moduleBytes.byteLength,
					sha256: moduleSha256
				}
			}
		});
		expect(first.moduleReceipt).toEqual(receipt.assets['index.js']);
		expect(versionModule).toContain(
			`export const WASM_TYPESCRIPT_ASSET_VERSION = '${first.fingerprint}';`
		);
		expect(versionModule).toContain(`bytes: ${moduleBytes.byteLength}`);
		expect(versionModule).toContain(`sha256: '${moduleSha256}'`);
		await expect(stat(path.join(fixture.targetDir, 'index.d.ts'))).rejects.toMatchObject({
			code: 'ENOENT'
		});

		await writeFile(path.join(fixture.targetDir, 'runtime-build.json'), '{}\n');
		const second = await syncWasmTypeScriptDist(fixture);
		expect(second).toEqual(first);
		expect(
			JSON.parse(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8'))
		).toEqual(receipt);
	});

	it('fails before replacing the target when the entry module is missing', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'keep.txt'), 'keep');

		await expect(syncWasmTypeScriptDist(fixture)).rejects.toThrow(
			'wasm-typescript dist entry was not found'
		);
		expect(await readFile(path.join(fixture.targetDir, 'keep.txt'), 'utf8')).toBe('keep');
	});

	it('pins the checked-in compressed bundle to its logical module receipt', async () => {
		const receipt = JSON.parse(
			await readFile(
				path.join(repositoryRoot, 'static/wasm-typescript/runtime-build.json'),
				'utf8'
			)
		);
		const compressed = await readFile(
			path.join(repositoryRoot, 'static/wasm-typescript/index.js.gz')
		);
		const moduleBytes = gunzipSync(compressed);
		const actualReceipt = {
			bytes: moduleBytes.byteLength,
			sha256: createHash('sha256').update(moduleBytes).digest('hex')
		};

		expect(receipt).toEqual({
			format: 'wasm-typescript-runtime-build-v1',
			fingerprint: WASM_TYPESCRIPT_ASSET_VERSION,
			assets: { 'index.js': WASM_TYPESCRIPT_MODULE_RECEIPT }
		});
		expect(actualReceipt).toEqual(WASM_TYPESCRIPT_MODULE_RECEIPT);
	});
});
