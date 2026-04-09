const SUPPORTED_EDITIONS = new Set(['2021', '2024']);
const SUPPORTED_CRATE_TYPES = new Set(['bin']);
const SUPPORTED_TARGET_TRIPLES = new Set([
    'wasm32-wasip1',
    'wasm32-wasip2',
    'wasm32-wasip3'
]);
export function describeWorkerErrorEvent(event) {
    const location = event.filename
        ? `${event.filename}${event.lineno ? `:${event.lineno}` : ''}${event.colno ? `:${event.colno}` : ''}`
        : '';
    const errorMessage = event.error instanceof Error
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
export function makeFailure(stderr, diagnostics, stdout, logs) {
    return {
        success: false,
        stderr,
        ...(stdout !== undefined ? { stdout } : {}),
        ...(diagnostics ? { diagnostics } : {}),
        ...(logs && logs.length > 0 ? { logs } : {})
    };
}
export function attachCompileLogs(result, logs, logRecords) {
    if (logs.length === 0 && logRecords.length === 0) {
        return result;
    }
    return {
        ...result,
        ...(logs.length > 0 ? { logs } : {}),
        ...(logRecords.length > 0 ? { logRecords } : {})
    };
}
export function validateCompileRequest(request) {
    if (!request.code || request.code.trim().length === 0) {
        return 'wasm-rust requires a non-empty Rust source file';
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
