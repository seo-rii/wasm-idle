import {
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface PrologWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export interface PrologDiagnosticRunnerRequest {
	baseUrl: string;
	workerUrl: string;
	code: string;
	activePath: string;
}

export interface PrologDiagnosticRunnerResult {
	error?: string;
}

export type RunPrologDiagnostics = (
	request: PrologDiagnosticRunnerRequest
) => Promise<PrologDiagnosticRunnerResult>;

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

function runInWorker(request: PrologDiagnosticRunnerRequest): Promise<PrologDiagnosticRunnerResult> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(request.workerUrl);
		const timeout = setTimeout(() => {
			worker.terminate();
			reject(new Error('Prolog diagnostics timed out'));
		}, 5000);
		worker.onerror = (event) => {
			clearTimeout(timeout);
			worker.terminate();
			reject(event.error || new Error(event.message || 'Prolog worker failed'));
		};
		worker.onmessage = (event: MessageEvent<PrologDiagnosticRunnerResult & { results?: boolean }>) => {
			if (!event.data?.results && !event.data?.error) return;
			clearTimeout(timeout);
			worker.terminate();
			resolve({ error: event.data.error });
		};
		worker.postMessage({
			baseUrl: request.baseUrl,
			code: request.code,
			activePath: request.activePath,
			diagnose: true,
			log: false
		});
	});
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
	runDiagnostics: RunPrologDiagnostics = runInWorker
): WorkerLanguageService {
	let config: PrologWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-prolog-lsp',
		diagnosticDelay: 300,
		capabilities: {
			completionProvider: { triggerCharacters: [':', '?'] },
			hoverProvider: true
		},
		initialize(options, context) {
			const nextConfig = (options || {}) as PrologWorkerOptions;
			if (!nextConfig.baseUrl || !nextConfig.workerUrl) {
				throw new Error('Prolog language server requires baseUrl and workerUrl');
			}
			context.reportProgress('load-prolog-runtime');
			config = nextConfig;
		},
		async diagnostics(document: LspDocument) {
			if (!config || !document.text.trim()) return [];
			const activePath = document.uri.split('/').pop() || 'main.prolog';
			const key = `${config.baseUrl}\n${config.workerUrl}\n${activePath}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			lastKey = key;
			const result = await runDiagnostics({
				baseUrl: config.baseUrl,
				workerUrl: config.workerUrl,
				code: document.text,
				activePath
			});
			lastDiagnostics = result.error ? [diagnosticFromError(result.error)] : [];
			return lastDiagnostics;
		},
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
