// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { preparePinnedAssets } from '../../scripts/prepare-pinned-assets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

async function createFixture(payload = Buffer.from('pinned asset fixture')) {
	const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-pinned-assets-'));
	temporaryDirectories.push(targetRoot);
	return {
		asset: {
			sourcePath: 'runtime/asset.wasm',
			targetPath: 'runtime/asset.wasm',
			size: payload.byteLength,
			sha256: createHash('sha256').update(payload).digest('hex')
		},
		payload,
		targetRoot
	};
}

async function prepareFixture(
	fixture: Awaited<ReturnType<typeof createFixture>>,
	fetchImpl: typeof fetch,
	maxAttempts = 3
) {
	return preparePinnedAssets({
		assets: [fixture.asset],
		targetRoot: fixture.targetRoot,
		sourceBaseUrl: 'https://assets.example.test/',
		label: 'test',
		userAgent: 'wasm-idle-test',
		fetchImpl,
		maxAttempts,
		retryDelayMs: 0
	});
}

describe('pinned asset retries', () => {
	it('retries a transient HTTP response and installs the verified asset', async () => {
		const fixture = await createFixture();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
			.mockResolvedValueOnce(new Response(fixture.payload));

		await expect(prepareFixture(fixture, fetchImpl)).resolves.toEqual({
			downloaded: 1,
			reused: 0
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(await readFile(path.join(fixture.targetRoot, fixture.asset.targetPath))).toEqual(
			fixture.payload
		);
	});

	it('retries a transport failure and installs the verified asset', async () => {
		const fixture = await createFixture();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError('fetch failed'))
			.mockResolvedValueOnce(new Response(fixture.payload));

		await expect(prepareFixture(fixture, fetchImpl)).resolves.toEqual({
			downloaded: 1,
			reused: 0
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('stops after the configured number of transient attempts', async () => {
		const fixture = await createFixture();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('temporarily unavailable', { status: 503 }));

		await expect(prepareFixture(fixture, fetchImpl, 3)).rejects.toThrow(
			'Failed to download https://assets.example.test/runtime/asset.wasm: 503'
		);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('does not retry a permanent HTTP response', async () => {
		const fixture = await createFixture();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('not found', { status: 404 }));

		await expect(prepareFixture(fixture, fetchImpl)).rejects.toThrow(
			'Failed to download https://assets.example.test/runtime/asset.wasm: 404'
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('does not retry a redirect outside the trusted source base', async () => {
		const fixture = await createFixture();
		const response = new Response(fixture.payload);
		Object.defineProperty(response, 'url', {
			value: 'https://untrusted.example.test/runtime/asset.wasm'
		});
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

		await expect(prepareFixture(fixture, fetchImpl)).rejects.toThrow(
			'redirected outside its trusted base'
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('does not retry a receipt hash mismatch', async () => {
		const fixture = await createFixture(Buffer.from('expected payload'));
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(Buffer.from('tampered payload')));

		await expect(prepareFixture(fixture, fetchImpl)).rejects.toThrow(
			'Downloaded test asset failed receipt validation: runtime/asset.wasm'
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
