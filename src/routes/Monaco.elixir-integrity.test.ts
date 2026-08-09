import { describe, expect, it } from 'vitest';

import pageSource from './+page.svelte?raw';
import monacoSource from './Monaco.svelte?raw';

describe('Monaco BEAM language server trust roots', () => {
	it('passes Elixir and Erlang receipts through the page, connection key, and LSP host', () => {
		expect(pageSource).toMatch(
			/const elixirLspIntegrity = \$derived\(\s*elixirLspEnabled \? runtimeAssets\.elixir\?\.integrity : undefined\s*\);/su
		);
		expect(pageSource).toMatch(
			/const erlangLspIntegrity = \$derived\(\s*erlangLspEnabled \? runtimeAssets\.erlang\?\.integrity : undefined\s*\);/su
		);
		expect(pageSource).toContain('{elixirLspIntegrity}');
		expect(pageSource).toContain('{erlangLspIntegrity}');
		expect(monacoSource).toContain(
			"import { WASM_ELIXIR_ASSET_RECEIPTS } from '$lib/playground/wasmElixirVersion'"
		);
		expect(monacoSource).toContain('elixirLspIntegrity = WASM_ELIXIR_ASSET_RECEIPTS');
		expect(monacoSource).toContain('erlangLspIntegrity = WASM_ELIXIR_ASSET_RECEIPTS');
		expect(monacoSource).toContain(
			"elixirLspEnabled ? JSON.stringify(elixirLspIntegrity) : ''"
		);
		expect(monacoSource).toContain(
			"erlangLspEnabled ? JSON.stringify(erlangLspIntegrity) : ''"
		);
		expect(monacoSource).toContain('integrity: elixirLspIntegrity');
		expect(monacoSource).toContain('integrity: erlangLspIntegrity');
	});
});
