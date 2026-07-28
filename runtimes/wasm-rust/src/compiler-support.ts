import type {
	BrowserRustDebugMode,
	BrowserRustCompileRequest,
	BrowserRustCompilerResult,
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
