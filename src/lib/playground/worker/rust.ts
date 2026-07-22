import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import type { DebugFrame, DebugPauseReason } from '$lib/playground/options';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

let stdinBufferRust: Int32Array | null = null;
let debugBufferRust: Int32Array | null = null;
let compilerUrl = '';
let debugModuleUrl = '';
let runtimeBaseUrl = '';
let loadedCompilerUrl = '';
let compilerPromise: Promise<{
	compiler: any;
	executeBrowserRustArtifact: (
		artifact: any,
		runtimeBaseUrl: string,
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
let loadedDebugModuleUrl = '';
let debugInstrumenterPromise: Promise<RustDebugInstrumenter> | null = null;

interface RustDebugInstrumenter {
	RUST_DEBUG_MARKER: string;
	instrumentRustDebugSource: (source: string) => string;
}

interface RustDebugState {
	breakpointVersion: number;
	breakpoints: Set<number>;
	pauseOnEntry: boolean;
	stepMode: 'step' | 'next' | 'out' | null;
	resumeSkip: string | null;
	nextDepth: number | null;
	nextLine: number | null;
	stepOutDepth: number | null;
	callStack: DebugFrame[];
}

async function loadCompiler(url: string) {
	if (!url) {
		throw new Error(
			'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
		);
	}
	if (loadedCompilerUrl === url && compilerPromise) {
		return await compilerPromise;
	}
	loadedCompilerUrl = url;
	try {
		runtimeBaseUrl = new URL('./runtime/', url).toString();
	} catch {
		runtimeBaseUrl = url;
	}
	compiledArtifact = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
		const factory =
			typeof module.createRustCompiler === 'function'
				? module.createRustCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-rust module must export createRustCompiler or a default factory');
		}
		if (typeof module.executeBrowserRustArtifact !== 'function') {
			throw new Error('wasm-rust module must export executeBrowserRustArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserRustArtifact: module.executeBrowserRustArtifact
		};
	})();
	return await compilerPromise;
}

async function loadDebugInstrumenter(url: string) {
	if (!url) {
		throw new Error('Rust debugging is not configured. Set runtimeAssets.rust.debugModuleUrl.');
	}
	if (loadedDebugModuleUrl === url && debugInstrumenterPromise) {
		return await debugInstrumenterPromise;
	}
	loadedDebugModuleUrl = url;
	debugInstrumenterPromise = (async () => {
		const module = (await import(/* @vite-ignore */ url)) as Partial<RustDebugInstrumenter>;
		if (
			typeof module.RUST_DEBUG_MARKER !== 'string' ||
			typeof module.instrumentRustDebugSource !== 'function'
		) {
			throw new Error(
				'Rust debug instrumenter must export RUST_DEBUG_MARKER and instrumentRustDebugSource.'
			);
		}
		return module as RustDebugInstrumenter;
	})().catch((error) => {
		if (loadedDebugModuleUrl === url) {
			loadedDebugModuleUrl = '';
			debugInstrumenterPromise = null;
		}
		throw error;
	});
	return await debugInstrumenterPromise;
}

function normalizedBreakpointSet(values: unknown) {
	return new Set(
		[...(Array.isArray(values) ? values : [])]
			.map((value) => Number(value))
			.filter((value) => Number.isInteger(value) && value > 0)
	);
}

function refreshRustDebugBreakpoints(state: RustDebugState, control: Int32Array) {
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

function waitForRustDebugCommand(
	state: RustDebugState,
	control: Int32Array,
	locationKey: string,
	line: number,
	depth: number
) {
	while (true) {
		const command = Atomics.exchange(control, 1, 0);
		if (!command) {
			const sequence = Atomics.load(control, 0);
			Atomics.wait(control, 0, sequence, 100);
			continue;
		}
		state.resumeSkip = locationKey;
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

function createRustDebugHost(options: {
	control: Int32Array;
	breakpoints: unknown;
	pauseOnEntry: boolean;
	marker: string;
}) {
	const state: RustDebugState = {
		breakpointVersion: Atomics.load(options.control, 2),
		breakpoints: normalizedBreakpointSet(options.breakpoints),
		pauseOnEntry: options.pauseOnEntry,
		stepMode: null,
		resumeSkip: null,
		nextDepth: null,
		nextLine: null,
		stepOutDepth: null,
		callStack: []
	};
	let stderrBuffer = '';
	const markerPrefix = `${options.marker}:`;

	const handleMarker = (line: number, functionName: string) => {
		refreshRustDebugBreakpoints(state, options.control);
		const normalizedFunctionName = functionName || 'main';
		const currentFrame = state.callStack.at(-1);
		if (!currentFrame) {
			state.callStack.push({ functionName: normalizedFunctionName, line });
		} else if (currentFrame.functionName === normalizedFunctionName) {
			currentFrame.line = line;
		} else {
			let existingFrameIndex = -1;
			for (let index = state.callStack.length - 2; index >= 0; index -= 1) {
				if (state.callStack[index].functionName === normalizedFunctionName) {
					existingFrameIndex = index;
					break;
				}
			}
			if (existingFrameIndex >= 0) {
				state.callStack.length = existingFrameIndex + 1;
				state.callStack[existingFrameIndex].line = line;
			} else {
				state.callStack.push({ functionName: normalizedFunctionName, line });
			}
		}
		const depth = state.callStack.length;
		const skipKey = `${depth}:${normalizedFunctionName}:${line}`;
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
			(depth !== state.nextDepth || line !== state.nextLine)
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
		const callStack = state.callStack.slice().reverse();
		postMessage({
			debugEvent: {
				type: 'pause',
				line,
				reason,
				locals: [],
				callStack
			}
		});
		waitForRustDebugCommand(state, options.control, skipKey, line, depth);
	};

	const consumeLine = (line: string, hasNewline: boolean) => {
		if (line.startsWith(markerPrefix)) {
			const payload = line.slice(markerPrefix.length);
			const separator = payload.indexOf(':');
			if (separator >= 0) {
				handleMarker(
					Math.max(1, Number(payload.slice(0, separator) || 1)),
					payload.slice(separator + 1) || 'main'
				);
			}
			return '';
		}
		return `${line}${hasNewline ? '\n' : ''}`;
	};

	return {
		handleStderr(chunk: string) {
			stderrBuffer += chunk;
			const parts = stderrBuffer.split('\n');
			stderrBuffer = parts.pop() || '';
			return parts.map((line) => consumeLine(line, true)).join('');
		},
		flush() {
			if (!stderrBuffer) return '';
			const chunk = consumeLine(stderrBuffer, false);
			stderrBuffer = '';
			return chunk;
		}
	};
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		compilerUrl: nextCompilerUrl,
		debugModuleUrl: nextDebugModuleUrl,
		buffer,
		debugBuffer,
		code,
		prepare,
		args = [],
		stdin,
		targetTriple = 'wasm32-wasip1',
		log,
		debug = false,
		breakpoints = [],
		pauseOnEntry = false
	} = event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			debugModuleUrl = nextDebugModuleUrl;
			if (log) {
				console.log(`[wasm-idle:rust-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(compilerUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferRust = new Int32Array(buffer);
		debugBufferRust = debugBuffer ? new Int32Array(debugBuffer) : null;
		if (debug && (!debugBufferRust || !isSharedBufferBackedView(debugBufferRust))) {
			postMessage({ error: 'Rust debugging requires SharedArrayBuffer.' });
			return;
		}
		const runtime = await loadCompiler(compilerUrl);
		let debugInstrumenter: RustDebugInstrumenter | null = null;
		if (debug) {
			postMessage({
				progress: {
					stage: 'load-debug-instrumenter',
					percent: 1,
					message: 'Loading Rust debugger'
				}
			});
			debugInstrumenter = await loadDebugInstrumenter(debugModuleUrl);
			postMessage({
				progress: {
					stage: 'load-debug-instrumenter',
					percent: 3,
					message: 'Rust debugger loaded'
				}
			});
		}
		const compileCode = debugInstrumenter
			? debugInstrumenter.instrumentRustDebugSource(code)
			: code;
		const compileCacheKey = `${targetTriple}\n${compileCode}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile start prepare=${String(prepare)} target=${targetTriple} bytes=${compileCode.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code: compileCode,
				edition: '2024',
				crateType: 'bin',
				targetTriple,
				prepare,
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						'Rust compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.wasm) {
				throw new Error('wasm-rust did not return a wasm artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] cached artifact target=${compiledArtifact.targetTriple} format=${compiledArtifact.format}`
				);
			}
		}

		if (prepare) {
			if (log) {
				console.log('[wasm-idle:rust-worker] prepare complete');
			}
			postMessage({ results: true });
			return;
		}

		if (log) {
			console.log(
				`[wasm-idle:rust-worker] runtime start target=${compiledArtifact.targetTriple} format=${compiledArtifact.format}`
			);
		}
		const rustDebugHost =
			debug && debugBufferRust && debugInstrumenter
				? createRustDebugHost({
						control: debugBufferRust,
						breakpoints,
						pauseOnEntry: !!pauseOnEntry,
						marker: debugInstrumenter.RUST_DEBUG_MARKER
					})
				: null;
		const hasInitialStdin = typeof stdin === 'string';
		let initialStdin: string | null = hasInitialStdin ? stdin : null;
		const execution = await runtime.executeBrowserRustArtifact(
			compiledArtifact,
			runtimeBaseUrl,
			{
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
									? '[wasm-idle:rust-stdin] fd_read(bytes=0, eof=true)'
									: `[wasm-idle:rust-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
							);
						}
						return chunk;
					}
					const chunk = waitForBufferedStdin(stdinBufferRust, () =>
						postMessage({ buffer: true })
					);
					if (chunk == null) {
						if (log) {
							console.log('[wasm-idle:rust-stdin] fd_read(bytes=0, eof=true)');
						}
						return null;
					}
					if (log) {
						console.log(
							`[wasm-idle:rust-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
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
					const visibleOutput = rustDebugHost
						? rustDebugHost.handleStderr(output)
						: output;
					if (visibleOutput) postMessage({ output: visibleOutput });
				}
			}
		);
		const flushedDebugOutput = rustDebugHost?.flush();
		if (flushedDebugOutput) postMessage({ output: flushedDebugOutput });
		if (log) {
			console.log(
				`[wasm-idle:rust-worker] wasi run complete exitCode=${String(execution.exitCode)}`
			);
		}
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `Rust program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `Rust program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:rust-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
