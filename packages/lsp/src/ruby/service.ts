import { File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';
import { RubyVM, consolePrinter } from '@ruby/wasm-wasi';
import {
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface RubyWorkerOptions {
	wasmUrl?: string;
}

export interface RubySyntaxDiagnostic {
	message: string;
	lineNumber?: number;
	columnNumber?: number;
	severity?: 'error' | 'warning' | 'info';
}

export interface RubySyntaxChecker {
	check(code: string, fileName: string): Promise<RubySyntaxDiagnostic[]> | RubySyntaxDiagnostic[];
	dispose?: () => void | Promise<void>;
}

export type LoadRubySyntaxChecker = (options: RubyWorkerOptions) => Promise<RubySyntaxChecker>;

const RUBY_KEYWORDS = [
	'BEGIN',
	'END',
	'alias',
	'and',
	'begin',
	'break',
	'case',
	'class',
	'def',
	'defined?',
	'do',
	'else',
	'elsif',
	'end',
	'ensure',
	'false',
	'for',
	'if',
	'in',
	'module',
	'next',
	'nil',
	'not',
	'or',
	'redo',
	'rescue',
	'retry',
	'return',
	'self',
	'super',
	'then',
	'true',
	'undef',
	'unless',
	'until',
	'when',
	'while',
	'yield'
] as const;

const RUBY_HOVER: Record<string, string> = {
	class: 'Defines a Ruby class.',
	module: 'Defines a Ruby module.',
	def: 'Defines a method.',
	begin: 'Starts a block that can handle exceptions.',
	rescue: 'Handles an exception raised in a begin block.',
	ensure: 'Runs cleanup code after begin/rescue.',
	yield: 'Calls the block passed to the current method.',
	self: 'The current receiver.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_!?=]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_!?=]*/u)?.[0] || '')
	);
};

async function loadRubyWasmChecker(options: RubyWorkerOptions): Promise<RubySyntaxChecker> {
	if (!options.wasmUrl) {
		throw new Error('Ruby language server requires a ruby.wasm URL');
	}
	const response = await fetch(options.wasmUrl);
	if (!response.ok) {
		throw new Error(`Failed to load Ruby WASM asset: ${response.status} ${response.statusText}`);
	}
	const module = await WebAssembly.compile(await response.arrayBuffer());

	return {
		async check(code, fileName) {
			let stderr = '';
			const printer = consolePrinter({
				stdout() {},
				stderr(output) {
					stderr += output;
				}
			});
			const wasi = new WASI(
				['ruby.wasm'],
				[],
				[new OpenFile(new File([])), new OpenFile(new File([])), new OpenFile(new File([]))],
				{ debug: false }
			);
			const { vm } = await RubyVM.instantiateModule({
				module,
				wasip1: wasi,
				args: ['ruby.wasm', '-EUTF-8', '-e_=0'],
				addToImports(imports) {
					printer.addToImports(imports);
				},
				setMemory(memory) {
					printer.setMemory(memory);
				}
			});
			try {
				vm.eval(
					`RubyVM::InstructionSequence.compile(${JSON.stringify(code)}, ${JSON.stringify(
						fileName
					)}, ${JSON.stringify(fileName)}, 1)`
				);
				return [];
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const location = message.match(/:(\d+):(?:(\d+):)?/u);
				return [
					{
						lineNumber: Number(location?.[1] || 1),
						columnNumber: Number(location?.[2] || 1),
						severity: 'error',
						message: message || stderr || 'Ruby syntax error'
					}
				];
			}
		}
	};
}

const diagnosticFor = (diagnostic: RubySyntaxDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: diagnostic.severity === 'warning' ? 2 : diagnostic.severity === 'info' ? 3 : 1,
		source: 'ruby',
		message: diagnostic.message
	};
};

export function createRubyWorkerService(
	loadChecker: LoadRubySyntaxChecker = loadRubyWasmChecker
): WorkerLanguageService {
	let checker: RubySyntaxChecker | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-ruby-lsp',
		diagnosticDelay: 300,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ':', '@'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as RubyWorkerOptions;
			context.reportProgress('load-ruby-runtime');
			checker = await loadChecker(config);
		},
		async diagnostics(document: LspDocument) {
			if (!checker || !document.text.trim()) return [];
			const fileName = document.uri.split('/').pop() || 'main.rb';
			const key = `${fileName}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			lastKey = key;
			const diagnostics = await checker.check(document.text, fileName);
			lastDiagnostics = diagnostics.map(diagnosticFor);
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: RUBY_KEYWORDS.map((label) => ({
					label,
					kind: 14,
					detail: RUBY_HOVER[label] || 'Ruby keyword'
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = RUBY_HOVER[word];
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
			const pattern = /^\s*(class|module|def)\s+([A-Za-z_][A-Za-z0-9_:!?=]*)/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const offset = match.index || 0;
				const before = document.text.slice(0, offset);
				const line = before.split('\n').length - 1;
				const character = offset - before.lastIndexOf('\n') - 1;
				symbols.push({
					name: match[2],
					kind: match[1] === 'def' ? 12 : 5,
					range: {
						start: { line, character },
						end: { line, character: character + match[0].length }
					},
					selectionRange: {
						start: { line, character: character + match[0].indexOf(match[2]) },
						end: { line, character: character + match[0].indexOf(match[2]) + match[2].length }
					}
				});
			}
			return symbols;
		},
		async dispose() {
			await checker?.dispose?.();
			checker = null;
		}
	};
}
