import {
	type LspDiagnostic,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import {
	createStaticWorkerDiagnostics,
	type StaticWorkerDiagnosticRequest,
	type StaticWorkerDiagnosticRunner
} from '../static-worker-service.js';

export interface PrologWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export type PrologDiagnosticRunnerRequest =
	StaticWorkerDiagnosticRequest<PrologWorkerOptions>;

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
	'is': 'Evaluates an arithmetic expression and unifies the result.',
	fail: 'Always fails.',
	true: 'Always succeeds.',
	consult: 'Loads Prolog source code.',
	findall: 'Collects all solutions for a goal.',
	writeln: 'Writes a term followed by a newline.'
};

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
		createMessage: (request) => ({
			baseUrl: request.baseUrl,
			code: request.code,
			activePath: request.activePath,
			diagnose: true,
			log: false
		}),
		diagnosticsFromResult: (result) =>
			result.error ? [diagnosticFromError(result.error)] : []
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
