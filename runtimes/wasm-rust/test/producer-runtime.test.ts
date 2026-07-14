import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyProducerOutput } from '../scripts/prepare-producer-runtime.mjs';

const tempRoots: string[] = [];
const targets = ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'];

async function createProducerFixture() {
	const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-producer-output-'));
	tempRoots.push(outputRoot);
	const files = new Map([
		['rust/bin/rustc.wasm', new Uint8Array([0x00, 0x61, 0x73, 0x6d])],
		...targets.map(
			(target, index) =>
				[`rust/lib/rustlib/${target}/lib/libstd.rlib`, new Uint8Array([index + 1])] as const
		)
	]);
	const assets = [];
	for (const [relativePath, bytes] of files) {
		const filePath = path.join(outputRoot, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, bytes);
		assets.push({
			path: relativePath,
			size: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
	}
	const sources = {
		rust: {
			commit: 'a'.repeat(40),
			tree: 'b'.repeat(40),
			patchedTree: 'c'.repeat(40),
			patchSha256: 'd'.repeat(64),
			submodules: [] as Array<{
				path: string;
				repository: string;
				commit: string;
				tree: string;
			}>
		}
	};
	const lock = {
		producerId: '@seo-rii/wasm-llvm/rust-browser',
		manifestSha256: 'e'.repeat(64),
		sourceDateEpoch: 1_783_912_447,
		environment: { platform: 'linux/amd64' },
		hostTools: [{ command: 'node', args: ['--version'], firstLine: 'v24.1.0' }],
		sources
	};
	await fs.writeFile(
		path.join(outputRoot, 'producer-receipt.json'),
		JSON.stringify({
			schemaVersion: 1,
			producerId: lock.producerId,
			manifestSha256: lock.manifestSha256,
			sourceDateEpoch: lock.sourceDateEpoch,
			runner: 'container',
			environment: lock.environment,
			hostTools: lock.hostTools,
			sources,
			assets
		})
	);
	return { outputRoot, lock };
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
	);
});

describe('wasm-llvm producer runtime packaging', () => {
	it('verifies the locked receipt and every producer output hash', async () => {
		const { outputRoot, lock } = await createProducerFixture();

		await expect(verifyProducerOutput(outputRoot, lock)).resolves.toMatchObject({
			producerId: lock.producerId,
			runner: 'container'
		});
	});

	it('ignores JSON key order when comparing locked submodules', async () => {
		const { outputRoot, lock } = await createProducerFixture();
		lock.sources.rust.submodules = [
			{
				path: 'library/backtrace',
				repository: 'https://example.test/backtrace.git',
				commit: 'f'.repeat(40),
				tree: '0'.repeat(40)
			}
		];
		const receiptPath = path.join(outputRoot, 'producer-receipt.json');
		const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
		receipt.sources.rust.submodules = [
			{
				commit: 'f'.repeat(40),
				path: 'library/backtrace',
				repository: 'https://example.test/backtrace.git',
				tree: '0'.repeat(40)
			}
		];
		await fs.writeFile(receiptPath, JSON.stringify(receipt));

		await expect(verifyProducerOutput(outputRoot, lock)).resolves.toMatchObject({
			producerId: lock.producerId
		});
	});

	it('rejects a producer asset changed after attestation', async () => {
		const { outputRoot, lock } = await createProducerFixture();
		await fs.writeFile(path.join(outputRoot, 'rust', 'bin', 'rustc.wasm'), 'tampered');

		await expect(verifyProducerOutput(outputRoot, lock)).rejects.toThrow(
			/producer asset hash mismatch/
		);
	});

	it('rejects a receipt from a different build environment', async () => {
		const { outputRoot, lock } = await createProducerFixture();
		const receiptPath = path.join(outputRoot, 'producer-receipt.json');
		const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
		receipt.environment.platform = 'linux/arm64';
		await fs.writeFile(receiptPath, JSON.stringify(receipt));

		await expect(verifyProducerOutput(outputRoot, lock)).rejects.toThrow(
			/producer receipt environment does not match/
		);
	});
});
