import { describe, expect, it } from 'vitest';

import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Gleam LSP integrity wiring', () => {
	it('passes the application manifest fingerprint through Monaco to the LSP host', () => {
		expect(pageSource).toMatch(
			/const gleamLspManifestFingerprint = \$derived\(\s*gleamLspEnabled \? runtimeAssets\.gleam\?\.manifestFingerprint : undefined\s*\);/s
		);
		expect(pageSource).toMatch(/\{gleamLspManifestFingerprint\}/);
		expect(monacoSource).toMatch(/gleamLspManifestFingerprint\?: string;/);
		expect(monacoSource).toMatch(
			/gleamLspEnabled \? gleamLspManifestFingerprint \|\| '' : ''/
		);
		expect(monacoSource).toMatch(
			/manifestFingerprint: gleamLspManifestFingerprint/
		);
	});
});
