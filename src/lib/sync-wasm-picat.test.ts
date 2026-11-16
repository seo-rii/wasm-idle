// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { syncWasmPicatAssets } from '../../scripts/sync-wasm-picat.mjs';
import { WASM_PICAT_PROFILE as profile } from './playground/wasmPicatVersion';

describe('Picat pinned sync', () => {
	it('rejects changed upstream bytes before publishing any executable', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'picat-sync-'));
		try {
			await expect(
				syncWasmPicatAssets({
					targetDir: dir,
					versionModulePath: path.join(dir, 'version.ts'),
					fetchImpl: async () => new Response('changed')
				})
			).rejects.toThrow(/receipt mismatch/);
			await expect(readFile(path.join(dir, 'picat.mjs'))).rejects.toMatchObject({
				code: 'ENOENT'
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('keeps the generated worker receipt coherent with the exact reviewed source', async () => {
		const lock = JSON.parse(
			await readFile(
				new URL('../../scripts/wasm-picat-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const source = await readFile(
			new URL('../../scripts/runtime-workers/wasm-picat-runner-worker.js', import.meta.url),
			'utf8'
		);
		const worker = Buffer.from(
			source.replace(
				'__WASM_IDLE_PICAT_ASSET_LOCK__',
				JSON.stringify({ assets: lock.assets })
			)
		);
		expect(createHash('sha256').update(worker).digest('hex')).toBe(
			profile.workerReceipt.sha256
		);
		expect(worker.length).toBe(profile.workerReceipt.bytes);
	});
});
