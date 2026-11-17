// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildGraphqlAssets, syncWasmGraphqlAssets } from '../../scripts/sync-wasm-graphql.mjs';
import { WASM_GRAPHQL_RUNNER_RECEIPT } from './playground/wasmGraphqlVersion';
import { RUNTIME_ASSET_LOCK } from '../../packages/core/src/runtime-asset-lock.generated';

it('reproduces the committed official graphql-js Worker and its verified receipt', async () => {
	await expect(syncWasmGraphqlAssets({ check: true })).resolves.toMatchObject({
		targetDir: expect.stringContaining('static/wasm-graphql')
	});
	const generated = await buildGraphqlAssets();
	expect(generated.worker.length).toBe(WASM_GRAPHQL_RUNNER_RECEIPT.bytes);
	expect(createHash('sha256').update(generated.worker).digest('hex')).toBe(
		WASM_GRAPHQL_RUNNER_RECEIPT.sha256
	);
	expect(await readFile('static/wasm-graphql/LICENSE.txt', 'utf8')).toContain('MIT');
});

it('includes the actual GraphQL Worker and manifest bytes in the generated release lock', async () => {
	for (const file of ['runner-worker.js', 'runtime-manifest.v1.json']) {
		const bytes = await readFile(`static/wasm-graphql/${file}`);
		expect(RUNTIME_ASSET_LOCK.assets[`wasm-graphql/${file}`]).toMatchObject({
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
	}
});
