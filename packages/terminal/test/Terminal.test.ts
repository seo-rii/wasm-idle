import source from '../src/Terminal.svelte?raw';
import pluginSource from '../src/plugin/index.ts?raw';
import Theme from '../src/theme.js';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Terminal source', () => {
	it('restores the cursor and retains ctrl+c stop handling', () => {
		expect(() =>
			compile(source, {
				filename: 'packages/terminal/src/Terminal.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/writeScreen\('\\u001B\[\?25h'\);/);
		expect(source).toMatch(
			/const isCopyShortcut =\s+\(ev\.ctrlKey \|\| ev\.metaKey\) && ev\.key\.toLowerCase\(\) === 'c';/
		);
	});

	it('requires an injected playground binding without importing the root runtime', () => {
		expect(source).toContain('playground: PlaygroundBinding;');
		expect(source).toContain('sandbox = await currentPlayground.load(language);');
		expect(source).not.toContain("from '$lib");
		expect(source).not.toMatch(/import load from/);
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
			/async stop\(\) \{\s+await wait\(\);\s+progressController\.invalidate\(\);\s+invalidatePreparedExecution\(\);\s+stopRequested = true;\s+finish = true;\s+sandboxAcceptingInput = false;\s+input = '';\s+inputCursor = 0;\s+discardPendingSandboxInput\(\);\s+if \(sandbox\?\.kill\) await sandbox\.kill\(\);\s+else await sandbox\?\.terminate\?\.\(\);\s+discardPendingSandboxInput\(\);\s+\}/s
		);
	});

	it('exposes a runtime restart that clears queued input before restarting the sandbox', () => {
		expect(source).toMatch(
			/async restartRuntime\(\) \{\s+await wait\(\);\s+if \(!sandbox\) return;\s+progressController\.invalidate\(\);\s+invalidatePreparedExecution\(\);\s+sandboxAcceptingInput = false;\s+discardPendingSandboxInput\(\);\s+input = '';\s+inputCursor = 0;\s+finish = true;\s+stopRequested = false;\s+tc \+= 1;\s+if \(sandbox\.restart\) await sandbox\.restart\(\);\s+else await sandbox\.clear\(\);\s+discardPendingSandboxInput\(\);\s+\}/s
		);
	});

	it('awaits debugger controls and queues source breakpoints before a sandbox is loaded', () => {
		expect(source).toMatch(
			/async debugCommand\(command: DebugCommand\) \{\s+await wait\(\);\s+await sandbox\.debugCommand\?\.\(command\);\s+\}/s
		);
		expect(source).toMatch(
			/async debugPause\(\) \{\s+await wait\(\);\s+await sandbox\.debugPause\?\.\(\);\s+\}/s
		);
		expect(source).toMatch(
			/async setBreakpoints\(lines: number\[\], sourcePath\?: string\) \{[\s\S]*?pendingDebugBreakpoints\.set\(sourcePath \|\| '', \[\.\.\.lines\]\);\s+pendingDebugSpecifications\.delete\(sourcePath \|\| ''\);\s+await wait\(\);\s+await sandbox\?\.setBreakpoints\?\.\(lines, sourcePath\);\s+\}/s
		);
		expect(source).toMatch(
			/sourceBreakpoints: Array\.from\(\s*pendingDebugBreakpoints,\s*\(\[sourcePath, lines\]\) => \(\{\s*sourcePath,\s*lines: \[\.\.\.lines\],[\s\S]*?\}\)\s*\)/s
		);
		expect(source).toMatch(
			/async debugReadMemory\(memoryReference: string, offset: number, count: number\) \{\s+await wait\(\);\s+return \(await sandbox\.debugReadMemory\?\.\(memoryReference, offset, count\)\) \?\? null;\s+\}/s
		);
		expect(source).toMatch(
			/async debugWriteMemory\([\s\S]*?await wait\(\);[\s\S]*?sandbox\.debugWriteMemory\?\.\(memoryReference, offset, data, allowPartial\)/
		);
		expect(source).toMatch(
			/async debugDataBreakpointInfo\(arguments_: DebugDataBreakpointInfoArguments\) \{\s+await wait\(\);\s+return \(await sandbox\.debugDataBreakpointInfo\?\.\(arguments_\)\) \?\? null;\s+\}/s
		);
		expect(source).toMatch(
			/async debugSetDataBreakpoints\(breakpoints: DebugDataBreakpoint\[\]\) \{\s+await wait\(\);\s+return \(await sandbox\.debugSetDataBreakpoints\?\.\(breakpoints\)\) \?\? \[\];\s+\}/s
		);
		expect(source).toMatch(
			/async debugScopes\(frameId: number\) \{\s+await wait\(\);\s+return \(await sandbox\.debugScopes\?\.\(frameId\)\) \?\? \[\];\s+\}/s
		);
	});

	it('activates xterm Unicode 11 width rules for CJK terminal cells', () => {
		expect(pluginSource).toMatch(/term\.unicode\.activeVersion = '11';/);
		expect(source).toContain('const unicode = core?.unicodeService;');
		expect(source).toMatch(/unicode\?\.getStringCellWidth\?\.\(text\)/);
		expect(source).not.toContain('const unicode = term?.unicode');
	});

	it('keeps a hidden transcript tail for browser debugging and Playwright assertions', () => {
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
		expect(source).toMatch(/loadedPlayground !== currentPlayground/);
		expect(source).toMatch(
			/function writeTerminalOutput\(text: string, executionOutput = false\)/
		);
		expect(source).not.toMatch(/debugOutput \+= text;/);
		expect(source).toMatch(/debugOutput = '';/);
		expect(source).toMatch(
			/<pre data-testid="terminal-debug-output" style="display: none;">\{debugOutput\}<\/pre>/
		);
	});

	it('reuses the same sandbox between prepare and run when language and runtime assets are unchanged', () => {
		expect(source).toMatch(
			/const requiresSandboxReset =[\s\S]*?ll !== language[\s\S]*?loadedRuntimeAssetsKey !== currentRuntimeAssetsKey[\s\S]*?loadedPlayground !== currentPlayground;/
		);
		expect(source).toMatch(
			/if \(sandbox && requiresSandboxReset\) \{\s+discardPendingSandboxInput\(\);\s+await sandbox\.clear\(\);\s+discardPendingSandboxInput\(\);\s+\}/s
		);
		expect(source).toMatch(/if \(!sandbox \|\| requiresSandboxReset\) \{/);
	});

	it('buffers stdin until the current sandbox is ready to accept it', () => {
		const prepareStart = source.slice(
			source.indexOf('async prepare('),
			source.indexOf('async run(', source.indexOf('async prepare('))
		);
		const runStart = source.slice(
			source.indexOf('async run('),
			source.indexOf('async destroy(', source.indexOf('async run('))
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
			/function discardPendingSandboxInput\(\) \{\s+pendingSandboxInput = \[\];\s+pendingSandboxEof = false;\s+\}/s
		);
		expect(source).toMatch(
			/if \(sandbox && sandboxAcceptingInput\) sandbox\.eof\?\.\(\);\s+else pendingSandboxEof = true;/s
		);
		expect(source).toMatch(
			/function finishSandboxRun\(\) \{\s+sandboxAcceptingInput = false;/s
		);
		expect(source).toMatch(/\.finally\(\(\) => \{\s+if \(finalize\) finishSandboxRun\(\);/s);
	});

	it('scopes progress lifecycles without fabricating cross-runtime phase bands', () => {
		expect(source).toContain('const progressController = new RuntimeProgressController();');
		expect(source).toMatch(
			/progressController\.begin\(\s+`\$\{language\}:\$\{\+\+progressLifecycleCounter\}`,\s+progress,\s+`Loading \$\{language\} runtime`/s
		);
		expect(source).toMatch(
			/finally \{\s+executionInputOwners -= 1;\s+lifecycle\.end\(\);\s+\}/s
		);
		expect(source).toMatch(
			/return \(\) => \{\s+initialization\.abort\(\);\s+void disposeTerminal\(\)\.catch/s
		);
		expect(source).toMatch(/sandbox\.load\(code, log, args, options, prepareProgress\)/);
		expect(source).toMatch(
			/runProgress\?\.report\?\.\(\{\s+kind: 'activity',\s+phase: 'starting'/s
		);
		expect(source).toMatch(/sandbox\.run\(code, true, log, prepareProgress, args, options\)/);
		expect(source).toMatch(
			/initSandbox\(language\)\.then\(async \(wasReset\) => \{\s+await sandbox\.load\(\s*code,\s*log,\s*args,\s*options,\s*activityOnlyProgress\(runProgress\)\s*\);\s+return wasReset;\s+\}\)/s
		);
		expect(source).toMatch(
			/sandbox\.run\(code, false, log, runProgress, args, executionOptions\)/
		);
		expect(source).not.toContain('phaseProgress');
		expect(source).not.toContain('progressBandsForLanguage');
	});

	it('reports readiness only from the final execution, never prepare completion', () => {
		expect(source).toMatch(
			/function activityOnlyProgress\([\s\S]+if \(event\.kind === 'activity'\) progress\.report\?\.\(event\);/s
		);
		expect(source).toMatch(
			/writeTerminalOutput\(output\.replaceAll\('\\n', '\\r\\n'\), true\)/
		);
		expect(source).toContain('const terminalOutputReadinessLanguages = new Set([');
		expect(source).toMatch(
			/executionOutput &&\s+activeExecutionLanguage &&\s+terminalOutputReadinessLanguages\.has\(activeExecutionLanguage\)[\s\S]+reason: 'stdout'/s
		);
		expect(source).toMatch(
			/if \(event\.type === 'pause'\) \{[\s\S]+reason: 'debug-paused'[\s\S]+\}/s
		);
		expect(source).toMatch(/reason: 'result'/);
		expect(source).toMatch(/kind: 'settled'/);
	});

	it('prepares direct ABI-fallback runs before arming output readiness', () => {
		const runSource = source.slice(
			source.indexOf('async run('),
			source.indexOf('async destroy(', source.indexOf('async run('))
		);
		expect(runSource).toMatch(
			/terminalOutputReadinessLanguages\.has\(language\)[\s\S]+sandbox\.run\(code, true, log, prepareProgress, args, options\)[\s\S]+activeExecutionProgress = runProgress;[\s\S]+sandbox\.run\(code, false, log, runProgress, args, executionOptions\)/s
		);
	});

	it('allows runtime progress stages to flow through the terminal progress sink', () => {
		expect(source).toMatch(/prog\?: ProgressLike/);
	});

	it('preserves timeout errors so the page can report a timed-out outcome', () => {
		expect(source).toContain('error instanceof TimeoutError');
		expect(source).toContain("error instanceof Error && error.name === 'TimeoutError'");
		expect(source).toMatch(/if \(isTimeoutError\(msg\)\) throw msg;/);
		expect(source).toMatch(
			/if \(isTimeoutError\(error\)\) \{[\s\S]+outcome: 'timed-out'[\s\S]+throw error;/s
		);
	});
});
