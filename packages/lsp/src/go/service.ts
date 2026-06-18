import {
	positionAt,
	type LspDiagnostic,
	type LspDocumentContext,
	type WorkerLanguageService
} from '../lsp.js';

export type GoLanguageServerTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';

export interface GoWorkerOptions {
	compilerUrl: string;
	target?: GoLanguageServerTarget;
}

interface GoCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface GoCompilerResult {
	success: boolean;
	diagnostics?: GoCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface GoCompiler {
	compile: (request: {
		code: string;
		target: GoLanguageServerTarget;
		prepare: boolean;
		log: boolean;
		onProgress?: (progress: {
			stage?: string;
			completed?: number;
			total?: number;
			percent?: number;
		}) => void;
	}) => Promise<GoCompilerResult>;
}

const severityFor = (severity: GoCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: GoCompilerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	const endCharacter = Math.max(
		character + 1,
		Number(diagnostic.endColumnNumber || diagnostic.columnNumber || character + 2) - 1
	);
	return {
		range: {
			start: { line, character },
			end: { line, character: endCharacter }
		},
		severity: severityFor(diagnostic.severity),
		source: 'go',
		message: String(diagnostic.message || 'Go diagnostic')
	};
};

async function loadGoCompiler(compilerUrl: string): Promise<GoCompiler> {
	const module = await import(/* @vite-ignore */ compilerUrl);
	const factory =
		typeof module.createGoCompiler === 'function'
			? module.createGoCompiler
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('wasm-go module must export createGoCompiler or a default factory');
	}
	return await factory();
}

export function createGoWorkerService(): WorkerLanguageService {
	let compiler: GoCompiler | null = null;
	let target: GoLanguageServerTarget = 'wasip1/wasm';
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-go-lsp',
		diagnosticDelay: 900,
		capabilities: {},
		async initialize(options, context) {
			const config = (options || {}) as GoWorkerOptions;
			if (!config.compilerUrl) {
				throw new Error('Go language server requires a wasm-go compilerUrl');
			}
			target = config.target || target;
			context.reportProgress('load-go-compiler');
			compiler = await loadGoCompiler(config.compilerUrl);
		},
		async diagnostics(document, context: LspDocumentContext) {
			if (!compiler) return [];
			if (!document.text.trim()) return [];
			const key = `${target}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('go-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				target,
				prepare: true,
				log: false,
				onProgress(progress) {
					context.reportProgress(
						progress.stage || 'go-diagnostics',
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
						source: 'go',
						message: result.stderr || result.stdout || 'Go compilation failed'
					}
				];
			}
			return lastDiagnostics;
		}
	};
}
