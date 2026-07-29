import { enforceRuntimeTrustProfile, type RuntimeTrustGrant } from './capabilities.js';
import { resolveExecutionLimits, type ExecutionLimits } from './execution.js';
import {
	ResourceLimitError,
	RuntimeConfigurationError,
	type RuntimeResourceKind
} from './errors.js';

export interface RuntimeResourceReservation {
	readonly wasmMemoryBytes?: number;
	readonly nestedWorkers?: number;
	readonly threads?: number;
}

export interface RuntimeResourceUsage {
	readonly wasmMemoryBytes: number;
	readonly nestedWorkers: number;
	readonly threads: number;
}

export interface RuntimeResourceBudgetSnapshot {
	readonly capacity: RuntimeResourceUsage;
	readonly used: RuntimeResourceUsage;
	readonly remaining: RuntimeResourceUsage;
	readonly disposed: boolean;
}

export interface RuntimeResourceLease {
	readonly reservation: RuntimeResourceUsage;
	readonly released: boolean;
	update(reservation: RuntimeResourceReservation): RuntimeResourceUsage;
	release(): void;
}

export interface RuntimeResourceBudgetOptions {
	readonly grant: RuntimeTrustGrant;
	readonly limits?: Partial<ExecutionLimits>;
	readonly runtimeId?: string;
}

interface RuntimeResourceLeaseState {
	reservation: RuntimeResourceUsage;
	released: boolean;
}

const ZERO_USAGE = Object.freeze({
	wasmMemoryBytes: 0,
	nestedWorkers: 0,
	threads: 0
}) satisfies RuntimeResourceUsage;

function freezeUsage(usage: RuntimeResourceUsage): RuntimeResourceUsage {
	return Object.freeze({ ...usage });
}

function normalizeReservation(reservation: RuntimeResourceReservation): RuntimeResourceUsage {
	if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) {
		throw new RuntimeConfigurationError('Runtime resource reservation must be an object');
	}
	const normalized = {
		wasmMemoryBytes: reservation.wasmMemoryBytes ?? 0,
		nestedWorkers: reservation.nestedWorkers ?? 0,
		threads: reservation.threads ?? 0
	};
	for (const [name, value] of Object.entries(normalized)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RuntimeConfigurationError(
				`Runtime resource reservation ${name} must be a non-negative safe integer`
			);
		}
	}
	if (Object.values(normalized).every((value) => value === 0)) {
		throw new RuntimeConfigurationError(
			'Runtime resource reservation must request at least one resource'
		);
	}
	return freezeUsage(normalized);
}

function normalizeGrant(grant: RuntimeTrustGrant): RuntimeTrustGrant {
	if (!grant || typeof grant !== 'object') {
		throw new RuntimeConfigurationError('Runtime trust grant must be an object');
	}
	return enforceRuntimeTrustProfile(grant.profile, {
		environment: grant.environment,
		networkUrls: grant.networkUrls,
		pageOrigin: grant.pageOrigin,
		storage: grant.storage,
		threads: grant.threads,
		nestedWorkers: grant.nestedWorkers,
		sharedArrayBuffer: grant.sharedArrayBuffer,
		dynamicCode: grant.dynamicCode,
		sameOriginAccess: grant.sameOriginAccess
	});
}

export class RuntimeResourceBudget {
	private readonly capacity: RuntimeResourceUsage;
	private readonly runtimeId?: string;
	private readonly profileId: string;
	private readonly leases = new Set<RuntimeResourceLeaseState>();
	private used: RuntimeResourceUsage = ZERO_USAGE;
	private disposed = false;

	constructor(options: RuntimeResourceBudgetOptions) {
		if (!options || typeof options !== 'object') {
			throw new RuntimeConfigurationError('Runtime resource budget options are required');
		}
		const grant = normalizeGrant(options.grant);
		const limits = resolveExecutionLimits(options.limits);
		this.capacity = freezeUsage({
			wasmMemoryBytes: limits.maxWasmMemoryBytes,
			nestedWorkers: Math.min(limits.maxWorkers, grant.nestedWorkers),
			threads: Math.min(limits.maxThreads, grant.threads)
		});
		this.runtimeId = options.runtimeId;
		this.profileId = grant.profile.profileId;
	}

	reserve(reservation: RuntimeResourceReservation): RuntimeResourceLease {
		this.assertOpen();
		const normalized = normalizeReservation(reservation);
		this.assertWithinCapacity(this.addUsage(this.used, normalized));
		const state: RuntimeResourceLeaseState = {
			reservation: normalized,
			released: false
		};
		this.used = freezeUsage(this.addUsage(this.used, normalized));
		this.leases.add(state);
		const update = (nextReservation: RuntimeResourceReservation) => {
			this.assertLeaseActive(state);
			const next = normalizeReservation(nextReservation);
			const candidate = this.addUsage(this.subtractUsage(this.used, state.reservation), next);
			this.assertWithinCapacity(candidate);
			this.used = freezeUsage(candidate);
			state.reservation = next;
			return next;
		};
		const release = () => {
			if (state.released) return;
			state.released = true;
			this.leases.delete(state);
			if (!this.disposed) {
				this.used = freezeUsage(this.subtractUsage(this.used, state.reservation));
			}
		};
		return Object.freeze({
			get reservation() {
				return state.reservation;
			},
			get released() {
				return state.released;
			},
			update,
			release
		});
	}

	snapshot(): RuntimeResourceBudgetSnapshot {
		return Object.freeze({
			capacity: this.capacity,
			used: this.used,
			remaining: freezeUsage(this.subtractUsage(this.capacity, this.used)),
			disposed: this.disposed
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const lease of this.leases) lease.released = true;
		this.leases.clear();
		this.used = ZERO_USAGE;
	}

	private assertOpen(): void {
		if (this.disposed) {
			throw new RuntimeConfigurationError('Runtime resource budget is disposed', {
				runtimeId: this.runtimeId,
				profileId: this.profileId,
				phase: 'dispose'
			});
		}
	}

	private assertLeaseActive(state: RuntimeResourceLeaseState): void {
		this.assertOpen();
		if (state.released || !this.leases.has(state)) {
			throw new RuntimeConfigurationError('Runtime resource lease is released', {
				runtimeId: this.runtimeId,
				profileId: this.profileId
			});
		}
	}

	private assertWithinCapacity(usage: RuntimeResourceUsage): void {
		const resources: readonly [keyof RuntimeResourceUsage, RuntimeResourceKind][] = [
			['wasmMemoryBytes', 'wasm-memory'],
			['nestedWorkers', 'nested-workers'],
			['threads', 'threads']
		];
		for (const [field, resource] of resources) {
			if (usage[field] <= this.capacity[field]) continue;
			throw new ResourceLimitError(
				`Runtime ${resource} usage exceeded its execution grant: limit ${this.capacity[field]}, requested ${usage[field]}`,
				{
					resource,
					limit: this.capacity[field],
					actual: usage[field],
					runtimeId: this.runtimeId,
					profileId: this.profileId
				}
			);
		}
	}

	private addUsage(
		left: RuntimeResourceUsage,
		right: RuntimeResourceUsage
	): RuntimeResourceUsage {
		return {
			wasmMemoryBytes: left.wasmMemoryBytes + right.wasmMemoryBytes,
			nestedWorkers: left.nestedWorkers + right.nestedWorkers,
			threads: left.threads + right.threads
		};
	}

	private subtractUsage(
		left: RuntimeResourceUsage,
		right: RuntimeResourceUsage
	): RuntimeResourceUsage {
		return {
			wasmMemoryBytes: left.wasmMemoryBytes - right.wasmMemoryBytes,
			nestedWorkers: left.nestedWorkers - right.nestedWorkers,
			threads: left.threads - right.threads
		};
	}
}
