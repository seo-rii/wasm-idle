import { prepareKotlinSources, type KotlinSourceFile, type KotlinSourceLimits } from './sources.js';

export interface KotlinCompileRequest {
	readonly protocolVersion: 1;
	readonly requestId: string;
	readonly generation: number;
	readonly profileId: string;
	readonly files: readonly KotlinSourceFile[];
	readonly entry: { readonly file: string; readonly qualifiedFunction: string };
}

/** This candidate wire contract validates data; it does not supply a compiler. */
export function readKotlinCompileRequest(
	input: unknown,
	expectedProfileId: string,
	limits?: KotlinSourceLimits
): KotlinCompileRequest {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Invalid Kotlin compile request');
	}
	// Snapshot caller-owned accessors once so the returned fields are the same
	// values checked below, including identity and byte-limited diagnostics.
	const value = { ...(input as Record<string, unknown>) };
	if (
		value.protocolVersion !== 1 ||
		typeof value.requestId !== 'string' ||
		value.requestId.length === 0 ||
		value.requestId.length > 128 ||
		!Number.isSafeInteger(value.generation) ||
		(value.generation as number) < 0 ||
		typeof expectedProfileId !== 'string' ||
		expectedProfileId.length === 0 ||
		value.profileId !== expectedProfileId
	) {
		throw new Error('Kotlin request identity or protocol mismatch');
	}
	const keys = ['protocolVersion', 'requestId', 'generation', 'profileId', 'files', 'entry'];
	if (Object.keys(value).some((key) => !keys.includes(key))) {
		throw new Error('Kotlin compile options are not enabled in this candidate contract');
	}
	const files = prepareKotlinSources(value.files, limits);
	if (!value.entry || typeof value.entry !== 'object' || Array.isArray(value.entry)) {
		throw new Error('Kotlin entry must be selected explicitly');
	}
	const entry = { ...(value.entry as Record<string, unknown>) };
	if (
		typeof entry.file !== 'string' ||
		!files.some((file) => file.path === entry.file) ||
		typeof entry.qualifiedFunction !== 'string' ||
		entry.qualifiedFunction.length === 0 ||
		entry.qualifiedFunction.length > 1024 ||
		Object.keys(entry).some((key) => key !== 'file' && key !== 'qualifiedFunction')
	) {
		throw new Error('Kotlin entry must refer to an input file and named function');
	}
	return Object.freeze({
		protocolVersion: 1,
		requestId: value.requestId,
		generation: value.generation as number,
		profileId: expectedProfileId,
		files,
		entry: Object.freeze({ file: entry.file, qualifiedFunction: entry.qualifiedFunction })
	});
}

export interface KotlinCompileDiagnostic {
	readonly severity: 'error' | 'warning' | 'information';
	readonly code: string;
	readonly message: string;
	readonly path?: string;
	readonly startUtf16?: number;
	readonly endUtf16?: number;
}

export interface KotlinCompileFailure {
	readonly requestId: string;
	readonly generation: number;
	readonly status: 'compile-error' | 'internal-error';
	readonly diagnostics: readonly KotlinCompileDiagnostic[];
}

/** Validate failures without allowing a previous successful artifact to escape. */
export function readKotlinCompileFailure(
	input: unknown,
	request: KotlinCompileRequest,
	limits: { readonly maxDiagnostics: number; readonly maxDiagnosticBytes: number }
): KotlinCompileFailure {
	if (
		!Number.isSafeInteger(limits.maxDiagnostics) ||
		limits.maxDiagnostics <= 0 ||
		!Number.isSafeInteger(limits.maxDiagnosticBytes) ||
		limits.maxDiagnosticBytes <= 0
	) {
		throw new Error('Invalid Kotlin diagnostic limits');
	}
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Invalid Kotlin compile failure');
	}
	const value = { ...(input as Record<string, unknown>) };
	if (
		value.requestId !== request.requestId ||
		value.generation !== request.generation ||
		(value.status !== 'compile-error' && value.status !== 'internal-error') ||
		Object.keys(value).some(
			(key) => !['requestId', 'generation', 'status', 'diagnostics'].includes(key)
		) ||
		!Array.isArray(value.diagnostics) ||
		value.diagnostics.length > limits.maxDiagnostics
	) {
		throw new Error('Kotlin failure is stale, malformed, or contains an artifact');
	}
	const diagnostics: KotlinCompileDiagnostic[] = [];
	const inputDiagnostics = value.diagnostics;
	const diagnosticSnapshot = Array.from(
		{ length: inputDiagnostics.length },
		(_, index) => inputDiagnostics[index]
	);
	const encoder = new TextEncoder();
	let bytes = 0;
	for (const inputDiagnostic of diagnosticSnapshot) {
		if (
			!inputDiagnostic ||
			typeof inputDiagnostic !== 'object' ||
			Array.isArray(inputDiagnostic)
		) {
			throw new Error('Invalid Kotlin diagnostic');
		}
		const diagnostic = { ...(inputDiagnostic as Record<string, unknown>) };
		if (
			!['error', 'warning', 'information'].includes(diagnostic.severity as string) ||
			typeof diagnostic.code !== 'string' ||
			diagnostic.code.length === 0 ||
			typeof diagnostic.message !== 'string' ||
			Object.keys(diagnostic).some(
				(key) =>
					!['severity', 'code', 'message', 'path', 'startUtf16', 'endUtf16'].includes(key)
			)
		) {
			throw new Error('Invalid Kotlin diagnostic fields');
		}
		let source: KotlinSourceFile | undefined;
		if ('path' in diagnostic) {
			source = request.files.find((file) => file.path === diagnostic.path);
			if (!source) throw new Error('Kotlin diagnostic refers to an unknown source');
		}
		if ('startUtf16' in diagnostic || 'endUtf16' in diagnostic) {
			if (
				!source ||
				!Number.isSafeInteger(diagnostic.startUtf16) ||
				!Number.isSafeInteger(diagnostic.endUtf16) ||
				(diagnostic.startUtf16 as number) < 0 ||
				(diagnostic.endUtf16 as number) < (diagnostic.startUtf16 as number) ||
				(diagnostic.endUtf16 as number) > source.text.length
			) {
				throw new Error('Kotlin diagnostic range is outside its source');
			}
		}
		// UTF-8 needs at least as many bytes as UTF-16 code units. Reject huge
		// payloads before allocating their encoded copies, then count exact bytes.
		if (
			diagnostic.code.length + diagnostic.message.length + (source?.path.length ?? 0) >
			limits.maxDiagnosticBytes - bytes
		) {
			throw new Error('Kotlin diagnostic byte limit exceeded');
		}
		bytes +=
			encoder.encode(diagnostic.code).byteLength +
			encoder.encode(diagnostic.message).byteLength;
		if (source) bytes += encoder.encode(source.path).byteLength;
		if (bytes > limits.maxDiagnosticBytes)
			throw new Error('Kotlin diagnostic byte limit exceeded');
		diagnostics.push(Object.freeze({ ...diagnostic }) as unknown as KotlinCompileDiagnostic);
	}
	return Object.freeze({
		requestId: request.requestId,
		generation: request.generation,
		status: value.status,
		diagnostics: Object.freeze(diagnostics)
	});
}
