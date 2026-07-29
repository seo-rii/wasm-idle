export const RUNTIME_ERROR_CODES = [
	'unsupported-language',
	'busy',
	'runtime-configuration',
	'asset-not-found',
	'asset-integrity',
	'asset-too-large',
	'worker-startup',
	'compile',
	'runtime',
	'timeout',
	'cancelled',
	'resource-limit',
	'output-limit',
	'diagnostic-limit',
	'protocol',
	'unsupported-browser-feature'
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export const RUNTIME_PHASES = [
	'configuration',
	'asset',
	'startup',
	'compile',
	'execute',
	'protocol',
	'dispose'
] as const;

export type RuntimePhase = (typeof RUNTIME_PHASES)[number];

export interface RuntimeErrorContext {
	phase?: RuntimePhase;
	runtimeId?: string;
	profileId?: string;
	cause?: unknown;
	recoverable?: boolean;
}

export interface WasmIdleErrorOptions extends RuntimeErrorContext {
	code: RuntimeErrorCode;
}

export class WasmIdleError extends Error {
	readonly code: RuntimeErrorCode;
	readonly phase?: RuntimePhase;
	readonly runtimeId?: string;
	readonly profileId?: string;
	readonly recoverable: boolean;

	constructor(message: string, options: WasmIdleErrorOptions) {
		super(message, { cause: options.cause });
		this.name = 'WasmIdleError';
		this.code = options.code;
		this.phase = options.phase;
		this.runtimeId = options.runtimeId;
		this.profileId = options.profileId;
		this.recoverable = options.recoverable ?? false;
	}
}

export class UnsupportedLanguageError extends WasmIdleError {
	readonly languageId: string;

	constructor(languageId: string, options: RuntimeErrorContext = {}) {
		super(`Unsupported language: ${languageId}`, {
			...options,
			code: 'unsupported-language',
			phase: options.phase ?? 'configuration',
			recoverable: options.recoverable ?? false
		});
		this.name = 'UnsupportedLanguageError';
		this.languageId = languageId;
	}
}

export class BusyError extends WasmIdleError {
	constructor(
		message = 'A runtime operation is already active',
		options: RuntimeErrorContext = {}
	) {
		super(message, {
			...options,
			code: 'busy',
			phase: options.phase ?? 'execute',
			recoverable: options.recoverable ?? true
		});
		this.name = 'BusyError';
	}
}

export class RuntimeConfigurationError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'runtime-configuration',
			phase: options.phase ?? 'configuration',
			recoverable: options.recoverable ?? false
		});
		this.name = 'RuntimeConfigurationError';
	}
}

export class AssetNotFoundError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'asset-not-found',
			phase: options.phase ?? 'asset',
			recoverable: options.recoverable ?? true
		});
		this.name = 'AssetNotFoundError';
	}
}

export class AssetIntegrityError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'asset-integrity',
			phase: options.phase ?? 'asset',
			recoverable: options.recoverable ?? false
		});
		this.name = 'AssetIntegrityError';
	}
}

export interface AssetTooLargeErrorOptions extends RuntimeErrorContext {
	limit?: number;
	actual?: number;
}

export class AssetTooLargeError extends WasmIdleError {
	readonly limit?: number;
	readonly actual?: number;

	constructor(message: string, options: AssetTooLargeErrorOptions = {}) {
		super(message, {
			...options,
			code: 'asset-too-large',
			phase: options.phase ?? 'asset',
			recoverable: options.recoverable ?? false
		});
		this.name = 'AssetTooLargeError';
		this.limit = options.limit;
		this.actual = options.actual;
	}
}

export class WorkerStartupError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'worker-startup',
			phase: options.phase ?? 'startup',
			recoverable: options.recoverable ?? true
		});
		this.name = 'WorkerStartupError';
	}
}

export class CompileError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'compile',
			phase: options.phase ?? 'compile',
			recoverable: options.recoverable ?? true
		});
		this.name = 'CompileError';
	}
}

export class RuntimeExecutionError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'runtime',
			phase: options.phase ?? 'execute',
			recoverable: options.recoverable ?? true
		});
		this.name = 'RuntimeExecutionError';
	}
}

export interface TimeoutErrorOptions extends RuntimeErrorContext {
	phase: RuntimePhase;
	timeoutMs: number;
}

export class TimeoutError extends WasmIdleError {
	readonly timeoutMs: number;

	constructor(message: string, options: TimeoutErrorOptions) {
		super(message, {
			...options,
			code: 'timeout',
			recoverable: options.recoverable ?? true
		});
		this.name = 'TimeoutError';
		this.timeoutMs = options.timeoutMs;
	}
}

export class CancelledError extends WasmIdleError {
	constructor(message = 'Runtime operation cancelled', options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'cancelled',
			phase: options.phase ?? 'execute',
			recoverable: options.recoverable ?? true
		});
		this.name = 'CancelledError';
	}
}

export interface RuntimeMessageLimitErrorOptions extends RuntimeErrorContext {
	limit: number;
	actual: number;
}

export type RuntimeResourceKind = 'wasm-memory' | 'nested-workers' | 'threads';

export interface ResourceLimitErrorOptions extends RuntimeErrorContext {
	resource: RuntimeResourceKind;
	limit: number;
	actual: number;
}

export class ResourceLimitError extends WasmIdleError {
	readonly resource: RuntimeResourceKind;
	readonly limit: number;
	readonly actual: number;

	constructor(message: string, options: ResourceLimitErrorOptions) {
		super(message, {
			...options,
			code: 'resource-limit',
			phase: options.phase ?? 'execute',
			recoverable: options.recoverable ?? true
		});
		this.name = 'ResourceLimitError';
		this.resource = options.resource;
		this.limit = options.limit;
		this.actual = options.actual;
	}
}

export class OutputLimitError extends WasmIdleError {
	readonly limit: number;
	readonly actual: number;

	constructor(message: string, options: RuntimeMessageLimitErrorOptions) {
		super(message, {
			...options,
			code: 'output-limit',
			phase: options.phase ?? 'execute',
			recoverable: options.recoverable ?? true
		});
		this.name = 'OutputLimitError';
		this.limit = options.limit;
		this.actual = options.actual;
	}
}

export class DiagnosticLimitError extends WasmIdleError {
	readonly limit: number;
	readonly actual: number;

	constructor(message: string, options: RuntimeMessageLimitErrorOptions) {
		super(message, {
			...options,
			code: 'diagnostic-limit',
			phase: options.phase ?? 'compile',
			recoverable: options.recoverable ?? true
		});
		this.name = 'DiagnosticLimitError';
		this.limit = options.limit;
		this.actual = options.actual;
	}
}

export class ProtocolError extends WasmIdleError {
	constructor(message: string, options: RuntimeErrorContext = {}) {
		super(message, {
			...options,
			code: 'protocol',
			phase: options.phase ?? 'protocol',
			recoverable: options.recoverable ?? false
		});
		this.name = 'ProtocolError';
	}
}

export class UnsupportedBrowserFeatureError extends WasmIdleError {
	readonly feature: string;

	constructor(feature: string, options: RuntimeErrorContext = {}) {
		super(`Unsupported browser feature: ${feature}`, {
			...options,
			code: 'unsupported-browser-feature',
			phase: options.phase ?? 'configuration',
			recoverable: options.recoverable ?? false
		});
		this.name = 'UnsupportedBrowserFeatureError';
		this.feature = feature;
	}
}

export function isWasmIdleError(value: unknown): value is WasmIdleError {
	return value instanceof WasmIdleError;
}
