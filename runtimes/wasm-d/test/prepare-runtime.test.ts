import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	D_PRODUCER_ARTIFACTS,
	prepareDProducerRuntime,
	verifyDProducerArtifacts
} from '../scripts/prepare-runtime.mjs';
import { sha256, writeProducerReceipt } from './producer-fixture.js';

const tempDirs: string[] = [];
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-d-consumer-test-'));
	tempDirs.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	for (const asset of D_PRODUCER_ARTIFACTS) {
		const destination = path.join(sourceDir, asset);
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, asset.endsWith('.gz') ? gzipSync(asset) : Buffer.from(asset));
	}
	await mkdir(targetDir);
	await writeFile(path.join(targetDir, 'preserved.txt'), 'previous runtime');
	const lock = await writeProducerReceipt(sourceDir);
	return { sourceDir, targetDir, lock };
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('pinned wasm-llvm D artifact consumer', () => {
	it('imports exactly the verified producer outputs and its source receipt', async () => {
		const options = await fixture();
		await writeFile(path.join(options.sourceDir, 'untrusted-extra.js'), 'ignored');
		await prepareDProducerRuntime(options);
		for (const asset of [...D_PRODUCER_ARTIFACTS, 'producer-receipt.json']) {
			expect(await readFile(path.join(options.targetDir, asset))).toEqual(
				await readFile(path.join(options.sourceDir, asset))
			);
		}
		await expect(
			readFile(path.join(options.targetDir, 'untrusted-extra.js'))
		).rejects.toThrow();
		await expect(readFile(path.join(options.targetDir, 'preserved.txt'))).rejects.toThrow();
	});

	it('rejects altered artifact bytes before replacing the installed runtime', async () => {
		const options = await fixture();
		await writeFile(path.join(options.sourceDir, 'bin/ldc2.wasm.gz'), gzipSync('tampered'));
		await expect(prepareDProducerRuntime(options)).rejects.toThrow(
			'artifact integrity mismatch'
		);
		expect(await readFile(path.join(options.targetDir, 'preserved.txt'), 'utf8')).toBe(
			'previous runtime'
		);
	});

	it('rejects a self-receipted replacement even when its producer metadata still matches', async () => {
		const options = await fixture();
		await writeFile(path.join(options.sourceDir, 'bin/ldc2.wasm.gz'), gzipSync('replacement'));
		await writeProducerReceipt(options.sourceDir);
		await expect(prepareDProducerRuntime(options)).rejects.toThrow(
			'receipt integrity mismatch'
		);
		expect(await readFile(path.join(options.targetDir, 'preserved.txt'), 'utf8')).toBe(
			'previous runtime'
		);
	});

	it('validates logical gzip digests and the exact artifact set', async () => {
		const options = await fixture();
		const receiptPath = path.join(options.sourceDir, 'producer-receipt.json');
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
		receipt.artifacts[0].uncompressedSha256 = 'f'.repeat(64);
		const changed = Buffer.from(JSON.stringify(receipt));
		await writeFile(receiptPath, changed);
		await expect(
			verifyDProducerArtifacts(options.sourceDir, {
				...options.lock,
				receiptSha256: sha256(changed)
			})
		).rejects.toThrow('logical integrity mismatch');
		receipt.artifacts[0].path = '../escape';
		const escaped = Buffer.from(JSON.stringify(receipt));
		await writeFile(receiptPath, escaped);
		await expect(
			verifyDProducerArtifacts(options.sourceDir, {
				...options.lock,
				receiptSha256: sha256(escaped)
			})
		).rejects.toThrow('exactly the required');
	});

	it('requires an explicit producer directory and forbids in-place replacement', async () => {
		await expect(prepareDProducerRuntime({ targetDir: '/unused' })).rejects.toThrow(
			'WASM_LLVM_D_ARTIFACT_DIR'
		);
		const options = await fixture();
		await expect(
			prepareDProducerRuntime({ ...options, targetDir: options.sourceDir })
		).rejects.toThrow('must differ');
	});
});
