import {
	positionAt,
	uriToPath,
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
	PASCAL_MAX_ASSET_BYTES,
	PASCAL_MAX_LOGICAL_BYTES,
	PASCAL_MAX_MANIFEST_BYTES,
	requirePascalRuntimePreflightPayload,
	type PascalRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface PascalWorkerOptions {
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: PascalRuntimePreflightPayload;
	workerReceipt: RuntimeAssetIntegrityEntry;
	maxAssetBytes: number;
}

export type PascalDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<PascalWorkerOptions>;

export interface PascalDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunPascalDiagnostics = StaticWorkerDiagnosticRunner<
	PascalWorkerOptions,
	PascalDiagnosticRunnerResult
>;

const PASCAL_CONFIG_KEYS = [
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

function validatePascalWorkerConfig(config: PascalWorkerOptions): string | null {
	if (
		!isPlainRecord(config) ||
		Object.keys(config).sort().join('\n') !== PASCAL_CONFIG_KEYS.join('\n')
	) {
		return 'Pascal language server requires an exact verified runtime configuration';
	}
	if (
		!Number.isSafeInteger(config.maxAssetBytes) ||
		config.maxAssetBytes <= 0 ||
		config.maxAssetBytes > PASCAL_MAX_ASSET_BYTES
	) {
		return 'Pascal language server requires a valid maxAssetBytes limit';
	}
	if (
		!isPlainRecord(config.workerReceipt) ||
		Object.keys(config.workerReceipt).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(config.workerReceipt.bytes) ||
		(config.workerReceipt.bytes as number) <= 0 ||
		typeof config.workerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(config.workerReceipt.sha256)
	) {
		return 'Pascal language server requires a valid runner receipt';
	}
	if (
		!isOwnedUint8Array(config.runnerWorkerBytes) ||
		config.runnerWorkerBytes.byteLength !== config.workerReceipt.bytes ||
		config.runnerWorkerBytes.byteLength > config.maxAssetBytes
	) {
		return 'Pascal language server requires receipt-sized runner bytes';
	}
	let payload: PascalRuntimePreflightPayload;
	try {
		payload = requirePascalRuntimePreflightPayload(config.runtimePreflight);
	} catch {
		return 'Pascal language server requires a strict runtime preflight payload';
	}
	const runtimeBuffers = [
		payload.manifestBytes,
		payload.compilerJavaScriptBytes,
		payload.rtlJavaScriptBytes,
		payload.systemPascalBytes
	];
	for (const bytes of runtimeBuffers) {
		if (!isOwnedUint8Array(bytes)) {
			return 'Pascal language server requires owned runtime preflight bytes';
		}
		if (bytes.byteLength <= 0 || bytes.byteLength > config.maxAssetBytes) {
			return 'Pascal language server runtime preflight exceeds maxAssetBytes';
		}
	}
	if (payload.manifestBytes.byteLength > PASCAL_MAX_MANIFEST_BYTES) {
		return 'Pascal language server manifest exceeds the manifest limit';
	}
	if (
		new Set([config.runnerWorkerBytes.buffer, ...runtimeBuffers.map((bytes) => bytes.buffer)])
			.size !== 5
	) {
		return 'Pascal language server requires unique owned preflight buffers';
	}
	const logicalBytes =
		payload.compilerJavaScriptBytes.byteLength +
		payload.rtlJavaScriptBytes.byteLength +
		payload.systemPascalBytes.byteLength;
	if (!Number.isSafeInteger(logicalBytes) || logicalBytes > PASCAL_MAX_LOGICAL_BYTES) {
		return 'Pascal language server logical payload exceeds the aggregate limit';
	}
	return null;
}

const PASCAL_KEYWORDS = [
	'and',
	'array',
	'begin',
	'case',
	'class',
	'const',
	'constructor',
	'destructor',
	'div',
	'do',
	'downto',
	'else',
	'end',
	'except',
	'for',
	'function',
	'if',
	'implementation',
	'in',
	'inherited',
	'interface',
	'mod',
	'not',
	'object',
	'of',
	'or',
	'procedure',
	'program',
	'record',
	'repeat',
	'then',
	'to',
	'try',
	'type',
	'unit',
	'until',
	'uses',
	'var',
	'while',
	'with',
	'xor'
] as const;

const PASCAL_BUILTINS = [
	'Boolean',
	'Char',
	'Integer',
	'ReadLn',
	'Real',
	'String',
	'Write',
	'WriteLn'
] as const;

const PASCAL_HOVER: Record<string, string> = {
	begin: 'Starts a Pascal statement block.',
	end: 'Ends a Pascal statement block.',
	function: 'Declares a routine that returns a value.',
	procedure: 'Declares a routine that does not return a value.',
	program: 'Declares the main Pascal program.',
	readln: 'Reads one line from standard input.',
	repeat: 'Starts a loop that runs until its condition becomes true.',
	unit: 'Declares a reusable Pascal module.',
	uses: 'Imports units into the current program or unit.',
	var: 'Starts a variable declaration section.',
	while: 'Runs a loop while its condition remains true.',
	writeln: 'Writes values followed by a newline.'
};

export function createPascalWorkerService(
	runDiagnostics?: RunPascalDiagnostics
): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		PascalWorkerOptions,
		PascalDiagnosticRunnerResult
	>({
		languageName: 'Pascal',
		loadProgressStage: 'load-pascal-runtime',
		diagnosticsProgressStage: 'pascal-diagnostics',
		defaultActivePath: 'main.pas',
		timeoutMessage: 'Pascal diagnostics timed out',
		runtime: 'pascal',
		runDiagnostics,
		validateConfig: validatePascalWorkerConfig,
		cacheKeyParts: (config) => [
			config.runtimePreflight.protocol,
			String(config.runtimePreflight.protocolVersion),
			config.runtimePreflight.profileId,
			config.runtimePreflight.artifactRevision,
			config.runtimePreflight.pas2jsVersion,
			config.runtimePreflight.pas2jsRevision,
			config.runtimePreflight.manifestFingerprint,
			String(config.runtimePreflight.manifestBytes.byteLength),
			String(config.runtimePreflight.compilerJavaScriptBytes.byteLength),
			String(config.runtimePreflight.rtlJavaScriptBytes.byteLength),
			String(config.runtimePreflight.systemPascalBytes.byteLength),
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
		activePathFromDocument: (document) =>
			uriToPath(document.uri).split('/').filter(Boolean).pop() || 'main.pas',
		diagnosticsFromResult: (result, document) => {
			const message = (result.error || result.output || '').trim();
			if (!message) return [];
			const parsedDiagnostics: Array<LspDiagnostic & { hasLocation?: boolean }> = [];
			for (const lineText of message.split(/\r\n|\n|\r/u)) {
				const trimmed = lineText.trim();
				if (!trimmed) continue;
				const match = trimmed.match(
					/^(?:(?:[^()\s]+)\((\d+),(\d+)\)\s*)?(Fatal|Error|Warning|Note|Hint):\s*(.*)$/iu
				);
				if (!match) continue;
				const line = Math.max(0, Number(match[1] || 1) - 1);
				const character = Math.max(0, Number(match[2] || 1) - 1);
				const severityName = match[3].toLowerCase();
				parsedDiagnostics.push({
					range: {
						start: { line, character },
						end: { line, character: character + 1 }
					},
					severity:
						severityName === 'warning'
							? 2
							: severityName === 'note' || severityName === 'hint'
								? 3
								: 1,
					source: 'pascal',
					message: match[4] || trimmed,
					hasLocation: !!match[1]
				});
			}
			const hasLocatedDiagnostic = parsedDiagnostics.some(
				(diagnostic) => diagnostic.hasLocation
			);
			const diagnostics = (
				hasLocatedDiagnostic
					? parsedDiagnostics.filter((diagnostic) => diagnostic.hasLocation)
					: parsedDiagnostics
			).map(({ hasLocation: _hasLocation, ...diagnostic }) => diagnostic);
			if (diagnostics.length) return diagnostics;
			return [
				{
					range: {
						start: positionAt(document.text, 0),
						end: positionAt(document.text, Math.min(document.text.length, 1))
					},
					severity: 1,
					source: 'pascal',
					message
				}
			];
		}
	});

	return {
		name: 'wasm-idle-pascal-lsp',
		diagnosticDelay: 600,
		capabilities: {
			completionProvider: { triggerCharacters: ['.'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...PASCAL_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: PASCAL_HOVER[label] || 'Pascal keyword'
					})),
					...PASCAL_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: PASCAL_HOVER[label.toLowerCase()] || 'Pascal built-in'
					}))
				]
			};
		},
		hover(document, position: LspPosition) {
			const line = document.text.split('\n')[position.line] || '';
			const character = Math.max(0, Math.min(position.character, line.length));
			const word =
				(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
				(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '');
			const description = PASCAL_HOVER[word.toLowerCase()];
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
			const pattern = /^\s*(program|unit|procedure|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gimu;
			for (const match of document.text.matchAll(pattern)) {
				const name = match[2];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				const start = positionAt(document.text, nameOffset);
				const end = positionAt(document.text, nameOffset + name.length);
				symbols.push({
					name,
					kind:
						match[1].toLowerCase() === 'function' ||
						match[1].toLowerCase() === 'procedure'
							? 12
							: 2,
					range: { start, end },
					selectionRange: { start, end }
				});
			}
			return symbols;
		}
	};
}
