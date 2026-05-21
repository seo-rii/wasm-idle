import type {
	BrowserRustCompileRequest,
	BrowserRustCompilerResult,
	CompilerDiagnostic,
	CompilerLogRecord,
	SupportedTargetTriple
} from './types.js';

const SUPPORTED_EDITIONS = new Set(['2021', '2024']);
const SUPPORTED_CRATE_TYPES = new Set(['bin']);
const SUPPORTED_TARGET_TRIPLES = new Set<SupportedTargetTriple>([
	'wasm32-wasip1',
	'wasm32-wasip2',
	'wasm32-wasip3'
]);

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
	return null;
}
