import type { ResolvedRubyRuntimeAssetConfig } from '$lib/playground/assets';
import {
	preflightRubyRuntimeAssets,
	requireRubyRuntimePreflightPayload,
	type ExecutionLimits,
	type RubyRuntimePreflightPayload,
	type RuntimeAssetPreflightProgress
} from '@wasm-idle/core';

export interface RubyRuntimePreflightOptions {
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export type RubyRuntimePreflightDeliveryState = 'available' | 'consumed' | 'retired';

export interface RubyRuntimeOwnedPreflightDelivery {
	readonly payload: RubyRuntimePreflightPayload;
	readonly state: RubyRuntimePreflightDeliveryState;
	consume(): readonly [ArrayBuffer, ArrayBuffer, ArrayBuffer];
	retire(): void;
}

function isPlainFrozenRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function requireOwnedWholeBuffer(value: Uint8Array, label: string): ArrayBuffer {
	if (
		value.byteLength <= 0 ||
		!(value.buffer instanceof ArrayBuffer) ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new TypeError(`Ruby runtime ${label} must exclusively own one nonempty whole buffer`);
	}
	return value.buffer;
}

/**
 * Adopts a freshly preflighted Ruby payload for exactly one Worker load dispatch.
 * The caller relinquishes every payload byte view after consume(), regardless of
 * whether postMessage succeeds; a consumed or retired delivery cannot be reused.
 */
export function createRubyRuntimeOwnedPreflightDelivery(
	value: unknown
): RubyRuntimeOwnedPreflightDelivery {
	if (!isPlainFrozenRecord(value)) {
		throw new TypeError('Ruby runtime preflight delivery requires one frozen plain payload');
	}
	const payload = requireRubyRuntimePreflightPayload(value);
	const transferables = [
		requireOwnedWholeBuffer(payload.manifestBytes, 'manifest bytes'),
		requireOwnedWholeBuffer(payload.moduleJavaScriptBytes, 'module JavaScript bytes'),
		requireOwnedWholeBuffer(payload.wasmBytes, 'Wasm bytes')
	] as const;
	if (new Set(transferables).size !== transferables.length) {
		throw new TypeError('Ruby runtime preflight byte buffers must have unique ownership');
	}
	let state: RubyRuntimePreflightDeliveryState = 'available';
	return Object.freeze({
		payload,
		get state() {
			return state;
		},
		consume() {
			if (state !== 'available') {
				throw new TypeError('Ruby runtime preflight delivery is no longer available');
			}
			state = 'consumed';
			return transferables;
		},
		retire() {
			if (state === 'available') state = 'retired';
		}
	});
}

export async function preflightVerifiedRubyRuntimeAssets(
	config: ResolvedRubyRuntimeAssetConfig,
	options: RubyRuntimePreflightOptions = {}
): Promise<RubyRuntimePreflightPayload> {
	return await preflightRubyRuntimeAssets({
		baseUrl: config.baseUrl,
		manifestUrl: config.manifestUrl,
		moduleUrl: config.moduleUrl,
		wasmUrl: config.wasmUrl,
		profile: config.preflightProfile,
		limits: options.limits,
		signal: options.signal,
		fetch: options.fetch,
		reportProgress: options.reportProgress,
		reportDecompressionProgress: options.reportDecompressionProgress
	});
}
