import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmBashAssets } from '../../scripts/sync-wasm-bash.mjs';
import { WASM_BASH_ASSET_VERSION, WASM_BASH_WEBC_RECEIPT } from './playground/wasmBashVersion';

const temporaryDirectories: string[] = [];
const repositoryRoot = process.cwd();
const sourceRevision = 'fc8096485478055f4fcf31402004fdd8ff6b72b7';

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-bash-receipt-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'wasmBashVersion.ts');
	await mkdir(sourceDir, { recursive: true });
	const webc = new TextEncoder().encode('fixture Bash WEBc package');
	const license = new TextEncoder().encode('fixture license');
	await writeFile(path.join(sourceDir, 'bash.webc'), webc);
	await writeFile(path.join(sourceDir, 'LICENSE.txt'), license);
	await writeFile(
		path.join(sourceDir, 'runtime-build.json'),
		`${JSON.stringify(
			{
				package: 'wasmer/bash',
				packageVersion: 'fixture',
				sourceRevision,
				webcBytes: webc.byteLength,
				webcSha256: sha256(webc),
				licenseSha256: sha256(license)
			},
			null,
			2
		)}\n`
	);
	return { sourceDir, targetDir, versionModulePath, webc };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmBashAssets', () => {
	it('generates the browser-consumed WEBc receipt from verified producer metadata', async () => {
		const fixture = await createFixture();
		const result = await syncWasmBashAssets(fixture);
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');

		expect(result.webcReceipt).toEqual({
			bytes: fixture.webc.byteLength,
			sha256: sha256(fixture.webc)
		});
		expect(versionModule).toContain(`bytes: ${fixture.webc.byteLength}`);
		expect(versionModule).toContain(`sha256: '${sha256(fixture.webc)}'`);
		expect(
			JSON.parse(
				await readFile(path.join(fixture.targetDir, 'runtime-manifest.v1.json'), 'utf8')
			)
		).toMatchObject({
			format: 'wasm-bash-runtime-manifest-v1',
			fingerprint: result.fingerprint
		});
	});

	it('generates the receipt from the verified installation snapshot when the source changes', async () => {
		const fixture = await createFixture();
		const replacementWebc = new TextEncoder().encode('replacement Bash WEBc package');
		let replaced = false;
		const result = await syncWasmBashAssets({
			...fixture,
			copyAsset: async (...args) => {
				await cp(...args);
				const source = String(args[0]);
				if (replaced || path.basename(source) !== 'LICENSE.txt') return;
				replaced = true;
				const license = await readFile(path.join(fixture.sourceDir, 'LICENSE.txt'));
				await writeFile(path.join(fixture.sourceDir, 'bash.webc'), replacementWebc);
				await writeFile(
					path.join(fixture.sourceDir, 'runtime-build.json'),
					`${JSON.stringify(
						{
							package: 'wasmer/bash',
							packageVersion: 'replacement',
							sourceRevision,
							webcBytes: replacementWebc.byteLength,
							webcSha256: sha256(replacementWebc),
							licenseSha256: sha256(license)
						},
						null,
						2
					)}\n`
				);
			}
		});
		const installedWebc = await readFile(path.join(fixture.targetDir, 'bash.webc'));
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v1.json'), 'utf8')
		);

		expect(replaced).toBe(true);
		expect(Array.from(installedWebc)).toEqual(Array.from(replacementWebc));
		expect(result.webcReceipt).toEqual({
			bytes: replacementWebc.byteLength,
			sha256: sha256(replacementWebc)
		});
		expect(versionModule).toContain(`bytes: ${replacementWebc.byteLength}`);
		expect(versionModule).toContain(`sha256: '${sha256(replacementWebc)}'`);
		expect(manifest).toMatchObject({ packageVersion: 'replacement' });
	});

	it('pins the checked-in compressed WEBc to the producer receipt and generated constants', async () => {
		const metadata = JSON.parse(
			await readFile(path.join(repositoryRoot, 'static/wasm-bash/runtime-build.json'), 'utf8')
		);
		const logicalBytes = gunzipSync(
			await readFile(path.join(repositoryRoot, 'static/wasm-bash/bash.webc.gz'))
		);
		const actualReceipt = {
			bytes: logicalBytes.byteLength,
			sha256: sha256(logicalBytes)
		};

		expect(actualReceipt).toEqual(WASM_BASH_WEBC_RECEIPT);
		expect(metadata).toMatchObject({
			webcBytes: WASM_BASH_WEBC_RECEIPT.bytes,
			webcSha256: WASM_BASH_WEBC_RECEIPT.sha256
		});
		expect(WASM_BASH_ASSET_VERSION).toMatch(/^[a-f0-9]{16}$/u);
	});
});
