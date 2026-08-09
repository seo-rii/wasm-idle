import source from './d.ts?raw';
import { describe, expect, it } from 'vitest';

describe('D worker source', () => {
	it('injects the Core integrity verifier into the compiler runtime', () => {
		const normalized = source.replace(/\s+/gu, ' ');
		expect(source).toContain('loadVerifiedDOuterAssets');
		expect(source).toContain('verifyRuntimeAssetIntegrity');
		expect(normalized).toContain('module.parseRuntimeManifest(JSON.parse(manifestSource))');
		expect(normalized).toContain('manifest, verifyRuntimeAssetIntegrity');
		expect(source).not.toContain('import(/* @vite-ignore */ nextModuleUrl)');
	});
});
