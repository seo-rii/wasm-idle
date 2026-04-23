import source from './Terminal.svelte?raw';
import Theme from './theme';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Terminal source', () => {
	it('restores the cursor and copies terminal selections before ctrl+c stop handling', () => {
		expect(() =>
			compile(source, {
				filename: 'src/lib/terminal/Terminal.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/term\.write\('\\u001B\[\?25h'\);/);
		expect(source).toMatch(
			/const isCopyShortcut = \(ev\.ctrlKey \|\| ev\.metaKey\) && ev\.key\.toLowerCase\(\) === 'c';/
		);
		expect(source).toMatch(
			/if \(isCopyShortcut && term\.hasSelection\(\)\) \{\s+const selectedText = term\.getSelection\(\);\s+if \(selectedText\) \{\s+ev\.preventDefault\(\);\s+navigator\.clipboard\.writeText\(selectedText\)\.catch\(\(\) => \{\}\);\s+return;\s+\}\s+\}\s+if \(finish\) return;/s
		);
		expect(source).toMatch(
			/if \(isCopyShortcut\) \{\s+ev\.preventDefault\(\);\s+sandbox\.kill\?\.\(\);\s+\}/s
		);
	});

	it('uses transparent backgrounds for terminal rendering layers', () => {
		expect(Theme.Tango_Dark.background).toMatch(
			/^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/
		);
		expect(Theme.Tango_Light.background).toMatch(
			/^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/
		);
		expect(source).toMatch(
			/:global\(\.xterm\),\s+:global\(\.xterm \.xterm-viewport\),\s+:global\(\.xterm \.composition-view\) \{\s+background-color: transparent;\s+\}/s
		);
	});

	it('exposes a stop hook and suppresses abort output for user-initiated stops', () => {
		expect(source).toMatch(/stopRequested = false;/);
		expect(source).toMatch(/if \(stopRequested\) return false;/);
		expect(source).toMatch(
			/async stop\(\) \{\s+await wait\(\);\s+stopRequested = true;\s+finish = true;\s+if \(sandbox\?\.kill\) sandbox\.kill\(\);\s+else sandbox\?\.terminate\?\.\(\);\s+\}/s
		);
	});

	it('submits pending stdin and sends EOF on ctrl+d for read-to-end programs', () => {
		expect(source).toMatch(
			/else if \(\(ev\.ctrlKey \|\| ev\.metaKey\) && ev\.key\.toLowerCase\(\) === 'd'\) \{\s+ev\.preventDefault\(\);\s+if \(input\.length > 0\) submitCurrentInput\(\);\s+sandbox\?\.eof\?\.\(\);\s+\}/s
		);
	});

	it('uses xterm onData for printable keys, Enter, and Backspace instead of relying on keydown heuristics', () => {
		expect(source).toMatch(/term\.onData\(\(data: string\) => \{/);
		expect(source).toMatch(/if \(chunk === '\\r' \|\| chunk === '\\n'\)/);
		expect(source).toMatch(/if \(chunk === '\\u007f'\)/);
		expect(source).toMatch(/input = Array\.from\(input\)\.slice\(0, -1\)\.join\(''\);/);
		expect(source).toMatch(/if \(\(chunk\.codePointAt\(0\) \|\| 0\) >= 0x20\) \{/);
		expect(source).not.toMatch(
			/const printable = !ev\.altKey && !ev\.ctrlKey && !ev\.metaKey;/
		);
		expect(source).not.toMatch(/else if \(printable\) \{/);
	});

	it('keeps a hidden transcript mirror for browser debugging and Playwright assertions', () => {
		expect(source).toMatch(/debugOutput = \$state\(''\)/);
		expect(source).toMatch(/loadedRuntimeAssetsKey: string \| undefined = undefined/);
		expect(source).not.toMatch(/loadedRuntimeAssets = \$state/);
		expect(source).not.toMatch(/loadedPlayground = \$state/);
		expect(source).toMatch(/const currentRuntimeAssetsKey =/);
		expect(source).toMatch(/clangBaseUrl: currentRuntimeAssets\?\.clang\?\.baseUrl \|\| '',/);
		expect(source).toMatch(/hasClangLoader: !!currentRuntimeAssets\?\.clang\?\.loader,/);
		expect(source).toMatch(/clangdBaseUrl: currentRuntimeAssets\?\.clangd\?\.baseUrl \|\| '',/);
		expect(source).toMatch(/hasClangdLoader: !!currentRuntimeAssets\?\.clangd\?\.loader,/);
		expect(source).toMatch(/goCompilerUrl: currentRuntimeAssets\?\.go\?\.compilerUrl \|\| '',/);
		expect(source).toMatch(
			/elixirBundleUrl: currentRuntimeAssets\?\.elixir\?\.bundleUrl \|\| '',/
		);
		expect(source).toMatch(
			/ocamlModuleUrl: currentRuntimeAssets\?\.ocaml\?\.moduleUrl \|\| '',/
		);
		expect(source).toMatch(
			/ocamlManifestUrl: currentRuntimeAssets\?\.ocaml\?\.manifestUrl \|\| '',/
		);
		expect(source).not.toMatch(/loadedRuntimeAssets !== currentRuntimeAssets/);
		expect(source).not.toMatch(/loadedPlayground !== currentPlayground/);
		expect(source).toMatch(/function writeTerminalOutput\(text: string\)/);
		expect(source).toMatch(/debugOutput \+= text;/);
		expect(source).toMatch(/debugOutput = '';/);
		expect(source).toMatch(
			/<pre data-testid="terminal-debug-output" style="display: none;">\{debugOutput\}<\/pre>/
		);
	});

	it('reuses the same sandbox between prepare and run when language and runtime assets are unchanged', () => {
		expect(source).toMatch(
			/const requiresSandboxReset =\s+ll !== language \|\| loadedRuntimeAssetsKey !== currentRuntimeAssetsKey;/
		);
		expect(source).toMatch(/if \(sandbox && requiresSandboxReset\) await sandbox\.clear\(\);/);
		expect(source).toMatch(/if \(!sandbox \|\| requiresSandboxReset\) \{/);
	});

	it('uses rust-specific progress windows instead of jumping straight to the prepare band', () => {
		expect(source).toMatch(/prog\?\.set\?\.\(0\);/);
		expect(source).toMatch(
			/language === 'RUST' \|\|\s+language === 'GO' \|\|\s+language === 'TINYGO' \|\|\s+language === 'OCAML'\s+\? phaseProgress\(prog, 0, 0\.05\)\s+: phaseProgress\(prog, 0, 0\.85\)/
		);
		expect(source).toMatch(
			/language === 'RUST' \|\|\s+language === 'GO' \|\|\s+language === 'TINYGO' \|\|\s+language === 'OCAML'\s+\? phaseProgress\(prog, 0\.05, 0\.99\)\s+: phaseProgress\(prog, 0\.85, 0\.99\)/
		);
	});
});
