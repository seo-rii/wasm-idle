import { describe, expect, it } from 'vitest';

import { createBashNestedBootstrapSource } from './bashNestedBootstrap';

describe('Bash nested Wasmer bootstrap', () => {
	it('imports only the verified SDK Blob and ignores message-controlled sdkUrl', () => {
		const source = createBashNestedBootstrapSource({
			sdkModuleUrl: 'blob:https://app.example.test/verified-sdk',
			sentinelUrl: 'https://app.example.test/__wasm_idle/bash-sdk/index.mjs',
			realmUrl: 'https://app.example.test/_app/bash-worker.js'
		});

		expect(source).toContain(
			'const verifiedSdkUrl = "blob:https://app.example.test/verified-sdk";'
		);
		expect(source).toContain(
			'const sdkSentinelUrl = "https://app.example.test/__wasm_idle/bash-sdk/index.mjs";'
		);
		expect(source).toContain('await import(verifiedSdkUrl)');
		expect(source).toContain('init({ module, memory, sdkUrl: sdkSentinelUrl })');
		expect(source).not.toContain('data.sdkUrl');
		expect(source).not.toContain('fetch(');
	});

	it('rejects an unverified SDK URL or non-hierarchical/cross-origin sentinel', () => {
		const valid = {
			sdkModuleUrl: 'blob:https://app.example.test/verified-sdk',
			sentinelUrl: 'https://app.example.test/__wasm_idle/bash-sdk/index.mjs',
			realmUrl: 'https://app.example.test/_app/bash-worker.js'
		};
		expect(() =>
			createBashNestedBootstrapSource({ ...valid, sdkModuleUrl: 'https://evil.test/sdk.js' })
		).toThrow(/Blob/iu);
		expect(() =>
			createBashNestedBootstrapSource({ ...valid, sentinelUrl: 'blob:sentinel' })
		).toThrow(/sentinel/iu);
		expect(() =>
			createBashNestedBootstrapSource({
				...valid,
				sentinelUrl: 'https://other.example.test/index.mjs'
			})
		).toThrow(/same-origin/iu);
	});
});
