<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal, { cppDebugLanguageAdapter, pythonDebugLanguageAdapter } from '$lib';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import type { DebugFrame, DebugSessionEvent, DebugVariable } from '$lib/playground/options';
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
		watchInput = $state(''),
		watchExpressions = $state<string[]>([]),
		pausedLine = $state<number | null>(null),
		debugActive = $state(false),
		debugPaused = $state(false),
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

	async function exec(debug = false) {
		if (!editor || !terminal) return;
		if (runningMode) return;
		runningMode = debug ? 'debug' : 'run';
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
		if (browser) {
			localStorage.setItem('code', editor.getValue());
			localStorage.setItem('language', language);
		}
		try {
			if (!('SharedArrayBuffer' in window)) location.reload();
			await executeTerminalRun({
				terminal,
				language,
				code: editor.getValue(),
				log,
				options: {
					debug,
					breakpoints,
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

	const watchValues = $derived.by(() =>
		watchExpressions.map((expression) => {
			try {
				return {
					expression,
					value: debugLanguage
						? debugLanguage.evaluateExpression(expression, debugLocals)
						: 'error'
				};
			} catch (error) {
				return {
					expression,
					value: error instanceof Error && error.message === 'unavailable' ? '?' : 'error'
				};
			}
		})
	);

	$effect(() => {
		if (browser && editor && !init) {
			const code = localStorage.getItem('code');
			const lang = localStorage.getItem('language');
			if (code) editor.setValue(code);
			if (lang) language = lang;
			init = true;
		}
	});

	$effect(() => {
		if (!debugLanguage) {
			breakpoints = [];
			pausedLine = null;
			debugLocals = [];
			debugCallStack = [];
			debugActive = false;
			debugPaused = false;
		}
	});
</script>

<main>
	<div style="width: 50%">
		{path}
		<button onclick={() => exec(false)} disabled={!!runningMode}>Run</button>
		<button onclick={() => exec(true)} disabled={!!runningMode || !debugLanguage}>
			Debug
		</button>
		<button onclick={() => sendDebugCommand('continue')} disabled={!debugPaused}>
			Continue
		</button>
		<button onclick={() => sendDebugCommand('stepInto')} disabled={!debugPaused}>
			Step Into
		</button>
		<button onclick={() => sendDebugCommand('nextLine')} disabled={!debugPaused}>
			Next Line
		</button>
		<button onclick={() => sendDebugCommand('stepOut')} disabled={!debugPaused}>
			Step Out
		</button>
		<input id="log-toggle" type="checkbox" bind:checked={log} />
		<label for="log-toggle">Log</label>
		<select bind:value={language}>
			<option value="CPP">C++</option>
			<option value="PYTHON">Python</option>
		</select>
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
							{#each debugLocals as variable}
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
							{#each watchValues as watch}
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
							{#each debugCallStack as frame}
								<li>{frame.functionName}:{frame.line}</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">No frames</p>
					{/if}
				</section>
			</div>
		{/if}
		<Terminal bind:terminal {path} ondebug={onDebugEvent} />
	</div>
	{#key language}
		<Monaco
			language={language.toLowerCase()}
			bind:editor
			{clangdBaseUrl}
			{breakpoints}
			{debugLocals}
			{debugLanguage}
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
	}

	.hint {
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

	.remove {
		padding: 0 6px;
	}

	.empty {
		margin: 0;
		color: #64748b;
	}
</style>
