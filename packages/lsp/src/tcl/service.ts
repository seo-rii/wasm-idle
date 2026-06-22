import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import { runRuntimeWorkerDiagnostics } from '../runtime-worker.js';

export interface TclWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export interface TclDiagnosticRunnerRequest {
	baseUrl: string;
	workerUrl: string;
	code: string;
	activePath: string;
}

export interface TclDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunTclDiagnostics = (
	request: TclDiagnosticRunnerRequest
) => Promise<TclDiagnosticRunnerResult>;

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

const defaultRunDiagnostics: RunTclDiagnostics = (request) =>
	runRuntimeWorkerDiagnostics({
		workerUrl: request.workerUrl,
		timeoutMessage: 'Tcl diagnostics timed out',
		message: {
			run: true,
			baseUrl: request.baseUrl,
			code: request.code,
			args: [],
			stdin: '',
			activePath: request.activePath,
			diagnose: true,
			log: false
		}
	});

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

export function createTclWorkerService(
	runDiagnostics: RunTclDiagnostics = defaultRunDiagnostics
): WorkerLanguageService {
	let config: TclWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-tcl-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize(options, context) {
			const nextConfig = (options || {}) as TclWorkerOptions;
			if (!nextConfig.baseUrl || !nextConfig.workerUrl) {
				throw new Error('Tcl language server requires baseUrl and workerUrl');
			}
			context.reportProgress('load-tcl-runtime');
			config = nextConfig;
		},
		async diagnostics(document: LspDocument, context) {
			if (!config || !document.text.trim()) return [];
			const activePath = document.uri.split('/').pop() || 'main.tcl';
			const key = `${config.baseUrl}\n${config.workerUrl}\n${activePath}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('tcl-diagnostics');
			lastKey = key;
			const result = await runDiagnostics({
				baseUrl: config.baseUrl,
				workerUrl: config.workerUrl,
				code: document.text,
				activePath
			});
			const message = (result.error || result.output || '').trim();
			lastDiagnostics = message ? [diagnosticFromMessage(message)] : [];
			return lastDiagnostics;
		},
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
