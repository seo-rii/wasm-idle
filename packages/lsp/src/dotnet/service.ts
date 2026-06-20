import type { LspDiagnostic, LspDocument, WorkerLanguageService } from '../lsp.js';

export type DotnetLanguage = 'csharp' | 'fsharp' | 'vbnet';

export interface DotnetWorkerOptions {
	language: DotnetLanguage;
	moduleUrl: string;
	debug?: boolean;
}

interface DotnetDiagnostic {
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface DotnetCompilerResult {
	success: boolean;
	stderr?: string;
	diagnostics?: DotnetDiagnostic[];
}

interface DotnetCompiler {
	compile(request: {
		code: string;
		language: DotnetLanguage;
		target: 'browser-wasm';
		prepare?: boolean;
		log?: boolean;
		onProgress?: (progress: { stage?: string; completed?: number; total?: number }) => void;
	}): Promise<DotnetCompilerResult>;
}

interface DotnetRuntimeModule {
	createDotnetCompiler(options?: { loadReferences?: boolean }): DotnetCompiler;
}

type LoadDotnetModule = (moduleUrl: string) => Promise<DotnetRuntimeModule>;

const CSHARP_KEYWORDS = [
	'abstract',
	'as',
	'async',
	'await',
	'base',
	'bool',
	'break',
	'case',
	'catch',
	'char',
	'class',
	'const',
	'continue',
	'decimal',
	'default',
	'delegate',
	'do',
	'double',
	'else',
	'enum',
	'event',
	'explicit',
	'extern',
	'false',
	'finally',
	'fixed',
	'float',
	'for',
	'foreach',
	'get',
	'global',
	'goto',
	'if',
	'implicit',
	'in',
	'int',
	'interface',
	'internal',
	'is',
	'lock',
	'long',
	'namespace',
	'new',
	'null',
	'object',
	'operator',
	'out',
	'override',
	'params',
	'partial',
	'private',
	'protected',
	'public',
	'readonly',
	'record',
	'ref',
	'required',
	'return',
	'sbyte',
	'sealed',
	'set',
	'short',
	'sizeof',
	'stackalloc',
	'static',
	'string',
	'struct',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'typeof',
	'uint',
	'ulong',
	'unchecked',
	'unsafe',
	'ushort',
	'using',
	'value',
	'var',
	'virtual',
	'void',
	'volatile',
	'while',
	'with',
	'yield'
] as const;

const VB_KEYWORDS = [
	'AddHandler',
	'AddressOf',
	'And',
	'AndAlso',
	'As',
	'Async',
	'Await',
	'Boolean',
	'ByRef',
	'ByVal',
	'Call',
	'Case',
	'Catch',
	'Class',
	'Const',
	'Continue',
	'Decimal',
	'Delegate',
	'Dim',
	'Do',
	'Double',
	'Each',
	'Else',
	'ElseIf',
	'End',
	'Enum',
	'Event',
	'Exit',
	'False',
	'Finally',
	'For',
	'Friend',
	'Function',
	'Get',
	'Handles',
	'If',
	'Implements',
	'Imports',
	'In',
	'Inherits',
	'Integer',
	'Interface',
	'Is',
	'IsNot',
	'Long',
	'Loop',
	'Me',
	'Module',
	'MustInherit',
	'MustOverride',
	'Namespace',
	'New',
	'Next',
	'Not',
	'Nothing',
	'Object',
	'Of',
	'On',
	'Operator',
	'Option',
	'Or',
	'OrElse',
	'Overloads',
	'Overrides',
	'Partial',
	'Private',
	'Property',
	'Protected',
	'Public',
	'RaiseEvent',
	'ReadOnly',
	'ReDim',
	'RemoveHandler',
	'Resume',
	'Return',
	'Select',
	'Set',
	'Shared',
	'Short',
	'Single',
	'Static',
	'Step',
	'Stop',
	'String',
	'Structure',
	'Sub',
	'SyncLock',
	'Then',
	'Throw',
	'To',
	'True',
	'Try',
	'Using',
	'When',
	'While',
	'With',
	'WriteOnly',
	'Xor'
] as const;

const FSHARP_KEYWORDS = [
	'abstract',
	'and',
	'as',
	'assert',
	'base',
	'begin',
	'class',
	'default',
	'delegate',
	'do',
	'done',
	'downcast',
	'downto',
	'elif',
	'else',
	'end',
	'exception',
	'extern',
	'false',
	'finally',
	'for',
	'fun',
	'function',
	'if',
	'in',
	'inherit',
	'inline',
	'interface',
	'internal',
	'lazy',
	'let',
	'match',
	'member',
	'module',
	'mutable',
	'namespace',
	'new',
	'null',
	'of',
	'open',
	'or',
	'override',
	'private',
	'public',
	'rec',
	'return',
	'static',
	'struct',
	'then',
	'to',
	'true',
	'try',
	'type',
	'upcast',
	'use',
	'val',
	'void',
	'when',
	'while',
	'with',
	'yield'
] as const;

const loadDotnetModule: LoadDotnetModule = async (moduleUrl) =>
	(await import(/* @vite-ignore */ moduleUrl)) as DotnetRuntimeModule;

export function createDotnetWorkerService(
	defaultLanguage: DotnetLanguage,
	loadModule: LoadDotnetModule = loadDotnetModule
): WorkerLanguageService {
	let language = defaultLanguage;
	let compiler: DotnetCompiler;
	let debug = false;
	let reportProgress: (stage: string, loaded?: number, total?: number) => void = () => {};

	const diagnosticSource = () =>
		language === 'csharp' ? 'roslyn-csharp' : language === 'fsharp' ? 'fsharp' : 'roslyn-vb';
	const serverName = () =>
		defaultLanguage === 'csharp'
			? 'wasm-idle-csharp-lsp'
			: defaultLanguage === 'fsharp'
				? 'wasm-idle-fsharp-lsp'
				: 'wasm-idle-visual-basic-lsp';
	const completionKeywords = () =>
		language === 'csharp'
			? CSHARP_KEYWORDS
			: language === 'fsharp'
				? FSHARP_KEYWORDS
				: VB_KEYWORDS;

	const convertDiagnostic = (diagnostic: DotnetDiagnostic): LspDiagnostic => {
		const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
		const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
		const endCharacter = Math.max(
			character + 1,
			Number(diagnostic.endColumnNumber || character + 2) - 1
		);
		return {
			range: {
				start: { line, character },
				end: { line, character: endCharacter }
			},
			severity:
				diagnostic.severity === 'warning' ? 2 : diagnostic.severity === 'other' ? 3 : 1,
			source: diagnosticSource(),
			message: String(diagnostic.message || 'Compilation error')
		};
	};

	return {
		name: serverName(),
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ' '] }
		},
		async initialize(options, context) {
			const config = options as DotnetWorkerOptions;
			language = config.language || defaultLanguage;
			debug = config.debug === true;
			reportProgress = context.reportProgress;
			reportProgress('load-dotnet-runtime');
			if (debug) {
				console.debug(
					`[wasm-idle:dotnet-lsp] initialize language=${language} moduleUrl=${config.moduleUrl}`
				);
			}
			const module = await loadModule(config.moduleUrl);
			if (typeof module.createDotnetCompiler !== 'function') {
				throw new Error('wasm-dotnet module must export createDotnetCompiler');
			}
			compiler = module.createDotnetCompiler();
			if (debug) console.debug('[wasm-idle:dotnet-lsp] compiler ready');
		},
		async diagnostics(document: LspDocument) {
			if (debug) {
				console.debug(
					`[wasm-idle:dotnet-lsp] compile start language=${language} uri=${document.uri} bytes=${document.text.length}`
				);
			}
			const result = await compiler.compile({
				code: document.text,
				language,
				target: 'browser-wasm',
				prepare: true,
				log: debug,
				onProgress(progress) {
					if (debug) {
						console.debug(
							`[wasm-idle:dotnet-lsp] compile progress stage=${progress.stage || 'compile'} completed=${progress.completed ?? ''} total=${progress.total ?? ''}`
						);
					}
					reportProgress(progress.stage || 'compile', progress.completed, progress.total);
				}
			});
			const diagnostics = (result.diagnostics || []).map(convertDiagnostic);
			if (!result.success && diagnostics.length === 0 && result.stderr) {
				diagnostics.push({
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 }
					},
					severity: 1,
					source: diagnosticSource(),
					message: result.stderr
				});
			}
			if (debug) {
				console.debug(
					`[wasm-idle:dotnet-lsp] compile done success=${String(result.success)} diagnostics=${diagnostics.length} stderr=${result.stderr ? result.stderr.slice(0, 160) : ''}`
				);
			}
			return diagnostics;
		},
		completion() {
			const keywords = completionKeywords();
			return {
				isIncomplete: false,
				items: keywords.map((keyword) => ({
					label: keyword,
					kind: 14
				}))
			};
		}
	};
}
