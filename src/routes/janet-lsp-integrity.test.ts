import { describe, expect, it } from 'vitest';

import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Janet LSP integrity wiring', () => {
	it('passes the application manifest and worker pins through Monaco to the LSP host', () => {
		for (const field of ['manifestUrl', 'manifestFingerprint', 'workerReceipt']) {
			const prop = `janetLsp${field[0].toUpperCase()}${field.slice(1)}`;
			expect(pageSource).toContain(`runtimeAssets.janet?.${field}`);
			expect(pageSource).toContain(`{${prop}}`);
			expect(monacoSource).toContain(`${prop}?:`);
			expect(monacoSource).toContain(`${field}: ${prop}`);
		}
		expect(monacoSource).toContain('JSON.stringify(janetLspWorkerReceipt)');
		expect(monacoSource).toContain('!!janetLspManifestFingerprint');
		expect(monacoSource).toContain('!!janetLspWorkerReceipt');
	});
});
