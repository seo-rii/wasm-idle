import { describe, expect, it } from 'vitest';

import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Perl LSP integrity wiring', () => {
	it('passes one complete application trust bundle through Monaco without field projection', () => {
		expect(pageSource).toContain('$derived(perlLspEnabled ? runtimeAssets.perl : undefined)');
		expect(pageSource).toContain('{perlLspRuntime}');
		expect(monacoSource).toContain('type PerlLspRuntimeConfig = NonNullable<');
		expect(monacoSource).toContain('perlLspRuntime?: PerlLspRuntimeConfig');
		expect(monacoSource).toContain('JSON.stringify(perlLspRuntime)');
		expect(monacoSource).toContain('const runtime = perlLspRuntime');
		expect(monacoSource).toContain('perl: runtime');
		for (const legacyProjection of [
			'perlLspManifestFingerprint',
			'perlLspWorkerReceipt',
			'perlLspManifestUrl'
		]) {
			expect(pageSource).not.toContain(legacyProjection);
			expect(monacoSource).not.toContain(legacyProjection);
		}
	});
});
