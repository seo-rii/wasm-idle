import { createRustCompiler } from '/dist/index.js';
import { executeBrowserRustArtifact } from '/dist/browser-execution.js';
import { loadRuntimeManifest, normalizeRuntimeManifest } from '/dist/runtime-manifest.js';

const sourceInput = document.querySelector('#source');
const compileTimeoutInput = document.querySelector('#compile-timeout');
const artifactIdleInput = document.querySelector('#artifact-idle');
const memoryInitialInput = document.querySelector('#memory-initial');
const memoryMaximumInput = document.querySelector('#memory-maximum');
const editionInput = document.querySelector('#edition');
const targetTripleInput = document.querySelector('#target-triple');
const enableLogsInput = document.querySelector('#enable-logs');
const runButton = document.querySelector('#run-button');
const resultPanel = document.querySelector('#result-panel');
const logPanel = document.querySelector('#log-panel');
const isolationPill = document.querySelector('#isolation-pill');
const runPill = document.querySelector('#run-pill');
const progressPill = document.querySelector('#progress-pill');
const progressBar = document.querySelector('#progress-bar');
const runtimeManifestUrl = new URL('/dist/runtime/runtime-manifest.json', window.location.href);

const state = {
	lastResult: null,
	progressEvents: []
};

let manifestDefaultsPromise;

function appendLog(message, kind = 'info', echo = true) {
	const line = `[${new Date().toISOString()}][${kind}] ${message}`;
	logPanel.textContent += `${line}\n`;
	logPanel.scrollTop = logPanel.scrollHeight;
	if (!echo) {
		return;
	}
	if (kind === 'error') {
		console.error(line);
		return;
	}
	if (kind === 'warn') {
		console.warn(line);
		return;
	}
	console.log(line);
}

function updateProgress(progress) {
	state.progressEvents.push(progress);
	progressBar.value = progress.percent;
	progressPill.textContent = `progress: ${Math.round(progress.percent)}% ${progress.stage} (${progress.attempt}/${progress.maxAttempts})`;
}

async function loadHarnessManifest() {
	if (!manifestDefaultsPromise) {
		const v3Url = new URL('/dist/runtime/runtime-manifest.v3.json', window.location.href);
		const v2Url = new URL('/dist/runtime/runtime-manifest.v2.json', window.location.href);
		manifestDefaultsPromise = loadRuntimeManifest(v3Url)
			.catch(() => loadRuntimeManifest(v2Url))
			.catch(() => loadRuntimeManifest(runtimeManifestUrl))
			.then((manifest) => normalizeRuntimeManifest(manifest));
	}
	return manifestDefaultsPromise;
}

function readNumericInput(input, fallback) {
	const parsed = Number.parseInt(input.value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function syncTargetSelector(manifest) {
	const availableTargets = new Set(Object.keys(manifest.targets));
	for (const option of Array.from(targetTripleInput.options)) {
		option.disabled = !availableTargets.has(option.value);
	}
	if (!availableTargets.has(targetTripleInput.value)) {
		targetTripleInput.value = manifest.defaultTargetTriple;
	}
}

async function runWasiModule(wasmArtifact) {
	return executeBrowserRustArtifact(wasmArtifact, new URL('/dist/runtime/', window.location.href).toString());
}

function readHarnessOptions(baseManifest, overrides = {}) {
	return {
		code: overrides.code ?? sourceInput.value,
		edition: overrides.edition ?? editionInput.value,
		targetTriple: overrides.targetTriple ?? targetTripleInput.value ?? baseManifest.defaultTargetTriple,
		compileTimeoutMs:
			overrides.compileTimeoutMs ??
			readNumericInput(compileTimeoutInput, baseManifest.compiler.compileTimeoutMs),
		artifactIdleMs:
			overrides.artifactIdleMs ??
			readNumericInput(artifactIdleInput, baseManifest.compiler.artifactIdleMs),
		initialPages:
			overrides.initialPages ??
			readNumericInput(memoryInitialInput, baseManifest.compiler.rustcMemory.initialPages),
		maximumPages:
			overrides.maximumPages ??
			readNumericInput(memoryMaximumInput, baseManifest.compiler.rustcMemory.maximumPages),
		log: overrides.log ?? enableLogsInput.checked
	};
}

async function runWasmRustHarness(overrides = {}) {
	const baseManifest = await loadHarnessManifest();
	const options = readHarnessOptions(baseManifest, overrides);
	const startedAt = performance.now();
	logPanel.textContent = '';
	state.progressEvents = [];
	progressBar.value = 0;
	progressPill.textContent = 'progress: 0% manifest (1/5)';
	runPill.textContent = 'status: running';
	appendLog(
		`starting compile target=${options.targetTriple} timeout=${options.compileTimeoutMs} idle=${options.artifactIdleMs} memory=${options.initialPages}/${options.maximumPages}`
	);

	const compiler = await createRustCompiler({
		dependencies: {
			loadManifest: async () => ({
				...baseManifest,
				compiler: {
					...baseManifest.compiler,
					compileTimeoutMs: options.compileTimeoutMs,
					artifactIdleMs: options.artifactIdleMs,
					rustcMemory: {
						...baseManifest.compiler.rustcMemory,
						initialPages: options.initialPages,
						maximumPages: options.maximumPages
					}
				}
			})
		}
	});

	const compileResult = await compiler.compile({
		code: options.code,
		edition: options.edition,
		crateType: 'bin',
		targetTriple: options.targetTriple,
		log: options.log,
		onProgress: (progress) => {
			updateProgress(progress);
		}
	});
	for (const line of compileResult.logs || []) {
		appendLog(line, 'compile', false);
	}
	const result = {
		crossOriginIsolated: window.crossOriginIsolated,
		elapsedMs: Math.round(performance.now() - startedAt),
		manifest: {
			targetTriple: options.targetTriple,
			compileTimeoutMs: options.compileTimeoutMs,
			artifactIdleMs: options.artifactIdleMs,
			initialPages: options.initialPages,
			maximumPages: options.maximumPages
		},
		compile: {
			success: compileResult.success,
			stdout: compileResult.stdout ?? '',
			stderr: compileResult.stderr ?? '',
			diagnostics: compileResult.diagnostics ?? [],
			logs: compileResult.logs ?? [],
			hasWasm: Boolean(compileResult.artifact?.wasm),
			hasWat: Boolean(compileResult.artifact?.wat),
			targetTriple: compileResult.artifact?.targetTriple ?? options.targetTriple,
			format: compileResult.artifact?.format ?? null
		},
		runtime: null
	};

	if (compileResult.success && compileResult.artifact?.wasm) {
		appendLog('compile succeeded; executing WASI module in browser');
		result.runtime = await runWasiModule(compileResult.artifact);
	} else {
		appendLog(
			`compile failed: ${compileResult.stderr || 'missing artifact from compiler result'}`,
			'warn'
		);
	}

	state.lastResult = result;
	resultPanel.textContent = JSON.stringify(result, null, 2);
	runPill.textContent = result.compile.success && result.runtime?.exitCode === 0 ? 'status: ok' : 'status: failed';
	appendLog(`run finished in ${result.elapsedMs}ms`);
	return result;
}

isolationPill.textContent = `crossOriginIsolated: ${String(window.crossOriginIsolated)}`;
loadHarnessManifest()
	.then((manifest) => {
		compileTimeoutInput.value = String(manifest.compiler.compileTimeoutMs);
		artifactIdleInput.value = String(manifest.compiler.artifactIdleMs);
		memoryInitialInput.value = String(manifest.compiler.rustcMemory.initialPages);
		memoryMaximumInput.value = String(manifest.compiler.rustcMemory.maximumPages);
		syncTargetSelector(manifest);
		targetTripleInput.value = manifest.defaultTargetTriple;
	})
	.catch((error) => {
		appendLog(
			`failed to load runtime manifest defaults: ${error instanceof Error ? error.message : String(error)}`,
			'warn'
		);
	});
window.__wasmRustBrowserHarnessState = state;
window.runWasmRustHarness = runWasmRustHarness;

runButton.addEventListener('click', async () => {
	runButton.disabled = true;
	try {
		await runWasmRustHarness();
	} catch (error) {
		const result = {
			crossOriginIsolated: window.crossOriginIsolated,
			elapsedMs: 0,
			compile: {
				success: false,
				stdout: '',
				stderr: error instanceof Error ? error.message : String(error),
				diagnostics: [],
				hasWasm: false,
				hasWat: false
			},
			runtime: null
		};
		state.lastResult = result;
		resultPanel.textContent = JSON.stringify(result, null, 2);
		runPill.textContent = 'status: failed';
		progressPill.textContent = 'progress: failed';
		progressBar.value = 0;
		appendLog(result.compile.stderr, 'error');
	} finally {
		runButton.disabled = false;
	}
});
