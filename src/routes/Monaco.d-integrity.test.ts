import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Monaco D language server trust roots', () => {
	it('passes the generated module and manifest receipts to the D LSP loader', async () => {
		const source = await readFile(path.resolve('src/routes/Monaco.svelte'), 'utf8');
		const pageSource = await readFile(path.resolve('src/routes/+page.svelte'), 'utf8');

		expect(source).toContain("from '$lib/playground/wasmDIntegrity'");
		expect(source).toContain("new SvelteURL('runtime/runtime-manifest.v1.json', moduleUrl)");
		expect(source).toContain('if (!dLspManifestUrl) manifestUrl.search = moduleUrl.search');
		expect(source).toContain('integrity: dLspIntegrity');
		expect(pageSource).toContain(
			'const dLspManifestUrl = $derived(dLspEnabled ? runtimeAssets.d?.manifestUrl : undefined)'
		);
		expect(pageSource).toContain(
			'const dLspIntegrity = $derived(dLspEnabled ? runtimeAssets.d?.integrity : undefined)'
		);
		expect(pageSource).toContain('{dLspManifestUrl}');
		expect(pageSource).toContain('{dLspIntegrity}');
	});
});
