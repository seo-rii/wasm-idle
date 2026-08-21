import { describe, expect, it } from 'vitest';

import { createApplicationRuntimeAssets } from '$lib/playground/applicationAssets';
import { resolveJanetLanguageServerPreflightProfile } from '@wasm-idle/lsp';
import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Janet LSP integrity wiring', () => {
	it('passes one complete application trust bundle through Monaco without field projection', () => {
		expect(pageSource).toContain('$derived(janetLspEnabled ? runtimeAssets.janet : undefined)');
		expect(pageSource).toContain('{janetLspRuntime}');
		expect(monacoSource).toContain('type JanetLspRuntimeConfig = NonNullable<');
		expect(monacoSource).toContain('janetLspRuntime?: JanetLspRuntimeConfig');
		expect(monacoSource).toContain('JSON.stringify(janetLspRuntime)');
		expect(monacoSource).toContain('const runtime = janetLspRuntime');
		expect(monacoSource).toContain('janet: runtime');
		for (const legacyProjection of [
			'janetLspManifestFingerprint',
			'janetLspWorkerReceipt',
			'janetLspManifestUrl'
		]) {
			expect(pageSource).not.toContain(legacyProjection);
			expect(monacoSource).not.toContain(legacyProjection);
		}
	});

	it('keeps the generated application profile valid at the public LSP boundary', () => {
		const runtime = createApplicationRuntimeAssets('/wasm-idle').janet;
		expect(runtime).toBeDefined();
		expect(resolveJanetLanguageServerPreflightProfile({ janet: runtime })).toMatchObject({
			profileId: runtime?.profileId,
			artifactRevision: runtime?.artifactRevision,
			janetVersion: runtime?.janetVersion,
			emscriptenVersion: runtime?.emscriptenVersion,
			manifestFingerprint: runtime?.manifestFingerprint
		});
	});
});
