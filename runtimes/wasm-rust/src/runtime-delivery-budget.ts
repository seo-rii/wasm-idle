import type {
	RuntimeAssetDeliveryBudgetDescriptor,
	RuntimeAssetDeliveryBudgetSnapshot
} from './types.js';

export type {
	RuntimeAssetDeliveryBudgetDescriptor,
	RuntimeAssetDeliveryBudgetSnapshot
} from './types.js';

const RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION = 1;
const RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC = 0x5741534d49444c45n;
const RUNTIME_ASSET_DELIVERY_BUDGET_STATE_BYTES = 40;
const RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC_INDEX = 0;
const RUNTIME_ASSET_DELIVERY_BUDGET_MAX_INDEX = 1;
const RUNTIME_ASSET_DELIVERY_BUDGET_EXPECTED_INDEX = 2;
const RUNTIME_ASSET_DELIVERY_BUDGET_DELIVERED_INDEX = 3;
const RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX = 4;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SIGNED_64_BIT_INTEGER = (1n << 63n) - 1n;
const sharedArrayBufferByteLengthGetter =
	typeof SharedArrayBuffer === 'function'
		? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get
		: undefined;

let activeRuntimeAssetDeliveryBudget: RuntimeAssetDeliveryBudgetDescriptor | undefined;
let activeRuntimeAssetDeliveryBudgetDepth = 0;

function invalidRuntimeAssetDeliveryBudget(): Error {
	return new Error('wasm-rust runtime delivery budget is invalid');
}

function assertSafeNonNegativeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`wasm-rust runtime delivery budget has invalid ${label}`);
	}
}

function readRuntimeAssetDeliveryBudgetState(descriptor: RuntimeAssetDeliveryBudgetDescriptor) {
	const state = new BigInt64Array(descriptor.state);
	if (
		Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC_INDEX) !==
			RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC ||
		Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_MAX_INDEX) !== BigInt(descriptor.maxBytes)
	) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	return state;
}

function safeStateNumber(value: bigint): number {
	if (value < 0n || value > MAX_SAFE_BIGINT) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	return Number(value);
}

function deliveredStateNumber(value: bigint): number {
	if (value < 0n || value > MAX_SIGNED_64_BIT_INTEGER) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	return Number(value);
}

function sharedArrayBufferByteLength(value: unknown): number | undefined {
	if (!sharedArrayBufferByteLengthGetter) return undefined;
	try {
		return sharedArrayBufferByteLengthGetter.call(value) as number;
	} catch {
		return undefined;
	}
}

export function createRuntimeAssetDeliveryBudget(
	maxBytes: number
): RuntimeAssetDeliveryBudgetDescriptor {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error('wasm-rust runtime delivery budget has invalid maxBytes');
	}
	if (typeof SharedArrayBuffer !== 'function') {
		throw new Error('wasm-rust runtime delivery budget requires SharedArrayBuffer');
	}
	const buffer = new SharedArrayBuffer(RUNTIME_ASSET_DELIVERY_BUDGET_STATE_BYTES);
	const state = new BigInt64Array(buffer);
	Atomics.store(
		state,
		RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC_INDEX,
		RUNTIME_ASSET_DELIVERY_BUDGET_MAGIC
	);
	Atomics.store(state, RUNTIME_ASSET_DELIVERY_BUDGET_MAX_INDEX, BigInt(maxBytes));
	return Object.freeze({
		schemaVersion: RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
		maxBytes,
		state: buffer
	});
}

export function snapshotRuntimeAssetDeliveryBudget(
	value: unknown
): RuntimeAssetDeliveryBudgetDescriptor {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== 3 || ownKeys.some((key) => typeof key !== 'string')) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	const keys = (ownKeys as string[]).sort();
	if (
		keys[0] !== 'maxBytes' ||
		keys[1] !== 'schemaVersion' ||
		keys[2] !== 'state' ||
		keys.some((key) => {
			const property = Object.getOwnPropertyDescriptor(value, key);
			return !property || !property.enumerable || !('value' in property);
		})
	) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	const candidate = value as Partial<RuntimeAssetDeliveryBudgetDescriptor>;
	const schemaVersion = candidate.schemaVersion;
	const maxBytes = candidate.maxBytes;
	const sharedState = candidate.state;
	if (
		schemaVersion !== RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION ||
		!Number.isSafeInteger(maxBytes) ||
		maxBytes! <= 0 ||
		sharedArrayBufferByteLength(sharedState) !== RUNTIME_ASSET_DELIVERY_BUDGET_STATE_BYTES
	) {
		throw invalidRuntimeAssetDeliveryBudget();
	}
	const descriptor = Object.freeze({
		schemaVersion: RUNTIME_ASSET_DELIVERY_BUDGET_SCHEMA_VERSION,
		maxBytes: maxBytes!,
		state: sharedState as SharedArrayBuffer
	});
	const state = readRuntimeAssetDeliveryBudgetState(descriptor);
	safeStateNumber(Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_EXPECTED_INDEX));
	deliveredStateNumber(Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_DELIVERED_INDEX));
	safeStateNumber(Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX));
	return descriptor;
}

export function readRuntimeAssetDeliveryBudget(
	value: RuntimeAssetDeliveryBudgetDescriptor
): RuntimeAssetDeliveryBudgetSnapshot {
	const descriptor = snapshotRuntimeAssetDeliveryBudget(value);
	const state = readRuntimeAssetDeliveryBudgetState(descriptor);
	let sequenceBefore: bigint;
	let expected: bigint;
	let delivered: bigint;
	let sequenceAfter: bigint;
	do {
		sequenceBefore = Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX);
		expected = Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_EXPECTED_INDEX);
		delivered = Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_DELIVERED_INDEX);
		sequenceAfter = Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX);
	} while (sequenceBefore !== sequenceAfter);
	const expectedBytes = safeStateNumber(expected);
	const deliveredBytes = deliveredStateNumber(delivered);
	const sequence = safeStateNumber(sequenceAfter);
	return Object.freeze({
		maxBytes: descriptor.maxBytes,
		expectedBytes,
		deliveredBytes,
		remainingBytes: Math.max(descriptor.maxBytes - deliveredBytes, 0),
		sequence
	});
}

export function declareRuntimeAssetDeliveryExpectedBytes(
	value: RuntimeAssetDeliveryBudgetDescriptor,
	expectedBytes: number
): RuntimeAssetDeliveryBudgetSnapshot {
	assertSafeNonNegativeInteger(expectedBytes, 'expectedBytes');
	const descriptor = snapshotRuntimeAssetDeliveryBudget(value);
	const state = readRuntimeAssetDeliveryBudgetState(descriptor);
	const expected = BigInt(expectedBytes);
	const previous = Atomics.compareExchange(
		state,
		RUNTIME_ASSET_DELIVERY_BUDGET_EXPECTED_INDEX,
		0n,
		expected
	);
	if (previous !== 0n && previous !== expected) {
		throw new Error('wasm-rust runtime delivery budget expected bytes are already declared');
	}
	if (previous === 0n && expected !== 0n) {
		Atomics.add(state, RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX, 1n);
	}
	if (expectedBytes > descriptor.maxBytes) {
		throw new Error(
			`wasm-rust runtime delivery budget expected bytes exceed the ${descriptor.maxBytes} byte limit`
		);
	}
	return readRuntimeAssetDeliveryBudget(descriptor);
}

export function consumeRuntimeAssetDeliveryBytes(
	value: RuntimeAssetDeliveryBudgetDescriptor,
	deltaBytes: number
): RuntimeAssetDeliveryBudgetSnapshot {
	assertSafeNonNegativeInteger(deltaBytes, 'delivery byte count');
	const descriptor = snapshotRuntimeAssetDeliveryBudget(value);
	const state = readRuntimeAssetDeliveryBudgetState(descriptor);
	const delta = BigInt(deltaBytes);
	let delivered = Atomics.load(state, RUNTIME_ASSET_DELIVERY_BUDGET_DELIVERED_INDEX);
	let next: bigint;
	while (true) {
		if (delivered < 0n || delivered > MAX_SIGNED_64_BIT_INTEGER) {
			throw invalidRuntimeAssetDeliveryBudget();
		}
		next = delivered + delta;
		if (next > MAX_SIGNED_64_BIT_INTEGER) {
			throw new Error(
				'wasm-rust runtime delivery byte count exceeds the shared counter range'
			);
		}
		const observed = Atomics.compareExchange(
			state,
			RUNTIME_ASSET_DELIVERY_BUDGET_DELIVERED_INDEX,
			delivered,
			next
		);
		if (observed === delivered) break;
		delivered = observed;
	}
	if (delta !== 0n) {
		Atomics.add(state, RUNTIME_ASSET_DELIVERY_BUDGET_SEQUENCE_INDEX, 1n);
	}
	if (next! > BigInt(descriptor.maxBytes)) {
		throw new Error(
			`wasm-rust runtime delivery exceeds the ${descriptor.maxBytes} byte aggregate limit`
		);
	}
	return readRuntimeAssetDeliveryBudget(descriptor);
}

export function assertRuntimeAssetDeliveryBudgetAvailable(
	value: RuntimeAssetDeliveryBudgetDescriptor
): RuntimeAssetDeliveryBudgetSnapshot {
	const snapshot = readRuntimeAssetDeliveryBudget(value);
	if (snapshot.expectedBytes > snapshot.maxBytes) {
		throw new Error(
			`wasm-rust runtime delivery budget expected bytes exceed the ${snapshot.maxBytes} byte limit`
		);
	}
	if (snapshot.deliveredBytes >= snapshot.maxBytes) {
		throw new Error(
			`wasm-rust runtime delivery budget is exhausted at ${snapshot.maxBytes} bytes`
		);
	}
	return snapshot;
}

export function resolveRuntimeAssetDeliveryBudget(
	value?: RuntimeAssetDeliveryBudgetDescriptor
): RuntimeAssetDeliveryBudgetDescriptor | undefined {
	return value === undefined
		? activeRuntimeAssetDeliveryBudget
		: snapshotRuntimeAssetDeliveryBudget(value);
}

export async function withRuntimeAssetDeliveryBudget<T>(
	value: RuntimeAssetDeliveryBudgetDescriptor | undefined,
	operation: () => T | Promise<T>
): Promise<T> {
	if (value === undefined) return await operation();
	const descriptor = snapshotRuntimeAssetDeliveryBudget(value);
	if (
		activeRuntimeAssetDeliveryBudget &&
		activeRuntimeAssetDeliveryBudget.state !== descriptor.state
	) {
		throw new Error('wasm-rust runtime delivery budget scopes must not overlap');
	}
	if (!activeRuntimeAssetDeliveryBudget) {
		activeRuntimeAssetDeliveryBudget = descriptor;
	}
	activeRuntimeAssetDeliveryBudgetDepth += 1;
	try {
		return await operation();
	} finally {
		activeRuntimeAssetDeliveryBudgetDepth -= 1;
		if (activeRuntimeAssetDeliveryBudgetDepth === 0) {
			activeRuntimeAssetDeliveryBudget = undefined;
		}
	}
}
