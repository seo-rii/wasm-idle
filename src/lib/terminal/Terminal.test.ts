import source from './Terminal.svelte?raw';
import pluginSource from './plugin/index.ts?raw';
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
			/async stop\(\) \{\s+await wait\(\);\s+stopRequested = true;\s+finish = true;\s+sandboxAcceptingInput = false;\s+pendingSandboxEof = false;\s+if \(sandbox\?\.kill\) sandbox\.kill\(\);\s+else sandbox\?\.terminate\?\.\(\);\s+\}/s
		);
	});

	it('submits pending stdin and sends EOF on ctrl+d for read-to-end programs', () => {
		expect(source).toMatch(
			/else if \(\(ev\.ctrlKey \|\| ev\.metaKey\) && ev\.key\.toLowerCase\(\) === 'd'\) \{\s+ev\.preventDefault\(\);\s+if \(input\.length > 0\) submitCurrentInput\(\);\s+submitSandboxEof\(\);\s+\}/s
		);
	});

	it('uses xterm onData for printable keys, Enter, and Backspace instead of relying on keydown heuristics', () => {
		expect(source).toMatch(/term\.onData\(\(data: string\) => \{/);
		expect(source).toMatch(/if \(chunk === '\\r' \|\| chunk === '\\n'\)/);
		expect(source).toMatch(/if \(chunk === '\\u007f'\)/);
		expect(source).toMatch(/inputCursor = 0,/);
		expect(source).toMatch(/function getInputCharacters\(text: string\)/);
		expect(source).toMatch(/function getInputCellWidth\(text: string\)/);
		expect(source).toMatch(
			/const removedInput = inputCharacters\.splice\(inputCursor - 1, 1\)\[0\];/
		);
		expect(source).toMatch(
			/inputCharacters\.splice\(inputCursor, 0, \.\.\.insertedCharacters\);/
		);
		expect(source).toContain('term.write(`\\x1b[${cursorReturnCellWidth}D`);');
		expect(source).toMatch(/if \(\(chunk\.codePointAt\(0\) \|\| 0\) >= 0x20\) \{/);
		expect(source).not.toMatch(
			/const printable = !ev\.altKey && !ev\.ctrlKey && !ev\.metaKey;/
		);
		expect(source).not.toMatch(/else if \(printable\) \{/);
	});

	it('consumes arrow-key escape sequences for local cursor movement', () => {
		expect(source).toMatch(
			/data\.slice\(i\)\.match\(\/\^\\x1b\(\?:\\\[\[0-9;\?\]\*\[ABCD\]\|O\[ABCD\]\)\/\)/
		);
		expect(source).toMatch(/direction === 'D' && inputCursor > 0/);
		expect(source).toMatch(/direction === 'C' && inputCursor < inputCharacters\.length/);
		expect(source).toMatch(/term\.write\(`\\x1b\[\$\{inputCharacterCellWidth\}D`\);/);
		expect(source).toMatch(/term\.write\(`\\x1b\[\$\{inputCharacterCellWidth\}C`\);/);
		expect(source).not.toMatch(/for \(const chunk of data\)/);
	});

	it('activates xterm Unicode 11 width rules for CJK terminal cells', () => {
		expect(pluginSource).toMatch(/term\.unicode\.activeVersion = '11';/);
		expect(source).toContain(')?._core?.unicodeService;');
		expect(source).toMatch(/unicode\?\.getStringCellWidth\?\.\(text\)/);
		expect(source).not.toContain('const unicode = term?.unicode');
	});

	it('keeps a hidden transcript mirror for browser debugging and Playwright assertions', () => {
		expect(source).toMatch(/debugOutput = \$state\(''\)/);
		expect(source).toMatch(/loadedRuntimeAssetsKey: string \| undefined = undefined/);
		expect(source).not.toMatch(/loadedRuntimeAssets = \$state/);
		expect(source).not.toMatch(/loadedPlayground = \$state/);
		expect(source).toContain('createRuntimeAssetsKey');
		expect(source).toMatch(
			/const currentRuntimeAssetsKey = createRuntimeAssetsKey\(currentRuntimeAssets\);/
		);
		expect(source).not.toContain('dotnet' + 'Host' + 'CompileUrl');
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

	it('buffers stdin until the current sandbox is ready to accept it', () => {
		const prepareStart = source.slice(
			source.indexOf('async prepare('),
			source.indexOf('const progressBands')
		);
		const runStart = source.slice(
			source.indexOf('async run('),
			source.indexOf('await Promise.all', source.indexOf('async run('))
		);
		expect(source).toMatch(/sandboxAcceptingInput = false,/);
		expect(source).toMatch(/pendingSandboxEof = false,/);
		expect(prepareStart).not.toContain('pendingSandboxEof = false;');
		expect(runStart).not.toContain('pendingSandboxEof = false;');
		expect(source).toMatch(/sandboxAcceptingInput = true;/);
		expect(source).toMatch(
			/if \(sandbox && sandboxAcceptingInput\) sandbox\.write\?\.\(submittedInput\);\s+else pendingSandboxInput\.push\(submittedInput\);/s
		);
		expect(source).toMatch(
			/function flushPendingSandboxInput\(\) \{\s+if \(pendingSandboxInput\.length > 0\) \{\s+for \(const pendingInput of pendingSandboxInput\) \{\s+sandbox\.write\?\.\(pendingInput\);\s+\}\s+pendingSandboxInput = \[\];\s+\}\s+if \(pendingSandboxEof\) \{\s+sandbox\.eof\?\.\(\);\s+pendingSandboxEof = false;\s+\}\s+\}/s
		);
		expect(source).toMatch(
			/function submitSandboxEof\(\) \{\s+if \(sandbox && sandboxAcceptingInput\) sandbox\.eof\?\.\(\);\s+else pendingSandboxEof = true;\s+\}/s
		);
		expect(source).toMatch(
			/async write\(input: string\) \{\s+await waitForInput\(\);\s+if \(!input\) return;\s+applyPastedText\(input\);/s
		);
		expect(source).toMatch(
			/sandboxAcceptingInput = true;\s+flushPendingSandboxInput\(\);\s+return await runSandbox\(sandbox\.run\(code, false, log, prog, args, options\)\);/s
		);
		expect(source).toMatch(/\.finally\(\(\) => \{\s+sandboxAcceptingInput = false;/s);
	});

	it('uses rust-specific progress windows instead of jumping straight to the prepare band', () => {
		expect(source).toMatch(/prog\?\.set\?\.\(0\);/);
		expect(source).toMatch(/const progressBands = progressBandsForLanguage\(language\);/);
		expect(source).toMatch(
			/phaseProgress\(prog, progressBands\.load\[0\], progressBands\.load\[1\]\)/
		);
		expect(source).toMatch(/progressBands\.prepare\[0\]/);
		expect(source).toMatch(/progressBands\.prepare\[1\]/);
	});

	it('allows runtime progress stages to flow through the terminal progress sink', () => {
		expect(source).toMatch(/prog\?: \{ set\?: \(value: number, stage\?: string\) => void \}/);
	});
});
