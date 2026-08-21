import { describe, expect, it } from 'vitest';

import { createApplicationRuntimeAssets } from '$lib/playground/applicationAssets';
import {
	resolvePascalLanguageServerAssetConfig,
	resolvePascalLanguageServerPreflightProfile
} from '@wasm-idle/lsp';
import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Pascal LSP integrity wiring', () => {
	it('passes one complete application trust bundle through Monaco without field projection', () => {
		expect(pageSource).toContain('pascalLspEnabled ? runtimeAssets.pascal : undefined');
		expect(pageSource).toContain('{pascalLspRuntime}');
		expect(monacoSource).toContain('type PascalLspRuntimeConfig = NonNullable<');
		expect(monacoSource).toContain('pascalLspRuntime?: PascalLspRuntimeConfig');
		expect(monacoSource).toContain('JSON.stringify(pascalLspRuntime)');
		expect(monacoSource).toContain('const runtime = pascalLspRuntime');
		expect(monacoSource).toContain('pascal: runtime');
		for (const legacyProjection of [
			'pascalLspManifestFingerprint',
			'pascalLspWorkerReceipt',
			'pascalLspManifestUrl',
			'pascalLspBaseUrl',
			'pascalLspWorkerUrl'
		]) {
			expect(pageSource).not.toContain(legacyProjection);
			expect(monacoSource).not.toContain(legacyProjection);
		}
	});

	it('keeps the generated application profile valid at the public LSP boundary', () => {
		const runtime = createApplicationRuntimeAssets('/wasm-idle').pascal;
		expect(runtime).toBeDefined();
		if (!runtime) throw new Error('Pascal application runtime assets are unavailable');
		expect(resolvePascalLanguageServerPreflightProfile({ pascal: runtime })).toEqual({
			profileId: runtime.profileId,
			artifactRevision: runtime.artifactRevision,
			pas2jsVersion: runtime.pas2jsVersion,
			pas2jsRevision: runtime.pas2jsRevision,
			manifestFingerprint: runtime.manifestFingerprint,
			manifestReceipt: runtime.manifestReceipt,
			compilerJavaScriptReceipt: runtime.compilerJavaScriptReceipt,
			rtlJavaScriptReceipt: runtime.rtlJavaScriptReceipt,
			systemPascalReceipt: runtime.systemPascalReceipt
		});
		expect(resolvePascalLanguageServerAssetConfig({ pascal: runtime })).toMatchObject({
			compilerJavaScriptUrl: runtime.compilerJavaScriptUrl,
			rtlJavaScriptUrl: runtime.rtlJavaScriptUrl,
			systemPascalUrl: runtime.systemPascalUrl
		});
	});
});
