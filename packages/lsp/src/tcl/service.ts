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
	TCL_MAX_ASSET_BYTES,
	requireTclRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry,
	type TclRuntimePreflightPayload
} from '@wasm-idle/core';

export interface TclWorkerOptions {
	workerReceipt: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: TclRuntimePreflightPayload;
	maxAssetBytes: number;
}

export type TclDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<TclWorkerOptions>;

export interface TclDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunTclDiagnostics = StaticWorkerDiagnosticRunner<
	TclWorkerOptions,
	TclDiagnosticRunnerResult
>;

const TCL_COMMANDS = [
	'append',
	'array',
	'break',
	'catch',
	'continue',
	'error',
	'eval',
	'expr',
	'for',
	'foreach',
	'global',
	'if',
	'incr',
	'info',
	'lappend',
	'lindex',
	'linsert',
	'list',
	'llength',
	'lrange',
	'proc',
	'puts',
	'read',
	'return',
	'set',
	'split',
	'string',
	'switch',
	'unset',
	'while'
] as const;

const TCL_HOVER: Record<string, string> = {
	catch: 'Evaluates a script and captures errors instead of throwing them.',
	expr: 'Evaluates an arithmetic or boolean expression.',
	foreach: 'Iterates over one or more lists.',
	gets: 'Reads a line from a channel such as stdin.',
	if: 'Conditionally evaluates Tcl scripts.',
	proc: 'Defines a Tcl procedure.',
	puts: 'Writes a string to stdout or another channel.',
	read: 'Reads bytes from a channel.',
	set: 'Reads or writes a variable.',
	string: 'Performs string operations.',
	switch: 'Matches a value against patterns.'
};

const TCL_CONFIG_KEYS = [
	'maxAssetBytes',
	'runnerWorkerBytes',
	'runtimePreflight',
	'workerReceipt'
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const isUint8Array = (value: unknown): value is Uint8Array =>
	ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';

function validateTclWorkerConfig(config: TclWorkerOptions): string | null {
	if (
		!isPlainRecord(config) ||
		Object.keys(config).sort().join('\n') !== TCL_CONFIG_KEYS.join('\n')
	) {
		return 'Tcl language server requires an exact verified runtime configuration';
	}
	if (
		!Number.isSafeInteger(config.maxAssetBytes) ||
		config.maxAssetBytes <= 0 ||
		config.maxAssetBytes > TCL_MAX_ASSET_BYTES
	) {
		return 'Tcl language server requires a valid maxAssetBytes limit';
	}
	if (
		!isPlainRecord(config.workerReceipt) ||
		Object.keys(config.workerReceipt).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(config.workerReceipt.bytes) ||
		(config.workerReceipt.bytes as number) <= 0 ||
		typeof config.workerReceipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(config.workerReceipt.sha256)
	) {
		return 'Tcl language server requires a valid runner receipt';
	}
	if (
		!isUint8Array(config.runnerWorkerBytes) ||
		config.runnerWorkerBytes.byteLength !== config.workerReceipt.bytes ||
		config.runnerWorkerBytes.byteLength > config.maxAssetBytes
	) {
		return 'Tcl language server requires receipt-sized runner bytes';
	}
	let payload: TclRuntimePreflightPayload;
	try {
		payload = requireTclRuntimePreflightPayload(config.runtimePreflight);
	} catch {
		return 'Tcl language server requires a strict runtime preflight payload';
	}
	for (const bytes of [
		payload.manifestBytes,
		payload.requireJsBytes,
		payload.customDataBytes,
		payload.libraryDataBytes,
		payload.glueBytes,
		payload.wasmBytes
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > config.maxAssetBytes) {
			return 'Tcl language server runtime preflight exceeds maxAssetBytes';
		}
	}
	return null;
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_:.-]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_:.-]*/u)?.[0] || '')
	);
};

const diagnosticFromMessage = (message: string): LspDiagnostic => {
	const location =
		message.match(/\(file\s+"[^"]+"\s+line\s+(\d+)\)/iu) ||
		message.match(/\bline\s+(\d+)(?:\D+column\s+(\d+))?/iu) ||
		message.match(/:(\d+):(?:(\d+):)?/u);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'tcl',
		message: message || 'Tcl diagnostic'
	};
};

export function createTclWorkerService(runDiagnostics?: RunTclDiagnostics): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		TclWorkerOptions,
		TclDiagnosticRunnerResult
	>({
		languageName: 'Tcl',
		loadProgressStage: 'load-tcl-runtime',
		diagnosticsProgressStage: 'tcl-diagnostics',
		defaultActivePath: 'main.tcl',
		timeoutMessage: 'Tcl diagnostics timed out',
		runtime: 'tcl',
		runDiagnostics,
		validateConfig: validateTclWorkerConfig,
		cacheKeyParts: (config) => [
			config.runtimePreflight.protocol,
			String(config.runtimePreflight.protocolVersion),
			config.runtimePreflight.profileId,
			config.runtimePreflight.artifactRevision,
			config.runtimePreflight.waclRevision,
			config.runtimePreflight.tclRevision,
			config.runtimePreflight.requireJsRevision,
			config.runtimePreflight.emscriptenRevision,
			config.runtimePreflight.manifestFingerprint,
			String(config.runtimePreflight.manifestBytes.byteLength),
			String(config.runtimePreflight.requireJsBytes.byteLength),
			String(config.runtimePreflight.customDataBytes.byteLength),
			String(config.runtimePreflight.libraryDataBytes.byteLength),
			String(config.runtimePreflight.glueBytes.byteLength),
			String(config.runtimePreflight.wasmBytes.byteLength),
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
			const message = (result.error || result.output || '').trim();
			return message ? [diagnosticFromMessage(message)] : [];
		}
	});

	return {
		name: 'wasm-idle-tcl-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: TCL_COMMANDS.map((label) => ({
					label,
					kind: 3,
					detail: TCL_HOVER[label] || 'Tcl command'
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = TCL_HOVER[word];
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
			const pattern = /^\s*proc\s+([A-Za-z_][A-Za-z0-9_:.-]*)\s+\{/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const name = match[1];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				const start = positionAt(document.text, nameOffset);
				const end = positionAt(document.text, nameOffset + name.length);
				symbols.push({
					name,
					kind: 12,
					range: { start, end },
					selectionRange: { start, end }
				});
			}
			return symbols;
		}
	};
}
