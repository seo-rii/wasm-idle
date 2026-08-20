import { type LspDiagnostic, type LspPosition, type WorkerLanguageService } from '../lsp.js';
import {
	createStaticWorkerDiagnostics,
	type StaticWorkerDiagnosticRequest,
	type StaticWorkerDiagnosticRunner
} from '../static-worker-service.js';
import {
	PROLOG_MAX_ASSET_BYTES,
	requirePrologRuntimePreflightPayload,
	type PrologRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface PrologWorkerOptions {
	workerReceipt: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: PrologRuntimePreflightPayload;
	maxAssetBytes: number;
}

export type PrologDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<PrologWorkerOptions>;

export interface PrologDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunPrologDiagnostics = StaticWorkerDiagnosticRunner<
	PrologWorkerOptions,
	PrologDiagnosticRunnerResult
>;

const PROLOG_KEYWORDS = [
	':-',
	'?-',
	'is',
	'not',
	'fail',
	'true',
	'false',
	'consult',
	'listing',
	'assertz',
	'retract',
	'findall',
	'bagof',
	'setof',
	'forall',
	'call',
	'once',
	'write',
	'writeln',
	'read_line_to_string'
] as const;

const PROLOG_HOVER: Record<string, string> = {
	':-': 'Introduces a rule body or directive.',
	is: 'Evaluates an arithmetic expression and unifies the result.',
	fail: 'Always fails.',
	true: 'Always succeeds.',
	consult: 'Loads Prolog source code.',
	findall: 'Collects all solutions for a goal.',
	writeln: 'Writes a term followed by a newline.'
};

const PROLOG_CONFIG_KEYS = [
	'maxAssetBytes',
	'runnerWorkerBytes',
	'runtimePreflight',
	'workerReceipt'
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const isUint8Array = (value: unknown): value is Uint8Array =>
	ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';

function validatePrologWorkerConfig(config: PrologWorkerOptions): string | null {
	if (
		!isPlainRecord(config) ||
		Object.keys(config).sort().join('\n') !== PROLOG_CONFIG_KEYS.join('\n')
	) {
		return 'Prolog language server requires an exact verified runtime configuration';
	}
	if (
		!Number.isSafeInteger(config.maxAssetBytes) ||
		config.maxAssetBytes <= 0 ||
		config.maxAssetBytes > PROLOG_MAX_ASSET_BYTES
	) {
		return 'Prolog language server requires a valid maxAssetBytes limit';
	}
	if (
		!isPlainRecord(config.workerReceipt) ||
		Object.keys(config.workerReceipt).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(config.workerReceipt.bytes) ||
		(config.workerReceipt.bytes as number) <= 0 ||
		typeof config.workerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(config.workerReceipt.sha256)
	) {
		return 'Prolog language server requires a valid runner receipt';
	}
	if (
		!isUint8Array(config.runnerWorkerBytes) ||
		config.runnerWorkerBytes.byteLength !== config.workerReceipt.bytes ||
		config.runnerWorkerBytes.byteLength > config.maxAssetBytes
	) {
		return 'Prolog language server requires receipt-sized runner bytes';
	}
	let payload: PrologRuntimePreflightPayload;
	try {
		payload = requirePrologRuntimePreflightPayload(config.runtimePreflight);
	} catch {
		return 'Prolog language server requires a strict runtime preflight payload';
	}
	for (const bytes of [
		payload.manifestBytes,
		payload.javascriptBytes,
		payload.wasmBytes,
		payload.dataBytes
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > config.maxAssetBytes) {
			return 'Prolog language server runtime preflight exceeds maxAssetBytes';
		}
	}
	return null;
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[:?][-]|[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

const diagnosticFromError = (message: string): LspDiagnostic => {
	const location = message.match(/(?:line|:)(\d+)(?::(\d+))?/iu);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'prolog',
		message
	};
};

export function createPrologWorkerService(
	runDiagnostics?: RunPrologDiagnostics
): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		PrologWorkerOptions,
		PrologDiagnosticRunnerResult
	>({
		languageName: 'Prolog',
		loadProgressStage: 'load-prolog-runtime',
		defaultActivePath: 'main.prolog',
		timeoutMessage: 'Prolog diagnostics timed out',
		runDiagnostics,
		validateConfig: validatePrologWorkerConfig,
		cacheKeyParts: (config) => [
			config.runtimePreflight.protocol,
			String(config.runtimePreflight.protocolVersion),
			config.runtimePreflight.profileId,
			config.runtimePreflight.packageRevision,
			config.runtimePreflight.swiplRevision,
			config.runtimePreflight.manifestFingerprint,
			String(config.runtimePreflight.manifestBytes.byteLength),
			String(config.runtimePreflight.javascriptBytes.byteLength),
			String(config.runtimePreflight.wasmBytes.byteLength),
			String(config.runtimePreflight.dataBytes.byteLength),
			String(config.workerReceipt.bytes),
			config.workerReceipt.sha256,
			String(config.maxAssetBytes)
		],
		createMessage: (request) => ({
			runtimePreflight: request.runtimePreflight,
			maxAssetBytes: request.maxAssetBytes,
			code: request.code,
			activePath: request.activePath,
			diagnose: true,
			log: false
		}),
		diagnosticsFromResult: (result) => (result.error ? [diagnosticFromError(result.error)] : [])
	});

	return {
		name: 'wasm-idle-prolog-lsp',
		diagnosticDelay: 300,
		capabilities: {
			completionProvider: { triggerCharacters: [':', '?'] },
			hoverProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: PROLOG_KEYWORDS.map((label) => ({
					label,
					kind: label.startsWith(':') || label.startsWith('?') ? 14 : 3,
					detail: PROLOG_HOVER[label] || 'SWI-Prolog predicate or keyword'
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = PROLOG_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		}
	};
}
