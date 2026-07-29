import { describe, expect, it } from 'vitest';
import source from './+page.svelte?raw';

describe('page application asset root', () => {
	it('injects the SvelteKit base into every non-debug runtime asset consumer', () => {
		expect(source).toMatch(
			/import \{\s+createApplicationAssetResolver,\s+createApplicationRuntimeAssets\s+\} from '\$lib\/playground\/applicationAssets';/s
		);
		expect(source).toMatch(/const applicationRootUrl = base;/);
		expect(source).toMatch(
			/const resolveApplicationAsset = createApplicationAssetResolver\(applicationRootUrl\);/
		);
		expect(source).toMatch(/\.\.\.createApplicationRuntimeAssets\(applicationRootUrl\),/);
		expect(source).toMatch(
			/let clangdBaseUrl = \$derived\(resolveApplicationAsset\('clangd\/'\)\);/
		);
		expect(source).toMatch(
			/const pythonLspBaseUrl = \$derived\(resolveApplicationAsset\('pyodide\/'\)\);/
		);
		expect(source).toMatch(
			/const manifestUrl = runtimeAssets\.rust\?\.manifestUrl;\s+if \(!manifestUrl\) return;/s
		);
		expect(source).toMatch(
			/const manifestUrl = runtimeAssets\.go\?\.manifestUrl;\s+if \(!manifestUrl\) return;/s
		);
		expect(source).not.toMatch(/import \{ WASM_[A-Z_]+_ASSET_VERSION \}/u);
	});
});
