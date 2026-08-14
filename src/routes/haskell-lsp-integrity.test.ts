import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routesDir = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(path.join(routesDir, '+page.svelte'), 'utf8');
const monacoSource = readFileSync(path.join(routesDir, 'Monaco.svelte'), 'utf8');

describe('Haskell LSP asset integrity wiring', () => {
	it('forwards the selected runtime receipt from the page to the editor host', () => {
		expect(pageSource).toContain(
			'haskellLspEnabled ? runtimeAssets.haskell?.integrity : undefined'
		);
		expect(pageSource).toContain('{haskellLspIntegrity}');
	});

	it('binds the receipt to provider identity and worker initialization', () => {
		expect(monacoSource).toContain(
			"haskellLspEnabled ? JSON.stringify(haskellLspIntegrity) : ''"
		);
		expect(monacoSource).toMatch(
			/haskell:\s*\{[\s\S]*?moduleUrl: haskellLspModuleUrl \|\| ''[\s\S]*?integrity: haskellLspIntegrity[\s\S]*?\}/
		);
	});
});
