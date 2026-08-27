import {
	AWK_MAX_ASSET_BYTES,
	AWK_RUNTIME_WORKER_PATH,
	awkRuntimePreflightTransferables,
	cloneAwkRuntimePreflightPayload,
	requireAwkRuntimePreflightPayload,
	snapshotAwkRuntimePreflightProfile,
	verifyAwkRuntimePreflightPayload,
	verifyRuntimeAssetIntegrity,
	type AwkRuntimePreflightPayload,
	type AwkRuntimePreflightProfile,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';
import {
	positionAt,
	type LspDiagnostic,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import {
	createStaticWorkerDiagnostics,
	type StaticWorkerDiagnosticRequest,
	type StaticWorkerDiagnosticRunner
} from '../static-worker-service.js';

export interface AwkWorkerOptions {
	manifestUrl: string;
	maxAssetBytes: number;
	profile: AwkRuntimePreflightProfile;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: AwkRuntimePreflightPayload;
	workerReceipt: RuntimeAssetIntegrityEntry;
}

export type AwkDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<AwkWorkerOptions>;

export interface AwkDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunAwkDiagnostics = StaticWorkerDiagnosticRunner<
	AwkWorkerOptions,
	AwkDiagnosticRunnerResult
>;

const AWK_CONFIG_KEYS = [
	'manifestUrl',
	'maxAssetBytes',
	'profile',
	'runnerWorkerBytes',
	'runtimePreflight',
	'workerReceipt'
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	if (Object.getOwnPropertySymbols(value).length) return false;
	return Object.values(Object.getOwnPropertyDescriptors(value)).every(
		(descriptor) => !descriptor.get && !descriptor.set
	);
};

const isOwnedUint8Array = (value: unknown): value is Uint8Array =>
	ArrayBuffer.isView(value) &&
	Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(Uint8Array.prototype),
		Symbol.toStringTag
	)?.get?.call(value) === 'Uint8Array' &&
	value.buffer instanceof ArrayBuffer &&
	value.byteOffset === 0 &&
	value.byteLength === value.buffer.byteLength;

function validateManifestUrl(value: unknown): boolean {
	if (typeof value !== 'string' || !value) return false;
	try {
		const url = new URL(value);
		return (
			(url.protocol === 'https:' || url.protocol === 'http:') &&
			!url.username &&
			!url.password &&
			!url.hash
		);
	} catch {
		return false;
	}
}

function validateAwkWorkerConfig(config: AwkWorkerOptions): string | null {
	if (
		!isPlainRecord(config) ||
		Object.keys(config).sort().join('\n') !== AWK_CONFIG_KEYS.join('\n')
	) {
		return 'AWK language server requires an exact verified runtime configuration';
	}
	if (!validateManifestUrl(config.manifestUrl)) {
		return 'AWK language server requires an absolute pinned manifest URL';
	}
	if (
		!Number.isSafeInteger(config.maxAssetBytes) ||
		config.maxAssetBytes <= 0 ||
		config.maxAssetBytes > AWK_MAX_ASSET_BYTES
	) {
		return 'AWK language server requires a valid maxAssetBytes limit';
	}
	let profile: AwkRuntimePreflightProfile;
	try {
		profile = snapshotAwkRuntimePreflightProfile(config.profile);
	} catch {
		return 'AWK language server requires a strict runtime preflight profile';
	}
	if (
		!isPlainRecord(config.workerReceipt) ||
		Object.keys(config.workerReceipt).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(config.workerReceipt.bytes) ||
		(config.workerReceipt.bytes as number) <= 0 ||
		typeof config.workerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(config.workerReceipt.sha256) ||
		config.workerReceipt.bytes !== profile.workerReceipt.bytes ||
		config.workerReceipt.sha256 !== profile.workerReceipt.sha256
	) {
		return 'AWK language server requires the profile-pinned runner receipt';
	}
	if (
		!isOwnedUint8Array(config.runnerWorkerBytes) ||
		config.runnerWorkerBytes.byteLength !== config.workerReceipt.bytes ||
		config.runnerWorkerBytes.byteLength > config.maxAssetBytes
	) {
		return 'AWK language server requires receipt-sized runner bytes';
	}
	let payload: AwkRuntimePreflightPayload;
	try {
		payload = requireAwkRuntimePreflightPayload(config.runtimePreflight);
	} catch {
		return 'AWK language server requires a strict runtime preflight payload';
	}
	for (const bytes of [payload.goShimBytes, payload.wasmBytes]) {
		if (!isOwnedUint8Array(bytes)) {
			return 'AWK language server requires owned runtime preflight bytes';
		}
		if (bytes.byteLength <= 0 || bytes.byteLength > config.maxAssetBytes) {
			return 'AWK language server runtime preflight exceeds maxAssetBytes';
		}
	}
	if (
		new Set([
			config.runnerWorkerBytes.buffer,
			payload.goShimBytes.buffer,
			payload.wasmBytes.buffer
		]).size !== 3
	) {
		return 'AWK language server requires unique owned preflight buffers';
	}
	return null;
}

function runtimeMessageTransfer(message: Record<string, unknown>): readonly Transferable[] {
	return awkRuntimePreflightTransferables(message.runtimePreflight);
}

const AWK_KEYWORDS = [
	'BEGIN',
	'END',
	'BEGINFILE',
	'ENDFILE',
	'break',
	'continue',
	'delete',
	'do',
	'else',
	'exit',
	'for',
	'function',
	'if',
	'in',
	'next',
	'nextfile',
	'print',
	'printf',
	'return',
	'while'
] as const;

const AWK_BUILTINS = [
	'atan2',
	'close',
	'cos',
	'exp',
	'fflush',
	'gsub',
	'index',
	'int',
	'length',
	'log',
	'match',
	'rand',
	'sin',
	'split',
	'sprintf',
	'sqrt',
	'srand',
	'sub',
	'substr',
	'system',
	'tolower',
	'toupper'
] as const;

const AWK_HOVER: Record<string, string> = {
	BEGIN: 'Runs before AWK reads input records.',
	END: 'Runs after AWK finishes reading input records.',
	function: 'Defines an AWK function.',
	print: 'Writes fields or expressions followed by a newline.',
	printf: 'Writes formatted output.',
	next: 'Skips to the next input record.',
	NF: 'Number of fields in the current record.',
	NR: 'Number of records read so far.',
	FS: 'Input field separator.',
	OFS: 'Output field separator.',
	RS: 'Input record separator.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

const diagnosticFromMessage = (message: string): LspDiagnostic => {
	const location =
		message.match(/\bat\s+(\d+):(\d+)/iu) ||
		message.match(/\bline\s+(\d+)(?:[:,]\s*(\d+))?/iu) ||
		message.match(/:(\d+):(?:(\d+):)?/u);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'awk',
		message: message || 'AWK diagnostic'
	};
};

export function createAwkWorkerService(runDiagnostics?: RunAwkDiagnostics): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		AwkWorkerOptions,
		AwkDiagnosticRunnerResult
	>({
		languageName: 'AWK',
		loadProgressStage: 'load-awk-runtime',
		diagnosticsProgressStage: 'awk-diagnostics',
		defaultActivePath: 'main.awk',
		timeoutMessage: 'AWK diagnostics timed out',
		runtime: 'awk',
		workerAsset: AWK_RUNTIME_WORKER_PATH,
		singleFlight: true,
		runDiagnostics,
		validateConfig: validateAwkWorkerConfig,
		cacheKeyParts: (config) => [
			config.manifestUrl,
			JSON.stringify(config.profile),
			config.workerReceipt.sha256,
			String(config.workerReceipt.bytes),
			String(config.maxAssetBytes)
		],
		createMessage: (request) => ({
			run: true,
			runtimePreflight: cloneAwkRuntimePreflightPayload(request.runtimePreflight),
			code: request.code,
			activePath: request.activePath,
			args: [],
			stdin: '',
			diagnose: true,
			log: false
		}),
		messageTransfer: runtimeMessageTransfer,
		diagnosticsFromResult: (result) => {
			const message = (result.error || result.output || '').trim();
			return message ? [diagnosticFromMessage(message)] : [];
		}
	});

	return {
		name: 'wasm-idle-awk-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$', '@'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(workerOptions, context) {
			// Rehash every transferred byte inside this trusted outer Worker before any
			// receipt-pinned nested Worker can be constructed.
			const config = workerOptions as AwkWorkerOptions;
			const validationError = validateAwkWorkerConfig(config);
			if (validationError) throw new Error(validationError);
			const profile = snapshotAwkRuntimePreflightProfile(config.profile);
			const runtimePreflight = requireAwkRuntimePreflightPayload(config.runtimePreflight);
			const workerReceipt = Object.freeze({
				bytes: config.workerReceipt.bytes,
				sha256: config.workerReceipt.sha256
			});
			const verifiedConfig = Object.freeze({
				manifestUrl: config.manifestUrl,
				maxAssetBytes: config.maxAssetBytes,
				profile,
				runnerWorkerBytes: config.runnerWorkerBytes,
				runtimePreflight: Object.freeze({
					protocol: runtimePreflight.protocol,
					goShimBytes: runtimePreflight.goShimBytes,
					wasmBytes: runtimePreflight.wasmBytes
				}),
				workerReceipt
			}) satisfies AwkWorkerOptions;
			await Promise.all([
				verifyAwkRuntimePreflightPayload(verifiedConfig.runtimePreflight, profile, {
					maxAssetBytes: verifiedConfig.maxAssetBytes
				}),
				verifyRuntimeAssetIntegrity({
					asset: AWK_RUNTIME_WORKER_PATH,
					bytes: verifiedConfig.runnerWorkerBytes,
					expected: workerReceipt,
					stage: 'compressed',
					runtimeId: 'awk'
				})
			]);
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(verifiedConfig.runnerWorkerBytes);
			} catch {
				throw new Error('AWK language server runner is not valid UTF-8 JavaScript');
			}
			await workerDiagnostics.initialize?.(verifiedConfig, context);
		},
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...AWK_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: AWK_HOVER[label] || 'AWK keyword'
					})),
					...AWK_BUILTINS.map((label) => ({ label, kind: 3, detail: 'AWK built-in' }))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = AWK_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		documentSymbols(document) {
			const symbols = [];
			const pattern = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const offset = match.index || 0;
				const start = positionAt(document.text, offset);
				const end = positionAt(document.text, offset + match[0].length);
				symbols.push({
					name: match[1],
					kind: 12,
					range: { start, end },
					selectionRange: {
						start,
						end: { line: start.line, character: start.character + match[0].length }
					}
				});
			}
			return symbols;
		}
	};
}
