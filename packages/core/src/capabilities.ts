import { RuntimeConfigurationError } from './errors.js';

export const RUNTIME_TRUST_PROFILE_SCHEMA_VERSION = 1 as const;

export type RuntimeNetworkMode = 'none' | 'allowlist' | 'unrestricted';
export type RuntimeStorageMode = 'none' | 'ephemeral' | 'persistent';
export type RuntimeEnvironmentMode = 'none' | 'allowlist';
export type RuntimeDynamicCodeMode = 'none' | 'wasm-only' | 'javascript-and-wasm';

export interface RuntimeNetworkPolicy {
	readonly mode: RuntimeNetworkMode;
	readonly allowedOrigins: readonly string[];
}

export interface RuntimeStoragePolicy {
	readonly mode: RuntimeStorageMode;
}

export interface RuntimeEnvironmentPolicy {
	readonly mode: RuntimeEnvironmentMode;
	readonly allowedNames: readonly string[];
}

export interface RuntimeThreadPolicy {
	readonly maxThreads: number;
}

export interface RuntimeWorkerPolicy {
	readonly maxNestedWorkers: number;
}

export interface RuntimeTrustProfile {
	readonly schemaVersion: typeof RUNTIME_TRUST_PROFILE_SCHEMA_VERSION;
	readonly profileId: string;
	readonly network: RuntimeNetworkPolicy;
	readonly storage: RuntimeStoragePolicy;
	readonly environment: RuntimeEnvironmentPolicy;
	readonly threads: RuntimeThreadPolicy;
	readonly workers: RuntimeWorkerPolicy;
	readonly sharedArrayBuffer: boolean;
	readonly dynamicCode: RuntimeDynamicCodeMode;
	readonly sameOriginAccess: boolean;
}

export interface RuntimeTrustRequest {
	readonly environment?: Readonly<Record<string, string>>;
	readonly networkUrls?: readonly string[];
	readonly pageOrigin?: string;
	readonly storage?: RuntimeStorageMode;
	readonly threads?: number;
	readonly nestedWorkers?: number;
	readonly sharedArrayBuffer?: boolean;
	readonly dynamicCode?: RuntimeDynamicCodeMode;
	readonly sameOriginAccess?: boolean;
}

export interface RuntimeTrustGrant {
	readonly profile: RuntimeTrustProfile;
	readonly environment: Readonly<Record<string, string>>;
	readonly networkUrls: readonly string[];
	readonly pageOrigin?: string;
	readonly storage: RuntimeStorageMode;
	readonly threads: number;
	readonly nestedWorkers: number;
	readonly sharedArrayBuffer: boolean;
	readonly dynamicCode: RuntimeDynamicCodeMode;
	readonly sameOriginAccess: boolean;
}

export function defineRuntimeTrustProfile(profile: RuntimeTrustProfile): RuntimeTrustProfile {
	if (profile.schemaVersion !== RUNTIME_TRUST_PROFILE_SCHEMA_VERSION) {
		throw new TypeError(
			`Unsupported runtime trust profile schema: ${String(profile.schemaVersion)}`
		);
	}
	if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(profile.profileId)) {
		throw new TypeError('Runtime trust profile ID must be a non-empty stable identifier');
	}
	if (!['none', 'allowlist', 'unrestricted'].includes(profile.network.mode)) {
		throw new TypeError(`Unsupported runtime network mode: ${String(profile.network.mode)}`);
	}
	const allowedOrigins = profile.network.allowedOrigins.map((origin) => {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new TypeError(`Runtime network allowlist contains an invalid origin: ${origin}`);
		}
		if (
			(url.protocol !== 'https:' && url.protocol !== 'http:') ||
			url.pathname !== '/' ||
			url.search ||
			url.hash ||
			url.username ||
			url.password
		) {
			throw new TypeError(`Runtime network allowlist requires HTTP(S) origins: ${origin}`);
		}
		return url.origin;
	});
	const uniqueOrigins = [...new Set(allowedOrigins)].sort();
	if (profile.network.mode === 'allowlist' && uniqueOrigins.length === 0) {
		throw new TypeError('Runtime network allowlist mode requires at least one origin');
	}
	if (profile.network.mode !== 'allowlist' && uniqueOrigins.length > 0) {
		throw new TypeError(
			`Runtime network mode ${profile.network.mode} cannot declare allowed origins`
		);
	}
	if (!['none', 'ephemeral', 'persistent'].includes(profile.storage.mode)) {
		throw new TypeError(`Unsupported runtime storage mode: ${String(profile.storage.mode)}`);
	}
	if (!['none', 'allowlist'].includes(profile.environment.mode)) {
		throw new TypeError(
			`Unsupported runtime environment mode: ${String(profile.environment.mode)}`
		);
	}
	for (const name of profile.environment.allowedNames) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
			throw new TypeError(`Runtime environment allowlist contains an invalid name: ${name}`);
		}
	}
	const allowedNames = [...new Set(profile.environment.allowedNames)].sort();
	if (profile.environment.mode === 'allowlist' && allowedNames.length === 0) {
		throw new TypeError('Runtime environment allowlist mode requires at least one name');
	}
	if (profile.environment.mode === 'none' && allowedNames.length > 0) {
		throw new TypeError('Runtime environment mode none cannot declare allowed names');
	}
	if (!Number.isSafeInteger(profile.threads.maxThreads) || profile.threads.maxThreads < 0) {
		throw new TypeError('Runtime maxThreads must be a non-negative safe integer');
	}
	if (
		!Number.isSafeInteger(profile.workers.maxNestedWorkers) ||
		profile.workers.maxNestedWorkers < 0
	) {
		throw new TypeError('Runtime maxNestedWorkers must be a non-negative safe integer');
	}
	if (typeof profile.sharedArrayBuffer !== 'boolean') {
		throw new TypeError('Runtime sharedArrayBuffer capability must be boolean');
	}
	if (!profile.sharedArrayBuffer && profile.threads.maxThreads > 0) {
		throw new TypeError('Runtime threads require SharedArrayBuffer capability');
	}
	if (!['none', 'wasm-only', 'javascript-and-wasm'].includes(profile.dynamicCode)) {
		throw new TypeError(
			`Unsupported runtime dynamic-code mode: ${String(profile.dynamicCode)}`
		);
	}
	if (typeof profile.sameOriginAccess !== 'boolean') {
		throw new TypeError('Runtime sameOriginAccess capability must be boolean');
	}

	return Object.freeze({
		schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
		profileId: profile.profileId,
		network: Object.freeze({
			mode: profile.network.mode,
			allowedOrigins: Object.freeze(uniqueOrigins)
		}),
		storage: Object.freeze({ mode: profile.storage.mode }),
		environment: Object.freeze({
			mode: profile.environment.mode,
			allowedNames: Object.freeze(allowedNames)
		}),
		threads: Object.freeze({ maxThreads: profile.threads.maxThreads }),
		workers: Object.freeze({ maxNestedWorkers: profile.workers.maxNestedWorkers }),
		sharedArrayBuffer: profile.sharedArrayBuffer,
		dynamicCode: profile.dynamicCode,
		sameOriginAccess: profile.sameOriginAccess
	});
}

function normalizeRuntimeNetworkUrl(
	profile: RuntimeTrustProfile,
	value: string | URL,
	pageOrigin?: string,
	baseUrl?: string
) {
	let url: URL;
	try {
		url = new URL(String(value), baseUrl);
	} catch {
		throw new RuntimeConfigurationError(`Runtime network URL is invalid: ${String(value)}`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new RuntimeConfigurationError(
			`Runtime network URL uses an unsupported scheme: ${url.protocol}`
		);
	}
	if (url.username || url.password) {
		throw new RuntimeConfigurationError(
			`Runtime network URL cannot contain credentials: ${url.origin}`
		);
	}
	if (profile.network.mode === 'none') {
		throw new RuntimeConfigurationError(
			`Runtime trust profile ${profile.profileId} does not allow network access`
		);
	}
	if (
		profile.network.mode === 'allowlist' &&
		!profile.network.allowedOrigins.includes(url.origin)
	) {
		throw new RuntimeConfigurationError(
			`Runtime network origin ${url.origin} is not allowed by ${profile.profileId}`
		);
	}
	if (!profile.sameOriginAccess) {
		if (!pageOrigin) {
			throw new RuntimeConfigurationError(
				'Runtime page origin is required to enforce same-origin isolation'
			);
		}
		if (url.origin === pageOrigin) {
			throw new RuntimeConfigurationError(
				`Runtime trust profile ${profile.profileId} does not allow same-origin access`
			);
		}
	}
	return url.href;
}

export function enforceRuntimeTrustProfile(
	profile: RuntimeTrustProfile,
	request: RuntimeTrustRequest = {}
): RuntimeTrustGrant {
	const normalizedProfile = defineRuntimeTrustProfile(profile);
	if (
		request.environment !== undefined &&
		(!request.environment ||
			typeof request.environment !== 'object' ||
			Array.isArray(request.environment))
	) {
		throw new RuntimeConfigurationError('Runtime environment must be a string record');
	}
	const environmentEntries = Object.entries(request.environment ?? {}).sort(([left], [right]) =>
		left.localeCompare(right)
	);
	if (normalizedProfile.environment.mode === 'none' && environmentEntries.length > 0) {
		throw new RuntimeConfigurationError(
			`Runtime trust profile ${normalizedProfile.profileId} does not allow environment variables`
		);
	}
	for (const [name, value] of environmentEntries) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
			throw new RuntimeConfigurationError(`Runtime environment name is invalid: ${name}`);
		}
		if (typeof value !== 'string' || value.includes('\0')) {
			throw new RuntimeConfigurationError(`Runtime environment value is invalid: ${name}`);
		}
		if (
			normalizedProfile.environment.mode === 'allowlist' &&
			!normalizedProfile.environment.allowedNames.includes(name)
		) {
			throw new RuntimeConfigurationError(
				`Runtime environment variable ${name} is not allowed by ${normalizedProfile.profileId}`
			);
		}
	}

	let pageOrigin: string | undefined;
	if (request.pageOrigin !== undefined) {
		let pageUrl: URL;
		try {
			pageUrl = new URL(request.pageOrigin);
		} catch {
			throw new RuntimeConfigurationError(
				`Runtime page origin is invalid: ${request.pageOrigin}`
			);
		}
		if (
			(pageUrl.protocol !== 'https:' && pageUrl.protocol !== 'http:') ||
			pageUrl.pathname !== '/' ||
			pageUrl.search ||
			pageUrl.hash ||
			pageUrl.username ||
			pageUrl.password
		) {
			throw new RuntimeConfigurationError(
				`Runtime page origin must be an HTTP(S) origin: ${request.pageOrigin}`
			);
		}
		pageOrigin = pageUrl.origin;
	}
	const normalizedNetworkUrls = (request.networkUrls ?? []).map((value) =>
		normalizeRuntimeNetworkUrl(normalizedProfile, value, pageOrigin)
	);

	const storage = request.storage ?? 'none';
	if (!['none', 'ephemeral', 'persistent'].includes(storage)) {
		throw new RuntimeConfigurationError(
			`Runtime storage request is invalid: ${String(storage)}`
		);
	}
	const storageRanks: Record<RuntimeStorageMode, number> = {
		none: 0,
		ephemeral: 1,
		persistent: 2
	};
	if (storageRanks[storage] > storageRanks[normalizedProfile.storage.mode]) {
		throw new RuntimeConfigurationError(
			`Runtime storage ${storage} exceeds trust profile ${normalizedProfile.profileId}`
		);
	}
	const threads = request.threads ?? 0;
	if (!Number.isSafeInteger(threads) || threads < 0) {
		throw new RuntimeConfigurationError(
			'Runtime thread request must be a non-negative integer'
		);
	}
	if (threads > normalizedProfile.threads.maxThreads) {
		throw new RuntimeConfigurationError(
			`Runtime requested ${threads} threads; trust profile limit is ${normalizedProfile.threads.maxThreads}`
		);
	}
	const nestedWorkers = request.nestedWorkers ?? 0;
	if (!Number.isSafeInteger(nestedWorkers) || nestedWorkers < 0) {
		throw new RuntimeConfigurationError(
			'Runtime nested-worker request must be a non-negative integer'
		);
	}
	if (nestedWorkers > normalizedProfile.workers.maxNestedWorkers) {
		throw new RuntimeConfigurationError(
			`Runtime requested ${nestedWorkers} nested workers; trust profile limit is ${normalizedProfile.workers.maxNestedWorkers}`
		);
	}
	const sharedArrayBuffer = request.sharedArrayBuffer ?? false;
	if (typeof sharedArrayBuffer !== 'boolean') {
		throw new RuntimeConfigurationError('Runtime SharedArrayBuffer request must be boolean');
	}
	if (sharedArrayBuffer && !normalizedProfile.sharedArrayBuffer) {
		throw new RuntimeConfigurationError(
			`Runtime trust profile ${normalizedProfile.profileId} does not allow SharedArrayBuffer`
		);
	}
	if (threads > 0 && !sharedArrayBuffer) {
		throw new RuntimeConfigurationError(
			'Runtime thread requests require SharedArrayBuffer access'
		);
	}
	const dynamicCode = request.dynamicCode ?? 'none';
	if (!['none', 'wasm-only', 'javascript-and-wasm'].includes(dynamicCode)) {
		throw new RuntimeConfigurationError(
			`Runtime dynamic-code request is invalid: ${String(dynamicCode)}`
		);
	}
	const dynamicCodeRanks: Record<RuntimeDynamicCodeMode, number> = {
		none: 0,
		'wasm-only': 1,
		'javascript-and-wasm': 2
	};
	if (dynamicCodeRanks[dynamicCode] > dynamicCodeRanks[normalizedProfile.dynamicCode]) {
		throw new RuntimeConfigurationError(
			`Runtime dynamic-code request ${dynamicCode} exceeds trust profile ${normalizedProfile.profileId}`
		);
	}
	const sameOriginAccess = request.sameOriginAccess ?? false;
	if (typeof sameOriginAccess !== 'boolean') {
		throw new RuntimeConfigurationError('Runtime same-origin request must be boolean');
	}
	if (sameOriginAccess && !normalizedProfile.sameOriginAccess) {
		throw new RuntimeConfigurationError(
			`Runtime trust profile ${normalizedProfile.profileId} does not allow same-origin access`
		);
	}

	return Object.freeze({
		profile: normalizedProfile,
		environment: Object.freeze(Object.fromEntries(environmentEntries)),
		networkUrls: Object.freeze([...new Set(normalizedNetworkUrls)].sort()),
		pageOrigin,
		storage,
		threads,
		nestedWorkers,
		sharedArrayBuffer,
		dynamicCode,
		sameOriginAccess
	});
}

export function authorizeRuntimeNetworkRequest(
	grant: RuntimeTrustGrant,
	value: string | URL,
	baseUrl?: string
): string {
	if (!grant || typeof grant !== 'object') {
		throw new RuntimeConfigurationError('Runtime trust grant must be an object');
	}
	const normalizedGrant = enforceRuntimeTrustProfile(grant.profile, {
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
	const authorizedUrl = normalizeRuntimeNetworkUrl(
		normalizedGrant.profile,
		value,
		normalizedGrant.pageOrigin,
		baseUrl ?? normalizedGrant.pageOrigin
	);
	if (!normalizedGrant.networkUrls.includes(authorizedUrl)) {
		throw new RuntimeConfigurationError(
			`Runtime network URL is not included in the execution grant: ${authorizedUrl}`
		);
	}
	return authorizedUrl;
}

export const DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE = defineRuntimeTrustProfile({
	schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	profileId: 'restricted-browser-worker-v1',
	network: { mode: 'none', allowedOrigins: [] },
	storage: { mode: 'ephemeral' },
	environment: { mode: 'none', allowedNames: [] },
	threads: { maxThreads: 0 },
	workers: { maxNestedWorkers: 0 },
	sharedArrayBuffer: false,
	dynamicCode: 'wasm-only',
	sameOriginAccess: false
});
