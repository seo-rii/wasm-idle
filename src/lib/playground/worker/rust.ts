import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import type { DebugFrame, DebugPauseReason } from '$lib/playground/options';
import {
	WASM_RUST_EXECUTABLE_GRAPH_PROFILE,
	WASM_RUST_RUNTIME_PROFILE
} from '$lib/playground/wasmRustVersion';

declare var self: any;

type RustWorkerDebugMode = 'none' | 'trace' | 'lldb';
const lowercaseSha256Pattern = /^[0-9a-f]{64}$/u;

interface RustCompilerModule {
	configureVerifiedRuntimeExecutableModuleUrls?: (
		moduleUrls: Readonly<Record<string, string>>,
		graphFingerprint: string
	) => void;
	createRustCompiler?: (options: {
		dependencies: { runtimeProfile: RustWorkerRuntimeProfile };
	}) => Promise<any>;
	default?: RustCompilerModule['createRustCompiler'];
	executeBrowserRustArtifact?: (
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
}

interface RustWorkerRuntimeProfile {
	readonly profileId: string;
	readonly protocolVersion: 1;
	readonly manifestPath: 'runtime/runtime-manifest.v3.json';
	readonly manifestFingerprint: string;
	readonly manifestReceipt: Readonly<{ bytes: number; sha256: string }>;
	readonly moduleUrl: string;
}

type RustCompilerModuleImporter = (url: string) => Promise<RustCompilerModule>;

const testOnlyCompilerModuleImporter =
	import.meta.env.MODE === 'test'
		? (
				globalThis as typeof globalThis & {
					__WASM_IDLE_TEST_ONLY_RUST_COMPILER_MODULE_IMPORTER__?: unknown;
				}
			).__WASM_IDLE_TEST_ONLY_RUST_COMPILER_MODULE_IMPORTER__
		: undefined;
const importRustCompilerModule: RustCompilerModuleImporter =
	typeof testOnlyCompilerModuleImporter === 'function'
		? (testOnlyCompilerModuleImporter as RustCompilerModuleImporter)
		: (url) => import(/* @vite-ignore */ url) as Promise<RustCompilerModule>;

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
let runtimeProfile: RustWorkerRuntimeProfile | null = null;
let verifiedModuleUrls: Record<string, string> | null = null;
let executableGraphFingerprint = '';
let loadedCompilerUrl = '';
let loadedExecutableGraphFingerprint = '';
let acceptedCompilerBootstrap = false;
let activeExecution = false;
let compilerPromise: Promise<{
	compiler: any;
	executeBrowserRustArtifact: NonNullable<RustCompilerModule['executeBrowserRustArtifact']>;
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

function compareCodeUnits(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	return (
		JSON.stringify(Object.keys(value).sort(compareCodeUnits)) ===
		JSON.stringify([...expected].sort(compareCodeUnits))
	);
}

function requireCanonicalBlobUrl(value: unknown, label: string) {
	if (typeof value !== 'string') throw new Error(`${label} must be a canonical Blob URL`);
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${label} must be a canonical Blob URL`);
	}
	if (
		parsed.protocol !== 'blob:' ||
		value.includes('?') ||
		value.includes('#') ||
		parsed.href !== value
	) {
		throw new Error(`${label} must be a canonical Blob URL without a query or fragment`);
	}
	return value;
}

function snapshotRuntimeProfile(value: unknown): RustWorkerRuntimeProfile {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('wasm-rust runtime profile must match the bundled receipt profile');
	}
	const profile = value as Record<string, unknown>;
	if (
		!hasExactKeys(profile, [
			'manifestFingerprint',
			'manifestPath',
			'manifestReceipt',
			'moduleUrl',
			'profileId',
			'protocolVersion'
		]) ||
		profile.profileId !== WASM_RUST_RUNTIME_PROFILE.profileId ||
		profile.protocolVersion !== WASM_RUST_RUNTIME_PROFILE.protocolVersion ||
		profile.manifestPath !== WASM_RUST_RUNTIME_PROFILE.manifestPath ||
		profile.manifestFingerprint !== WASM_RUST_RUNTIME_PROFILE.manifestFingerprint ||
		!profile.manifestReceipt ||
		typeof profile.manifestReceipt !== 'object' ||
		Array.isArray(profile.manifestReceipt)
	) {
		throw new Error('wasm-rust runtime profile must match the bundled receipt profile');
	}
	const manifestReceipt = profile.manifestReceipt as Record<string, unknown>;
	if (
		!hasExactKeys(manifestReceipt, ['bytes', 'sha256']) ||
		manifestReceipt.bytes !== WASM_RUST_RUNTIME_PROFILE.manifestReceipt.bytes ||
		manifestReceipt.sha256 !== WASM_RUST_RUNTIME_PROFILE.manifestReceipt.sha256
	) {
		throw new Error('wasm-rust runtime profile receipt must match the bundled receipt profile');
	}
	if (typeof profile.moduleUrl !== 'string') {
		throw new Error('wasm-rust runtime profile module URL is invalid');
	}
	let moduleUrl: URL;
	try {
		moduleUrl = new URL(profile.moduleUrl);
	} catch {
		throw new Error('wasm-rust runtime profile module URL is invalid');
	}
	const expectedQuery = `?v=${WASM_RUST_RUNTIME_PROFILE.manifestFingerprint}&rustManifestBytes=${WASM_RUST_RUNTIME_PROFILE.manifestReceipt.bytes}&rustManifestSha256=${WASM_RUST_RUNTIME_PROFILE.manifestReceipt.sha256}`;
	if (
		(moduleUrl.protocol !== 'http:' && moduleUrl.protocol !== 'https:') ||
		moduleUrl.username ||
		moduleUrl.password ||
		profile.moduleUrl.includes('#') ||
		moduleUrl.href !== profile.moduleUrl ||
		/%(?:2e|2f|5c)/iu.test(moduleUrl.pathname) ||
		!moduleUrl.pathname.endsWith(`/${WASM_RUST_EXECUTABLE_GRAPH_PROFILE.entryPath}`) ||
		moduleUrl.search !== expectedQuery
	) {
		throw new Error('wasm-rust runtime profile module URL is invalid');
	}
	return Object.freeze({
		profileId: WASM_RUST_RUNTIME_PROFILE.profileId,
		protocolVersion: WASM_RUST_RUNTIME_PROFILE.protocolVersion,
		manifestPath: WASM_RUST_RUNTIME_PROFILE.manifestPath,
		manifestFingerprint: WASM_RUST_RUNTIME_PROFILE.manifestFingerprint,
		manifestReceipt: Object.freeze({
			bytes: WASM_RUST_RUNTIME_PROFILE.manifestReceipt.bytes,
			sha256: WASM_RUST_RUNTIME_PROFILE.manifestReceipt.sha256
		}),
		moduleUrl: moduleUrl.href
	});
}

function snapshotVerifiedModuleUrls(
	value: unknown,
	runtimeModuleUrl: string
): Readonly<Record<string, string>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('wasm-rust verified module URL map is invalid');
	}
	const sourceModuleUrl = new URL(runtimeModuleUrl);
	const sourceBaseUrl = new URL('./', sourceModuleUrl);
	sourceBaseUrl.search = sourceModuleUrl.search;
	const expectedNetworkUrls = Object.keys(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules)
		.sort(compareCodeUnits)
		.map((modulePath) => {
			const networkUrl = new URL(modulePath, sourceBaseUrl);
			networkUrl.search = sourceModuleUrl.search;
			return networkUrl.href;
		})
		.sort(compareCodeUnits);
	const entries = Object.entries(value as Record<string, unknown>);
	const actualNetworkUrls = entries.map(([networkUrl]) => networkUrl).sort(compareCodeUnits);
	if (JSON.stringify(actualNetworkUrls) !== JSON.stringify(expectedNetworkUrls)) {
		throw new Error('wasm-rust verified module URL map does not match the bundled graph');
	}
	const snapshot: Record<string, string> = {};
	const blobUrls = new Set<string>();
	for (const [networkUrl, candidateBlobUrl] of entries) {
		const blobUrl = requireCanonicalBlobUrl(candidateBlobUrl, 'wasm-rust verified module URL');
		if (blobUrls.has(blobUrl)) {
			throw new Error('wasm-rust verified module URLs must map one-to-one to Blob URLs');
		}
		blobUrls.add(blobUrl);
		snapshot[networkUrl] = blobUrl;
	}
	return Object.freeze(snapshot);
}

function snapshotCompilerBootstrap(
	url: string,
	profileValue: unknown,
	moduleUrlsValue: unknown,
	graphFingerprint: unknown
) {
	const verifiedCompilerUrl = requireCanonicalBlobUrl(url, 'wasm-rust compiler URL');
	if (graphFingerprint !== WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint) {
		throw new Error(
			'wasm-rust executable graph fingerprint does not match the bundled receipt profile'
		);
	}
	const profile = snapshotRuntimeProfile(profileValue);
	const moduleUrls = snapshotVerifiedModuleUrls(moduleUrlsValue, profile.moduleUrl);
	if (moduleUrls[profile.moduleUrl] !== verifiedCompilerUrl) {
		throw new Error('wasm-rust compiler URL must identify the bundled graph entry');
	}
	return Object.freeze({
		compilerUrl: verifiedCompilerUrl,
		profile,
		moduleUrls,
		graphFingerprint: WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint
	});
}

async function loadCompiler(
	url: string,
	profile: RustWorkerRuntimeProfile | null = runtimeProfile,
	moduleUrls: Record<string, string> | null = verifiedModuleUrls,
	graphFingerprint = executableGraphFingerprint
) {
	if (!url) {
		throw new Error(
			'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
		);
	}
	const bootstrap = snapshotCompilerBootstrap(url, profile, moduleUrls, graphFingerprint);
	if (
		loadedCompilerUrl === bootstrap.compilerUrl &&
		loadedExecutableGraphFingerprint === bootstrap.graphFingerprint &&
		compilerPromise
	) {
		return await compilerPromise;
	}
	compilerUrl = bootstrap.compilerUrl;
	runtimeProfile = bootstrap.profile;
	verifiedModuleUrls = bootstrap.moduleUrls;
	executableGraphFingerprint = bootstrap.graphFingerprint;
	loadedCompilerUrl = bootstrap.compilerUrl;
	loadedExecutableGraphFingerprint = bootstrap.graphFingerprint;
	const runtimeModuleUrl = new URL(bootstrap.profile.moduleUrl);
	const resolvedRuntimeBaseUrl = new URL('./runtime/', runtimeModuleUrl);
	resolvedRuntimeBaseUrl.search = runtimeModuleUrl.search;
	runtimeBaseUrl = resolvedRuntimeBaseUrl.toString();
	compiledArtifact = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = await importRustCompilerModule(bootstrap.compilerUrl);
		if (typeof module.configureVerifiedRuntimeExecutableModuleUrls !== 'function') {
			throw new Error(
				'wasm-rust module must export configureVerifiedRuntimeExecutableModuleUrls'
			);
		}
		module.configureVerifiedRuntimeExecutableModuleUrls(
			bootstrap.moduleUrls,
			bootstrap.graphFingerprint
		);
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
			compiler: await factory({
				dependencies: { runtimeProfile: bootstrap.profile }
			}),
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
		runtimeProfile: nextRuntimeProfile,
		verifiedModuleUrls: nextVerifiedModuleUrls,
		executableGraphFingerprint: nextExecutableGraphFingerprint,
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
		debugMode: requestedDebugMode,
		breakpoints = [],
		pauseOnEntry = false,
		limits: executionLimits
	} = event.data;
	let ownsExecution = false;
	try {
		if (load) {
			if (acceptedCompilerBootstrap) {
				throw new Error('wasm-rust application worker accepts exactly one bootstrap');
			}
			acceptedCompilerBootstrap = true;
			compilerUrl = nextCompilerUrl;
			debugModuleUrl = nextDebugModuleUrl;
			runtimeProfile = nextRuntimeProfile || null;
			verifiedModuleUrls = nextVerifiedModuleUrls || null;
			executableGraphFingerprint = nextExecutableGraphFingerprint || '';
			if (log) {
				console.log(`[wasm-idle:rust-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(
				compilerUrl,
				runtimeProfile,
				verifiedModuleUrls,
				executableGraphFingerprint
			);
			postMessage({ load: true });
			return;
		}
		if (!acceptedCompilerBootstrap) {
			throw new Error('wasm-rust application worker must be bootstrapped before execution');
		}
		if (activeExecution) {
			throw new Error('wasm-rust application worker already has an active execution');
		}
		activeExecution = true;
		ownsExecution = true;

		const debugMode: RustWorkerDebugMode =
			requestedDebugMode === undefined ? (debug ? 'trace' : 'none') : requestedDebugMode;
		if (debugMode !== 'none' && debugMode !== 'trace' && debugMode !== 'lldb') {
			throw new Error(`Unsupported Rust debug mode: ${String(debugMode)}`);
		}
		stdinBufferRust = new Int32Array(buffer);
		debugBufferRust = debugBuffer ? new Int32Array(debugBuffer) : null;
		if (
			debugMode === 'trace' &&
			(!debugBufferRust || !isSharedBufferBackedView(debugBufferRust))
		) {
			postMessage({ error: 'Rust debugging requires SharedArrayBuffer.' });
			return;
		}
		const runtime = await loadCompiler(compilerUrl);
		let debugInstrumenter: RustDebugInstrumenter | null = null;
		if (debugMode === 'trace') {
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
		const compileCacheKey = `${executableGraphFingerprint}\n${debugMode}\n${targetTriple}\n${compileCode}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile start prepare=${String(prepare)} target=${targetTriple} bytes=${compileCode.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code: compileCode,
				debugMode,
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

		if (debugMode === 'lldb') {
			if (
				compiledArtifact.targetTriple !== 'wasm32-wasip1' ||
				compiledArtifact.format !== 'core-wasm'
			) {
				throw new Error('wasm-rust LLDB artifact must be wasm32-wasip1 core-wasm');
			}
			const descriptor = compiledArtifact.debug;
			if (
				!descriptor ||
				typeof descriptor !== 'object' ||
				descriptor.kind !== 'dwarf' ||
				descriptor.sourceRoot !== '/workspace'
			) {
				throw new Error('wasm-rust did not return an LLDB DWARF descriptor');
			}
			if (
				typeof descriptor.moduleSha256 !== 'string' ||
				!lowercaseSha256Pattern.test(descriptor.moduleSha256)
			) {
				throw new Error('wasm-rust LLDB descriptor has an invalid module SHA-256');
			}
			if (
				!Array.isArray(descriptor.files) ||
				descriptor.files.length !== 1 ||
				!descriptor.files[0] ||
				typeof descriptor.files[0] !== 'object' ||
				descriptor.files[0].path !== '/workspace/main.rs'
			) {
				throw new Error(
					'wasm-rust LLDB descriptor must contain exactly one /workspace/main.rs source'
				);
			}
			const sourceDescriptor = descriptor.files[0];
			if (
				typeof sourceDescriptor.contentSha256 !== 'string' ||
				!lowercaseSha256Pattern.test(sourceDescriptor.contentSha256)
			) {
				throw new Error(
					'wasm-rust LLDB descriptor has an invalid /workspace/main.rs SHA-256'
				);
			}
			const compiler = descriptor.compiler;
			if (
				!compiler ||
				typeof compiler !== 'object' ||
				compiler.name !== 'rustc' ||
				[
					'version',
					'revision',
					'llvmVersion',
					'llvmRevision',
					'runtimeVersion',
					'hostTriple'
				].some(
					(field) =>
						typeof compiler[field] !== 'string' || compiler[field].trim().length === 0
				)
			) {
				throw new Error(
					'wasm-rust LLDB descriptor requires complete rustc compiler provenance'
				);
			}
			const artifactBytes =
				compiledArtifact.wasm instanceof Uint8Array
					? compiledArtifact.wasm
					: new Uint8Array(compiledArtifact.wasm);
			postMessage({
				lldbArtifact: {
					bytes: new Uint8Array(artifactBytes),
					descriptor,
					sources: [
						{
							path: '/workspace/main.rs',
							content: code,
							contentSha256: sourceDescriptor.contentSha256
						}
					]
				}
			});
			return;
		}

		postMessage({ runtimePhase: 'run' });
		if (log) {
			console.log(
				`[wasm-idle:rust-worker] runtime start target=${compiledArtifact.targetTriple} format=${compiledArtifact.format}`
			);
		}
		const rustDebugHost =
			debugMode === 'trace' && debugBufferRust && debugInstrumenter
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
		const errorMessage = String(error?.message || error);
		const maxErrorBytes =
			Number.isSafeInteger(executionLimits?.maxOutputBytes) &&
			executionLimits.maxOutputBytes > 0
				? executionLimits.maxOutputBytes
				: 1024 * 1024;
		postMessage({
			error:
				new TextEncoder().encode(errorMessage).byteLength <= maxErrorBytes
					? errorMessage
					: `Rust worker error exceeded ${maxErrorBytes} bytes`
		});
	} finally {
		if (ownsExecution) activeExecution = false;
	}
};
