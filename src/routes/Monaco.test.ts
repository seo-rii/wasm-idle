import pageSource from './+page.svelte?raw';
import source from './Monaco.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Monaco route debug sync', () => {
	it('keeps the debug view reactive and applies markers immediately after creation', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/Monaco.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).not.toMatch(/clangdBaseUrl\s*=\s*DEFAULT_CLANGD_BASE_URL/);
		expect(source).toMatch(/let debugView = \$state<MonacoDebugView \| null>\(null\);/);
		expect(source).toMatch(/clangdEnabled\?: boolean;/);
		expect(source).toMatch(/clangdEnabled = false,/);
		expect(source).toMatch(
			/monacoApi\.editor\.setModelMarkers\(activeModel, 'wasm-idle-compiler', markers\);/
		);
		expect(source.match(/occurrencesHighlight: 'off'/g)).toHaveLength(2);
		expect(source).toMatch(
			/const rustDefaults: Record<RustTargetTriple, string> = \{[\s\S]*'wasm32-wasip1': `use std::io;[\s\S]*'wasm32-wasip2': `#\[cfg\(not\(target_env = "p2"\)\)\][\s\S]*compile_error!\("This example requires wasm32-wasip2\."\);[\s\S]*println!\("preview2_component=\{\}", preview2_label\);[\s\S]*println!\("factorial_plus_bonus=\{\}", factorial\(n\) \+ BONUS\);[\s\S]*}`,[\s\S]*'wasm32-wasip3': `#\[cfg\(not\(target_env = "p3"\)\)\][\s\S]*compile_error!\("This example requires wasm32-wasip3\."\);[\s\S]*println!\("preview3_transition=\{\}", preview3_label\);[\s\S]*println!\("factorial_plus_bonus=\{\}", factorial\(n\) \+ BONUS\);[\s\S]*}`/s
		);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+if \(!editor \|\| language !== 'rust'\) return;[\s\S]*currentValue !== rustDefaults\['wasm32-wasip1'\][\s\S]*currentValue !== rustDefaults\['wasm32-wasip2'\][\s\S]*currentValue !== rustDefaults\['wasm32-wasip3'\][\s\S]*editor\.setValue\(nextValue\);[\s\S]*\}\);/s
		);
		expect(source).toMatch(
			/debugView = new MonacoDebugView\(Monaco, editor, onBreakpointsChange\);\s+debugView\.setBreakpoints\(breakpoints\);\s+debugView\.setPauseState\(pausedLine, debugLocals, debugLanguage\);/s
		);
		expect(source).toMatch(
			/if \(language !== 'cpp' \|\| !editor \|\| !clangdEnabled \|\| !clangdBaseUrl\) \{\s+session\?\.dispose\(\);\s+session = null;\s+clangdStatus = \{ state: 'disabled' \};\s+return;\s+\}/s
		);
		expect(source).toMatch(
			/const \{ ClangdSession \} = await import\('\$lib\/clangd\/session'\);/s
		);
		expect(source).not.toMatch(/clangd ready/);
		expect(source).not.toMatch(/clangd loading/);
		expect(source).not.toMatch(/clangd failed:/);
		expect(source).not.toMatch(/class="clangd-status"/);
	});

	it('requests clangd only after cpp debug starts', () => {
		expect(() =>
			compile(pageSource, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(pageSource).toMatch(/clangdRequested = \$state\(false\),/);
		expect(pageSource).toMatch(/if \(debug && language === 'CPP'\) clangdRequested = true;/);
		expect(pageSource).toMatch(/if \(language !== 'CPP'\) clangdRequested = false;/);
		expect(pageSource).toMatch(/<option value="RUST">Rust<\/option>/);
		expect(pageSource).toMatch(/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/);
		expect(pageSource).toMatch(
			/\{#each availableRustTargetTriples as targetTriple\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(pageSource).toMatch(/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}/);
		expect(pageSource).toMatch(/clangdEnabled=\{clangdRequested\}/);
	});
});
