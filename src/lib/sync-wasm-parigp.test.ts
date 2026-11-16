// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { syncWasmPariGpAssets } from '../../scripts/sync-wasm-parigp.mjs';

describe('PARI/GP asset sync', () => {
	it('rejects altered upstream bytes before publishing a bundle', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'parigp-sync-test-'));
		const fetchImpl = vi.fn(async () => new Response('corrupt'));
		try {
			await expect(
				syncWasmPariGpAssets({
					targetDir: path.join(directory, 'runtime'),
					versionModulePath: path.join(directory, 'version.ts'),
					fetchImpl
				})
			).rejects.toThrow(/integrity mismatch/);
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
