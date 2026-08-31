import {
	RuntimeConfigurationError,
	resolveExecutionLimits,
	type ExecutionLimits
} from '@wasm-idle/core';

export const RUST_NON_DEBUG_RESOURCE_REQUIREMENTS = Object.freeze({
	maxWorkers: 1,
	maxThreads: 4
});

// The largest pinned logical target closure is currently 179,123,525 bytes (wasip3).
export const RUST_NON_DEBUG_MAX_ASSET_DELIVERY_BYTES = 192 * 1024 * 1024;

export interface RustNonDebugResourceLimits {
	readonly maxWorkers: number;
	readonly maxThreads: number;
	readonly maxAssetDeliveryBytes: number;
	readonly compilerLimits: Readonly<{
		maxWorkers: number;
		maxThreads: number;
	}>;
}

export function snapshotRustNonDebugResourceLimits(value: unknown): RustNonDebugResourceLimits {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RuntimeConfigurationError('Rust non-debug execution limits must be an object', {
			phase: 'compile',
			runtimeId: 'wasm-rust'
		});
	}
	const limits = value as Record<string, unknown>;
	for (const name of ['maxWorkers', 'maxThreads', 'maxAssetBytes'] as const) {
		if (!Number.isSafeInteger(limits[name]) || (limits[name] as number) <= 0) {
			throw new RuntimeConfigurationError(
				`Rust non-debug execution limit ${name} must be a positive safe integer`,
				{ phase: 'compile', runtimeId: 'wasm-rust' }
			);
		}
	}
	const maxWorkers = limits.maxWorkers as number;
	const maxThreads = limits.maxThreads as number;
	const maxAssetDeliveryBytes =
		Math.min(limits.maxAssetBytes as number, RUST_NON_DEBUG_MAX_ASSET_DELIVERY_BYTES / 2) * 2;
	const compilerLimits = Object.freeze({ maxWorkers, maxThreads });
	return Object.freeze({
		maxWorkers,
		maxThreads,
		maxAssetDeliveryBytes,
		compilerLimits
	});
}

export function resolveRustNonDebugResourceLimits(
	limits: Partial<ExecutionLimits> = {}
): RustNonDebugResourceLimits {
	return snapshotRustNonDebugResourceLimits(resolveExecutionLimits(limits));
}
