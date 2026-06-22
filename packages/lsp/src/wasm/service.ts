import {
	fullDocumentRange,
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

const WASM_COMPLETIONS = [
	{
		label: 'base64:',
		detail: 'WebAssembly binary encoded as base64'
	},
	{
		label: 'wasm:',
		detail: 'WebAssembly binary encoded as base64'
	},
	{
		label: 'data:application/wasm;base64,',
		detail: 'WebAssembly data URL'
	},
	{
		label: '0x',
		detail: 'WebAssembly binary encoded as hexadecimal bytes'
	}
] as const;

const WASM_HOVER: Record<string, string> = {
	base64: 'Decodes the rest of the document as a base64 WebAssembly binary.',
	wasm: 'Decodes the rest of the document as a base64 WebAssembly binary.',
	data: 'A `data:application/wasm;base64,...` URL can hold a WebAssembly binary.',
	'0x': 'Hexadecimal WebAssembly bytes. Valid modules start with `0x0061736d`.'
};

function decodeBase64(value: string) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeHex(value: string) {
	const normalized = value.replace(/^0x/iu, '').replace(/\s+/gu, '');
	const bytes = new Uint8Array(normalized.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

export function decodeWasmSource(source: string) {
	const withoutComments = source
		.split(/\r?\n/u)
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')
		.trim();
	const dataUrlMatch = /^data:[^,]*,\s*([\s\S]+)$/iu.exec(withoutComments);
	const prefixedBase64 = /^(?:base64|wasm):\s*([\s\S]+)$/iu.exec(withoutComments);
	const candidate = (dataUrlMatch?.[1] || prefixedBase64?.[1] || withoutComments).replace(
		/\s+/gu,
		''
	);
	let bytes: Uint8Array;
	try {
		bytes =
			/^(?:0x)?[0-9a-f]+$/iu.test(candidate) &&
			candidate.replace(/^0x/iu, '').length % 2 === 0
				? decodeHex(candidate)
				: decodeBase64(candidate);
	} catch {
		throw new Error('WASM source must decode to a WebAssembly binary');
	}
	if (
		bytes.length < 4 ||
		bytes[0] !== 0x00 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error('WASM source must decode to a WebAssembly binary');
	}
	return bytes;
}

const diagnosticFromError = (error: unknown): LspDiagnostic => ({
	range: {
		start: { line: 0, character: 0 },
		end: { line: 0, character: 1 }
	},
	severity: 1,
	source: 'webassembly',
	message: error instanceof Error ? error.message : String(error)
});

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	const prefixMatch = line.slice(Math.max(0, character - 2), character + 2).match(/0x/u);
	if (prefixMatch) return '0x';
	return (
		(line.slice(0, character).match(/[A-Za-z0-9]+$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9]+/u)?.[0] || '')
	);
};

const symbolKindFor = (kind: string) => {
	switch (kind) {
		case 'function':
			return 12;
		case 'global':
			return 13;
		case 'memory':
		case 'table':
			return 7;
		default:
			return 19;
	}
};

async function compileModule(source: string) {
	const bytes = decodeWasmSource(source);
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return await WebAssembly.compile(buffer);
}

export function createWasmWorkerService(): WorkerLanguageService {
	let lastDiagnosticKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];
	let lastModuleKey = '';
	let lastModule: WebAssembly.Module | null = null;

	return {
		name: 'wasm-idle-wasm-lsp',
		diagnosticDelay: 150,
		capabilities: {
			completionProvider: { triggerCharacters: [':', ','] },
			hoverProvider: true,
			documentSymbolProvider: true,
			documentFormattingProvider: true
		},
		initialize(_options, context) {
			context.reportProgress('load-webassembly-runtime');
		},
		async diagnostics(document) {
			if (!document.text.trim()) return [];
			if (document.text === lastDiagnosticKey) return lastDiagnostics;
			lastDiagnosticKey = document.text;
			try {
				lastModule = await compileModule(document.text);
				lastModuleKey = document.text;
				lastDiagnostics = [];
			} catch (error) {
				lastModule = null;
				lastModuleKey = '';
				lastDiagnostics = [diagnosticFromError(error)];
			}
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: WASM_COMPLETIONS.map((item) => ({
					label: item.label,
					kind: item.label === '0x' ? 15 : 14,
					detail: item.detail
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position).toLowerCase();
			const description = WASM_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		async documentSymbols(document) {
			let module = lastModuleKey === document.text ? lastModule : null;
			if (!module) {
				module = await compileModule(document.text);
				lastModule = module;
				lastModuleKey = document.text;
			}
			const range = fullDocumentRange(document.text);
			const selectionRange = {
				start: range.start,
				end: positionAt(document.text, Math.min(document.text.length, 1))
			};
			return [
				...WebAssembly.Module.exports(module).map((entry) => ({
					name: `export ${entry.name}`,
					kind: symbolKindFor(entry.kind),
					range,
					selectionRange
				})),
				...WebAssembly.Module.imports(module).map((entry) => ({
					name: `import ${entry.module}.${entry.name}`,
					kind: symbolKindFor(entry.kind),
					range,
					selectionRange
				}))
			];
		},
		formatting(document) {
			const trimmed = document.text
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter(Boolean)
				.join('\n');
			return trimmed === document.text
				? []
				: [{ range: fullDocumentRange(document.text), newText: trimmed }];
		}
	};
}
