import {
	AssetTooLargeError,
	RuntimeConfigurationError,
	UnsupportedBrowserFeatureError
} from './errors.js';

export const RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION = 1 as const;

export interface RuntimeAssetDeliveryBudgetDescriptor {
	readonly schemaVersion: typeof RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION;
	readonly maxBytes: number;
	readonly state: SharedArrayBuffer;
}

export interface RuntimeAssetDeliveryBudgetContext {
	readonly runtimeId?: string;
	readonly profileId?: string;
}

export interface RuntimeAssetDeliveryBudgetSnapshot {
	readonly maxBytes: number;
	readonly expectedBytes: number;
	readonly deliveredBytes: number;
	readonly remainingBytes: number;
	/** Monotonic change counter for telemetry; it is not a transactional seqlock. */
	readonly sequence: number;
}

const RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC = 0x5741534d49444c45n;
const STATE_SLOT_MAGIC = 0;
const STATE_SLOT_MAX_BYTES = 1;
const STATE_SLOT_EXPECTED_BYTES = 2;
const STATE_SLOT_DELIVERED_BYTES = 3;
const STATE_SLOT_SEQUENCE = 4;
const STATE_SLOT_COUNT = 5;
const STATE_BYTE_LENGTH = STATE_SLOT_COUNT * BigInt64Array.BYTES_PER_ELEMENT;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SIGNED_64_BIT_INTEGER = (1n << 63n) - 1n;

const sharedArrayBufferByteLengthGetter =
	typeof SharedArrayBuffer === 'function'
		? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get
		: undefined;

function configurationError(message: string, context: RuntimeAssetDeliveryBudgetContext = {}) {
	return new RuntimeConfigurationError(message, { phase: 'asset', ...context });
}

function requirePositiveSafeInteger(
	value: unknown,
	label: string,
	context: RuntimeAssetDeliveryBudgetContext = {}
): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw configurationError(`${label} must be a positive safe integer`, context);
	}
	return value;
}

function requireNonNegativeSafeInteger(
	value: unknown,
	label: string,
	context: RuntimeAssetDeliveryBudgetContext = {}
): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw configurationError(`${label} must be a non-negative safe integer`, context);
	}
	return value;
}

function hasExactDescriptorKeys(value: Record<PropertyKey, unknown>) {
	const expected = ['maxBytes', 'schemaVersion', 'state'];
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== expected.length || ownKeys.some((key) => typeof key !== 'string')) {
		return false;
	}
	const actual = (ownKeys as string[]).sort();
	if (!actual.every((key, index) => key === expected[index])) return false;
	return actual.every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return !!descriptor && descriptor.enumerable && 'value' in descriptor;
	});
}

function sharedArrayBufferByteLength(value: unknown): number | undefined {
	if (!sharedArrayBufferByteLengthGetter) return undefined;
	try {
		return sharedArrayBufferByteLengthGetter.call(value) as number;
	} catch {
		return undefined;
	}
}

function requireValidStateValue(value: bigint, label: string) {
	if (value < 0n || value > MAX_SAFE_INTEGER_BIGINT) {
		throw configurationError(`Runtime asset delivery budget ${label} is invalid`);
	}
	return Number(value);
}

function requireValidDeliveredStateValue(value: bigint) {
	if (value < 0n || value > MAX_SIGNED_64_BIT_INTEGER) {
		throw configurationError('Runtime asset delivery budget delivered byte count is invalid');
	}
	return Number(value);
}

function snapshotDescriptorState(value: unknown): {
	descriptor: RuntimeAssetDeliveryBudgetDescriptor;
	state: BigInt64Array;
} {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw configurationError('Runtime asset delivery budget descriptor is required');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw configurationError('Runtime asset delivery budget descriptor must be a plain object');
	}
	const candidate = value as Record<PropertyKey, unknown>;
	if (!hasExactDescriptorKeys(candidate)) {
		throw configurationError('Runtime asset delivery budget descriptor has invalid keys');
	}
	if (candidate.schemaVersion !== RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION) {
		throw configurationError('Runtime asset delivery budget descriptor schema is unsupported');
	}
	const maxBytes = requirePositiveSafeInteger(
		candidate.maxBytes,
		'Runtime asset delivery budget maxBytes'
	);
	const sharedStateByteLength = sharedArrayBufferByteLength(candidate.state);
	if (sharedStateByteLength !== STATE_BYTE_LENGTH) {
		throw configurationError(
			`Runtime asset delivery budget state must be a ${STATE_BYTE_LENGTH}-byte SharedArrayBuffer`
		);
	}
	const sharedState = candidate.state as SharedArrayBuffer;
	const state = new BigInt64Array(sharedState);
	if (Atomics.load(state, STATE_SLOT_MAGIC) !== RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC) {
		throw configurationError('Runtime asset delivery budget state magic is invalid');
	}
	if (Atomics.load(state, STATE_SLOT_MAX_BYTES) !== BigInt(maxBytes)) {
		throw configurationError('Runtime asset delivery budget state maxBytes does not match');
	}
	requireValidStateValue(Atomics.load(state, STATE_SLOT_EXPECTED_BYTES), 'expected byte count');
	requireValidDeliveredStateValue(Atomics.load(state, STATE_SLOT_DELIVERED_BYTES));
	requireValidStateValue(Atomics.load(state, STATE_SLOT_SEQUENCE), 'sequence');
	return {
		descriptor: Object.freeze({
			schemaVersion: RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
			maxBytes,
			state: sharedState
		}),
		state
	};
}

function readSnapshot(
	descriptor: RuntimeAssetDeliveryBudgetDescriptor,
	state: BigInt64Array
): RuntimeAssetDeliveryBudgetSnapshot {
	const expectedBytes = requireValidStateValue(
		Atomics.load(state, STATE_SLOT_EXPECTED_BYTES),
		'expected byte count'
	);
	const deliveredBytes = requireValidDeliveredStateValue(
		Atomics.load(state, STATE_SLOT_DELIVERED_BYTES)
	);
	const sequence = requireValidStateValue(Atomics.load(state, STATE_SLOT_SEQUENCE), 'sequence');
	return Object.freeze({
		maxBytes: descriptor.maxBytes,
		expectedBytes,
		deliveredBytes,
		remainingBytes: Math.max(0, descriptor.maxBytes - deliveredBytes),
		sequence
	});
}

export function createRuntimeAssetDeliveryBudget(
	maxBytes: number
): RuntimeAssetDeliveryBudgetDescriptor {
	const normalizedMaxBytes = requirePositiveSafeInteger(
		maxBytes,
		'Runtime asset delivery budget maxBytes'
	);
	if (typeof SharedArrayBuffer !== 'function' || typeof Atomics !== 'object') {
		throw new UnsupportedBrowserFeatureError('SharedArrayBuffer-backed BigInt64 Atomics', {
			phase: 'asset'
		});
	}
	const sharedState = new SharedArrayBuffer(STATE_BYTE_LENGTH);
	const state = new BigInt64Array(sharedState);
	Atomics.store(state, STATE_SLOT_MAGIC, RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC);
	Atomics.store(state, STATE_SLOT_MAX_BYTES, BigInt(normalizedMaxBytes));
	return Object.freeze({
		schemaVersion: RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
		maxBytes: normalizedMaxBytes,
		state: sharedState
	});
}

export function snapshotRuntimeAssetDeliveryBudgetDescriptor(
	value: unknown
): RuntimeAssetDeliveryBudgetDescriptor {
	return snapshotDescriptorState(value).descriptor;
}

export function declareRuntimeAssetDeliveryExpectedBytes(
	descriptor: RuntimeAssetDeliveryBudgetDescriptor,
	expectedBytes: number,
	context: RuntimeAssetDeliveryBudgetContext = {}
): RuntimeAssetDeliveryBudgetSnapshot {
	const normalizedExpectedBytes = requireNonNegativeSafeInteger(
		expectedBytes,
		'Runtime asset delivery expected bytes',
		context
	);
	const snapshot = snapshotDescriptorState(descriptor);
	const expected = BigInt(normalizedExpectedBytes);
	while (true) {
		const current = Atomics.load(snapshot.state, STATE_SLOT_EXPECTED_BYTES);
		if (current === expected) break;
		if (current !== 0n) {
			throw configurationError(
				`Runtime asset delivery expected bytes are already declared as ${current}`,
				context
			);
		}
		if (
			Atomics.compareExchange(snapshot.state, STATE_SLOT_EXPECTED_BYTES, 0n, expected) === 0n
		) {
			if (expected !== 0n) Atomics.add(snapshot.state, STATE_SLOT_SEQUENCE, 1n);
			break;
		}
	}
	if (normalizedExpectedBytes > snapshot.descriptor.maxBytes) {
		throw new AssetTooLargeError(
			`Runtime asset delivery expectation exceeds the ${snapshot.descriptor.maxBytes} byte aggregate limit`,
			{
				limit: snapshot.descriptor.maxBytes,
				actual: normalizedExpectedBytes,
				phase: 'asset',
				...context
			}
		);
	}
	return readSnapshot(snapshot.descriptor, snapshot.state);
}

export function consumeRuntimeAssetDeliveryBytes(
	descriptor: RuntimeAssetDeliveryBudgetDescriptor,
	delta: number,
	context: RuntimeAssetDeliveryBudgetContext = {}
): RuntimeAssetDeliveryBudgetSnapshot {
	const normalizedDelta = requireNonNegativeSafeInteger(
		delta,
		'Runtime asset delivery byte delta',
		context
	);
	const snapshot = snapshotDescriptorState(descriptor);
	const increment = BigInt(normalizedDelta);
	let delivered: bigint;
	while (true) {
		const current = Atomics.load(snapshot.state, STATE_SLOT_DELIVERED_BYTES);
		if (current < 0n || current > MAX_SIGNED_64_BIT_INTEGER) {
			throw configurationError(
				'Runtime asset delivery byte count exceeds the shared counter range',
				context
			);
		}
		delivered = current + increment;
		if (delivered > MAX_SIGNED_64_BIT_INTEGER) {
			throw configurationError(
				'Runtime asset delivery byte count exceeds the shared counter range',
				context
			);
		}
		if (
			Atomics.compareExchange(
				snapshot.state,
				STATE_SLOT_DELIVERED_BYTES,
				current,
				delivered
			) === current
		) {
			if (increment !== 0n) Atomics.add(snapshot.state, STATE_SLOT_SEQUENCE, 1n);
			break;
		}
	}
	const deliveredBytes = Number(delivered);
	if (deliveredBytes > snapshot.descriptor.maxBytes) {
		throw new AssetTooLargeError(
			`Runtime asset delivery exceeds the ${snapshot.descriptor.maxBytes} byte aggregate limit`,
			{
				limit: snapshot.descriptor.maxBytes,
				actual: deliveredBytes,
				phase: 'asset',
				...context
			}
		);
	}
	return readSnapshot(snapshot.descriptor, snapshot.state);
}

export function readRuntimeAssetDeliveryBudget(
	descriptor: RuntimeAssetDeliveryBudgetDescriptor
): RuntimeAssetDeliveryBudgetSnapshot {
	const snapshot = snapshotDescriptorState(descriptor);
	return readSnapshot(snapshot.descriptor, snapshot.state);
}
