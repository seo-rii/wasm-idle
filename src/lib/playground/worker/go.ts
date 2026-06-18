import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import { instrumentGoDebugSource } from '$lib/playground/goDebugInstrumentation';
import type { DebugFrame, DebugPauseReason } from '$lib/playground/options';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

let stdinBufferGo: Int32Array | null = null;
let debugBufferGo: Int32Array | null = null;
let compilerUrl = '';
let loadedCompilerUrl = '';
let compilerPromise: Promise<{
	compiler: any;
	executeBrowserGoArtifact: (
		artifact: any,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: () => string | null;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
}> | null = null;
let compiledArtifact: any = null;
let compiledCacheKey = '';

interface GoDebugState {
	breakpointVersion: number;
	breakpoints: Set<number>;
	pauseOnEntry: boolean;
	stepMode: 'step' | 'next' | 'out' | null;
	resumeSkip: string | null;
	nextDepth: number | null;
	nextLine: number | null;
	stepOutDepth: number | null;
}

async function loadCompiler(url: string) {
	if (!url) {
		throw new Error(
			'Go runtime is not configured. Set PUBLIC_WASM_GO_COMPILER_URL or runtimeAssets.go.compilerUrl.'
		);
	}
	if (loadedCompilerUrl === url && compilerPromise) {
		return await compilerPromise;
	}
	loadedCompilerUrl = url;
	compiledArtifact = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
		const factory =
			typeof module.createGoCompiler === 'function'
				? module.createGoCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-go module must export createGoCompiler or a default factory');
		}
		if (typeof module.executeBrowserGoArtifact !== 'function') {
			throw new Error('wasm-go module must export executeBrowserGoArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserGoArtifact: module.executeBrowserGoArtifact
		};
	})();
	return await compilerPromise;
}

function normalizeDiagnostic(diagnostic: any) {
	return {
		fileName: diagnostic?.fileName ?? null,
		lineNumber: Math.max(1, Number(diagnostic?.lineNumber || 1)),
		columnNumber:
			typeof diagnostic?.columnNumber === 'number'
				? Math.max(1, diagnostic.columnNumber)
				: undefined,
		severity:
			diagnostic?.severity === 'warning' || diagnostic?.severity === 'other'
				? diagnostic.severity
				: 'error',
		message: String(diagnostic?.message || '')
	};
}

function normalizedBreakpointSet(values: unknown) {
	return new Set(
		[...(Array.isArray(values) ? values : [])]
			.map((value) => Number(value))
			.filter((value) => Number.isInteger(value) && value > 0)
	);
}

function refreshGoDebugBreakpoints(state: GoDebugState, control: Int32Array) {
	const version = Atomics.load(control, 2);
	if (state.breakpointVersion === version) return;
	state.breakpointVersion = version;
	const count = Math.max(0, Math.min(Atomics.load(control, 3), control.length - 4));
	const next = new Set<number>();
	for (let index = 0; index < count; index += 1) {
		const line = Atomics.load(control, 4 + index);
		if (Number.isInteger(line) && line > 0) next.add(line);
	}
	state.breakpoints = next;
}

function parseGoDebugStack(stackJson: string, fallbackLine: number): DebugFrame[] {
	try {
		const stack = JSON.parse(stackJson);
		if (Array.isArray(stack)) {
			return stack
				.map((frame) => ({
					functionName: String(frame?.functionName || 'main'),
					line: Math.max(1, Number(frame?.line || fallbackLine))
				}))
				.filter((frame) => frame.line > 0);
		}
	} catch {
		// Keep running even if user code corrupts the hook argument.
	}
	return [{ functionName: 'main', line: fallbackLine }];
}

function waitForGoDebugCommand(
	state: GoDebugState,
	control: Int32Array,
	depth: number,
	line: number
) {
	let sequence = Atomics.load(control, 0);
	while (true) {
		Atomics.wait(control, 0, sequence, 100);
		const command = Atomics.exchange(control, 1, 0);
		if (!command) {
			sequence = Atomics.load(control, 0);
			continue;
		}
		state.resumeSkip = `${depth}:${line}`;
		state.stepMode = null;
		state.nextDepth = null;
		state.nextLine = null;
		state.stepOutDepth = null;
		if (command === 2) {
			state.stepMode = 'step';
		} else if (command === 3) {
			state.stepMode = 'next';
			state.nextDepth = depth;
			state.nextLine = line;
		} else if (command === 4) {
			state.stepMode = 'out';
			state.stepOutDepth = Math.max(0, depth - 1);
		}
		return;
	}
}

function createGoDebugHost(options: {
	control: Int32Array;
	breakpoints: unknown;
	pauseOnEntry: boolean;
}) {
	const state: GoDebugState = {
		breakpointVersion: Atomics.load(options.control, 2),
		breakpoints: normalizedBreakpointSet(options.breakpoints),
		pauseOnEntry: options.pauseOnEntry,
		stepMode: null,
		resumeSkip: null,
		nextDepth: null,
		nextLine: null,
		stepOutDepth: null
	};
	const previousHook = (globalThis as any).__wasmIdleGoDebugLine;
	(globalThis as any).__wasmIdleGoDebugLine = (rawLine: unknown, rawStackJson: unknown) => {
		const line = Math.max(1, Number(rawLine || 1));
		refreshGoDebugBreakpoints(state, options.control);
		const callStack = parseGoDebugStack(String(rawStackJson || '[]'), line);
		const depth = Math.max(1, callStack.length);
		const skipKey = `${depth}:${line}`;
		if (state.resumeSkip === skipKey) return;
		if (state.resumeSkip) state.resumeSkip = null;

		let reason: DebugPauseReason | null = null;
		if (state.pauseOnEntry) {
			reason = 'entry';
		} else if (state.breakpoints.has(line)) {
			reason = 'breakpoint';
		} else if (state.stepMode === 'step') {
			reason = 'step';
		} else if (
			state.stepMode === 'next' &&
			state.nextDepth !== null &&
			depth <= state.nextDepth &&
			line !== state.nextLine
		) {
			reason = 'nextLine';
		} else if (
			state.stepMode === 'out' &&
			state.stepOutDepth !== null &&
			depth <= state.stepOutDepth
		) {
			reason = 'stepOut';
		}
		if (!reason) return;

		state.pauseOnEntry = false;
		state.stepMode = null;
		state.nextDepth = null;
		state.nextLine = null;
		state.stepOutDepth = null;
		postMessage({
			debugEvent: {
				type: 'pause',
				line,
				reason,
				locals: [],
				callStack
			}
		});
		waitForGoDebugCommand(state, options.control, depth, line);
	};
	return () => {
		if (previousHook === undefined) {
			delete (globalThis as any).__wasmIdleGoDebugLine;
		} else {
			(globalThis as any).__wasmIdleGoDebugLine = previousHook;
		}
	};
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		compilerUrl: nextCompilerUrl,
		buffer,
		debugBuffer,
		code,
		prepare,
		args = [],
		stdin,
		target = 'wasip1/wasm',
		log,
		debug = false,
		breakpoints = [],
		pauseOnEntry = false
	} = event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			if (log) {
				console.log(`[wasm-idle:go-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(compilerUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferGo = new Int32Array(buffer);
		debugBufferGo = debugBuffer ? new Int32Array(debugBuffer) : null;
		if (debug && (!debugBufferGo || !isSharedBufferBackedView(debugBufferGo))) {
			postMessage({ error: 'Go debugging requires SharedArrayBuffer.' });
			return;
		}
		const runtime = await loadCompiler(compilerUrl);
		const effectiveTarget = debug ? 'js/wasm' : target;
		const compileCode = debug ? instrumentGoDebugSource(code) : code;
		const compileCacheKey = `${effectiveTarget}\n${compileCode}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:go-worker] compile start prepare=${String(prepare)} target=${effectiveTarget} bytes=${compileCode.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code: compileCode,
				target: effectiveTarget,
				prepare,
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:go-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic: normalizeDiagnostic(diagnostic) });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						'Go compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.wasm) {
				throw new Error('wasm-go did not return a wasm artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
			if (log) {
				console.log(
					`[wasm-idle:go-worker] cached artifact target=${compiledArtifact.target} format=${compiledArtifact.format}`
				);
			}
		}

		if (prepare) {
			if (log) {
				console.log('[wasm-idle:go-worker] prepare complete');
			}
			postMessage({ results: true });
			return;
		}

		if (log) {
			console.log(
				`[wasm-idle:go-worker] runtime start target=${compiledArtifact.target} format=${compiledArtifact.format}`
			);
		}
		const restoreGoDebugHost =
			debug && debugBufferGo
				? createGoDebugHost({
						control: debugBufferGo,
						breakpoints,
						pauseOnEntry: !!pauseOnEntry
					})
				: null;
		const hasInitialStdin = typeof stdin === 'string';
		let initialStdin: string | null = hasInitialStdin ? stdin : null;
		let execution: {
			exitCode: number | null;
			stdout: string;
			stderr: string;
		} | null = null;
		try {
			execution = await runtime.executeBrowserGoArtifact(compiledArtifact, {
				args,
				env: {
					USER: 'jungol'
				},
				stdin: () => {
					if (hasInitialStdin) {
						const chunk = initialStdin;
						initialStdin = null;
						if (log) {
							console.log(
								chunk == null
									? '[wasm-idle:go-stdin] fd_read(bytes=0, eof=true)'
									: `[wasm-idle:go-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
							);
						}
						return chunk;
					}
					const chunk = waitForBufferedStdin(stdinBufferGo, () =>
						postMessage({ buffer: true })
					);
					if (chunk == null) {
						if (log) {
							console.log('[wasm-idle:go-stdin] fd_read(bytes=0, eof=true)');
						}
						return null;
					}
					if (log) {
						console.log(
							`[wasm-idle:go-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
						);
					}
					return chunk;
				},
				stdout: (output) => {
					if (output) {
						postMessage({ output });
					}
				},
				stderr: (output) => {
					if (output) {
						postMessage({ output });
					}
				}
			});
		} finally {
			restoreGoDebugHost?.();
		}
		if (log) {
			console.log(
				`[wasm-idle:go-worker] wasi run complete exitCode=${String(execution?.exitCode)}`
			);
		}
		if (!execution) {
			throw new Error('Go program did not return an execution result');
		}
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `Go program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `Go program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:go-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
