<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal, { cppDebugLanguageAdapter, pythonDebugLanguageAdapter } from '$lib';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
	import { WASM_RUST_ASSET_VERSION } from '$lib/playground/wasmRustVersion';
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
	let runtimeAssets = $derived.by<PlaygroundRuntimeAssets>(() => ({
		rootUrl: path,
		rust: {
			compilerUrl: path
				? `${path}/wasm-rust/index.js?v=${WASM_RUST_ASSET_VERSION}`
				: `/wasm-rust/index.js?v=${WASM_RUST_ASSET_VERSION}`
		}
	}));

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
		progress = $state(-1),
		init = $state(false);

	const progressRef = {
		set(value: number) {
			progress = value;
		}
	};

	const debugLanguage = $derived.by(() =>
		language === 'CPP'
			? cppDebugLanguageAdapter
			: language === 'PYTHON'
				? pythonDebugLanguageAdapter
				: null
	);
	const debugStatusLabel = $derived(debugPaused ? 'Paused' : debugActive ? 'Running' : 'Ready');
	const debugStatusIcon = $derived(
		debugPaused ? 'pause_circle' : debugActive ? 'play_circle' : 'adjust'
	);
	const debugTitle = $derived(language === 'CPP' ? 'Native Trace' : 'Pyodide Trace');
	const loading = $derived(progress >= 0 && progress < 1);
	const progressValue = $derived(progress < 0 ? 0 : progress > 1 ? 1 : progress);
	const progressPercent = $derived(Math.round(progressValue * 100));
	const progressLabel = $derived(
		runningMode === 'debug' ? 'Preparing debug session' : 'Loading runtime'
	);
	type WasmIdleDebugApi = {
		writeTerminalInput: (text: string, eof?: boolean) => Promise<void>;
	};

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

	async function stopDebug() {
		if (!terminal || runningMode !== 'debug') return;
		await terminal.stop?.();
	}

	async function sendTerminalEof() {
		if (!terminal || !runningMode) return;
		await terminal.eof?.();
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
		const args =
			(language === 'JAVA' || language === 'RUST') && argsInput.trim()
				? argsInput.trim().split(/\s+/)
				: [];
		if (browser) {
			localStorage.setItem('code', editor.getValue());
			localStorage.setItem('language', language);
			localStorage.setItem('argsInput', argsInput);
		}
		try {
			if (!('SharedArrayBuffer' in window)) location.reload();
			progress = 0;
			await executeTerminalRun({
				terminal,
				language,
				code: editor.getValue(),
				log,
				progress: progressRef,
				args,
				options: {
					debug,
					breakpoints,
					stdin: '',
					pauseOnEntry: debug
				}
			});
		} finally {
			progress = -1;
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
		if (!browser) return;
		const target = window as Window & typeof globalThis & { __wasmIdleDebug?: WasmIdleDebugApi };
		const debugApi: WasmIdleDebugApi = {
			async writeTerminalInput(text: string, eof = false) {
				if (!terminal) return;
				await terminal.waitForInput?.();
				await terminal.write(text);
				if (eof) await terminal.eof?.();
			}
		};
		target.__wasmIdleDebug = debugApi;
		return () => {
			if (target.__wasmIdleDebug === debugApi) delete target.__wasmIdleDebug;
		};
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
		if (language !== 'JAVA' && language !== 'RUST') compilerDiagnostics = [];
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
					{#if runningMode === 'debug'}
						<button class="action-button action-button--stop" onclick={stopDebug}>
							<span class="material-symbols-outlined">stop_circle</span>
							<span>Stop Debug</span>
						</button>
					{:else}
						<button
							class="action-button action-button--debug"
							onclick={() => exec(true)}
							disabled={!!runningMode || !debugLanguage}
						>
							<span class="material-symbols-outlined">bug_report</span>
							<span>Debug</span>
						</button>
					{/if}
					<button
						class="action-button action-button--icon"
						onclick={sendTerminalEof}
						disabled={!runningMode}
						title="Send EOF"
						aria-label="Send EOF"
					>
						<span class="material-symbols-outlined">keyboard_tab_rtl</span>
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
						<option value="RUST">Rust</option>
					</select>
				</label>
				{#if language === 'JAVA' || language === 'RUST'}
					<label class="args-chip">
						<span class="material-symbols-outlined">list_alt</span>
						<input bind:value={argsInput} placeholder="3 4 5" spellcheck={false} />
						<span>Args</span>
					</label>
				{/if}
			</div>
			{#if loading}
				<div class="progress-shell" aria-live="polite">
					<div class="progress-copy">
						<div class="progress-copy__text">
							<span class="material-symbols-outlined">downloading</span>
							<strong>{progressLabel}</strong>
						</div>
						<span class="progress-percent">{progressPercent}%</span>
					</div>
					<div
						class="progress-track"
						role="progressbar"
						aria-label={progressLabel}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={progressPercent}
					>
						<div class="progress-fill" style={`transform: scaleX(${progressValue})`}></div>
					</div>
				</div>
			{/if}
		</section>
		{#if language === 'JAVA'}
			<p class="hint">Run after that type into the terminal below and press Enter.</p>
		{/if}
		{#if language === 'RUST'}
			<p class="hint">
				Type into the terminal below and press Enter to send a line. Use Ctrl+D or the EOF
				button while running if the program reads stdin until EOF.
			</p>
		{/if}
		{#if debugLanguage}
			<section
				class={[
					'debug-shell',
					debugPaused && 'debug-shell--paused',
					debugActive && !debugPaused && 'debug-shell--active'
				]}
			>
				<div class="debug-hero">
					<div class="debug-hero__intro">
						<div class="debug-hero__badge">
							<span class="material-symbols-outlined">bug_report</span>
						</div>
						<div class="debug-hero__copy">
							<p class="debug-hero__eyebrow">Debug Workspace</p>
							<h2>{debugTitle}</h2>
						</div>
					</div>
					<div class="debug-hero__stats">
						<div
							class={[
								'debug-status-pill',
								debugPaused
									? 'debug-status-pill--paused'
									: debugActive
										? 'debug-status-pill--active'
										: 'debug-status-pill--idle'
							]}
						>
							<span class="material-symbols-outlined">{debugStatusIcon}</span>
							<span>{debugStatusLabel}</span>
						</div>
						<div class="debug-metric">
							<span>Breakpoints</span>
							<strong>{breakpoints.length}</strong>
						</div>
						<div class="debug-metric">
							<span>Watches</span>
							<strong>{watchExpressions.length}</strong>
						</div>
						<div class="debug-metric">
							<span>Line</span>
							<strong>{pausedLine === null ? '—' : `L${pausedLine}`}</strong>
						</div>
					</div>
				</div>
				<div class="debug-panels">
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">data_object</span>
								<div class="debug-panel__copy">
									<h3>Locals</h3>
								</div>
							</div>
							<span class="debug-count">{debugLocals.length}</span>
						</header>
						{#if debugLocals.length}
							<ul>
								{#each debugLocals as variable (variable.name)}
									<li class="debug-entry debug-entry--local">
										<code class="debug-key">{variable.name}</code>
										<code class="debug-value">{variable.value}</code>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No locals yet</span>
							</p>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">visibility</span>
								<div class="debug-panel__copy">
									<h3>Watch</h3>
								</div>
							</div>
							<span class="debug-count">{watchExpressions.length}</span>
						</header>
						<div class="watch-row">
							<input
								bind:value={watchInput}
								placeholder="a == b"
								onkeydown={(event) => event.key === 'Enter' && addWatchExpression()}
							/>
							<button class="watch-add" onclick={addWatchExpression}>
								<span class="material-symbols-outlined">add</span>
								<span>Add</span>
							</button>
						</div>
						{#if watchValues.length}
							<ul>
								{#each watchValues as watch (watch.expression)}
									<li class="debug-entry debug-entry--watch">
										<div class="debug-entry__body">
											<span class="debug-expression">{watch.expression}</span>
											<code class="debug-value">{watch.value}</code>
										</div>
										<button
											class="remove"
											onclick={() => removeWatchExpression(watch.expression)}
											aria-label={`Remove watch expression ${watch.expression}`}
										>
											<span class="material-symbols-outlined">close</span>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No watches yet</span>
							</p>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">layers</span>
								<div class="debug-panel__copy">
									<h3>Call Stack</h3>
								</div>
							</div>
							<span class="debug-count">{debugCallStack.length}</span>
						</header>
						{#if debugCallStack.length}
							<ul>
								{#each debugCallStack as frame, index (`${frame.functionName}:${frame.line}`)}
									<li
										class={[
											'debug-entry',
											'debug-entry--stack',
											index === 0 && 'debug-entry--current'
										]}
									>
										<div class="stack-meta">
											<span class="stack-order">{index + 1}</span>
											<span class="stack-function"
												>{frame.functionName || '(entry)'}</span
											>
										</div>
										<code class="stack-line">L{frame.line}</code>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No frames yet</span>
							</p>
						{/if}
					</section>
				</div>
			</section>
		{/if}
		<div class="terminal-shell">
			<Terminal
				bind:terminal
				{path}
				{runtimeAssets}
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

	.progress-shell {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid rgba(45, 212, 191, 0.2);
		background:
			linear-gradient(180deg, rgba(240, 253, 250, 0.96), rgba(236, 253, 245, 0.92)),
			radial-gradient(circle at top left, rgba(20, 184, 166, 0.16), transparent 42%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.9),
			0 12px 24px rgba(20, 184, 166, 0.08);
	}

	.progress-copy {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.progress-copy__text {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: #0f172a;
		font-size: 12px;
	}

	.progress-copy__text strong {
		font-size: 12px;
	}

	.progress-percent {
		font-size: 12px;
		font-weight: 700;
		color: #0f766e;
	}

	.progress-track {
		height: 8px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.18);
		box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
	}

	.progress-fill {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		transform-origin: left center;
		background: linear-gradient(90deg, #0f766e 0%, #14b8a6 52%, #34d399 100%);
		box-shadow: 0 0 24px rgba(20, 184, 166, 0.28);
		transition: transform 0.18s ease;
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

	.action-button--stop {
		background: linear-gradient(135deg, #b91c1c 0%, #ef4444 100%);
		color: #fff8f8;
		box-shadow: 0 12px 22px rgba(239, 68, 68, 0.24);
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

	.debug-shell {
		--debug-accent: #6366f1;
		--debug-accent-soft: rgba(99, 102, 241, 0.14);
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 8px 0 10px;
		padding: 12px;
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 18px;
		background:
			radial-gradient(circle at top left, var(--debug-accent-soft), transparent 34%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
		box-shadow: 0 22px 40px rgba(15, 23, 42, 0.08);
	}

	.debug-shell--active {
		--debug-accent: #0f766e;
		--debug-accent-soft: rgba(20, 184, 166, 0.16);
	}

	.debug-shell--paused {
		--debug-accent: #7c3aed;
		--debug-accent-soft: rgba(124, 58, 237, 0.16);
	}

	.debug-hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.debug-hero__intro {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex: 1 1 260px;
		min-width: 0;
	}

	.debug-hero__badge {
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		border-radius: 14px;
		background: linear-gradient(135deg, var(--debug-accent) 0%, #0f172a 180%);
		color: white;
		box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
		flex: 0 0 auto;
	}

	.debug-hero__badge .material-symbols-outlined {
		font-size: 20px;
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.debug-hero__copy {
		min-width: 0;
	}

	.debug-hero__eyebrow {
		margin: 0 0 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--debug-accent);
	}

	.debug-hero__copy h2 {
		margin: 0;
		font-size: 18px;
		line-height: 1.1;
		color: #0f172a;
	}

	.debug-hero__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.debug-status-pill,
	.debug-metric {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(255, 255, 255, 0.86);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
	}

	.debug-status-pill {
		font-size: 11px;
		font-weight: 700;
		color: #0f172a;
	}

	.debug-status-pill--idle {
		color: #475569;
	}

	.debug-status-pill--active {
		color: #0f766e;
	}

	.debug-status-pill--paused {
		color: #7c3aed;
	}

	.debug-metric {
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding-top: 6px;
		padding-bottom: 6px;
		border-radius: 14px;
	}

	.debug-metric span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}

	.debug-metric strong {
		font-size: 13px;
		line-height: 1;
		color: #0f172a;
	}

	.debug-panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 10px;
	}

	.debug-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		border: 1px solid rgba(203, 213, 225, 0.72);
		border-radius: 16px;
		padding: 12px;
		background: rgba(255, 255, 255, 0.82);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.88),
			0 12px 24px rgba(15, 23, 42, 0.05);
		font-size: 12px;
	}

	.debug-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.debug-panel__title {
		display: flex;
		gap: 10px;
		min-width: 0;
	}

	.debug-panel__title > .material-symbols-outlined {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: rgba(99, 102, 241, 0.08);
		color: var(--debug-accent);
		flex: 0 0 auto;
	}

	.debug-panel__copy {
		min-width: 0;
	}

	.debug-panel h3 {
		margin: 0;
		font-size: 12px;
		color: #0f172a;
	}

	.debug-count {
		min-width: 22px;
		height: 22px;
		display: inline-grid;
		place-items: center;
		padding: 0 6px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.06);
		color: #334155;
		font-size: 11px;
		font-weight: 700;
	}

	.debug-panel ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.debug-entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px;
		border: 1px solid rgba(226, 232, 240, 0.92);
		border-radius: 12px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
	}

	.debug-entry--local {
		align-items: flex-start;
	}

	.debug-entry__body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.debug-expression,
	.stack-function {
		font-weight: 600;
		color: #0f172a;
		word-break: break-word;
	}

	.debug-key,
	.stack-line,
	.debug-value {
		max-width: 100%;
		padding: 4px 7px;
		border-radius: 9px;
		background: rgba(241, 245, 249, 0.95);
		border: 1px solid rgba(226, 232, 240, 0.95);
	}

	.debug-key {
		color: var(--debug-accent);
		font-weight: 700;
	}

	.debug-value {
		color: #334155;
		overflow-wrap: anywhere;
	}

	.debug-entry--stack {
		align-items: center;
	}

	.debug-entry--current {
		border-color: rgba(99, 102, 241, 0.24);
		box-shadow: 0 8px 18px rgba(99, 102, 241, 0.08);
	}

	.stack-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.stack-order {
		width: 20px;
		height: 20px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.08);
		color: #475569;
		font-size: 10px;
		font-weight: 700;
	}

	.watch-row {
		display: flex;
		gap: 8px;
	}

	.watch-row input {
		flex: 1;
		min-width: 0;
		padding: 0 12px;
		min-height: 36px;
		border: 1px solid rgba(148, 163, 184, 0.3);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.94);
		font: inherit;
		color: #0f172a;
		outline: none;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.watch-row input:focus {
		border-color: rgba(99, 102, 241, 0.42);
		box-shadow:
			0 0 0 3px rgba(99, 102, 241, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.watch-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: 12px;
		background: linear-gradient(135deg, #4338ca 0%, #6366f1 100%);
		color: #f8faff;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 18px rgba(99, 102, 241, 0.22);
	}

	.watch-add .material-symbols-outlined {
		font-size: 16px;
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
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgba(239, 68, 68, 0.09);
		color: #b91c1c;
		cursor: pointer;
		flex: 0 0 auto;
	}

	.remove .material-symbols-outlined {
		font-size: 15px;
	}

	.empty {
		margin: 0;
		padding: 14px 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px dashed rgba(148, 163, 184, 0.35);
		border-radius: 12px;
		background: rgba(248, 250, 252, 0.76);
		color: #64748b;
	}

	@media (max-width: 960px) {
		.debug-hero__stats {
			width: 100%;
			justify-content: flex-start;
		}
	}
</style>
