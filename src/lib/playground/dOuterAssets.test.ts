import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	loadVerifiedDOuterAssets,
	snapshotDOuterAssetConfig,
	type DOuterAssetReceipts
} from './dOuterAssets';

const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex'),
	uncompressedBytes: bytes.byteLength,
	uncompressedSha256: createHash('sha256').update(bytes).digest('hex')
});

const fixture = () => {
	const moduleBytes = new TextEncoder().encode('export default () => ({})');
	const manifestBytes = new TextEncoder().encode('{"manifestVersion":1}');
	return {
		moduleBytes,
		manifestBytes,
		config: {
			moduleUrl: 'https://runtime.example/wasm-d/index.js?v=test',
			manifestUrl: 'https://runtime.example/wasm-d/runtime/runtime-manifest.v1.json?v=test',
			integrity: {
				'index.js': receipt(moduleBytes),
				'runtime/runtime-manifest.v1.json': receipt(manifestBytes)
			} satisfies DOuterAssetReceipts
		}
	};
};

describe('D outer runtime assets', () => {
	it('fetches exact no-store snapshots and verifies both trust roots', async () => {
		const { config, moduleBytes, manifestBytes } = fixture();
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
			const url = input.toString();
			const bytes = url.includes('runtime-manifest') ? manifestBytes : moduleBytes;
			return new Response(bytes, {
				headers: { 'Content-Length': String(bytes.byteLength) }
			});
		});

		const loaded = await loadVerifiedDOuterAssets(config, fetchImpl);
		expect(Array.from(loaded.moduleBytes)).toEqual(Array.from(moduleBytes));
		expect(Array.from(loaded.manifestBytes)).toEqual(Array.from(manifestBytes));
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchImpl.mock.calls) {
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
	});

	it('rejects a corrupt module before publication', async () => {
		const { config, manifestBytes } = fixture();
		const corruptModule = new TextEncoder().encode('export default compromised');

		await expect(
			loadVerifiedDOuterAssets(
				config,
				async (input) =>
					new Response(
						input.toString().includes('runtime-manifest')
							? manifestBytes
							: corruptModule
					)
			)
		).rejects.toThrow(
			/asset exceeds its receipt for index\.js|size mismatch for index\.js|index\.js.*SHA-256 mismatch/u
		);
	});

	it('verifies decoded logical bytes when HTTP content encoding is present', async () => {
		const { config, moduleBytes, manifestBytes } = fixture();

		const loaded = await loadVerifiedDOuterAssets(config, async (input) => {
			const bytes = input.toString().includes('runtime-manifest')
				? manifestBytes
				: moduleBytes;
			return new Response(bytes, {
				headers: {
					'Content-Encoding': 'br',
					'Content-Length': String(Math.max(1, bytes.byteLength - 1))
				}
			});
		});

		expect(Array.from(loaded.moduleBytes)).toEqual(Array.from(moduleBytes));
		expect(Array.from(loaded.manifestBytes)).toEqual(Array.from(manifestBytes));
	});

	it('rejects a truncated body even when hashing is not reached', async () => {
		const { config, moduleBytes, manifestBytes } = fixture();
		const truncatedModule = moduleBytes.subarray(0, moduleBytes.byteLength - 1);

		await expect(
			loadVerifiedDOuterAssets(
				config,
				async (input) =>
					new Response(
						input.toString().includes('runtime-manifest')
							? manifestBytes
							: truncatedModule
					)
			)
		).rejects.toThrow(
			`D outer runtime size mismatch for index.js: expected ${moduleBytes.byteLength}, received ${truncatedModule.byteLength}`
		);
	});

	it('copies and freezes caller-owned receipt metadata', () => {
		const { config } = fixture();
		const originalBytes = config.integrity['index.js'].bytes;
		const snapshot = snapshotDOuterAssetConfig(config);
		(config.integrity['index.js'] as { bytes: number }).bytes += 1;

		expect(snapshot.integrity['index.js'].bytes).toBe(originalBytes);
		expect(snapshot.integrity).not.toBe(config.integrity);
		expect(Object.isFrozen(snapshot.integrity['index.js'])).toBe(true);
	});

	it('rejects final URL substitution and cancels the response body', async () => {
		const { config } = fixture();
		let cancelled = false;
		const response = new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				}
			})
		);
		Object.defineProperty(response, 'url', {
			value: 'https://attacker.example/substituted.js'
		});

		await expect(loadVerifiedDOuterAssets(config, async () => response)).rejects.toThrow(
			'D outer runtime response URL mismatch'
		);
		await vi.waitFor(() => expect(cancelled).toBe(true));
	});
});
