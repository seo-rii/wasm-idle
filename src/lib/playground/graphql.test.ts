import { describe, expect, it } from 'vitest';
import { resolveGraphqlRuntimeAssetConfig } from './assets';
import { createApplicationRuntimeAssets } from './applicationAssets';
import { WASM_GRAPHQL_RUNNER_RECEIPT } from './wasmGraphqlVersion';
import Graphql from './graphql';

describe('GraphQL runtime assets and stdin', () => {
	it('keeps Worker URLs under the configured asset root and pins the bundle before execution', () => {
		expect(resolveGraphqlRuntimeAssetConfig('/demo', 'https://example.test/app/')).toEqual({
			baseUrl: 'https://example.test/demo/wasm-graphql/',
			workerUrl: 'https://example.test/demo/wasm-graphql/runner-worker.js',
			workerReceipt: WASM_GRAPHQL_RUNNER_RECEIPT
		});
		const configured = createApplicationRuntimeAssets('/demo');
		expect(configured.graphql).toEqual({
			workerUrl: `/demo/wasm-graphql/runner-worker.js?v=${WASM_GRAPHQL_RUNNER_RECEIPT.sha256}`,
			workerReceipt: WASM_GRAPHQL_RUNNER_RECEIPT
		});
		const custom = { bytes: 2, sha256: 'a'.repeat(64) };
		expect(
			resolveGraphqlRuntimeAssetConfig(
				{ graphql: { workerUrl: '/custom.js', workerReceipt: custom } },
				'https://example.test/'
			).workerReceipt
		).toBe(custom);
	});

	it('uses the shared buffered EOF and disposal lifecycle', async () => {
		const sandbox = new Graphql();
		expect(sandbox.stdinMode).toBe('prebuffered');
		await sandbox.dispose();
		await expect(sandbox.load()).rejects.toThrow('disposed');
	});
});
