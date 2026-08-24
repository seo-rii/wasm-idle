import { describe, expect, it } from 'vitest';

import { createApplicationRuntimeAssets } from '$lib/playground/applicationAssets';
import {
	resolveRubyLanguageServerAssetConfig,
	resolveRubyLanguageServerPreflightProfile
} from '@wasm-idle/lsp';
import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Ruby LSP integrity wiring', () => {
	it('passes one complete application trust bundle through Monaco without projection', () => {
		expect(pageSource).toContain('rubyLspEnabled ? runtimeAssets.ruby : undefined');
		expect(pageSource).toContain('{rubyLspRuntime}');
		expect(monacoSource).toContain('type RubyLspRuntimeConfig = NonNullable<');
		expect(monacoSource).toContain('rubyLspRuntime?: RubyLspRuntimeConfig');
		expect(monacoSource).toContain('JSON.stringify(rubyLspRuntime)');
		expect(monacoSource).toContain('const runtime = rubyLspRuntime');
		expect(monacoSource).toContain('ruby: runtime');

		for (const projectedField of [
			'rubyLspModuleUrl',
			'rubyLspWasmUrl',
			'rubyLspIntegrity',
			'rubyLspManifestFingerprint'
		]) {
			expect(pageSource).not.toContain(projectedField);
			expect(monacoSource).not.toContain(projectedField);
		}
	});

	it('threads provider cancellation into Ruby host preflight before worker creation', () => {
		expect(monacoSource).toContain(
			'load: (currentUrl: string, signal?: AbortSignal) => Promise<EditorLanguageServerHandle>'
		);
		expect(monacoSource).toContain(
			'const connection = await route.load(currentUrl, context?.signal)'
		);
		expect(monacoSource).toMatch(
			/languages: \['ruby'\],[\s\S]*?load: async \(currentUrl, signal\) => \{[\s\S]*?getRubyLanguageServer\(\{[\s\S]*?signal,[\s\S]*?ruby: runtime/
		);
	});

	it('keeps the generated application profile valid at the public LSP boundary', () => {
		const runtime = createApplicationRuntimeAssets('/wasm-idle').ruby;
		expect(runtime).toBeDefined();
		if (!runtime) throw new Error('Ruby application runtime assets are unavailable');
		expect(resolveRubyLanguageServerPreflightProfile({ ruby: runtime })).toEqual({
			profileId: runtime.profileId,
			artifactRevision: runtime.artifactRevision,
			rubyVersion: runtime.rubyVersion,
			rubyRevision: runtime.rubyRevision,
			rubyWasmVersion: runtime.rubyWasmVersion,
			rubyWasmRevision: runtime.rubyWasmRevision,
			wasiSdkVersion: runtime.wasiSdkVersion,
			manifestFingerprint: runtime.manifestFingerprint,
			manifestReceipt: runtime.manifestReceipt,
			moduleJavaScriptReceipt: runtime.moduleJavaScriptReceipt,
			wasmReceipt: runtime.wasmReceipt
		});
		expect(resolveRubyLanguageServerAssetConfig({ ruby: runtime })).toMatchObject({
			baseUrl: runtime.baseUrl,
			manifestUrl: runtime.manifestUrl,
			moduleUrl: runtime.moduleUrl,
			wasmUrl: runtime.wasmUrl
		});
	});
});
