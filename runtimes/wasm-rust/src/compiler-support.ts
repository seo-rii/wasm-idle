import type {
	BrowserRustDebugMode,
	BrowserRustCompileRequest,
	BrowserRustCompilerResult,
	BrowserRustWorkerLimits,
	CompilerDiagnostic,
	CompilerLogRecord,
	SupportedTargetTriple
} from './types.js';

const SUPPORTED_EDITIONS = new Set(['2021', '2024']);
const SUPPORTED_CRATE_TYPES = new Set(['bin']);
const SUPPORTED_DEBUG_MODES = new Set<BrowserRustDebugMode>(['none', 'trace', 'lldb']);
const SUPPORTED_TARGET_TRIPLES = new Set<SupportedTargetTriple>([
	'wasm32-wasip1',
	'wasm32-wasip2',
	'wasm32-wasip3'
]);

export const BROWSER_RUST_COMPILER_WORKER_REQUIREMENTS = Object.freeze({
	maxWorkers: 1
});

export const BROWSER_RUST_THREAD_POOL_CAPACITY = 4;

export function resolveBrowserRustWorkerLimits(
	value: BrowserRustWorkerLimits | undefined
): Readonly<BrowserRustWorkerLimits> | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('wasm-rust worker limits must be an object');
	}
	if (
		JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['maxThreads', 'maxWorkers'])
	) {
		throw new Error('wasm-rust worker limits require exactly maxWorkers and maxThreads');
	}
	for (const [name, limit] of Object.entries(value)) {
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			throw new Error(`wasm-rust worker limit ${name} must be a positive safe integer`);
		}
	}
	if (value.maxWorkers < BROWSER_RUST_COMPILER_WORKER_REQUIREMENTS.maxWorkers) {
		throw new Error(
			`wasm-rust compilation requires at least ${BROWSER_RUST_COMPILER_WORKER_REQUIREMENTS.maxWorkers} compiler worker`
		);
	}
	return Object.freeze({
		maxWorkers: value.maxWorkers,
		maxThreads: value.maxThreads
	});
}

export function resolveBrowserRustThreadPoolSize(
	workerLimits: Readonly<BrowserRustWorkerLimits> | undefined
) {
	return workerLimits
		? Math.min(BROWSER_RUST_THREAD_POOL_CAPACITY, workerLimits.maxThreads)
		: BROWSER_RUST_THREAD_POOL_CAPACITY;
}

export function resolveBrowserRustDebugMode(
	request: Pick<BrowserRustCompileRequest, 'debugMode'>
): BrowserRustDebugMode {
	const debugMode = request.debugMode ?? 'none';
	if (!SUPPORTED_DEBUG_MODES.has(debugMode)) {
		throw new Error(`unsupported browser compiler debug mode: ${String(debugMode)}`);
	}
	return debugMode;
}

export function createBrowserRustCompileRequestIdentity(
	request: BrowserRustCompileRequest
): string {
	return JSON.stringify({
		version: 1,
		sourcePath: '/workspace/main.rs',
		code: request.code,
		debugMode: resolveBrowserRustDebugMode(request),
		edition: request.edition || '2024',
		crateType: request.crateType || 'bin',
		targetTriple: request.targetTriple || 'wasm32-wasip1'
	});
}

export function describeWorkerErrorEvent(
	event: Pick<ErrorEvent, 'message' | 'filename' | 'lineno' | 'colno' | 'error'>
) {
	const location = event.filename
		? `${event.filename}${event.lineno ? `:${event.lineno}` : ''}${event.colno ? `:${event.colno}` : ''}`
		: '';
	const errorMessage =
		event.error instanceof Error
			? event.error.message || event.error.name
			: typeof event.error === 'string'
				? event.error
				: '';
	const primaryMessage = errorMessage || event.message || '';
	if (primaryMessage && location) {
		return `${primaryMessage} (${location})`;
	}
	if (primaryMessage) {
		return primaryMessage;
	}
	if (location) {
		return `worker script error at ${location}`;
	}
	return 'worker script error';
}

export function makeFailure(
	stderr: string,
	diagnostics?: CompilerDiagnostic[],
	stdout?: string,
	logs?: string[]
): BrowserRustCompilerResult {
	return {
		success: false,
		stderr,
		...(stdout !== undefined ? { stdout } : {}),
		...(diagnostics ? { diagnostics } : {}),
		...(logs && logs.length > 0 ? { logs } : {})
	};
}

export function attachCompileLogs(
	result: BrowserRustCompilerResult,
	logs: string[],
	logRecords: CompilerLogRecord[]
): BrowserRustCompilerResult {
	if (logs.length === 0 && logRecords.length === 0) {
		return result;
	}
	return {
		...result,
		...(logs.length > 0 ? { logs } : {}),
		...(logRecords.length > 0 ? { logRecords } : {})
	};
}

export function validateCompileRequest(request: BrowserRustCompileRequest) {
	if (!request.code || request.code.trim().length === 0) {
		return 'wasm-rust requires a non-empty Rust source file';
	}
	if (request.channel !== undefined) {
		return 'browser compiler channel selection is not supported yet; omit channel';
	}
	if (request.mode !== undefined) {
		return 'browser compiler mode selection is not supported yet; omit mode';
	}
	if (request.edition && !SUPPORTED_EDITIONS.has(request.edition)) {
		return `unsupported browser compiler edition: ${request.edition}`;
	}
	if (request.crateType && !SUPPORTED_CRATE_TYPES.has(request.crateType)) {
		return `unsupported browser compiler crate type: ${request.crateType}`;
	}
	if (request.targetTriple && !SUPPORTED_TARGET_TRIPLES.has(request.targetTriple)) {
		return `unsupported browser compiler target: ${request.targetTriple}`;
	}
	try {
		resolveBrowserRustWorkerLimits(request.workerLimits);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	let debugMode: BrowserRustDebugMode;
	try {
		debugMode = resolveBrowserRustDebugMode(request);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	const targetTriple = request.targetTriple || 'wasm32-wasip1';
	if (debugMode === 'lldb' && targetTriple !== 'wasm32-wasip1') {
		return `browser compiler LLDB debugging currently supports only wasm32-wasip1, not ${targetTriple}`;
	}
	return null;
}
