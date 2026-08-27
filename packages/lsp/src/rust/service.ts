import {
	positionAt,
	type LspDiagnostic,
	type LspDocumentContext,
	type WorkerLanguageService
} from '../lsp.js';
import type { RustLanguageServerRuntimeProfile } from '../types.js';
import {
	createRuntimeAssetDeliveryBudget,
	resolveExecutionLimits,
	type RuntimeAssetDeliveryBudgetDescriptor
} from '@wasm-idle/core';

export type RustLanguageServerTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';

export interface RustWorkerOptions {
	compilerUrl: string;
	expectedNetworkModuleUrls: readonly string[];
	verifiedModuleUrls: Readonly<Record<string, string>>;
	graphFingerprint: string;
	runtimeProfile: RustLanguageServerRuntimeProfile;
	maxAssetBytes: number;
	targetTriple?: RustLanguageServerTargetTriple;
	edition?: string;
}

interface RustCompilerDiagnostic {
	lineNumber?: number;
	columnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface RustCompilerResult {
	success: boolean;
	diagnostics?: RustCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface RustCompiler {
	compile: (request: {
		code: string;
		edition: string;
		crateType: 'bin';
		targetTriple: RustLanguageServerTargetTriple;
		extendedTimeout: boolean;
		log: boolean;
		assetDeliveryBudget: RuntimeAssetDeliveryBudgetDescriptor;
		onProgress?: (progress: {
			stage?: string;
			completed?: number;
			total?: number;
			delivery?: {
				deliveredBytes: number;
				expectedBytes: number;
				maxBytes: number;
				sequence: number;
			};
		}) => void;
	}) => Promise<RustCompilerResult>;
}

interface RustCompilerModule {
	createRustCompiler?: (options: {
		dependencies: { runtimeProfile: RustLanguageServerRuntimeProfile };
	}) => Promise<RustCompiler>;
	default?: RustCompilerModule['createRustCompiler'];
	configureVerifiedRuntimeExecutableModuleUrls?: (
		moduleUrls: Readonly<Record<string, string>>,
		graphFingerprint: string
	) => void;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_RUNTIME_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_EXECUTABLE_MODULES = 256;
// The largest pinned logical target closure is currently 179,123,525 bytes (wasip3).
const MAX_RUST_LSP_ASSET_DELIVERY_BYTES = 192 * 1024 * 1024;

function requireCanonicalBlobUrl(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new Error(`${label} must be a canonical Blob URL`);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} must be a canonical Blob URL`);
	}
	if (url.protocol !== 'blob:' || url.search || url.hash || url.href !== value) {
		throw new Error(`${label} must be a canonical Blob URL without a query or fragment`);
	}
	return value;
}

function requireCanonicalNetworkModuleUrl(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Rust verified network module URL is invalid');
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('Rust verified network module URL is invalid');
	}
	if (
		(parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
		parsed.username ||
		parsed.password ||
		parsed.hash ||
		parsed.href !== value
	) {
		throw new Error('Rust verified network module URL is invalid');
	}
	return value;
}

function snapshotExpectedNetworkModuleUrls(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXECUTABLE_MODULES) {
		throw new Error(
			'Rust language server requires the complete expected network module URL set'
		);
	}
	const expected: string[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		const networkUrl = requireCanonicalNetworkModuleUrl(candidate);
		if (seen.has(networkUrl)) {
			throw new Error('Rust expected network module URLs must not contain duplicates');
		}
		seen.add(networkUrl);
		expected.push(networkUrl);
	}
	return Object.freeze(expected);
}

function snapshotVerifiedModuleUrls(value: unknown): Readonly<Record<string, string>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Rust language server requires verified network module URLs');
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0 || entries.length > MAX_EXECUTABLE_MODULES)
		throw new Error('Rust language server requires verified network module URLs');
	const result: Record<string, string> = {};
	const blobUrls = new Set<string>();
	for (const [networkUrl, blobUrl] of entries) {
		requireCanonicalNetworkModuleUrl(networkUrl);
		const verifiedBlobUrl = requireCanonicalBlobUrl(blobUrl, 'Rust verified module URL');
		if (blobUrls.has(verifiedBlobUrl)) {
			throw new Error('Rust verified network module URLs must map one-to-one to Blob URLs');
		}
		blobUrls.add(verifiedBlobUrl);
		result[networkUrl] = verifiedBlobUrl;
	}
	return Object.freeze(result);
}

const severityFor = (severity: RustCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: RustCompilerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: severityFor(diagnostic.severity),
		source: 'rustc',
		message: String(diagnostic.message || 'Rust diagnostic')
	};
};

async function loadRustCompiler(
	config: RustWorkerOptions,
	importModule: (url: string) => Promise<RustCompilerModule>
): Promise<RustCompiler> {
	const compilerUrl = requireCanonicalBlobUrl(config.compilerUrl, 'Rust compiler URL');
	const expectedNetworkModuleUrls = snapshotExpectedNetworkModuleUrls(
		config.expectedNetworkModuleUrls
	);
	const moduleUrls = snapshotVerifiedModuleUrls(config.verifiedModuleUrls);
	const mappedNetworkModuleUrls = Object.keys(moduleUrls);
	if (
		mappedNetworkModuleUrls.length !== expectedNetworkModuleUrls.length ||
		expectedNetworkModuleUrls.some(
			(networkUrl) => !Object.prototype.hasOwnProperty.call(moduleUrls, networkUrl)
		)
	) {
		throw new Error(
			'Rust verified network module URL map must exactly match the expected executable graph URL set'
		);
	}
	if (!Object.values(moduleUrls).includes(compilerUrl)) {
		throw new Error('Rust compiler URL must belong to the verified executable graph');
	}
	if (!SHA256_PATTERN.test(config.graphFingerprint)) {
		throw new Error('Rust executable graph fingerprint must be a lowercase SHA-256');
	}
	if (
		!config.runtimeProfile ||
		typeof config.runtimeProfile !== 'object' ||
		Array.isArray(config.runtimeProfile)
	) {
		throw new Error('Rust language server requires a pinned runtime profile');
	}
	const runtimeProfile = config.runtimeProfile as unknown as Record<string, unknown>;
	if (
		Object.keys(runtimeProfile).sort().join('\0') !==
			[
				'manifestFingerprint',
				'manifestPath',
				'manifestReceipt',
				'moduleUrl',
				'profileId',
				'protocolVersion'
			].join('\0') ||
		typeof runtimeProfile.profileId !== 'string' ||
		runtimeProfile.protocolVersion !== 1 ||
		runtimeProfile.manifestPath !== 'runtime/runtime-manifest.v3.json' ||
		typeof runtimeProfile.manifestFingerprint !== 'string' ||
		!SHA256_PATTERN.test(runtimeProfile.manifestFingerprint) ||
		!runtimeProfile.manifestReceipt ||
		typeof runtimeProfile.manifestReceipt !== 'object' ||
		Array.isArray(runtimeProfile.manifestReceipt)
	) {
		throw new Error('Rust language server runtime profile is invalid');
	}
	const manifestReceipt = runtimeProfile.manifestReceipt as Record<string, unknown>;
	if (
		Object.keys(manifestReceipt).sort().join('\0') !== ['bytes', 'sha256'].join('\0') ||
		!Number.isSafeInteger(manifestReceipt.bytes) ||
		(manifestReceipt.bytes as number) <= 0 ||
		(manifestReceipt.bytes as number) > MAX_RUNTIME_MANIFEST_BYTES ||
		typeof manifestReceipt.sha256 !== 'string' ||
		!SHA256_PATTERN.test(manifestReceipt.sha256)
	) {
		throw new Error('Rust language server runtime profile receipt is invalid');
	}
	if (runtimeProfile.profileId !== `wasm-rust-${runtimeProfile.manifestFingerprint}`) {
		throw new Error('Rust language server runtime profile identity is invalid');
	}
	if (
		typeof runtimeProfile.moduleUrl !== 'string' ||
		moduleUrls[runtimeProfile.moduleUrl] !== compilerUrl
	) {
		throw new Error(
			'Rust runtime profile module URL must identify the verified compiler entry'
		);
	}
	let parsedRuntimeModuleUrl: URL;
	try {
		parsedRuntimeModuleUrl = new URL(runtimeProfile.moduleUrl);
	} catch {
		throw new Error('Rust runtime profile module URL is invalid');
	}
	if (
		(parsedRuntimeModuleUrl.protocol !== 'https:' &&
			parsedRuntimeModuleUrl.protocol !== 'http:') ||
		parsedRuntimeModuleUrl.username ||
		parsedRuntimeModuleUrl.password ||
		parsedRuntimeModuleUrl.hash ||
		parsedRuntimeModuleUrl.href !== runtimeProfile.moduleUrl
	) {
		throw new Error('Rust runtime profile module URL is invalid');
	}
	const canonicalRuntimeQuery = `?v=${runtimeProfile.manifestFingerprint}&rustManifestBytes=${manifestReceipt.bytes}&rustManifestSha256=${manifestReceipt.sha256}`;
	if (parsedRuntimeModuleUrl.search !== canonicalRuntimeQuery) {
		throw new Error('Rust runtime profile module URL has a non-canonical receipt query');
	}
	for (const networkUrl of expectedNetworkModuleUrls) {
		if (new URL(networkUrl).search !== canonicalRuntimeQuery) {
			throw new Error('Rust verified network module URL has a non-canonical receipt query');
		}
	}
	const pinnedRuntimeProfile: RustLanguageServerRuntimeProfile = Object.freeze({
		profileId: runtimeProfile.profileId,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint: runtimeProfile.manifestFingerprint,
		manifestReceipt: Object.freeze({
			bytes: manifestReceipt.bytes as number,
			sha256: manifestReceipt.sha256
		}),
		moduleUrl: runtimeProfile.moduleUrl
	}) as RustLanguageServerRuntimeProfile;
	const module = await importModule(compilerUrl);
	if (typeof module.configureVerifiedRuntimeExecutableModuleUrls !== 'function') {
		throw new Error(
			'wasm-rust module must export configureVerifiedRuntimeExecutableModuleUrls'
		);
	}
	module.configureVerifiedRuntimeExecutableModuleUrls(moduleUrls, config.graphFingerprint);
	const factory =
		typeof module.createRustCompiler === 'function'
			? module.createRustCompiler
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('wasm-rust module must export createRustCompiler or a default factory');
	}
	return await factory({ dependencies: { runtimeProfile: pinnedRuntimeProfile } });
}

export function createRustWorkerService(
	importModule: (url: string) => Promise<RustCompilerModule> = (url) =>
		import(/* @vite-ignore */ url) as Promise<RustCompilerModule>
): WorkerLanguageService {
	let compiler: RustCompiler | null = null;
	let targetTriple: RustLanguageServerTargetTriple = 'wasm32-wasip1';
	let edition = '2024';
	let maxAssetDeliveryBytes = MAX_RUST_LSP_ASSET_DELIVERY_BYTES;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-rust-lsp',
		diagnosticDelay: 800,
		capabilities: {},
		async initialize(options, context) {
			const config = (options || {}) as RustWorkerOptions;
			const configuredMaxAssetBytes = resolveExecutionLimits(
				config.maxAssetBytes === undefined ? {} : { maxAssetBytes: config.maxAssetBytes }
			).maxAssetBytes;
			const configuredAssetDeliveryBytes =
				Math.min(configuredMaxAssetBytes, MAX_RUST_LSP_ASSET_DELIVERY_BYTES / 2) * 2;
			targetTriple = config.targetTriple || targetTriple;
			edition = config.edition || edition;
			context.reportProgress('load-rust-compiler');
			compiler = await loadRustCompiler(config, importModule);
			maxAssetDeliveryBytes = configuredAssetDeliveryBytes;
		},
		async diagnostics(document, context: LspDocumentContext) {
			if (!compiler) return [];
			if (!document.text.trim()) return [];
			const key = `${targetTriple}\n${edition}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('rustc-diagnostics');
			const assetDeliveryBudget = createRuntimeAssetDeliveryBudget(maxAssetDeliveryBytes);
			const result = await compiler.compile({
				code: document.text,
				edition,
				crateType: 'bin',
				targetTriple,
				extendedTimeout: true,
				log: false,
				assetDeliveryBudget,
				onProgress(progress) {
					if (progress.delivery) {
						context.reportProgress(
							progress.stage || 'rustc-diagnostics',
							progress.delivery.deliveredBytes,
							progress.delivery.expectedBytes || progress.delivery.maxBytes
						);
						return;
					}
					context.reportProgress(
						progress.stage || 'rustc-diagnostics',
						progress.completed,
						progress.total
					);
				}
			});
			lastKey = key;
			lastDiagnostics = (result.diagnostics || []).map(diagnosticFor);
			if (!result.success && !lastDiagnostics.length) {
				lastDiagnostics = [
					{
						range: {
							start: positionAt(document.text, 0),
							end: positionAt(document.text, Math.min(document.text.length, 1))
						},
						severity: 1,
						source: 'rustc',
						message: result.stderr || result.stdout || 'Rust compilation failed'
					}
				];
			}
			return lastDiagnostics;
		}
	};
}
