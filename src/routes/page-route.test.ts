import layoutSource from './+layout.svelte?raw';
import source from './+page.svelte?raw';
import { createApplicationRuntimeAssets } from '$lib/playground/applicationAssets';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { createExecutionPreflightGate } from './executionPreflight';
import {
	argsHelpLanguages,
	argsLabels,
	compilerDiagnosticLanguages,
	editorLanguages,
	editorOnlyLanguages,
	languageLabels,
	playgroundLanguages,
	type PlaygroundLanguage
} from './language-registry';

const applicationRuntimeAssets = createApplicationRuntimeAssets('/wasm-idle');

const expectEditorLanguage = (language: PlaygroundLanguage, editorLanguage: string) => {
	expect(editorLanguages[language]).toBe(editorLanguage);
};

const expectPlaygroundLanguage = (language: PlaygroundLanguage) => {
	expect(playgroundLanguages).toContain(language);
	expect(languageLabels[language]).toBeTruthy();
};

describe('example route debug actions', () => {
	it('swaps run/debug actions for stop buttons while sessions are active', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/async function stopExecution\(\) \{/);
		expect(source).toMatch(/if \(!terminal \|\| !runningMode\) return;/);
		expect(source).toMatch(/if \(runningMode === 'debug'\) \{/);
		expect(source).toMatch(/await debug\.stop\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'run'\}\s+<button class="action-button action-button--stop" onclick=\{stopExecution\}>/s
		);
		expect(source).toMatch(/<span>Stop Running<\/span>/);
		expect(source).toMatch(/await terminal\.stop\?\.\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'debug'\}\s+<button\s+class="action-button action-button--debug-restart"/s
		);
		expect(source).toContain('aria-label="Restart Debug"');
		expect(source).toContain(
			'<button class="action-button action-button--stop" onclick={stopExecution}>'
		);
		expect(source).toMatch(/<span>Stop Debug<\/span>/);
		expect(source).toMatch(/disabled=\{runningMode === 'debug' \|\| !executionAvailable\}/);
		expect(source).toMatch(/async function sendTerminalEof\(\) \{/);
		expect(source).toMatch(/await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(/title="Send EOF"/);
	});

	it('delegates debug state, runtime watches, and run-to-cursor to the shared debug controller', () => {
		const executionStart = source.indexOf('function exec(');
		const executionCatchStart = source.indexOf('} catch (error) {', executionStart);
		const executionCatch = source.slice(
			executionCatchStart,
			source.indexOf('} finally', executionCatchStart) + '} finally'.length
		);
		expect(source).toMatch(
			/import Terminal, \{ type TerminalControl \} from '@wasm-idle\/terminal';/
		);
		expect(source).toMatch(
			/import \{ createPlaygroundBinding, isSharedArrayBufferAvailable \} from '\$lib';/
		);
		expect(source).toMatch(
			/import \{\s+createDebugSessionController,\s+cppDebugLanguageAdapter,\s+goDebugLanguageAdapter,\s+pythonDebugLanguageAdapter,\s+rustDebugLanguageAdapter,\s+type DebugLanguageAdapter\s+\} from '@wasm-idle\/debug';/s
		);
		expect(source).toMatch(
			/const debugLanguageAdapters(?:: Partial<Record<PlaygroundLanguage, DebugLanguageAdapter>>)? = \{/
		);
		expect(source).toMatch(/GO: goDebugLanguageAdapter/);
		expect(source).toMatch(/RUST: rustDebugLanguageAdapter/);
		expect(source).toMatch(/C: cppDebugLanguageAdapter/);
		expect(source).toMatch(/CPP: cppDebugLanguageAdapter/);
		expect(source).toMatch(/OBJC: cppDebugLanguageAdapter/);
		expect(source).toMatch(/PYTHON: pythonDebugLanguageAdapter/);
		expect(source).toMatch(/const debug = createDebugSessionController\(\{/);
		expect(source).toMatch(/syncBreakpointsWhile: \(\) => runningMode === 'debug'/);
		expect(source).toMatch(/\$effect\(\(\) => \{\s+debug\.setTerminal\(terminal\);\s+\}\);/s);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+debug\.setAdapter\(debugLanguage\);\s+\}\);/s
		);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+debug\.setSourcePath\(activeDebugSourcePath\);\s+\}\);/s
		);
		expect(source).toMatch(/debug\.begin\(\);/);
		expect(source).toMatch(
			/debug\.markSourceRevisionStale\(`\/workspace\/\$\{file\.path\}`\);/
		);
		expect(source).toMatch(/debug\.sourceRevisionStale/);
		expect(source).toContain('<span>Source</span>');
		expect(source).toContain('<strong>Changed</strong>');
		expect(source).toMatch(/breakpoints: \[\.\.\.debug\.effectiveBreakpoints\],/);
		expect(source).toMatch(/sourceBreakpoints: debug\.sourceBreakpoints\.filter/);
		expect(source).toMatch(
			/const lldbDebugLanguages = new Set<PlaygroundLanguage>\(\['C', 'CPP', 'RUST'\]\);/
		);
		expect(source).toMatch(
			/const selectedDebugMode = \$derived\(\s*lldbDebugLanguages\.has\(language\) \? \('lldb' as const\) : \('trace' as const\)\s*\);/s
		);
		expect(source).toMatch(/language !== 'RUST' \|\| rustTargetTriple === 'wasm32-wasip1'/);
		expect(source).toMatch(/if \(executionDebugMode === 'lldb'\) \{/);
		expect(source).toMatch(/executionDebugMode = 'trace';/);
		expect(source).not.toMatch(/parseDebugRuntimeManifest\(await response\.json\(\)\)/);
		expect(source).toMatch(
			/resolveDebugRuntimeUrls\(\s*runtimeAssets,\s*globalThis\.location\.href\s*\)/s
		);
		expect(source).toMatch(
			/loadVerifiedDebugRuntimeManifest\(\s*debugRuntime\.manifestUrl,\s*debugRuntime\.manifestReceipt,\s*fetch,\s*preflight\.signal\s*\)/s
		);
		expect(source).not.toContain('preflightDebugRuntimeAssets');
		expect(source).toContain('if (!executionPreflight.isCurrent(preflight)) return;');
		expect(source).toMatch(/signal: preflight\.signal,/);
		expect(source.includes('interactive: enableDebug,')).toBe(true);
		expect(executionCatch).toMatch(
			/catch \(error\) \{\s+if \(\s*preflight\.signal\.aborted &&\s*!executionPreflight\.isCurrent\(preflight\)\s*\)\s+return;\s+throw error;\s+\} finally/s
		);
		expect(executionCatch).not.toContain('error === preflight.signal.reason');
		expect(source).toMatch(/if \(!debug\.paused\) debug\.reset\(\);/);
		expect(source).toMatch(
			/title=\{debug\.cursorLine\s+\?\s+`Run to Cursor \(L\$\{debug\.cursorLine\}\)`\s+:\s+'Run to Cursor'\}/
		);
		expect(source).toMatch(
			/aria-label=\{debug\.cursorLine\s+\?\s+`Run to Cursor \(L\$\{debug\.cursorLine\}\)`\s+:\s+'Run to Cursor'\}/
		);
		expect(source).toMatch(/onclick=\{\(\) => runToCursorWhileDataBreakpointIdle\(\)\}/);
		expect(source).toMatch(/disabled=\{!debug\.canRunToCursor \|\| dataBreakpointLoading\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.sendCommand\('continue'\)\}/);
		expect(source).toMatch(/ondebug=\{onDebugEvent\}/);
		expect(source).toMatch(/bind:value=\{debug\.watchInput\}/);
		expect(source).toMatch(/bind:value=\{debug\.watchInput\}\s+maxlength=\{4096\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.addWatchExpression\(\)\}/);
		expect(source).toMatch(
			/onclick=\{\(\) =>\s+debug\.removeWatchExpression\(watch\.expression\)\}/
		);
		expect(source).toMatch(/debugLocals=\{debug\.locals\}/);
		expect(source).toMatch(/pausedLine=\{debug\.pausedLine\}/);
		expect(source).toMatch(/onRunToCursor=\{runToCursorWhileDataBreakpointIdle\}/);
		expect(source).toMatch(/<span class="material-symbols-outlined">play_circle<\/span>/);
	});

	it('provides a bounded LLDB memory inspector with stale-request invalidation', () => {
		expect(source).toContain('const MAX_DEBUG_MEMORY_BYTES = 256;');
		expect(source).toContain('let memoryResult = $state.raw<DebugMemoryView | null>(null);');
		expect(source).toContain('let memoryRows = $state.raw<DebugMemoryRow[]>([]);');
		expect(source).toContain("let memoryCountInput = $state('4');");
		expect(source).not.toContain('const memoryRows = $derived.by');
		expect(source).toContain('async function readDebugMemoryPage(pageDelta = 0)');
		expect(source).toContain('memoryRequestVersion += 1;');
		expect(source).toContain("event.type === 'resume' || event.type === 'stop'");
		expect(source).not.toContain(
			"event.type === 'pause' || event.type === 'resume' || event.type === 'stop'"
		);
		expect(source).toMatch(
			/if \(\s*requestVersion !== memoryRequestVersion \|\|\s*!debug\.paused \|\|\s*debug\.frameId !== frameId\s*\)\s*return;/s
		);
		expect(source).toMatch(/activeDebugBackend === 'lldb' &&\s*debug\.paused/s);
		expect(source).toContain('aria-label="Memory reference"');
		expect(source).toContain('aria-label="Memory offset"');
		expect(source).toContain('aria-label="Memory byte count"');
		expect(source).toContain('class="debug-memory-byte debug-memory-byte--unreadable"');
		expect(source).toContain('aria-label={`Inspect memory for ${variable.name}`}');
		expect(source).toContain('readDebugMemoryPage(-1)');
		expect(source).toContain('readDebugMemoryPage(1)');
		expect(source).toContain('debug.capabilities.readMemory');
		expect(source).toContain('debug.capabilities.writeMemory');
		expect(source).toContain('debug.capabilities.dataBreakpoints');
	});

	it('sets one session-scoped LLDB memory data breakpoint from the inspector', () => {
		expect(source).toContain(
			"let dataBreakpointAccessType = $state<DebugDataBreakpointAccessType>('write');"
		);
		expect(source).toContain(
			'let activeDataBreakpoint = $state.raw<ActiveDebugDataBreakpoint | null>(null);'
		);
		expect(source).toContain('async function setMemoryDataBreakpoint()');
		expect(source).toContain('async function clearMemoryDataBreakpoint()');
		expect(source).toContain('debug.dataBreakpointInfo({');
		expect(source).toMatch(/debug\.setDataBreakpoints\(\[\s*\{/s);
		expect(source).toContain("event.type === 'stop'");
		expect(source).toContain('aria-label="Data breakpoint access"');
		expect(source).toContain('aria-label="Set data breakpoint"');
		expect(source).toContain('aria-label="Clear data breakpoint"');
		expect(source).toContain('class="debug-data-breakpoint-status"');
		expect(source).toContain('dataBreakpointInfo: (');
		expect(source).toContain('setDataBreakpoints: (');
		expect(source).toContain('let dataBreakpointLoadingOwner: number | null = null;');
		expect(source).toMatch(
			/function runToCursorWhileDataBreakpointIdle\(targetLine\?: number \| null\) \{\s+if \(dataBreakpointLoadingOwner !== null\) return Promise\.resolve\(false\);\s+return debug\.runToCursor\(targetLine\);\s+\}/
		);
		expect(source).toMatch(
			/async function setMemoryDataBreakpoint\(\) \{[\s\S]*?if \(dataBreakpointLoadingOwner !== null\) return;[\s\S]*?const accessType = dataBreakpointAccessType;[\s\S]*?info\.accessTypes\.includes\(accessType\)[\s\S]*?activeDataBreakpoint = null;[\s\S]*?await debug\.setDataBreakpoints\(\[[\s\S]*?accessType[\s\S]*?\]\)/
		);
		expect(source).toMatch(
			/async function clearMemoryDataBreakpoint\(\) \{[\s\S]*?if \(dataBreakpointLoadingOwner !== null\) return;[\s\S]*?activeDataBreakpoint = null;[\s\S]*?await debug\.setDataBreakpoints\(\[\]\)/
		);
		expect(source).toMatch(
			/finally \{\s+if \(dataBreakpointLoadingOwner === requestVersion\) \{\s+dataBreakpointLoadingOwner = null;\s+dataBreakpointLoading = false;\s+\}\s+\}/
		);
		expect(source).toMatch(
			/bind:value=\{dataBreakpointAccessType\}\s+disabled=\{dataBreakpointLoading\}/
		);
		expect(source).toMatch(
			/onclick=\{\(\) => debug\.sendCommand\('continue'\)\}\s+disabled=\{!debug\.paused \|\| dataBreakpointLoading\}/
		);
		expect(source).toMatch(
			/class="debug-frame-select"\s+disabled=\{!frame\.id \|\| dataBreakpointLoading\}/
		);
	});

	it('writes bounded hexadecimal bytes through the paused LLDB memory inspector', () => {
		expect(source).toContain("let memoryWriteInput = $state('');");
		expect(source).toContain('let memoryWriteStatus = $state.raw<');
		expect(source).toContain('async function writeDebugMemoryPage()');
		expect(source).toMatch(
			/debug\.writeMemory\(\s*requestedReference,\s*offset,\s*Uint8Array\.from\(bytes\),\s*false\s*\)/s
		);
		expect(source).toContain('aria-label="Memory write bytes"');
		expect(source).toContain('aria-label="Write memory"');
		expect(source).toContain('class="debug-memory-write-status"');
	});

	it('restarts LLDB debugging through a fully disposed fresh execution', () => {
		expect(source).toContain('let restartDebugPending = $state(false);');
		expect(source).toContain('let executionGeneration = 0;');
		expect(source).toContain('async function restartDebugExecution()');
		expect(source).toContain('const previousExecution = activeExecution;');
		expect(source).toContain('restartRequestGeneration += 1;');
		expect(source).toContain('if (restartRequestGeneration !== requestGeneration) return;');
		expect(source).toContain('await debug.stop();');
		expect(source).toContain('await previousExecution;');
		expect(source).toContain('await exec(true);');
		expect(source).toContain('executionPreflight.cancel();');
		expect(source).toContain('aria-label="Restart Debug"');
		expect(source).toContain('disabled={restartDebugPending}');
		expect(source).toMatch(
			/if \(executionGeneration === generation\) \{[\s\S]*?runningMode = null;\s+activeExecution = null;/
		);
	});

	it('keeps a stopped preflight obsolete and admits a clean relaunch', async () => {
		const gate = createExecutionPreflightGate();
		let releasePreflight!: () => void;
		const stalledPreflight = new Promise<void>((resolve) => {
			releasePreflight = resolve;
		});
		let executionCount = 0;
		const first = gate.begin();
		const obsoleteRun = (async () => {
			await stalledPreflight;
			if (gate.isCurrent(first)) executionCount += 1;
		})();

		gate.cancel();
		expect(first.signal.aborted).toBe(true);
		releasePreflight();
		await obsoleteRun;
		expect(executionCount).toBe(0);

		const relaunch = gate.begin();
		if (gate.isCurrent(relaunch)) executionCount += 1;
		gate.finish(relaunch);
		expect(executionCount).toBe(1);
	});

	it('navigates the workspace editor when an LLDB frame belongs to another source', () => {
		expect(source).toContain(
			'async function selectDebugFrame(frame: DebugFrame) {\n\t\tdataBreakpointRequestVersion += 1;'
		);
		expect(source).toMatch(
			/async function selectDebugFrame\(frame: DebugFrame\) \{\s+dataBreakpointRequestVersion \+= 1;\s+invalidateMemoryInspector\(\);\s+if \(!frame\.id \|\| !\(await debug\.selectFrame\(frame\.id\)\)\) return;\s+const workspacePath = normalizePath\(\s*frame\.sourcePath\?\.replace\(\/\^\\\/workspace\\\/\/u, ''\) \|\| ''\s*\);\s+if \(!workspacePath \|\| !files\.some\(\(file\) => file\.path === workspacePath\)\) return;\s+selectFile\(workspacePath\);\s+debug\.setSourcePath\(`\/workspace\/\$\{workspacePath\}`\);\s+\}/s
		);
		expect(source).toMatch(/onclick=\{\(\) => selectDebugFrame\(frame\)\}/);
	});

	it('preloads stdin when SharedArrayBuffer is unavailable or Bash is selected', () => {
		expect(source).not.toMatch(/location\.reload\(\)/);
		expect(source).toMatch(
			/const sharedBufferAvailable = \$derived\(\s*!browser \|\| isSharedArrayBufferAvailable\(\)\s*\);/s
		);
		expect(source).toMatch(
			/const preloadedStdin =\s+sharedBufferAvailable && language !== 'BASH' \? undefined : stdinInput;/s
		);
		expect(source).toMatch(/stdin: preloadedStdin/);
		expect(source).toMatch(
			/\{#if !sharedBufferAvailable \|\| language === 'BASH'\}\s+<div class="stdin-panel">/s
		);
		expect(source).toMatch(/bind:value=\{stdinInput\}/);
		expect(source).toMatch(
			/disabled=\{!!runningMode \|\|\s+!debugLanguage \|\|\s+!sharedBufferAvailable \|\|\s+!debugTargetAvailable\}/s
		);
	});

	it('derives non-debug runtime assets from the deployed application base', () => {
		expect(source).toContain("from '$lib/playground/applicationAssets';");
		expect(source).toContain('const applicationRootUrl = base;');
		expect(source).toContain(
			'const resolveApplicationAsset = createApplicationAssetResolver(applicationRootUrl);'
		);
		expect(source).toMatch(
			/let runtimeAssets = \$derived\.by\(\(\) => \(\{\s+\.\.\.createApplicationRuntimeAssets\(applicationRootUrl\),/s
		);
		expect(source).toMatch(
			/\{#each playgroundLanguages as languageOption \(languageOption\)\}\s+<option value=\{languageOption\}>\{languageLabels\[languageOption\]\}<\/option>/s
		);
		expect(source).not.toMatch(/import \{ WASM_[A-Z_]+_ASSET_VERSION \}/u);
		expect(source).toMatch(
			/const playground = \$derived\.by\(\(\) => createPlaygroundBinding\(runtimeAssets\)\);/
		);
		expect(source).toMatch(/<Terminal\s+bind:terminal\s+\{playground\}/s);
		expect(applicationRuntimeAssets.rootUrl).toBe('/wasm-idle');

		for (const [runtime, config] of Object.entries(applicationRuntimeAssets)) {
			if (runtime === 'rootUrl' || !config || typeof config !== 'object') continue;
			for (const [key, value] of Object.entries(config)) {
				if (typeof value !== 'string') continue;
				if (key.endsWith('Fingerprint')) {
					expect(value).toMatch(/^[a-f0-9]{64}$/u);
				} else if (key.endsWith('Url')) {
					expect(value).toMatch(/^\/wasm-idle\//u);
				}
			}
		}
	});

	it('persists and forwards the Rust target triple selection', () => {
		expect(source).toMatch(
			/type WasmRustRuntimeModule = \{\s+preloadBrowserRustRuntime\?: \(options\?: \{\s+targetTriple\?: RustTargetTriple;\s+\}\) => Promise<void>;\s+\};/s
		);
		expect(source).toMatch(/rustTargetTriple = \$state<RustTargetTriple>\('wasm32-wasip1'\),/);
		expect(source).toMatch(/if \(!browser \|\| language !== 'RUST'\) return;/);
		expect(source).toMatch(
			/const compilerUrl = runtimeAssets\.rust\?\.compilerUrl;\s+const preloadTargetTriple = availableRustTargetTriples\.includes\(rustTargetTriple\)\s+\?\s+rustTargetTriple\s+:\s+availableRustTargetTriples\[0\];/s
		);
		expect(source).toMatch(
			/const runtimeModule = \(await import\(\s+\/\* @vite-ignore \*\/ compilerUrl\s+\)\) as WasmRustRuntimeModule;/
		);
		expect(source).toMatch(
			/await runtimeModule\.preloadBrowserRustRuntime\?\.\(\{\s+targetTriple: preloadTargetTriple\s+\}\);/s
		);
		expect(source).toMatch(
			/const knownRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'\] as const;/
		);
		expect(source).toMatch(
			/let availableRustTargetTriples = \$state<RustTargetTriple\[]>\(\[\s*'wasm32-wasip1',\s*'wasm32-wasip2'\s*\]\);/s
		);
		expect(source).toMatch(/localStorage\.setItem\('rustTargetTriple', rustTargetTriple\);/);
		expect(source).toMatch(/const manifestUrl = runtimeAssets\.rust\?\.manifestUrl;/);
		expect(applicationRuntimeAssets.rust?.manifestUrl).toContain(
			'/wasm-rust/runtime/runtime-manifest.v3.json?'
		);
		expect(source).toMatch(
			/const response = await fetch\(manifestUrl, \{ cache: 'no-store' \}\);/
		);
		expect(source).toMatch(
			/const nextAvailableRustTargetTriples = knownRustTargetTriples\.filter\(\s*\(targetTriple\) =>\s*Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, targetTriple\)\s*\);/s
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \[\.\.\.nextAvailableRustTargetTriples\];/
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2'\];/
		);
		expect(source).toMatch(/const editorLanguage = \$derived\(editorLanguages\[language\]\);/);
		expectEditorLanguage('ELIXIR', 'elixir');
		expectEditorLanguage('ERLANG', 'erlang');
		expectEditorLanguage('PROLOG', 'prolog');
		expectEditorLanguage('GLEAM', 'gleam');
		expectEditorLanguage('PERL', 'perl');
		expectEditorLanguage('JAVASCRIPT', 'javascript');
		expectEditorLanguage('TYPESCRIPT', 'typescript');
		expectEditorLanguage('ASSEMBLYSCRIPT', 'typescript');
		expectEditorLanguage('WAT', 'wat');
		expectEditorLanguage('LUA', 'lua');
		expectEditorLanguage('ZIG', 'zig');
		expectEditorLanguage('LISP', 'lisp');
		expectEditorLanguage('RUBY', 'ruby');
		expectEditorLanguage('HASKELL', 'haskell');
		expectEditorLanguage('R', 'r');
		expectEditorLanguage('BQN', 'bqn');
		expectEditorLanguage('JANET', 'janet');
		expectEditorLanguage('FORTRAN', 'fortran');
		expectEditorLanguage('COBOL', 'cobol');
		expectEditorLanguage('GRAPHQL', 'graphql');
		expectEditorLanguage('DUCKDB', 'sql');
		expectEditorLanguage('JSON', 'json');
		expectEditorLanguage('YAML', 'yaml');
		expectEditorLanguage('TOML', 'toml');
		expectEditorLanguage('HTML', 'html');
		expectEditorLanguage('CSS', 'css');
		expectEditorLanguage('MARKDOWN', 'markdown');
		expect(source).toMatch(/RUST: \(\) => \(\{ rustTargetTriple \}\)/);
		expect(source).toMatch(/\.\.\.languageExecutionOptions/);
		expect(source).toMatch(/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/);
		expect(source).toMatch(
			/\{#each availableRustTargetTriples as targetTriple \(targetTriple\)\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(source).toMatch(/rustTargetTriple=\{languageExecutionOptions\.rustTargetTriple\}/);
	});

	it('persists and forwards the Go target selection', () => {
		expect(source).toMatch(
			/type WasmGoRuntimeModule = \{\s+preloadBrowserGoRuntime\?: \(options\?: \{\s*target\?: GoTarget;?\s*\}\) => Promise<void>;\s+\};/s
		);
		expect(source).toMatch(/GoTarget,/);
		expect(source).toMatch(/goTarget = \$state<GoTarget>\('wasip1\/wasm'\),/);
		expect(source).toMatch(/if \(!browser \|\| language !== 'GO'\) return;/);
		expect(source).toMatch(/const compilerUrl = runtimeAssets\.go\?\.compilerUrl;/);
		expect(source).toMatch(
			/const preloadTarget = availableGoTargets\.includes\(goTarget\)\s+\?\s+goTarget\s+:\s+availableGoTargets\[0\];/
		);
		expect(source).toMatch(
			/const runtimeModule = \(await import\(\s+\/\* @vite-ignore \*\/ compilerUrl\s+\)\) as WasmGoRuntimeModule;/
		);
		expect(source).toMatch(
			/await runtimeModule\.preloadBrowserGoRuntime\?\.\(\{\s+target: preloadTarget\s+\}\);/s
		);
		expect(source).toMatch(
			/const knownGoTargets = \['wasip1\/wasm', 'wasip2\/wasm', 'wasip3\/wasm', 'js\/wasm'\] as const;/
		);
		expect(source).toMatch(
			/let availableGoTargets = \$state<GoTarget\[]>\(\['wasip1\/wasm'\]\);/
		);
		expect(source).toMatch(/localStorage\.setItem\('goTarget', goTarget\);/);
		expect(source).toMatch(/const storedGoTarget = localStorage\.getItem\('goTarget'\);/);
		expect(source).toMatch(/const manifestUrl = runtimeAssets\.go\?\.manifestUrl;/);
		expect(applicationRuntimeAssets.go?.manifestUrl).toContain(
			'/wasm-go/runtime/runtime-manifest.v1.json?'
		);
		expect(source).toMatch(
			/const nextAvailableGoTargets = knownGoTargets\.filter\(\s*\(target\) =>\s*Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, target\)\s*\);/s
		);
		expect(source).toMatch(/availableGoTargets = \[\.\.\.nextAvailableGoTargets\];/);
		expect(source).toMatch(/availableGoTargets = \['wasip1\/wasm'\];/);
		expect(source).toMatch(/GO: \(\) => \(\{ goTarget \}\)/);
		expect(source).toMatch(/requestedGoTarget === 'js\/wasm'/);
		expect(source).toMatch(/storedGoTarget === 'js\/wasm'/);
		expect(source).toMatch(/<select id="go-target" bind:value=\{goTarget\}>/);
		expect(source).toMatch(
			/\{#each availableGoTargets as target \(target\)\}\s+<option value=\{target\}>\{target\}<\/option>\s+\{\/each\}/s
		);
	});

	it('exposes a browser debug hook that writes terminal stdin through the bound control', () => {
		expect(source).toMatch(
			/type WasmIdleDebugApi = \{\s+writeTerminalInput: \(text: string, eof\?: boolean\) => Promise<void>;\s+getEditorValue: \(\) => string;\s+setEditorValue: \(text: string\) => Promise<boolean>;\s+setWorkspaceFiles: \(files: WorkspaceFile\[], activePath\?: string\) => Promise<boolean>;\s+setBreakpoints: \(lines: number\[]\) => void;\s+getDebugState: \(\) => \{\s+paused: boolean;\s+pausedLine: number \| null;\s+sourcePath: string;\s+pausedSourcePath: string \| null;\s+sourceRevisionStale: boolean;\s+frameId: number \| null;\s+callStack: DebugFrame\[];\s+scopes: DebugScope\[];\s+variablesByReference: Array<\[number, DebugVariable\[]\]>;\s+\};\s+selectDebugFrame: \(frameId: number\) => Promise<boolean>;\s+loadDebugVariables: \(\s+variablesReference: number,\s+start\?: number,\s+count\?: number\s+\) => Promise<DebugVariable\[]>;\s+readDebugMemory: \(\s+memoryReference: string,\s+offset: number,\s+count: number\s*\) => Promise<\{\s+address\?: string;\s+data: number\[\];\s+unreadableBytes: number;\s+\} \| null>;\s+setPreloadedStdin: \(text: string\) => void;\s+\};/s
		);
		expect(source).toMatch(/let browserDebugHookVersion = 0;/);
		expect(source).toMatch(/const debugHookVersion = \+\+browserDebugHookVersion;/);
		expect(source).toMatch(/target\.__wasmIdleDebug = debugApi;/);
		expect(source).toMatch(
			/if \(browserDebugHookVersion === debugHookVersion\) delete target\.__wasmIdleDebug;/
		);
		expect(source).toMatch(/await terminal\.waitForInput\?\.\(\);/);
		expect(source).toMatch(/await terminal\.write\(text\);/);
		expect(source).toMatch(/if \(eof\) await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(
			/getEditorValue\(\) \{\s+return editor\?\.getValue\(\) \|\| '';\s+\}/s
		);
		expect(source).toMatch(
			/async setEditorValue\(text: string\) \{\s+if \(!editor\) return false;\s+editor\.setValue\(text\);\s+updateActiveContent\(text\);\s+await Promise\.resolve\(\);\s+return editor\.getValue\(\) === text && activeFile\?\.content === text;\s+\}/s
		);
		expect(source).toMatch(/setPreloadedStdin\(text: string\) \{\s+stdinInput = text;\s+\}/s);
		expect(source).toMatch(
			/setBreakpoints\(lines: number\[]\) \{\s+debug\.setBreakpoints\(lines\);\s+\}/s
		);
		expect(source).toMatch(
			/getDebugState\(\) \{[\s\S]*paused: debug\.paused,[\s\S]*pausedLine: debug\.pausedLine,[\s\S]*sourcePath: debug\.sourcePath,[\s\S]*pausedSourcePath: debug\.pausedSourcePath,[\s\S]*sourceRevisionStale: debug\.sourceRevisionStale,[\s\S]*frameId: debug\.frameId,[\s\S]*scopes: debug\.scopes\.map\([\s\S]*variablesByReference: Array\.from\(\s*debug\.variablesByReference,[\s\S]*\);\s+\}/s
		);
		expect(source).toMatch(
			/loadDebugVariables\(variablesReference: number, start\?: number, count\?: number\) \{\s+return debug\.loadVariableChildren\(variablesReference, start, count\);\s+\}/s
		);
		expect(source).toMatch(
			/selectDebugFrame\(frameId: number\) \{\s+return debug\.selectFrame\(frameId\);\s+\}/s
		);
		expect(source).toMatch(
			/readDebugMemory:\s*\(\s*memoryReference: string,\s*offset: number,\s*count: number\s*\) => Promise<\{\s*address\?: string;\s*data: number\[\];\s*unreadableBytes: number;\s*\} \| null>;/s
		);
		expect(source).toMatch(
			/async readDebugMemory\(memoryReference: string, offset: number, count: number\) \{\s+const memory = await debug\.readMemory\(memoryReference, offset, count\);\s+return memory \? \{ \.\.\.memory, data: Array\.from\(memory\.data\) \} : null;\s+\}/s
		);
		expect(source).toContain('writeDebugMemory: (');
		expect(source).toMatch(
			/return debug\.writeMemory\([\s\S]{0,160}Uint8Array\.from\(data\)[\s\S]{0,80}allowPartial/
		);
		expect(source).toMatch(/onclick=\{\(\) => selectDebugFrame\(frame\)\}/);
		expect(source).toMatch(/debug\.frameId === frame\.id && 'debug-entry--current'/);
	});

	it('marks replaced non-active workspace sources stale during an active debug session', () => {
		expect(source).toMatch(
			/const previousWorkspaceFiles = new Map\(\s*files\.map\(\(file\) => \[file\.path, file\.content\]\)\s*\);/s
		);
		expect(source).toMatch(
			/const replacementWorkspaceFiles = new Map\(\s*sanitizedFiles\.map\(\(file\) => \[file\.path, file\.content\]\)\s*\);/s
		);
		expect(source).toMatch(
			/const replacedSourcePaths = new Set\(\s*\[\s*\.\.\.previousWorkspaceFiles\.keys\(\),\s*\.\.\.replacementWorkspaceFiles\.keys\(\)\s*\]\.filter\(\s*\(sourcePath\) => sourcePath !== nextActiveFilePath\s*\)\s*\);/s
		);
		expect(source).toMatch(
			/if \(\s*debug\.active &&\s*previousWorkspaceFiles\.get\(sourcePath\) !==\s*replacementWorkspaceFiles\.get\(sourcePath\)\s*\) \{\s*debug\.markSourceRevisionStale\(`\/workspace\/\$\{sourcePath\}`\);\s*\}/s
		);
	});

	it('keeps browser stdin helper wiring separate from the shared debug controller', () => {
		expect(source).not.toMatch(/terminalControl\?\.debugEvaluate/);
		expect(source).toMatch(/createDebugSessionController/);
	});

	it('keeps LSP opt-in and persists the toggle in workspace snapshots', () => {
		expect(source).toMatch(/lspEnabled = \$state\(false\),/);
		expect(source).toMatch(
			/function snapshot\(\): WorkspaceSnapshot \{[\s\S]*log,\s+lspEnabled,[\s\S]*version: 5,/s
		);
		expect(source).toMatch(
			/if \(typeof value\?\.lspEnabled === 'boolean'\) lspEnabled = value\.lspEnabled;/
		);
		expect(source).toMatch(
			/<input id="lsp-toggle" type="checkbox" bind:checked=\{lspEnabled\} \/>/
		);
		expect(source).toMatch(
			/<Monaco[\s\S]*\{lspEnabled\}[\s\S]*clangdEnabled=\{clangdLspEnabled\}/s
		);
		expect(source).toMatch(/\{typescriptLspLibUrl\}/);
	});

	it('shows a Rust stdin hint that explains EOF for read-to-end programs', () => {
		expect(source).toMatch(/press Enter to send a line\./);
		expect(source).toMatch(
			/selector only shows\s+Rust targets advertised by the bundled wasm-rust runtime manifest/
		);
		expect(source).toMatch(/`wasm32-wasip1`\s+uses preview1 core wasm/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip2'\)/);
		expect(source).toMatch(/`wasm32-wasip2`\s+uses preview2 component execution/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip3'\)/);
		expect(source).toMatch(
			/`wasm32-wasip3`\s+is only shown for the current transitional component path/
		);
		expect(source).toMatch(/Use\s+Ctrl\+D or the EOF button while running/);
	});

	it('publishes upstream TinyGo without exposing unsupported target controls', () => {
		expect(applicationRuntimeAssets.tinygo?.moduleUrl).toContain('/wasm-tinygo/upstream.js?');
		expect(playgroundLanguages).toContain('TINYGO');
		expect(languageLabels.TINYGO).toBe('TinyGo');
		expect(source).not.toMatch(/TinyGoTarget|tinygoTarget|knownTinyGoTargets/);
		expectPlaygroundLanguage('GO');
		expectPlaygroundLanguage('TINYGO');
		expectPlaygroundLanguage('D');
		expectPlaygroundLanguage('CSHARP');
		expectPlaygroundLanguage('FSHARP');
		expectPlaygroundLanguage('VBNET');
		expectPlaygroundLanguage('ELIXIR');
		expectPlaygroundLanguage('ERLANG');
		expectPlaygroundLanguage('PROLOG');
		expectPlaygroundLanguage('GLEAM');
		expectPlaygroundLanguage('PERL');
		expectPlaygroundLanguage('PASCAL');
		expectPlaygroundLanguage('CLOJURESCRIPT');
		expectPlaygroundLanguage('FORTH');
		expectPlaygroundLanguage('J');
		expectPlaygroundLanguage('BQN');
		expectPlaygroundLanguage('JANET');
		expectPlaygroundLanguage('OCAML');
		expectPlaygroundLanguage('JAVASCRIPT');
		expectPlaygroundLanguage('TYPESCRIPT');
		expectPlaygroundLanguage('ASSEMBLYSCRIPT');
		expectPlaygroundLanguage('WAT');
		expectPlaygroundLanguage('LUA');
		expectPlaygroundLanguage('ZIG');
		expectPlaygroundLanguage('LISP');
		expectPlaygroundLanguage('RUBY');
		expectPlaygroundLanguage('HASKELL');
		expectPlaygroundLanguage('R');
		expectPlaygroundLanguage('OCTAVE');
		expectPlaygroundLanguage('SQLITE');
		expectPlaygroundLanguage('PHP');
		expect(source).toMatch(/\{#if argsHelpLanguages\.has\(language\)\}/);
		for (const argsLanguage of [
			'JAVA',
			'RUST',
			'GO',
			'TINYGO',
			'D',
			'CSHARP',
			'FSHARP',
			'VBNET',
			'PROLOG',
			'GLEAM',
			'PERL',
			'TCL',
			'AWK',
			'JAVASCRIPT',
			'TYPESCRIPT',
			'LUA',
			'ZIG',
			'LISP',
			'RUBY',
			'HASKELL',
			'R',
			'OCTAVE',
			'PHP'
		] as const) {
			expect(argsHelpLanguages.has(argsLanguage)).toBe(true);
		}
		expect(source).toMatch(/Go uses the bundled `wasm-go` browser compiler runtime/);
		expect(source).toMatch(
			/selector only shows Go\s+targets advertised by the bundled runtime manifest/
		);
		expect(source).toMatch(/`wasip1\/wasm`/);
		expect(source).toMatch(/preview1\s+core wasm/);
		expect(source).toMatch(/availableGoTargets\.includes\('wasip2\/wasm'\)/);
		expect(source).toMatch(/availableGoTargets\.includes\('wasip3\/wasm'\)/);
		expect(source).toMatch(/availableGoTargets\.includes\('js\/wasm'\)/);
		expect(source).toMatch(/`js\/wasm` runs through the bundled `wasm_exec\.js` browser host/);
		expect(source).not.toContain('id="tinygo-target"');
		expect(source).toContain("language === 'TINYGO'");
		expect(source).toMatch(/receipt-verified upstream toolchain for\s+`wasip1`/);
	});

	it('surfaces D through bundled LDC and Emscripten LLD browser assets', () => {
		expect(applicationRuntimeAssets.d?.moduleUrl).toContain('/wasm-d/index.js?');
		expectPlaygroundLanguage('D');
		expect(source).toMatch(/d: 'D'/);
		expect(source).toMatch(/dlang: 'D'/);
		expectEditorLanguage('D', 'd');
		expect(source).toMatch(/'.d': 'D'/);
		expect(source).toMatch(/D: 'main\.d'/);
		expect(source).toMatch(/D: 'd'/);
		expect(compilerDiagnosticLanguages.has('D')).toBe(true);
		expect(source).toMatch(/D compiles in the browser with the bundled LDC WASI compiler/);
		expect(source).toMatch(/Emscripten LLD\s+linker assets/);
		expect(source).toMatch(/executes the emitted WASI artifact locally/);
		expect(source).toMatch(/stdin until EOF/);
	});

	it('surfaces C#, F#, and VB.NET through wasm-dotnet runtime assets and the browser compiler hint', () => {
		expect(applicationRuntimeAssets.dotnet?.moduleUrl).toContain('/wasm-dotnet/index.js?');
		expect(source).not.toContain('dotnet' + 'Host' + 'CompileUrl');
		expectPlaygroundLanguage('CSHARP');
		expectPlaygroundLanguage('FSHARP');
		expectPlaygroundLanguage('VBNET');
		expect(source).toMatch(/csharp: 'CSHARP'/);
		expect(source).toMatch(/'c#': 'CSHARP'/);
		expect(source).toMatch(/cs: 'CSHARP'/);
		expect(source).toMatch(/fsharp: 'FSHARP'/);
		expect(source).toMatch(/'f#': 'FSHARP'/);
		expect(source).toMatch(/fs: 'FSHARP'/);
		expect(source).toMatch(/vbnet: 'VBNET'/);
		expect(source).toMatch(/vb: 'VBNET'/);
		expect(source).toMatch(/visualbasic: 'VBNET'/);
		expectEditorLanguage('CSHARP', 'csharp');
		expectEditorLanguage('FSHARP', 'fsharp');
		expectEditorLanguage('VBNET', 'vb');
		expect(source).toMatch(/'.vb': 'VBNET'/);
		expect(source).toMatch(/VBNET: 'Program\.vb'/);
		expect(source).toMatch(/VBNET: 'vbnet'/);
		expect(compilerDiagnosticLanguages.has('VBNET')).toBe(true);
		expect(source).toMatch(/isEditorDefaultSource\(content\)/);
		expect(source).toMatch(/isLegacyEditorDefaultSource\(content\)/);
		expect(source).toMatch(
			/\{language === 'CSHARP' \? 'C#' : language === 'VBNET' \? 'VB\.NET' : 'F#'\} uses a\s+`wasm-dotnet`\s+browser runtime module/
		);
		expect(source).toMatch(/static \.NET `browser-wasm` compiler app/);
		expect(source).toMatch(/`runtime\/dotnet\.js`/);
		expect(source).toMatch(
			/terminal input submitted before or during preparation\s+is passed to `Console\.In`/
		);
		expect(source).not.toContain('api/dotnet');
	});

	it('surfaces JavaScript and TypeScript through the wasm-typescript runtime', () => {
		expect(applicationRuntimeAssets.typescript?.moduleUrl).toContain(
			'/wasm-typescript/index.js?'
		);
		expect(applicationRuntimeAssets.typescript?.libUrl).toContain(
			'/lsp/typescript-libs.json.gz?'
		);
		expectPlaygroundLanguage('JAVASCRIPT');
		expectPlaygroundLanguage('TYPESCRIPT');
		expect(source).toMatch(/javascript: 'JAVASCRIPT'/);
		expect(source).toMatch(/js: 'JAVASCRIPT'/);
		expect(source).toMatch(/typescript: 'TYPESCRIPT'/);
		expect(source).toMatch(/ts: 'TYPESCRIPT'/);
		expectEditorLanguage('JAVASCRIPT', 'javascript');
		expectEditorLanguage('TYPESCRIPT', 'typescript');
		expect(source).toMatch(/JAVASCRIPT: 'main\.js'/);
		expect(source).toMatch(/TYPESCRIPT: 'main\.ts'/);
		expect(source).toMatch(/JAVASCRIPT: 'javascript'/);
		expect(source).toMatch(/TYPESCRIPT: 'typescript'/);
		expect(source).toMatch(
			/\{\s*language === 'JAVASCRIPT'\s+\?\s+'JavaScript'\s+:\s+'TypeScript'\s*\}\s+runs through the bundled\s+`wasm-typescript`\s+browser module/
		);
		expect(source).toMatch(/`fs\.readFileSync\('\/dev\/stdin', 'utf8'\)`/);
		expect(source).toMatch(/`fs\.readFileSync\(0,\s+'utf8'\)`/);
		expect(source).toMatch(/send Ctrl\+D or\s+the EOF button after\s+typing input/s);
	});

	it('surfaces AssemblyScript through the bundled browser compiler', () => {
		expect(applicationRuntimeAssets.assemblyscript?.moduleUrl).toContain(
			'/wasm-assemblyscript/runtime.mjs?'
		);
		expectPlaygroundLanguage('ASSEMBLYSCRIPT');
		expect(source).toMatch(/assemblyscript: 'ASSEMBLYSCRIPT'/);
		expect(source).toMatch(/as: 'ASSEMBLYSCRIPT'/);
		expectEditorLanguage('ASSEMBLYSCRIPT', 'typescript');
		expect(source).toMatch(/endsWith\('\.as\.ts'\)\) return 'ASSEMBLYSCRIPT'/);
		expect(source).toMatch(/ASSEMBLYSCRIPT: 'main\.as\.ts'/);
		expect(source).toMatch(/ASSEMBLYSCRIPT: 'assemblyscript'/);
		expect(source).toMatch(/AssemblyScript compiles in the browser/);
		expect(source).toMatch(/bundled `assemblyscript` compiler/);
		expect(source).toMatch(/zero-argument numeric, boolean, and string exports/);
	});

	it('surfaces WAT through the wasm-wat browser compiler contract', () => {
		expect(applicationRuntimeAssets.wat?.moduleUrl).toContain('/wasm-wat/index.js?');
		expectPlaygroundLanguage('WAT');
		expect(source).toMatch(/wat: 'WAT'/);
		expect(source).toMatch(/wast: 'WAT'/);
		expectEditorLanguage('WAT', 'wat');
		expect(source).toMatch(/'.wat': 'WAT'/);
		expect(source).toMatch(/WAT: 'main\.wat'/);
		expect(source).toMatch(/WAT: 'wat'/);
		expect(source).toMatch(/WAT compiles through the bundled WABT browser module/);
		expect(source).toMatch(/Zero-argument numeric exports are called automatically/);
	});

	it('surfaces WASM through the binary WebAssembly runner contract', () => {
		expectPlaygroundLanguage('WASM');
		expect(source).toMatch(/wasm: 'WASM'/);
		expect(source).toMatch(/wasm32: 'WASM'/);
		expectEditorLanguage('WASM', 'wasm');
		expect(source).toMatch(/'.wasm': 'WASM'/);
		expect(source).toMatch(/WASM: 'main\.wasm'/);
		expect(source).toMatch(/WASM: 'wasm'/);
		expect(source).toMatch(
			/WASM executes a WebAssembly binary from base64, hex, or a `data:application\/wasm`/
		);
		expect(source).toMatch(/WASI preview1 stdin/);
	});

	it('surfaces Lua through the wasm-lua browser runtime contract', () => {
		expect(applicationRuntimeAssets.lua?.moduleUrl).toContain('/wasm-lua/index.js?');
		expectPlaygroundLanguage('LUA');
		expect(source).toMatch(/lua: 'LUA'/);
		expectEditorLanguage('LUA', 'lua');
		expect(source).toMatch(/'.lua': 'LUA'/);
		expect(source).toMatch(/LUA: 'main\.lua'/);
		expect(source).toMatch(/LUA: 'lua'/);
		expect(source).toMatch(/Lua runs through the bundled `wasmoon` Lua VM/);
		expect(source).toMatch(/backed by its local wasm payload/);
	});

	it('surfaces BQN through the CBQN wasm worker runtime contract', () => {
		expect(applicationRuntimeAssets.bqn?.workerUrl).toContain('/wasm-bqn/runner-worker.js?');
		expectPlaygroundLanguage('BQN');
		expect(source).toMatch(/bqn: 'BQN'/);
		expectEditorLanguage('BQN', 'bqn');
		expect(source).toMatch(/'.bqn': 'BQN'/);
		expect(source).toMatch(/BQN: 'main\.bqn'/);
		expect(source).toMatch(/BQN: 'bqn'/);
		expect(source).toMatch(/BQN runs through bundled CBQN WebAssembly assets/);
		expect(source).toMatch(/`•GetLine @`/);
	});

	it('surfaces Janet through the upstream Janet VM wasm worker runtime contract', () => {
		expect(applicationRuntimeAssets.janet?.workerUrl).toContain(
			'/wasm-janet/runner-worker.js?'
		);
		expectPlaygroundLanguage('JANET');
		expect(source).toMatch(/janet: 'JANET'/);
		expectEditorLanguage('JANET', 'janet');
		expect(source).toMatch(/'.janet': 'JANET'/);
		expect(source).toMatch(/JANET: 'main\.janet'/);
		expect(source).toMatch(/JANET: 'janet'/);
		expect(source).toMatch(/Janet runs through the upstream Janet VM compiled to WebAssembly/);
		expect(source).toMatch(/Use `getline` or[\s\S]*`file\/read stdin :line`/);
	});

	it('surfaces Julia through the Julia wasm worker runtime contract', () => {
		expect(applicationRuntimeAssets.julia?.workerUrl).toContain(
			'/wasm-julia/runner-worker.js?'
		);
		expectPlaygroundLanguage('JULIA');
		expect(source).toMatch(/julia: 'JULIA'/);
		expect(source).toMatch(/jl: 'JULIA'/);
		expectEditorLanguage('JULIA', 'julia');
		expect(source).toMatch(/'.jl': 'JULIA'/);
		expect(source).toMatch(/JULIA: 'main\.jl'/);
		expect(source).toMatch(/JULIA: 'julia'/);
		expect(source).toMatch(/legacy Julia 1\.3\.0-DEV\.560 WebAssembly runtime/);
		expect(source).toMatch(/Use `readline\(\)`/);
	});

	it('surfaces Nim through the Nim wasm compiler worker runtime contract', () => {
		expect(applicationRuntimeAssets.nim?.workerUrl).toContain('/wasm-nim/runner-worker.js?');
		expectPlaygroundLanguage('NIM');
		expect(source).toMatch(/nim: 'NIM'/);
		expect(source).toMatch(/nimrod: 'NIM'/);
		expectEditorLanguage('NIM', 'nim');
		expect(source).toMatch(/'.nim': 'NIM'/);
		expect(source).toMatch(/NIM: 'main\.nim'/);
		expect(source).toMatch(/NIM: 'nim'/);
		expect(source).toMatch(/Nim runs through the bundled Nim 2\.2\.4 WebAssembly compiler/);
		expect(source).toMatch(/Use `readLine\(stdin\)`/);
	});

	it('surfaces Zig through bundled wasm compiler assets and the browser runtime hint', () => {
		expect(applicationRuntimeAssets.zig?.compilerUrl).toContain('/wasm-zig/zig_small.wasm?');
		expect(applicationRuntimeAssets.zig?.stdlibUrl).toContain('/wasm-zig/std.tar.gz?');
		expectPlaygroundLanguage('ZIG');
		expect(source).toMatch(/zig: 'ZIG'/);
		expectEditorLanguage('ZIG', 'zig');
		expect(source).toMatch(/'.zig': 'ZIG'/);
		expect(source).toMatch(/ZIG: 'main\.zig'/);
		expect(source).toMatch(/ZIG: 'zig'/);
		expect(source).toMatch(/ZIG: \(\) => \(\{ zigTargetTriple: 'wasm64-wasi' \}\)/);
		expect(source).toMatch(/Zig runs the bundled `zig_small\.wasm` compiler/);
		expect(source).toMatch(/`std\.tar\.gz` standard\s+library inside\s+the browser worker/s);
		expect(source).toMatch(/compiles for `wasm64-wasi`/);
		expect(source).toMatch(/executes the\s+emitted WASI artifact locally/s);
		expect(source).not.toContain('api/zig');
	});

	it('surfaces Lisp through the Puppy Scheme wasm compiler contract', () => {
		expect(applicationRuntimeAssets.lisp?.moduleUrl).toContain('/wasm-lisp/index.js?');
		expect(applicationRuntimeAssets.lisp?.manifestUrl).toContain(
			'/wasm-lisp/runtime-manifest.v2.json?'
		);
		expect(applicationRuntimeAssets.lisp?.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expectPlaygroundLanguage('LISP');
		expect(source).toMatch(/lisp: 'LISP'/);
		expect(source).toMatch(/scheme: 'LISP'/);
		expectEditorLanguage('LISP', 'lisp');
		expect(source).toMatch(/'.scm': 'LISP'/);
		expect(source).toMatch(/LISP: 'main\.scm'/);
		expect(source).toMatch(/LISP: 'lisp'/);
	});

	it('surfaces Ruby through the CRuby WebAssembly runtime contract', () => {
		expect(applicationRuntimeAssets.ruby?.manifestUrl).toContain(
			'/wasm-ruby/runtime-manifest.v2.json?'
		);
		expect(applicationRuntimeAssets.ruby?.moduleUrl).toContain('/wasm-ruby/runtime.mjs.bin?');
		expect(applicationRuntimeAssets.ruby?.wasmUrl).toContain(
			'/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin?'
		);
		expectPlaygroundLanguage('RUBY');
		expect(source).toMatch(/ruby: 'RUBY'/);
		expect(source).toMatch(/rb: 'RUBY'/);
		expectEditorLanguage('RUBY', 'ruby');
		expect(source).toMatch(/'.rb': 'RUBY'/);
		expect(source).toMatch(/RUBY: 'main\.rb'/);
		expect(source).toMatch(/RUBY: 'ruby'/);
		expect(source).toMatch(/Ruby runs through a receipt-verified CRuby WebAssembly profile/);
		expect(source).toMatch(
			/manifest,\s+module, and compressed Wasm are verified before the worker starts/
		);
		expect(source).toMatch(/reads stdin until EOF/);
	});

	it('surfaces Haskell through the ghc-in-browser wasm compiler contract', () => {
		expect(applicationRuntimeAssets.haskell?.moduleUrl).toContain('/wasm-haskell/dyld.mjs?');
		expect(applicationRuntimeAssets.haskell?.rootfsUrl).toContain(
			'/wasm-haskell/rootfs.tar.zst?'
		);
		expect(applicationRuntimeAssets.haskell?.bsdtarUrl).toContain('/wasm-haskell/bsdtar.wasm?');
		expectPlaygroundLanguage('HASKELL');
		expect(source).toMatch(/haskell: 'HASKELL'/);
		expect(source).toMatch(/hs: 'HASKELL'/);
		expectEditorLanguage('HASKELL', 'haskell');
		expect(source).toMatch(/'.hs': 'HASKELL'/);
		expect(source).toMatch(/HASKELL: 'main\.hs'/);
		expect(source).toMatch(/HASKELL: 'haskell'/);
		expect(argsLabels.HASKELL).toBe('GHC Args');
		expect(source).toMatch(/<span>\{argsLabel\}<\/span>/);
		expect(source).toMatch(/Haskell loads a wasm GHC\/GHCi root filesystem/);
		expect(source).toMatch(/program stdin is currently treated as EOF/);
	});

	it('surfaces R through the bundled webR runtime contract', () => {
		expect(applicationRuntimeAssets.r?.baseUrl).toMatch(/^\/wasm-idle\/webr\/[a-f0-9]+\/$/u);
		expectPlaygroundLanguage('R');
		expect(source).toMatch(/r: 'R'/);
		expectEditorLanguage('R', 'r');
		expect(source).toMatch(/'.r': 'R'/);
		expect(source).toMatch(/R: 'main\.R'/);
		expect(source).toMatch(/R: 'r'/);
		expect(source).toMatch(/R runs through bundled webR WebAssembly assets/);
	});

	it('surfaces Octave through the bundled GNU Octave wasm runtime contract', () => {
		expect(applicationRuntimeAssets.octave?.workerUrl).toContain(
			'/wasm-octave/runner-worker.js?'
		);
		expect(applicationRuntimeAssets.octave?.manifestUrl).toContain(
			'/wasm-octave/runtime/runtime-manifest.v1.json?'
		);
		expectPlaygroundLanguage('OCTAVE');
		expect(source).toMatch(/octave: 'OCTAVE'/);
		expect(source).toMatch(/matlab: 'OCTAVE'/);
		expectEditorLanguage('OCTAVE', 'octave');
		expect(source).toMatch(/'.m': 'OCTAVE'/);
		expect(source).toMatch(/OCTAVE: 'main\.m'/);
		expect(source).toMatch(/OCTAVE: 'octave'/);
		expect(source).toMatch(/Octave runs through bundled GNU Octave WebAssembly assets/);
		expect(source).toMatch(/code using `stdin` reads a line/);
	});

	it('surfaces SQLite through the bundled sql.js worker runtime contract', () => {
		expect(applicationRuntimeAssets.sqlite?.moduleUrl).toContain('/wasm-sqlite/runtime.mjs?');
		expectPlaygroundLanguage('SQLITE');
		expect(source).toMatch(/sqlite: 'SQLITE'/);
		expect(source).toMatch(/sql: 'SQLITE'/);
		expectEditorLanguage('SQLITE', 'sql');
		expect(source).toMatch(/'.sql': 'SQLITE'/);
		expect(source).toMatch(/'.sqlite': 'SQLITE'/);
		expect(source).toMatch(/SQLITE: 'main\.sql'/);
		expect(source).toMatch(/SQLITE: 'sqlite'/);
		expect(source).toMatch(/SQLite runs through bundled sql\.js WebAssembly assets/);
		expect(source).toMatch(/SELECT results are printed as tab-separated tables/);
	});

	it('surfaces DuckDB through the bundled DuckDB-Wasm worker runtime contract', () => {
		expect(applicationRuntimeAssets.duckdb?.moduleUrl).toContain('/wasm-duckdb/runtime.mjs?');
		expectPlaygroundLanguage('DUCKDB');
		expect(source).toMatch(/duckdb: 'DUCKDB'/);
		expectEditorLanguage('DUCKDB', 'sql');
		expect(source).toMatch(/'.duckdb': 'DUCKDB'/);
		expect(source).toMatch(/DUCKDB: 'main\.duckdb'/);
		expect(source).toMatch(/DUCKDB: 'duckdb'/);
		expect(source).toMatch(/DuckDB runs through `@duckdb\/duckdb-wasm`/);
		expect(source).toMatch(/SELECT results are printed as tab-separated tables/);
		expect(editorOnlyLanguages.has('DUCKDB')).toBe(false);
	});

	it('surfaces COBOL through the GnuCOBOL llvm-core runtime contract', () => {
		expect(applicationRuntimeAssets.cobol?.baseUrl).toBe('/wasm-idle/wasm-cobol/');
		expectPlaygroundLanguage('COBOL');
		expect(source).toMatch(/cobol: 'COBOL'/);
		expect(source).toMatch(/gnucobol: 'COBOL'/);
		expect(source).toMatch(/'.cob': 'COBOL'/);
		expect(source).toMatch(/COBOL: 'main\.cob'/);
		expect(source).toMatch(/COBOL: 'cobol'/);
		expect(source).toMatch(/GnuCOBOL 3\.2/);
		expect(source).toMatch(/Use `ACCEPT` for stdin and `DISPLAY` for\s+stdout/);
		expect(editorOnlyLanguages.has('COBOL')).toBe(false);
	});

	it('surfaces editor-only LSP workspaces', () => {
		expect(applicationRuntimeAssets.fortran?.analyzerUrl).toContain(
			'/wasm-fortran/analyzer.js?'
		);
		expectPlaygroundLanguage('FORTRAN');
		expect(editorOnlyLanguages.has('FORTRAN')).toBe(false);
		for (const [language, label] of [
			['GRAPHQL', 'GraphQL'],
			['JSON', 'JSON'],
			['YAML', 'YAML'],
			['TOML', 'TOML'],
			['HTML', 'HTML'],
			['CSS', 'CSS'],
			['MARKDOWN', 'Markdown']
		] as const) {
			expectPlaygroundLanguage(language);
			expect(languageLabels[language]).toBe(label);
		}
		for (const language of [
			'GRAPHQL',
			'JSON',
			'YAML',
			'TOML',
			'HTML',
			'CSS',
			'MARKDOWN'
		] as const) {
			expect(editorOnlyLanguages.has(language)).toBe(true);
		}
		expect(source).toMatch(
			/const executionAvailable = \$derived\(!editorOnlyLanguages\.has\(language\)\);/
		);
		expect(source).toMatch(/if \(!executionAvailable\) return Promise\.resolve\(\);/);
		expect(source).toMatch(/fortran: 'FORTRAN'/);
		expect(source).toMatch(/graphql: 'GRAPHQL'/);
		expect(source).toMatch(/json: 'JSON'/);
		expect(source).toMatch(/jsonc: 'JSON'/);
		expect(source).toMatch(/yaml: 'YAML'/);
		expect(source).toMatch(/yml: 'YAML'/);
		expect(source).toMatch(/toml: 'TOML'/);
		expect(source).toMatch(/html: 'HTML'/);
		expect(source).toMatch(/htm: 'HTML'/);
		expect(source).toMatch(/css: 'CSS'/);
		expect(source).toMatch(/markdown: 'MARKDOWN'/);
		expect(source).toMatch(/md: 'MARKDOWN'/);
		expect(source).toMatch(/FORTRAN: 'main\.f'/);
		expect(source).toMatch(/GRAPHQL: 'main\.graphql'/);
		expect(source).toMatch(/JSON: 'main\.json'/);
		expect(source).toMatch(/YAML: 'main\.yaml'/);
		expect(source).toMatch(/TOML: 'main\.toml'/);
		expect(source).toMatch(/HTML: 'index\.html'/);
		expect(source).toMatch(/CSS: 'styles\.css'/);
		expect(source).toMatch(/MARKDOWN: 'README\.md'/);
		expect(source).toMatch(/'.json': 'JSON'/);
		expect(source).toMatch(/'.jsonc': 'JSON'/);
		expect(source).toMatch(/'.yaml': 'YAML'/);
		expect(source).toMatch(/'.yml': 'YAML'/);
		expect(source).toMatch(/'.toml': 'TOML'/);
		expect(source).toMatch(/'.html': 'HTML'/);
		expect(source).toMatch(/'.htm': 'HTML'/);
		expect(source).toMatch(/'.css': 'CSS'/);
		expect(source).toMatch(/'.md': 'MARKDOWN'/);
		expect(source).toMatch(/'.markdown': 'MARKDOWN'/);
	});

	it('surfaces PHP through the php-wasm browser runtime contract', () => {
		expect(applicationRuntimeAssets.php?.moduleUrl).toContain('/wasm-php/runtime.mjs?');
		expectPlaygroundLanguage('PHP');
		expect(source).toMatch(/php: 'PHP'/);
		expectEditorLanguage('PHP', 'php');
		expect(source).toMatch(/'.php': 'PHP'/);
		expect(source).toMatch(/PHP: 'main\.php'/);
		expect(source).toMatch(/PHP: 'php'/);
		expect(source).toMatch(/PHP 8\.4 runs from the external static runtime/);
		expect(source).toMatch(/stdin is provided as `php:\/\/input`/);
	});

	it('surfaces Elixir through the shared language selector and Popcorn hint', () => {
		expect(applicationRuntimeAssets.elixir?.bundleUrl).toContain('/wasm-elixir/bundle.avm?');
		expectPlaygroundLanguage('ELIXIR');
		expect(source).toMatch(/elixir: 'ELIXIR'/);
		expectEditorLanguage('ELIXIR', 'elixir');
		expect(source).toMatch(/Elixir runs through a bundled Popcorn evaluator/);
		expect(source).toMatch(/Code\.eval_string/);
		expect(source).toMatch(/prints the final expression as `=&gt; \.\.\.`/);
		expect(source).toMatch(/press Enter to send stdin/);
		expect(source).toMatch(/CLI args are still disabled/);
	});

	it('surfaces Erlang through the shared language selector and Popcorn hint', () => {
		expect(applicationRuntimeAssets.erlang?.bundleUrl).toContain('/wasm-elixir/bundle.avm?');
		expectPlaygroundLanguage('ERLANG');
		expect(source).toMatch(/erlang: 'ERLANG'/);
		expect(source).toMatch(/erl: 'ERLANG'/);
		expect(source).toMatch(/'.erl': 'ERLANG'/);
		expect(source).toMatch(/ERLANG: 'main\.erl'/);
		expect(source).toMatch(/ERLANG: 'erlang'/);
		expectEditorLanguage('ERLANG', 'erlang');
		expect(source).toMatch(/Erlang runs through the bundled Popcorn\/AtomVM evaluator/);
		expect(source).toMatch(/module files compile with the bundled Erlang compiler/);
		expect(source).toMatch(/`io:get_line\(""\)` or `io:get_chars\("", N\)`/);
	});

	it('surfaces Prolog, Gleam, and Perl through static wasm worker runtime contracts', () => {
		expect(applicationRuntimeAssets.prolog?.workerUrl).toContain(
			'/wasm-prolog/runner-worker.js?'
		);
		expect(applicationRuntimeAssets.gleam?.workerUrl).toContain(
			'/wasm-gleam/runner-worker.js?'
		);
		expect(applicationRuntimeAssets.perl?.workerUrl).toContain('/wasm-perl/runner-worker.js?');
		expectPlaygroundLanguage('PROLOG');
		expectPlaygroundLanguage('GLEAM');
		expectPlaygroundLanguage('PERL');
		expect(source).toMatch(/prolog: 'PROLOG'/);
		expect(source).toMatch(/swipl: 'PROLOG'/);
		expect(source).toMatch(/swi: 'PROLOG'/);
		expect(source).toMatch(/gleam: 'GLEAM'/);
		expect(source).toMatch(/perl: 'PERL'/);
		expect(source).toMatch(/'.prolog': 'PROLOG'/);
		expect(source).toMatch(/'.pro': 'PROLOG'/);
		expect(source).toMatch(/'.gleam': 'GLEAM'/);
		expect(source).toMatch(/'.pl': 'PERL'/);
		expect(source).toMatch(/PROLOG: 'main\.prolog'/);
		expect(source).toMatch(/GLEAM: 'main\.gleam'/);
		expect(source).toMatch(/PERL: 'main\.pl'/);
		expect(source).toMatch(/PROLOG: 'prolog'/);
		expect(source).toMatch(/GLEAM: 'gleam'/);
		expect(source).toMatch(/PERL: 'perl'/);
		expect(source).toMatch(/SWI-Prolog WebAssembly assets/);
		expect(source).toMatch(/Gleam WebAssembly compiler/);
		expect(source).toMatch(/WebPerl WebAssembly assets/);
		expect(source).toMatch(/`wasm_idle\/stdin`/);
		expect(source).toMatch(/`&lt;STDIN&gt;`/);
	});

	it('surfaces OCaml through the shared language selector and backend hint', () => {
		expect(source).toMatch(/ocamlBackend = \$state<OcamlBackend>\('wasm'\),/);
		expect(source).toMatch(/ocamlWasmBinaryenMode = \$state<OcamlWasmBinaryenMode>\('fast'\),/);
		expect(source).toMatch(/localStorage\.setItem\('ocamlBackend', ocamlBackend\);/);
		expect(source).toMatch(
			/localStorage\.setItem\('ocamlWasmBinaryenMode', ocamlWasmBinaryenMode\);/
		);
		expect(source).toMatch(
			/const storedOcamlBackend = localStorage\.getItem\('ocamlBackend'\);/
		);
		expect(source).toMatch(
			/const storedOcamlWasmBinaryenMode = localStorage\.getItem\('ocamlWasmBinaryenMode'\);/
		);
		expect(source).toMatch(
			/const requestedOcamlBackend = page\.url\.searchParams\.get\('ocamlBackend'\);/
		);
		expect(source).toMatch(
			/const requestedOcamlWasmBinaryenMode =\s+page\.url\.searchParams\.get\('ocamlWasmBinaryenMode'\);/s
		);
		expect(source).toMatch(
			/requestedOcamlBackend === 'js' \|\| requestedOcamlBackend === 'wasm'/
		);
		expect(source).toMatch(/storedOcamlBackend === 'js' \|\| storedOcamlBackend === 'wasm'/);
		expect(source).toMatch(
			/requestedOcamlWasmBinaryenMode === 'fast' \|\|\s+requestedOcamlWasmBinaryenMode === 'full'/
		);
		expect(source).toMatch(
			/storedOcamlWasmBinaryenMode === 'fast' \|\|\s+storedOcamlWasmBinaryenMode === 'full'/
		);
		expectEditorLanguage('OCAML', 'ocaml');
		expect(source).toMatch(/OCAML: \(\) => \(\{ ocamlBackend, ocamlWasmBinaryenMode \}\)/);
		expect(source).toMatch(/<select id="ocaml-backend" bind:value=\{ocamlBackend\}>/);
		expect(source).toMatch(
			/<select id="ocaml-binaryen-mode" bind:value=\{ocamlWasmBinaryenMode\}>/
		);
		expect(source).toMatch(/<option value="wasm">wasm_of_ocaml<\/option>/);
		expect(source).toMatch(/<option value="js">js_of_ocaml<\/option>/);
		expect(source).toMatch(/<option value="fast">Binaryen fast<\/option>/);
		expect(source).toMatch(/<option value="full">Binaryen full<\/option>/);
		expect(source).toMatch(
			/OCaml uses the bundled `wasm-of-js-of-ocaml` browser-native toolchain/
		);
		expect(source).toMatch(/selector switches between `wasm_of_ocaml` and `js_of_ocaml`/);
		expect(source).toMatch(/Binaryen fast is the\s+default low-memory wasm path/s);
		expect(source).toMatch(
			/Binaryen full runs the original static `wasm-metadce`\s+and `wasm-opt` passes/s
		);
		expect(source).toMatch(/Type into the\s+terminal below and press Enter to send a line/s);
	});

	it('keeps the example workspace full-height, resizable, and hides debug panels until debug starts', () => {
		expect(() =>
			compile(layoutSource, {
				filename: 'src/routes/+layout.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(
			/examplePaneWidth = \$state\(0\),\s+terminalPaneWidth = \$state<number \| null>\(null\),\s+resizingPane = \$state\(false\);/s
		);
		expect(source).toMatch(/const desktopExampleLayout = \$derived\(examplePaneWidth > 960\);/);
		expect(source).toMatch(/const terminalPanePixelWidth = \$derived\.by\(\(\) => \{/);
		expect(source).toMatch(/\{#if debugLanguage && debug\.active\}/);
		expect(source).toMatch(/class="panel-resizer"/);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/onpointerdown=\{\(event\) => \{/);
		expect(source).toMatch(/onkeydown=\{\(event\) => \{/);
		expect(source).toMatch(/height: 100dvh;/);
		expect(source).toMatch(
			/@media \(max-width: 960px\) \{\s+main \{\s+height: auto;\s+min-height: 100vh;\s+min-height: 100dvh;/s
		);
		expect(source).toMatch(
			/<div\s+class:panel-resizer--active=\{resizingPane\}\s+class="panel-resizer"/s
		);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/breakpoints=\{debug\.effectiveBreakpoints\}/);
		expect(source).toMatch(/onCursorLineChange=\{debug\.setCursorLine\}/);
		expect(source).toMatch(/onBreakpointsChange=\{debug\.setBreakpoints\}/);
		expect(source).toMatch(/onRunToCursor=\{runToCursorWhileDataBreakpointIdle\}/);
		expect(layoutSource).toMatch(
			/:global\(html\),\s+:global\(body\) \{\s+margin: 0;\s+min-height: 100%;\s+\}/s
		);
		expect(layoutSource).toMatch(
			/:global\(body\) \{\s+min-height: 100vh;\s+min-height: 100dvh;\s+\}/s
		);
		expect(layoutSource).toMatch(/let \{ children \} = \$props\(\);/);
		expect(layoutSource).toMatch(/\{@render children\(\)\}/);
	});

	it('keys recursive call stack entries by index so duplicate frames still render', () => {
		expect(source).toMatch(
			/\{#each debug\.callStack as frame, index \(`\$\{frame\.functionName\}:\$\{frame\.line\}:\$\{index\}`\)\}/
		);
	});
});
