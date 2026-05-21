import Runtime from './runtime.js';
import {
	loadRuntimeManifest,
	resolveRuntimeManifestUrl
} from './runtime-manifest.js';
import type {
	BrowserClangArtifact,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangCompiler,
	BrowserClangCompilerResult,
	BrowserClangRuntimeOptions,
	CompilerDiagnostic,
	CompilerLogLevel,
	CompilerLogRecord,
	RuntimeManifestV1
} from './types.js';

export type {
	BrowserClangArtifact,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangCompiler,
	BrowserClangCompilerResult,
	CompilerLogLevel,
	CompilerLogRecord
} from './types.js';

export interface CreateClangCompilerOptions {
	runtimeBaseUrl?: string | URL;
	showTiming?: boolean;
	log?: boolean;
	manifest?: RuntimeManifestV1;
	fetchImpl?: typeof fetch;
}

export interface PreloadBrowserClangRuntimeOptions {
	runtimeBaseUrl?: string | URL;
	manifest?: RuntimeManifestV1;
	fetchImpl?: typeof fetch;
}

function toStandaloneBytes(value: Uint8Array | ArrayBuffer) {
	return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

function pushRecord(
	records: CompilerLogRecord[],
	enabled: boolean,
	message: string,
	level: CompilerLogLevel = 'log'
) {
	if (!enabled) return;
	records.push({ level, message });
}

function emitProgress(
	request: BrowserClangCompileRequest,
	stage: BrowserClangCompileProgress['stage'],
	percent: number,
	message: string
) {
	request.onProgress?.({
		stage,
		completed: Math.round(percent),
		total: 100,
		percent,
		message
	});
}

function extractCompilerDiagnostics(output: string): CompilerDiagnostic[] {
	const diagnostics: CompilerDiagnostic[] = [];
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(
			/^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/
		);
		if (!match) continue;
		diagnostics.push({
			fileName: match[1] || undefined,
			lineNumber: Number(match[2]),
			columnNumber: match[3] ? Number(match[3]) : undefined,
			severity:
				match[4] === 'warning'
					? 'warning'
					: match[4] === 'note'
						? 'other'
						: 'error',
			message: match[5]
		});
	}
	return diagnostics;
}

function createLogResult(records: CompilerLogRecord[], enabled: boolean) {
	return enabled
		? {
				logRecords: records,
				logs: records.map((record) => record.message)
			}
		: {};
}

async function resolveManifest(options: CreateClangCompilerOptions | PreloadBrowserClangRuntimeOptions) {
	if (options.manifest) {
		return options.manifest;
	}
	return loadRuntimeManifest(
		options.runtimeBaseUrl ? resolveRuntimeManifestUrl(options.runtimeBaseUrl) : undefined,
		options.fetchImpl || fetch
	);
}

export async function preloadBrowserClangRuntime(
	options: PreloadBrowserClangRuntimeOptions = {}
): Promise<void> {
	const manifest = await resolveManifest(options);
	const runtime = new Runtime({
		stdin: () => '',
		stdout: () => {},
		progress: () => {},
		log: false,
		runtimeBaseUrl: options.runtimeBaseUrl,
		manifest
	});
	await runtime.ready;
}

export async function compileClang(
	request: BrowserClangCompileRequest,
	options: CreateClangCompilerOptions = {}
): Promise<BrowserClangCompilerResult> {
	if (!request.code || typeof request.code !== 'string') {
		return {
			success: false,
			stderr: 'wasm-clang requires a non-empty source string'
		};
	}
	if (request.target && request.target !== 'wasm32-wasi') {
		return {
			success: false,
			stderr: `unsupported wasm-clang target: ${request.target}`
		};
	}

	const enabledLogs = request.log ?? options.log ?? false;
	const logRecords: CompilerLogRecord[] = [];
	const compilerOutput: string[] = [];
	emitProgress(request, 'bootstrap', 0, 'loading runtime manifest');
	const manifest = await resolveManifest(options);
	pushRecord(logRecords, enabledLogs, '[wasm-clang] runtime manifest loaded');

	let lastPercent = 0;
	const runtimeOptions: BrowserClangRuntimeOptions = {
		stdin: () => '',
		stdout: (chunk) => compilerOutput.push(chunk),
		progress: (value) => {
			const percent = Math.round(Math.max(lastPercent, value * 100));
			lastPercent = percent;
			const stage = percent < 34 ? 'bootstrap' : percent < 90 ? 'compile' : 'link';
			emitProgress(
				request,
				stage,
				percent,
				stage === 'link'
					? 'linking wasm module'
					: stage === 'compile'
						? 'compiling source'
						: 'loading runtime'
			);
		},
		log: enabledLogs,
		showTiming: request.showTiming ?? options.showTiming ?? false,
		runtimeBaseUrl: options.runtimeBaseUrl,
		manifest
	};

	const runtime = new Runtime(runtimeOptions);

	try {
		await runtime.ready;
		pushRecord(logRecords, enabledLogs, '[wasm-clang] runtime ready');
		const wasmModule = await runtime.compileLink(request.code, {
			language: request.language || 'CPP',
			fileName: request.fileName,
			compileArgs: request.compileArgs || [],
			debug: request.debug,
			breakpoints: request.breakpoints,
			pauseOnEntry: request.pauseOnEntry,
			cppVersion: request.cppVersion,
			cVersion: request.cVersion
		});
		const output = compilerOutput.join('');
		const diagnostics = extractCompilerDiagnostics(output);
		const artifactBytes = toStandaloneBytes(
			runtime.memfs.getFileContents(runtime.lastArtifactPath)
		);
		const artifact: BrowserClangArtifact = {
			bytes: artifactBytes,
			wasm: wasmModule,
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm',
			fileName: runtime.lastArtifactPath,
			language: request.language || 'CPP',
			...(request.debug
				? {
						debugMetadata: {
							variableMetadata: runtime.debugVariableMetadata,
							globalVariableMetadata: runtime.debugGlobalMetadata,
							functionMetadata: runtime.debugFunctionMetadata
						}
					}
				: {})
		};
		emitProgress(request, 'done', 100, 'done');
		return {
			success: true,
			artifact,
			stdout: output,
			...(diagnostics.length ? { diagnostics } : {}),
			...createLogResult(logRecords, enabledLogs)
		};
	} catch (error) {
		pushRecord(
			logRecords,
			enabledLogs,
			error instanceof Error ? error.message : String(error),
			'error'
		);
		const output = compilerOutput.join('');
		const diagnostics = extractCompilerDiagnostics(output);
		return {
			success: false,
			stdout: output,
			stderr: output || (error instanceof Error ? error.message : String(error)),
			...(diagnostics.length ? { diagnostics } : {}),
			...createLogResult(logRecords, enabledLogs)
		};
	}
}

export async function createClangCompiler(
	options: CreateClangCompilerOptions = {}
): Promise<BrowserClangCompiler> {
	return {
		compile: (request) => compileClang(request, options)
	};
}
