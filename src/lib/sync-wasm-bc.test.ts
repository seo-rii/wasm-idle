// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncWasmBcAssets } from '../../scripts/sync-wasm-bc.mjs';

const sourceDir = path.resolve('static/wasm-bc');

async function withCopy(action: (directory: string, versionFile: string) => Promise<void>) {
	const directory = await mkdtemp(path.join(tmpdir(), 'bc-sync-test-'));
	const versionFile = path.join(directory, 'version.ts');
	try {
		await syncWasmBcAssets({
			sourceDir,
			targetDir: directory,
			versionModulePath: versionFile
		});
		await action(directory, versionFile);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe('original Bc runtime distribution', () => {
	it('verifies the committed interpreter, source/build inputs and generated profile', async () => {
		const result = await syncWasmBcAssets({ check: true });
		expect(result.bytes).toBeGreaterThan(8);
		expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
	});

	it('rejects corrupt runtime bytes without replacing the generated profile', async () => {
		await withCopy(async (directory, versionModulePath) => {
			const before = await readFile(versionModulePath);
			const wasm = await readFile(path.join(directory, 'bc.wasm'));
			wasm[wasm.length - 1] ^= 1;
			await writeFile(path.join(directory, 'bc.wasm'), wasm);
			await expect(
				syncWasmBcAssets({ targetDir: directory, versionModulePath })
			).rejects.toThrow('producer receipt');
			expect(await readFile(versionModulePath)).toEqual(before);
		});
	});

	it('rejects a stale producer source receipt and a substituted implementation', async () => {
		await withCopy(async (directory, versionModulePath) => {
			const file = path.join(directory, 'runtime-build.json');
			const original = JSON.parse(await readFile(file, 'utf8'));
			const stale = structuredClone(original);
			stale.producer.inputs['build.py'].sha256 = '0'.repeat(64);
			await writeFile(file, JSON.stringify(stale));
			await expect(
				syncWasmBcAssets({ targetDir: directory, versionModulePath })
			).rejects.toThrow('producer input changed');
			original.implementation.version = 'another-runtime';
			await writeFile(file, JSON.stringify(original));
			await expect(
				syncWasmBcAssets({ targetDir: directory, versionModulePath })
			).rejects.toThrow('pinned original');
		});
	});

	it('detects modified copyright notices', async () => {
		await withCopy(async (directory, versionModulePath) => {
			await writeFile(path.join(directory, 'THIRD_PARTY_NOTICES.txt'), 'changed');
			await expect(
				syncWasmBcAssets({ targetDir: directory, versionModulePath })
			).rejects.toThrow('THIRD_PARTY_NOTICES.txt');
		});
	});
});
