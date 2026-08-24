import {
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import {
	RUBY_MAX_ASSET_BYTES,
	RUBY_MAX_LOGICAL_BYTES,
	RUBY_MAX_MANIFEST_BYTES,
	RUBY_MAX_MODULE_BYTES,
	requireRubyRuntimePreflightPayload,
	rewriteVerifiedRubyRuntimeModule,
	verifyRubyRuntimePreflightPayload,
	type RubyRuntimePreflightPayload
} from '@wasm-idle/core';

export interface RubyWorkerOptions {
	readonly runtimePreflight: RubyRuntimePreflightPayload;
}

interface RubyVirtualMachine {
	eval(code: string): unknown;
}

interface RubyWasi {
	wasiImport: WebAssembly.ModuleImports;
	initialize(instance: WebAssembly.Instance): void;
}

interface RubyRuntimeModule {
	RubyVM?: {
		instantiateModule(options: {
			module: WebAssembly.Module;
			wasip1: RubyWasi;
			args: string[];
			addToImports(imports: WebAssembly.Imports): void;
			setMemory(memory: WebAssembly.Memory): void;
		}): Promise<{ vm: RubyVirtualMachine }>;
	};
	consolePrinter?: (options: { stdout(output: string): void; stderr(output: string): void }) => {
		addToImports(imports: WebAssembly.Imports): void;
		setMemory(memory: WebAssembly.Memory): void;
	};
	wasiShim?: {
		File: new (data: Array<number> | Uint8Array) => unknown;
		OpenFile: new (file: unknown) => unknown;
		WASI: new (
			args: string[],
			env: string[],
			fds: unknown[],
			options?: { debug?: boolean }
		) => RubyWasi;
	};
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

const RUBY_CONFIG_KEYS = ['runtimePreflight'] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const isOwnedUint8Array = (value: unknown): value is Uint8Array<ArrayBuffer> =>
	ArrayBuffer.isView(value) &&
	Object.prototype.toString.call(value) === '[object Uint8Array]' &&
	value.buffer instanceof ArrayBuffer &&
	value.byteOffset === 0 &&
	value.byteLength === value.buffer.byteLength;

const snapshotRubyWorkerOptions = (value: unknown): RubyWorkerOptions => {
	if (
		!isPlainRecord(value) ||
		Object.keys(value).sort().join('\n') !== RUBY_CONFIG_KEYS.join('\n')
	) {
		throw new TypeError(
			'Ruby language server requires an exact verified runtime configuration'
		);
	}
	const payload = requireRubyRuntimePreflightPayload(value.runtimePreflight);
	const buffers = [payload.manifestBytes, payload.moduleJavaScriptBytes, payload.wasmBytes];
	if (buffers.some((bytes) => !isOwnedUint8Array(bytes))) {
		throw new TypeError('Ruby language server requires owned runtime preflight bytes');
	}
	if (new Set(buffers.map((bytes) => bytes.buffer)).size !== buffers.length) {
		throw new TypeError('Ruby language server requires unique owned preflight buffers');
	}
	if (
		payload.manifestBytes.byteLength <= 0 ||
		payload.manifestBytes.byteLength > RUBY_MAX_MANIFEST_BYTES
	) {
		throw new TypeError('Ruby language server manifest exceeds the manifest limit');
	}
	if (
		payload.moduleJavaScriptBytes.byteLength <= 0 ||
		payload.moduleJavaScriptBytes.byteLength > RUBY_MAX_MODULE_BYTES
	) {
		throw new TypeError('Ruby language server module exceeds the module limit');
	}
	if (payload.wasmBytes.byteLength <= 0 || payload.wasmBytes.byteLength > RUBY_MAX_ASSET_BYTES) {
		throw new TypeError('Ruby language server Wasm exceeds the asset limit');
	}
	const logicalBytes = payload.moduleJavaScriptBytes.byteLength + payload.wasmBytes.byteLength;
	if (!Number.isSafeInteger(logicalBytes) || logicalBytes > RUBY_MAX_LOGICAL_BYTES) {
		throw new TypeError('Ruby language server payload exceeds the logical aggregate limit');
	}
	return Object.freeze({ runtimePreflight: payload });
};

const verifyRubyWorkerAssets = async (options: RubyWorkerOptions) => {
	await verifyRubyRuntimePreflightPayload(options.runtimePreflight);
};

async function loadRubyWasmChecker(options: RubyWorkerOptions): Promise<RubySyntaxChecker> {
	const payload = options.runtimePreflight;
	const moduleSource = rewriteVerifiedRubyRuntimeModule(payload);
	const module = await WebAssembly.compile(payload.wasmBytes as Uint8Array<ArrayBuffer>);
	if (
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof Blob !== 'function'
	) {
		throw new Error('Ruby language server requires Blob module URL support');
	}
	const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
	let runtime: RubyRuntimeModule;
	try {
		runtime = (await import(/* @vite-ignore */ moduleUrl)) as RubyRuntimeModule;
	} finally {
		try {
			URL.revokeObjectURL(moduleUrl);
		} catch {
			// Cleanup must not replace module import success or failure.
		}
	}
	if (!runtime.RubyVM || !runtime.consolePrinter || !runtime.wasiShim) {
		throw new Error('Ruby runtime module is missing required Ruby or WASI exports');
	}
	const { RubyVM, consolePrinter, wasiShim } = runtime;
	const { File: WasiFile, OpenFile, WASI } = wasiShim;

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
				[
					new OpenFile(new WasiFile([])),
					new OpenFile(new WasiFile([])),
					new OpenFile(new WasiFile([]))
				],
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
	let checkerGeneration = 0;
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
			const config = snapshotRubyWorkerOptions(options);
			context.reportProgress('load-ruby-runtime');
			await verifyRubyWorkerAssets(config);
			const nextChecker = await loadChecker(config);
			const previousChecker = checker;
			checker = nextChecker;
			checkerGeneration += 1;
			lastKey = '';
			lastDiagnostics = [];
			if (previousChecker && previousChecker !== nextChecker) {
				try {
					await previousChecker.dispose?.();
				} catch {
					// A retired checker cannot invalidate the successfully prepared replacement.
				}
			}
		},
		async diagnostics(document: LspDocument) {
			const activeChecker = checker;
			if (!activeChecker || !document.text.trim()) return [];
			const generation = checkerGeneration;
			const fileName = document.uri.split('/').pop() || 'main.rb';
			const key = `${fileName}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			const diagnostics = (await activeChecker.check(document.text, fileName)).map(
				diagnosticFor
			);
			if (checker === activeChecker && checkerGeneration === generation) {
				lastKey = key;
				lastDiagnostics = diagnostics;
			}
			return diagnostics;
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
						end: {
							line,
							character: character + match[0].indexOf(match[2]) + match[2].length
						}
					}
				});
			}
			return symbols;
		},
		async dispose() {
			const previousChecker = checker;
			checker = null;
			checkerGeneration += 1;
			lastKey = '';
			lastDiagnostics = [];
			await previousChecker?.dispose?.();
		}
	};
}
