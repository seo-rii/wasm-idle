<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal, { cppDebugLanguageAdapter, pythonDebugLanguageAdapter } from '$lib';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import type {
		CompilerDiagnostic,
		DebugFrame,
		DebugSessionEvent,
		DebugVariable
	} from '$lib/playground/options';
	import type { TerminalControl } from '$lib/terminal';
	import type monaco from 'monaco-editor';
	import { executeTerminalRun } from './execute';

	let path = $derived(
		page.url.pathname.endsWith('/') ? page.url.pathname.slice(0, -1) : page.url.pathname
	);
	let clangdBaseUrl = $derived(path ? `${path}/clangd` : '/clangd');

	let editor = $state<monaco.editor.IStandaloneCodeEditor | null>(null),
		terminal = $state<TerminalControl | undefined>(undefined),
		breakpoints = $state<number[]>([]),
		debugLocals = $state<DebugVariable[]>([]),
		debugCallStack = $state<DebugFrame[]>([]),
		compilerDiagnostics = $state<CompilerDiagnostic[]>([]),
		clangdRequested = $state(false),
		argsInput = $state(''),
		watchInput = $state(''),
		watchExpressions = $state<string[]>([]),
		pausedLine = $state<number | null>(null),
		debugActive = $state(false),
		debugPaused = $state(false),
		watchValues = $state<{ expression: string; value: string }[]>([]),
		log = $state(true),
		language = $state('CPP'),
		runningMode = $state<'run' | 'debug' | null>(null),
		init = $state(false);

	const debugLanguage = $derived.by(() =>
		language === 'CPP'
			? cppDebugLanguageAdapter
			: language === 'PYTHON'
				? pythonDebugLanguageAdapter
				: null
	);

	function onDebugEvent(event: DebugSessionEvent) {
		if (event.type === 'pause') {
			pausedLine = event.line;
			debugLocals = event.locals;
			debugCallStack = event.callStack;
			debugActive = true;
			debugPaused = true;
			return;
		}
		if (event.type === 'resume') {
			debugPaused = false;
			pausedLine = null;
			debugLocals = [];
			debugCallStack = [];
			return;
		}
		pausedLine = null;
		debugLocals = [];
		debugCallStack = [];
		debugPaused = false;
		debugActive = false;
	}

	function sendDebugCommand(command: 'continue' | 'stepInto' | 'nextLine' | 'stepOut') {
		if (!terminal || !debugPaused) return;
		terminal.debugCommand?.(command);
	}

	function onCompileDiagnostic(diagnostic: CompilerDiagnostic) {
		compilerDiagnostics = [...compilerDiagnostics, diagnostic];
	}

	async function exec(debug = false) {
		if (!editor || !terminal) return;
		if (debug && !debugLanguage) return;
		if (runningMode) return;
		runningMode = debug ? 'debug' : 'run';
		if (debug && language === 'CPP') clangdRequested = true;
		if (debug) {
			debugActive = true;
			debugPaused = false;
			pausedLine = null;
			debugLocals = [];
			debugCallStack = [];
		} else {
			debugActive = false;
			debugPaused = false;
			pausedLine = null;
			debugLocals = [];
			debugCallStack = [];
		}
		compilerDiagnostics = [];
		const args = language === 'JAVA' && argsInput.trim() ? argsInput.trim().split(/\s+/) : [];
		if (browser) {
			localStorage.setItem('code', editor.getValue());
			localStorage.setItem('language', language);
			localStorage.setItem('argsInput', argsInput);
		}
		try {
			if (!('SharedArrayBuffer' in window)) location.reload();
			await executeTerminalRun({
				terminal,
				language,
				code: editor.getValue(),
				log,
				args,
				options: {
					debug,
					breakpoints,
					stdin: '',
					pauseOnEntry: debug
				}
			});
		} finally {
			runningMode = null;
			if (!debugPaused) {
				debugActive = false;
				pausedLine = null;
				debugLocals = [];
				debugCallStack = [];
			}
		}
	}

	function addWatchExpression() {
		const expression = watchInput.trim();
		if (!expression || watchExpressions.includes(expression)) return;
		watchExpressions = [...watchExpressions, expression];
		watchInput = '';
	}

	function removeWatchExpression(expression: string) {
		watchExpressions = watchExpressions.filter((entry) => entry !== expression);
	}

	let watchRequestVersion = 0;

	$effect(() => {
		const expressions = [...watchExpressions];
		const adapter = debugLanguage;
		const locals = [...debugLocals];
		const paused = debugPaused;
		const activeLanguage = language;
		const terminalControl = terminal;
		const version = ++watchRequestVersion;

		if (!expressions.length) {
			watchValues = [];
			return;
		}

		if (activeLanguage === 'PYTHON' && paused && terminalControl?.debugEvaluate) {
			watchValues = expressions.map((expression) => ({ expression, value: '...' }));
			(async () => {
				const resolved: { expression: string; value: string }[] = [];
				for (const expression of expressions) {
					resolved.push({
						expression,
						value: await terminalControl.debugEvaluate!(expression)
					});
				}
				if (version === watchRequestVersion) watchValues = resolved;
			})().catch(() => {
				if (version === watchRequestVersion) {
					watchValues = expressions.map((expression) => ({ expression, value: 'error' }));
				}
			});
			return;
		}

		watchValues = expressions.map((expression) => {
			try {
				return {
					expression,
					value: adapter ? adapter.evaluateExpression(expression, locals) : 'error'
				};
			} catch (error) {
				return {
					expression,
					value: error instanceof Error && error.message === 'unavailable' ? '?' : 'error'
				};
			}
		});
	});

	$effect(() => {
		if (browser && editor && !init) {
			const code = localStorage.getItem('code');
			const lang = localStorage.getItem('language');
			const storedArgs = localStorage.getItem('argsInput');
			if (code) editor.setValue(code);
			if (lang) language = lang;
			if (storedArgs !== null) argsInput = storedArgs;
			init = true;
		}
	});

	$effect(() => {
		if (language !== 'CPP') clangdRequested = false;
		if (!debugLanguage) {
			breakpoints = [];
			pausedLine = null;
			debugLocals = [];
			debugCallStack = [];
			debugActive = false;
			debugPaused = false;
		}
		if (language !== 'JAVA') compilerDiagnostics = [];
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&display=block"
		rel="stylesheet"
		crossorigin="anonymous"
	/>
</svelte:head>

<main>
	<div class="terminal-pane">
		<section class="toolbar">
			<div class="toolbar-row">
				<div class="path-chip">
					<span class="material-symbols-outlined">terminal</span>
					<code>{path || '/'}</code>
				</div>
				<div class="action-group">
					<button
						class="action-button action-button--run"
						onclick={() => exec(false)}
						disabled={!!runningMode}
					>
						<span class="material-symbols-outlined">play_arrow</span>
						<span>Run</span>
					</button>
					<button
						class="action-button action-button--debug"
						onclick={() => exec(true)}
						disabled={!!runningMode || !debugLanguage}
					>
						<span class="material-symbols-outlined">bug_report</span>
						<span>Debug</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => sendDebugCommand('continue')}
						disabled={!debugPaused}
						title="Continue"
						aria-label="Continue"
					>
						<span class="material-symbols-outlined">skip_next</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => sendDebugCommand('stepInto')}
						disabled={!debugPaused}
						title="Step Into"
						aria-label="Step Into"
					>
						<span class="material-symbols-outlined">login</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => sendDebugCommand('nextLine')}
						disabled={!debugPaused}
						title="Next Line"
						aria-label="Next Line"
					>
						<span class="material-symbols-outlined">redo</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => sendDebugCommand('stepOut')}
						disabled={!debugPaused}
						title="Step Out"
						aria-label="Step Out"
					>
						<span class="material-symbols-outlined">logout</span>
					</button>
				</div>
			</div>
			<div class="toolbar-row toolbar-row--secondary">
				<label class="toggle-chip" for="log-toggle">
					<input id="log-toggle" type="checkbox" bind:checked={log} />
					<span class="material-symbols-outlined">notes</span>
					<span>Log</span>
				</label>
				<label class="select-chip">
					<span class="material-symbols-outlined">code_blocks</span>
					<select bind:value={language}>
						<option value="CPP">C++</option>
						<option value="PYTHON">Python</option>
						<option value="JAVA">Java</option>
					</select>
				</label>
				{#if language === 'JAVA'}
					<label class="args-chip">
						<span class="material-symbols-outlined">list_alt</span>
						<input bind:value={argsInput} placeholder="3 4 5" spellcheck={false} />
						<span>Args</span>
					</label>
				{/if}
			</div>
		</section>
		{#if language === 'JAVA'}
			<p class="hint">Run after that type into the terminal below and press Enter.</p>
		{/if}
		{#if debugLanguage}
			<p class="hint">
				{language === 'CPP'
					? 'Debug prints compile/runtime trace lines into the terminal.'
					: 'Debug pauses Pyodide execution at Python source lines.'}
			</p>
			<div class="debug-panels">
				<section class="debug-panel">
					<h3>Locals</h3>
					{#if debugLocals.length}
						<ul>
							{#each debugLocals as variable (variable.name)}
								<li><code>{variable.name}</code> = {variable.value}</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">No locals</p>
					{/if}
				</section>
				<section class="debug-panel">
					<h3>Watch</h3>
					<div class="watch-row">
						<input
							bind:value={watchInput}
							placeholder="a == b"
							onkeydown={(event) => event.key === 'Enter' && addWatchExpression()}
						/>
						<button onclick={addWatchExpression}>Add</button>
					</div>
					{#if watchValues.length}
						<ul>
							{#each watchValues as watch (watch.expression)}
								<li>
									<span>{watch.expression}</span>
									<code>{watch.value}</code>
									<button
										class="remove"
										onclick={() => removeWatchExpression(watch.expression)}
										>x</button
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">No watches</p>
					{/if}
				</section>
				<section class="debug-panel">
					<h3>Call Stack</h3>
					{#if debugCallStack.length}
						<ul>
							{#each debugCallStack as frame (`${frame.functionName}:${frame.line}`)}
								<li>{frame.functionName}:{frame.line}</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">No frames</p>
					{/if}
				</section>
			</div>
		{/if}
		<div class="terminal-shell">
			<Terminal
				bind:terminal
				{path}
				ondebug={onDebugEvent}
				oncompilediagnostic={onCompileDiagnostic}
			/>
		</div>
	</div>
	{#key language}
		<Monaco
			language={language.toLowerCase()}
			bind:editor
			clangdEnabled={clangdRequested}
			{clangdBaseUrl}
			{breakpoints}
			{debugLocals}
			{debugLanguage}
			{compilerDiagnostics}
			{pausedLine}
			onBreakpointsChange={(lines) => (breakpoints = lines)}
		/>
	{/key}
</main>

<style>
	main {
		height: calc(100vh - 40px);
		display: flex;
		flex-direction: row;
		background:
			radial-gradient(circle at top left, rgba(20, 184, 166, 0.08), transparent 28%),
			linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
	}

	.terminal-pane {
		width: 50%;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding-bottom: 6px;
		box-sizing: border-box;
	}

	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 8px;
		padding: 10px;
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(14px);
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
	}

	.toolbar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.toolbar-row--secondary {
		gap: 8px;
	}

	.path-chip,
	.toggle-chip,
	.select-chip,
	.args-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		padding: 0 9px;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.92);
		color: #0f172a;
		box-sizing: border-box;
	}

	.path-chip {
		max-width: 100%;
		font-size: 11px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}

	.path-chip code {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
	}

	.action-group {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.action-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			border-color 0.18s ease,
			background-color 0.18s ease;
	}

	.action-button:enabled:hover {
		transform: translateY(-1px);
	}

	.action-button:enabled:active {
		transform: translateY(0);
	}

	.action-button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
		box-shadow: none;
	}

	.action-button--run {
		background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
		color: #f8fffe;
		box-shadow: 0 12px 22px rgba(20, 184, 166, 0.28);
	}

	.action-button--debug {
		background: linear-gradient(135deg, #4338ca 0%, #6366f1 100%);
		color: #f8faff;
		box-shadow: 0 12px 22px rgba(99, 102, 241, 0.24);
	}

	.action-button--icon {
		width: 30px;
		min-width: 30px;
		padding: 0;
		justify-content: center;
		background: rgba(255, 255, 255, 0.92);
		border-color: rgba(148, 163, 184, 0.32);
		color: #0f172a;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
	}

	.terminal-shell {
		flex: 1;
		min-height: 0;
	}

	.material-symbols-outlined {
		font-family: 'Material Symbols Outlined';
		font-weight: normal;
		font-style: normal;
		font-size: 15px;
		line-height: 1;
		letter-spacing: normal;
		text-transform: none;
		display: inline-block;
		white-space: nowrap;
		word-wrap: normal;
		direction: ltr;
		font-feature-settings: 'liga';
		-webkit-font-feature-settings: 'liga';
		-webkit-font-smoothing: antialiased;
		font-variation-settings:
			'FILL' 0,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.action-button--icon .material-symbols-outlined {
		font-size: 16px;
	}

	.hint {
		margin: 0 0 8px;
		font-size: 12px;
		color: #475569;
	}

	.debug-panels {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		margin: 8px 0;
	}

	.debug-panel {
		border: 1px solid #dbe3ef;
		border-radius: 10px;
		padding: 10px;
		background: #f8fafc;
		font-size: 12px;
	}

	.debug-panel h3 {
		margin: 0 0 8px;
		font-size: 12px;
		color: #0f172a;
	}

	.debug-panel ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.debug-panel li {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.watch-row {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}

	.watch-row input {
		flex: 1;
		min-width: 0;
	}

	.toggle-chip input {
		margin: 0;
		accent-color: #14b8a6;
	}

	.select-chip select,
	.args-chip input {
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		outline: none;
	}

	.select-chip select {
		padding-right: 4px;
	}

	.args-chip input {
		min-width: 64px;
	}

	.remove {
		padding: 0 6px;
	}

	.empty {
		margin: 0;
		color: #64748b;
	}
</style>
