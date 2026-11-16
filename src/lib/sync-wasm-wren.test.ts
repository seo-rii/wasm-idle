// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { syncWasmWrenDist } from '../../scripts/sync-wasm-wren.mjs';

it('copies verified Wren assets and rejects a modified runtime', async () => {
	const targetDir = await mkdtemp(join(tmpdir(), 'wasm-idle-wren-sync-'));
	try {
		await syncWasmWrenDist({ targetDir });
		expect(await readFile(join(targetDir, 'wren.wasm'))).toEqual(
			await readFile('static/wasm-wren/wren.wasm')
		);
		await writeFile(join(targetDir, 'wren.wasm'), 'modified');
		await expect(syncWasmWrenDist({ sourceDir: targetDir })).rejects.toThrow(
			'receipt mismatch'
		);
	} finally {
		await rm(targetDir, { recursive: true, force: true });
	}
});
