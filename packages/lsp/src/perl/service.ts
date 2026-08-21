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
import {
	PERL_MAX_ASSET_BYTES,
	requirePerlRuntimePreflightPayload,
	type PerlRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface PerlWorkerOptions {
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: PerlRuntimePreflightPayload;
	maxAssetBytes: number;
	workerReceipt: RuntimeAssetIntegrityEntry;
}

export type PerlDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<PerlWorkerOptions>;

export interface PerlDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunPerlDiagnostics = StaticWorkerDiagnosticRunner<
	PerlWorkerOptions,
	PerlDiagnosticRunnerResult
>;

const PERL_KEYWORDS = [
	'continue',
	'do',
	'else',
	'elsif',
	'for',
	'foreach',
	'if',
	'last',
	'my',
	'next',
	'our',
	'package',
	'return',
	'sub',
	'unless',
	'until',
	'use',
	'while'
] as const;

const PERL_BUILTINS = [
	'chomp',
	'defined',
	'die',
	'exists',
	'grep',
	'join',
	'length',
	'map',
	'open',
	'pop',
	'print',
	'push',
	'say',
	'shift',
	'split',
	'sprintf',
	'undef',
	'unshift',
	'warn'
] as const;

const PERL_HOVER: Record<string, string> = {
	my: 'Declares a lexically scoped Perl variable.',
	our: 'Declares a package variable visible under strict vars.',
	sub: 'Defines a Perl subroutine.',
	use: 'Loads a module at compile time.',
	print: 'Writes values to the selected output handle.',
	say: 'Writes values followed by a newline.',
	chomp: 'Removes an input record separator from the end of a string.',
	defined: 'Checks whether a scalar has a defined value.',
	split: 'Splits a string into a list.'
};

const PERL_CONFIG_KEYS = [
	'maxAssetBytes',
	'runnerWorkerBytes',
	'runtimePreflight',
	'workerReceipt'
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const isOwnedUint8Array = (value: unknown): value is Uint8Array =>
	ArrayBuffer.isView(value) &&
	Object.prototype.toString.call(value) === '[object Uint8Array]' &&
	value.buffer instanceof ArrayBuffer &&
	value.byteOffset === 0 &&
	value.byteLength === value.buffer.byteLength;

function validatePerlWorkerConfig(config: PerlWorkerOptions): string | null {
	if (
		!isPlainRecord(config) ||
		Object.keys(config).sort().join('\n') !== PERL_CONFIG_KEYS.join('\n')
	) {
		return 'Perl language server requires an exact verified runtime configuration';
	}
	if (
		!Number.isSafeInteger(config.maxAssetBytes) ||
		config.maxAssetBytes <= 0 ||
		config.maxAssetBytes > PERL_MAX_ASSET_BYTES
	) {
		return 'Perl language server requires a valid maxAssetBytes limit';
	}
	if (
		!isPlainRecord(config.workerReceipt) ||
		Object.keys(config.workerReceipt).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(config.workerReceipt.bytes) ||
		(config.workerReceipt.bytes as number) <= 0 ||
		typeof config.workerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(config.workerReceipt.sha256)
	) {
		return 'Perl language server requires a valid runner receipt';
	}
	if (
		!isOwnedUint8Array(config.runnerWorkerBytes) ||
		config.runnerWorkerBytes.byteLength !== config.workerReceipt.bytes ||
		config.runnerWorkerBytes.byteLength > config.maxAssetBytes
	) {
		return 'Perl language server requires receipt-sized runner bytes';
	}
	let payload: PerlRuntimePreflightPayload;
	try {
		payload = requirePerlRuntimePreflightPayload(config.runtimePreflight);
	} catch {
		return 'Perl language server requires a strict runtime preflight payload';
	}
	for (const bytes of [
		payload.manifestBytes,
		payload.javascriptBytes,
		payload.wasmBytes,
		payload.dataBytes
	]) {
		if (!isOwnedUint8Array(bytes)) {
			return 'Perl language server requires owned runtime preflight bytes';
		}
		if (bytes.byteLength <= 0 || bytes.byteLength > config.maxAssetBytes) {
			return 'Perl language server runtime preflight exceeds maxAssetBytes';
		}
	}
	return null;
}

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
		message.match(/\bat\s+\S+\s+line\s+(\d+)(?:,\s+near\s+.+)?/iu) ||
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
		source: 'perl',
		message: message || 'Perl diagnostic'
	};
};

export function createPerlWorkerService(
	runDiagnostics?: RunPerlDiagnostics
): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		PerlWorkerOptions,
		PerlDiagnosticRunnerResult
	>({
		languageName: 'Perl',
		loadProgressStage: 'load-perl-runtime',
		diagnosticsProgressStage: 'perl-diagnostics',
		defaultActivePath: 'main.pl',
		timeoutMessage: 'Perl diagnostics timed out',
		runtime: 'perl',
		runDiagnostics,
		validateConfig: validatePerlWorkerConfig,
		cacheKeyParts: (config) => [
			config.runtimePreflight.protocol,
			String(config.runtimePreflight.protocolVersion),
			config.runtimePreflight.profileId,
			config.runtimePreflight.artifactRevision,
			config.runtimePreflight.webperlRevision,
			config.runtimePreflight.perlRevision,
			config.runtimePreflight.emscriptenRevision,
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
			args: [],
			stdin: '',
			activePath: request.activePath,
			diagnose: true,
			log: false
		}),
		diagnosticsFromResult: (result) => {
			const output = (result.output || '').trim();
			const error = (result.error || '').trim();
			const message =
				error && !/^Perl exited with status \d+\.$/u.test(error) ? error : output || error;
			return message ? [diagnosticFromMessage(message)] : [];
		}
	});

	return {
		name: 'wasm-idle-perl-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$', '@', '%', ':'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...PERL_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: PERL_HOVER[label] || 'Perl keyword'
					})),
					...PERL_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: PERL_HOVER[label] || 'Perl built-in'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = PERL_HOVER[word];
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
			const pattern = /^\s*sub\s+([A-Za-z_][A-Za-z0-9_]*)/gmu;
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
