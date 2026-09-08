import {
	AssetIntegrityError,
	AssetNotFoundError,
	AssetTooLargeError,
	BusyError,
	CancelledError,
	CompileError,
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	ResourceLimitError,
	RuntimeConfigurationError,
	RuntimeExecutionError,
	UnsupportedBrowserFeatureError,
	UnsupportedLanguageError,
	WasmIdleError,
	WorkerStartupError,
	TimeoutError,
	type ExecutionLimits,
	type RuntimeAssetPreflightProgress,
	type RuntimeErrorCode,
	type RuntimePhase,
	type RuntimeResourceKind
} from '@wasm-idle/core';

export const STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION = 1 as const;

export type StaticRuntimePreflightRuntimeId =
	| 'BQN'
	| 'CLOJURESCRIPT'
	| 'FORTH'
	| 'J'
	| 'JANET'
	| 'PROLOG';

export type StaticRuntimePreflightProgress =
	| {
			readonly kind: 'asset';
			readonly progress: RuntimeAssetPreflightProgress;
	  }
	| {
			readonly kind: 'decompression';
			readonly asset?: 'wasm' | 'data';
			readonly loadedBytes: number;
			readonly totalBytes: number;
	  };

export interface StaticRuntimePreflightRequestMessage {
	readonly protocolVersion: typeof STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION;
	readonly type: 'preflight';
	readonly requestId: number;
	readonly runtimeId: StaticRuntimePreflightRuntimeId;
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: unknown;
	readonly limits: ExecutionLimits;
}

export interface StaticRuntimePreflightProgressMessage {
	readonly protocolVersion: typeof STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION;
	readonly type: 'progress';
	readonly requestId: number;
	readonly progress: StaticRuntimePreflightProgress;
}

export interface StaticRuntimePreflightResultMessage {
	readonly protocolVersion: typeof STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION;
	readonly type: 'result';
	readonly requestId: number;
	readonly payload: unknown;
}

export interface StaticRuntimePreflightSerializedError {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly code?: RuntimeErrorCode;
	readonly phase?: RuntimePhase;
	readonly runtimeId?: string;
	readonly profileId?: string;
	readonly recoverable?: boolean;
	readonly actual?: number;
	readonly limit?: number;
	readonly timeoutMs?: number;
	readonly resource?: RuntimeResourceKind;
	readonly feature?: string;
	readonly languageId?: string;
}

export interface StaticRuntimePreflightErrorMessage {
	readonly protocolVersion: typeof STATIC_RUNTIME_PREFLIGHT_PROTOCOL_VERSION;
	readonly type: 'error';
	readonly requestId: number;
	readonly error: StaticRuntimePreflightSerializedError;
}

export type StaticRuntimePreflightResponseMessage =
	| StaticRuntimePreflightProgressMessage
	| StaticRuntimePreflightResultMessage
	| StaticRuntimePreflightErrorMessage;

function copyStringProperty(value: unknown, key: string) {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return typeof property === 'string' ? property : undefined;
	} catch {
		return undefined;
	}
}

function copyBooleanProperty(value: unknown, key: string) {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return typeof property === 'boolean' ? property : undefined;
	} catch {
		return undefined;
	}
}

function copySafeIntegerProperty(value: unknown, key: string) {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return Number.isSafeInteger(property) && (property as number) >= 0
			? (property as number)
			: undefined;
	} catch {
		return undefined;
	}
}

function safelyStringify(value: unknown) {
	try {
		return String(value);
	} catch {
		return 'Unknown static runtime preflight error';
	}
}

export function serializeStaticRuntimePreflightError(
	error: unknown
): StaticRuntimePreflightSerializedError {
	const name = copyStringProperty(error, 'name') || 'Error';
	const message =
		copyStringProperty(error, 'message') ||
		(typeof error === 'string' ? error : safelyStringify(error));
	const stack = copyStringProperty(error, 'stack');
	const code = copyStringProperty(error, 'code');
	const phase = copyStringProperty(error, 'phase');
	const runtimeId = copyStringProperty(error, 'runtimeId');
	const profileId = copyStringProperty(error, 'profileId');
	const recoverable = copyBooleanProperty(error, 'recoverable');
	const actual = copySafeIntegerProperty(error, 'actual');
	const limit = copySafeIntegerProperty(error, 'limit');
	const timeoutMs = copySafeIntegerProperty(error, 'timeoutMs');
	const resource = copyStringProperty(error, 'resource');
	const feature = copyStringProperty(error, 'feature');
	const languageId = copyStringProperty(error, 'languageId');
	return {
		name,
		message,
		...(stack ? { stack } : {}),
		...(isRuntimeErrorCode(code) ? { code } : {}),
		...(isRuntimePhase(phase) ? { phase } : {}),
		...(runtimeId ? { runtimeId } : {}),
		...(profileId ? { profileId } : {}),
		...(recoverable === undefined ? {} : { recoverable }),
		...(actual === undefined ? {} : { actual }),
		...(limit === undefined ? {} : { limit }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
		...(isRuntimeResourceKind(resource) ? { resource } : {}),
		...(feature ? { feature } : {}),
		...(languageId ? { languageId } : {})
	};
}

const runtimeErrorCodes = new Set<RuntimeErrorCode>([
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
]);

const runtimePhases = new Set<RuntimePhase>([
	'configuration',
	'asset',
	'startup',
	'compile',
	'execute',
	'protocol',
	'dispose'
]);

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	Symbol.toStringTag
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteLength'
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteOffset'
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	'byteLength'
)?.get;

function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
	return typeof value === 'string' && runtimeErrorCodes.has(value as RuntimeErrorCode);
}

function isRuntimePhase(value: unknown): value is RuntimePhase {
	return typeof value === 'string' && runtimePhases.has(value as RuntimePhase);
}

function isRuntimeResourceKind(value: unknown): value is RuntimeResourceKind {
	return value === 'wasm-memory' || value === 'nested-workers' || value === 'threads';
}

export function inspectStaticRuntimePreflightBytes(value: unknown) {
	if (
		!typedArrayTagGetter ||
		!typedArrayBufferGetter ||
		!typedArrayByteLengthGetter ||
		!typedArrayByteOffsetGetter ||
		!arrayBufferByteLengthGetter
	) {
		return undefined;
	}
	try {
		if (Reflect.apply(typedArrayTagGetter, value, []) !== 'Uint8Array') return undefined;
		const buffer = Reflect.apply(typedArrayBufferGetter, value, []) as ArrayBuffer;
		const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
		const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, value, []) as number;
		const bufferByteLength = Reflect.apply(arrayBufferByteLengthGetter, buffer, []) as number;
		return { buffer, bufferByteLength, byteLength, byteOffset };
	} catch {
		return undefined;
	}
}

export function isStaticRuntimePreflightSerializedError(
	value: unknown
): value is StaticRuntimePreflightSerializedError {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const error = value as Record<string, unknown>;
	return (
		typeof error.name === 'string' &&
		typeof error.message === 'string' &&
		(error.stack === undefined || typeof error.stack === 'string') &&
		(error.code === undefined || isRuntimeErrorCode(error.code)) &&
		(error.phase === undefined || isRuntimePhase(error.phase)) &&
		(error.runtimeId === undefined || typeof error.runtimeId === 'string') &&
		(error.profileId === undefined || typeof error.profileId === 'string') &&
		(error.recoverable === undefined || typeof error.recoverable === 'boolean') &&
		(error.actual === undefined ||
			(Number.isSafeInteger(error.actual) && (error.actual as number) >= 0)) &&
		(error.limit === undefined ||
			(Number.isSafeInteger(error.limit) && (error.limit as number) >= 0)) &&
		(error.timeoutMs === undefined ||
			(Number.isSafeInteger(error.timeoutMs) && (error.timeoutMs as number) >= 0)) &&
		(error.resource === undefined || isRuntimeResourceKind(error.resource)) &&
		(error.feature === undefined || typeof error.feature === 'string') &&
		(error.languageId === undefined || typeof error.languageId === 'string')
	);
}

export function deserializeStaticRuntimePreflightError(
	error: StaticRuntimePreflightSerializedError,
	fallbackRuntimeId: string
) {
	const phase = error.phase ?? 'asset';
	const context = {
		cause: error,
		phase,
		runtimeId: error.runtimeId || fallbackRuntimeId,
		...(error.profileId ? { profileId: error.profileId } : {}),
		...(error.recoverable === undefined ? {} : { recoverable: error.recoverable })
	};
	let deserialized: Error;
	switch (error.code) {
		case 'unsupported-language':
			deserialized = error.languageId
				? new UnsupportedLanguageError(error.languageId, context)
				: new WasmIdleError(error.message, { ...context, code: error.code });
			break;
		case 'busy':
			deserialized = new BusyError(error.message, context);
			break;
		case 'runtime-configuration':
			deserialized = new RuntimeConfigurationError(error.message, context);
			break;
		case 'asset-not-found':
			deserialized = new AssetNotFoundError(error.message, context);
			break;
		case 'asset-integrity':
			deserialized = new AssetIntegrityError(error.message, context);
			break;
		case 'asset-too-large':
			deserialized = new AssetTooLargeError(error.message, {
				...context,
				actual: error.actual,
				limit: error.limit
			});
			break;
		case 'worker-startup':
			deserialized = new WorkerStartupError(error.message, context);
			break;
		case 'compile':
			deserialized = new CompileError(error.message, context);
			break;
		case 'runtime':
			deserialized = new RuntimeExecutionError(error.message, context);
			break;
		case 'timeout':
			deserialized =
				error.timeoutMs === undefined
					? new WasmIdleError(error.message, { ...context, code: error.code })
					: new TimeoutError(error.message, {
							...context,
							timeoutMs: error.timeoutMs
						});
			break;
		case 'cancelled':
			deserialized = new CancelledError(error.message, context);
			break;
		case 'resource-limit':
			deserialized =
				error.actual === undefined ||
				error.limit === undefined ||
				error.resource === undefined
					? new WasmIdleError(error.message, { ...context, code: error.code })
					: new ResourceLimitError(error.message, {
							...context,
							actual: error.actual,
							limit: error.limit,
							resource: error.resource
						});
			break;
		case 'output-limit':
			deserialized =
				error.actual === undefined || error.limit === undefined
					? new WasmIdleError(error.message, { ...context, code: error.code })
					: new OutputLimitError(error.message, {
							...context,
							actual: error.actual,
							limit: error.limit
						});
			break;
		case 'diagnostic-limit':
			deserialized =
				error.actual === undefined || error.limit === undefined
					? new WasmIdleError(error.message, { ...context, code: error.code })
					: new DiagnosticLimitError(error.message, {
							...context,
							actual: error.actual,
							limit: error.limit
						});
			break;
		case 'protocol':
			deserialized = new ProtocolError(error.message, context);
			break;
		case 'unsupported-browser-feature':
			deserialized = error.feature
				? new UnsupportedBrowserFeatureError(error.feature, context)
				: new WasmIdleError(error.message, { ...context, code: error.code });
			break;
		default:
			deserialized = new WorkerStartupError(error.message, context);
	}
	if (deserialized.name === 'WasmIdleError' && error.name) deserialized.name = error.name;
	if (error.stack) deserialized.stack = error.stack;
	return deserialized;
}

export function collectStaticRuntimePreflightTransferables(payload: unknown) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new ProtocolError('Static runtime preflight payload must be a plain object', {
			phase: 'protocol'
		});
	}
	const prototype = Object.getPrototypeOf(payload);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new ProtocolError('Static runtime preflight payload must be a plain object', {
			phase: 'protocol'
		});
	}
	const transferables: ArrayBuffer[] = [];
	const seen = new Set<ArrayBuffer>();
	for (const key of Reflect.ownKeys(payload)) {
		if (typeof key !== 'string') {
			throw new ProtocolError('Static runtime preflight payload has a symbol key');
		}
		const descriptor = Object.getOwnPropertyDescriptor(payload, key);
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
			throw new ProtocolError(
				'Static runtime preflight payload properties must be enumerable data properties'
			);
		}
		const value = descriptor.value;
		const bytes = inspectStaticRuntimePreflightBytes(value);
		if (bytes) {
			if (
				bytes.byteLength <= 0 ||
				bytes.byteOffset !== 0 ||
				bytes.byteLength !== bytes.bufferByteLength ||
				seen.has(bytes.buffer)
			) {
				throw new ProtocolError(
					'Static runtime preflight bytes must own distinct non-empty whole ArrayBuffers'
				);
			}
			seen.add(bytes.buffer);
			transferables.push(bytes.buffer);
			continue;
		}
		if (
			value !== null &&
			(typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol')
		) {
			throw new ProtocolError(
				'Static runtime preflight payload accepts only primitive scalars and Uint8Arrays'
			);
		}
	}
	if (transferables.length === 0) {
		throw new ProtocolError('Static runtime preflight payload contains no transferable bytes');
	}
	return transferables;
}

export function isStaticRuntimePreflightProgress(
	value: unknown
): value is StaticRuntimePreflightProgress {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const progress = value as Record<string, unknown>;
	if (progress.kind === 'asset') {
		if (!progress.progress || typeof progress.progress !== 'object') return false;
		const asset = progress.progress as Record<string, unknown>;
		return (
			typeof asset.runtimeId === 'string' &&
			typeof asset.assetKey === 'string' &&
			Number.isSafeInteger(asset.loadedBytes) &&
			(asset.loadedBytes as number) >= 0 &&
			Number.isSafeInteger(asset.totalBytes) &&
			(asset.totalBytes as number) >= 0
		);
	}
	return (
		progress.kind === 'decompression' &&
		(progress.asset === undefined || progress.asset === 'wasm' || progress.asset === 'data') &&
		Number.isSafeInteger(progress.loadedBytes) &&
		(progress.loadedBytes as number) >= 0 &&
		Number.isSafeInteger(progress.totalBytes) &&
		(progress.totalBytes as number) > 0
	);
}
