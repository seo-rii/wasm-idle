import { getCSSLanguageService } from 'vscode-css-languageservice';
import { getLanguageService as getHtmlLanguageService } from 'vscode-html-languageservice';
import { getLanguageService as getJsonLanguageService } from 'vscode-json-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity, type Diagnostic, type TextEdit } from 'vscode-languageserver-types';
import MarkdownIt from 'markdown-it';
import { parse as parseToml } from 'smol-toml';
import { LineCounter, parseDocument as parseYamlDocument } from 'yaml';
import {
	fullDocumentRange,
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type LspRange,
	type WorkerLanguageService
} from '../lsp.js';

export type DocumentLanguageId = 'json' | 'yaml' | 'toml' | 'html' | 'css' | 'markdown';

export interface DocumentWorkerOptions {
	language?: DocumentLanguageId;
}

type MarkdownToken = {
	type: string;
	tag: string;
	map: [number, number] | null;
	content: string;
	markup: string;
	children: MarkdownToken[] | null;
	attrGet?: (name: string) => string | null;
};

const jsonLanguageService = getJsonLanguageService({});
const htmlLanguageService = getHtmlLanguageService();
const cssLanguageService = getCSSLanguageService();
const markdownLanguageService = new MarkdownIt({
	html: false,
	linkify: false,
	typographer: false
});

jsonLanguageService.configure({
	allowComments: false,
	validate: true,
	schemas: []
});

const documentFrom = (document: LspDocument) =>
	TextDocument.create(document.uri, document.languageId, document.version, document.text);

const normalizeDiagnosticSeverity = (severity: unknown): 1 | 2 | 3 | 4 => {
	switch (severity) {
		case DiagnosticSeverity.Error:
		case 1:
			return 1;
		case DiagnosticSeverity.Warning:
		case 2:
			return 2;
		case DiagnosticSeverity.Information:
		case 3:
			return 3;
		default:
			return 4;
	}
};

const diagnosticFrom = (diagnostic: Diagnostic, source: string): LspDiagnostic => ({
	range: diagnostic.range as LspRange,
	severity: normalizeDiagnosticSeverity(diagnostic.severity),
	code:
		typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
			? diagnostic.code
			: undefined,
	source: typeof diagnostic.source === 'string' ? diagnostic.source : source,
	message: String(diagnostic.message)
});

const completionItems = (labels: string[], detail: string) => ({
	isIncomplete: false,
	items: labels.map((label) => ({
		label,
		kind: 14,
		detail
	}))
});

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_-]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_-]*/u)?.[0] || '')
	);
};

const oneCharacterRange = (text: string, offset: number): LspRange => {
	const start = positionAt(text, offset);
	const end = positionAt(text, Math.min(text.length, offset + 1));
	return { start, end };
};

const yamlDiagnostics = (document: LspDocument): LspDiagnostic[] => {
	const lineCounter = new LineCounter();
	const parsed = parseYamlDocument(document.text, { lineCounter });
	return [...parsed.errors, ...parsed.warnings].map((error) => {
		const startLinePos = error.linePos?.[0];
		const endLinePos = error.linePos?.[1];
		const range =
			startLinePos && endLinePos
				? {
						start: {
							line: Math.max(0, startLinePos.line - 1),
							character: Math.max(0, startLinePos.col - 1)
						},
						end: {
							line: Math.max(0, endLinePos.line - 1),
							character: Math.max(0, endLinePos.col - 1)
						}
					}
				: oneCharacterRange(document.text, error.pos?.[0] || 0);
		return {
			range,
			severity: error.name === 'YAMLWarning' ? 2 : 1,
			code: error.code,
			source: 'yaml',
			message: error.message.split('\n')[0]
		};
	});
};

const tomlDiagnostics = (document: LspDocument): LspDiagnostic[] => {
	try {
		parseToml(document.text);
		return [];
	} catch (error) {
		const tomlError = error as Error & {
			line?: number;
			column?: number;
		};
		const line = Math.max(0, (tomlError.line || 1) - 1);
		const character = Math.max(0, (tomlError.column || 1) - 1);
		return [
			{
				range: {
					start: { line, character },
					end: { line, character: character + 1 }
				},
				severity: 1,
				source: 'toml',
				message: tomlError.message.split('\n')[0]
			}
		];
	}
};

const markdownSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/<[^>]+>/gu, '')
		.replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
		.replace(/\s+/gu, '-');

const markdownTokens = (document: LspDocument) =>
	markdownLanguageService.parse(document.text, {}) as MarkdownToken[];

const rangeFromMarkdownToken = (document: LspDocument, token: MarkdownToken): LspRange => {
	if (!token.map) return oneCharacterRange(document.text, 0);
	const lines = document.text.split('\n');
	const startLine = Math.max(0, token.map[0]);
	const endLine = Math.max(startLine, token.map[1] - 1);
	return {
		start: { line: startLine, character: 0 },
		end: { line: endLine, character: lines[endLine]?.length || 0 }
	};
};

const rangeFromMarkdownInlineToken = (
	document: LspDocument,
	parent: MarkdownToken,
	content: string
): LspRange => {
	if (!parent.map) return oneCharacterRange(document.text, 0);
	const lines = document.text.split('\n');
	const startLine = Math.max(0, parent.map[0]);
	const endLine = Math.max(startLine, parent.map[1] - 1);
	const startText = lines[startLine] || '';
	const startCharacter = Math.max(0, startText.indexOf(content));
	const endText = lines[endLine] || '';
	const endCharacter =
		startLine === endLine
			? Math.min(endText.length, startCharacter + content.length)
			: endText.length;
	return {
		start: { line: startLine, character: startCharacter },
		end: { line: endLine, character: endCharacter }
	};
};

const headingLevelFromToken = (token: MarkdownToken) => {
	const match = /^h([1-6])$/u.exec(token.tag);
	return match ? Number(match[1]) : 1;
};

const nextInlineToken = (tokens: MarkdownToken[], index: number) => {
	const next = tokens[index + 1];
	return next?.type === 'inline' ? next : null;
};

const decodeMarkdownAnchor = (value: string) => {
	const raw = value.replace(/^#+/u, '');
	try {
		return markdownSlug(decodeURIComponent(raw));
	} catch {
		return markdownSlug(raw);
	}
};

const markdownHeadings = (document: LspDocument, tokens = markdownTokens(document)) => {
	const headings: Array<{
		level: number;
		text: string;
		slug: string;
		range: LspRange;
	}> = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== 'heading_open') continue;
		const inline = nextInlineToken(tokens, index);
		const title = inline?.content.trim() || '';
		headings.push({
			level: headingLevelFromToken(token),
			text: title,
			slug: markdownSlug(title),
			range: rangeFromMarkdownToken(document, token)
		});
	}
	return headings;
};

const linkHrefFromToken = (token: MarkdownToken) => token.attrGet?.('href') || null;

const markdownDiagnostics = (document: LspDocument): LspDiagnostic[] => {
	const diagnostics: LspDiagnostic[] = [];
	const tokens = markdownTokens(document);
	const headingSlugs = new Set(markdownHeadings(document, tokens).map((heading) => heading.slug));

	for (const token of tokens) {
		if (token.type !== 'inline') continue;
		for (const child of token.children || []) {
			if (child.type !== 'link_open') continue;
			const href = linkHrefFromToken(child);
			if (!href?.startsWith('#')) continue;
			const slug = decodeMarkdownAnchor(href.slice(1));
			if (headingSlugs.has(slug)) continue;
			diagnostics.push({
				range: rangeFromMarkdownInlineToken(document, token, href),
				severity: 2,
				source: 'markdown',
				message: `No heading matches #${slug}.`
			});
		}
	}
	return diagnostics;
};

const markdownSymbols = (document: LspDocument) =>
	markdownHeadings(document).map((heading) => ({
		name: heading.text,
		kind: 13,
		range: heading.range,
		selectionRange: heading.range
	}));

const markdownHover = (document: LspDocument, position: LspPosition) => {
	const heading = markdownHeadings(document).find(
		(candidate) =>
			position.line >= candidate.range.start.line && position.line <= candidate.range.end.line
	);
	if (!heading) return null;
	return {
		contents: {
			kind: 'markdown',
			value: `Heading level ${heading.level}: \`${heading.text}\``
		}
	};
};

const jsonSymbols = (document: LspDocument) => {
	const textDocument = documentFrom(document);
	const jsonDocument = jsonLanguageService.parseJSONDocument(textDocument);
	return jsonLanguageService.findDocumentSymbols2(textDocument, jsonDocument);
};

const cssStylesheet = (document: LspDocument) => {
	const textDocument = documentFrom(document);
	return {
		textDocument,
		stylesheet: cssLanguageService.parseStylesheet(textDocument)
	};
};

const htmlDocument = (document: LspDocument) => {
	const textDocument = documentFrom(document);
	return {
		textDocument,
		htmlDocument: htmlLanguageService.parseHTMLDocument(textDocument)
	};
};

export function createDocumentWorkerService(): WorkerLanguageService {
	let language: DocumentLanguageId = 'json';

	return {
		name: 'wasm-idle-document-lsp',
		diagnosticDelay: 120,
		capabilities: {
			completionProvider: { triggerCharacters: ['"', ':', '<', '/', '#', '[', '.'] },
			hoverProvider: true,
			documentSymbolProvider: true,
			documentFormattingProvider: true
		},
		initialize(options, context) {
			const config = (options || {}) as DocumentWorkerOptions;
			language = config.language || 'json';
			context.reportProgress(`load-${language}-language-service`);
		},
		async diagnostics(document) {
			if (language === 'json') {
				const textDocument = documentFrom(document);
				const jsonDocument = jsonLanguageService.parseJSONDocument(textDocument);
				const diagnostics = await jsonLanguageService.doValidation(
					textDocument,
					jsonDocument
				);
				return diagnostics.map((diagnostic) => diagnosticFrom(diagnostic, 'json'));
			}
			if (language === 'css') {
				const { textDocument, stylesheet } = cssStylesheet(document);
				return cssLanguageService
					.doValidation(textDocument, stylesheet)
					.map((diagnostic) => diagnosticFrom(diagnostic, 'css'));
			}
			if (language === 'html') return [];
			if (language === 'yaml') return yamlDiagnostics(document);
			if (language === 'toml') return tomlDiagnostics(document);
			return markdownDiagnostics(document);
		},
		async completion(document, position) {
			if (language === 'json') {
				const textDocument = documentFrom(document);
				const jsonDocument = jsonLanguageService.parseJSONDocument(textDocument);
				return await jsonLanguageService.doComplete(textDocument, position, jsonDocument);
			}
			if (language === 'css') {
				const { textDocument, stylesheet } = cssStylesheet(document);
				return cssLanguageService.doComplete(textDocument, position, stylesheet);
			}
			if (language === 'html') {
				const { textDocument, htmlDocument: parsed } = htmlDocument(document);
				return htmlLanguageService.doComplete(textDocument, position, parsed);
			}
			if (language === 'markdown') {
				return completionItems(['# ', '## ', '[]()', '```'], 'Markdown snippet');
			}
			return completionItems(['true', 'false', 'null'], `${language.toUpperCase()} literal`);
		},
		async hover(document, position) {
			if (language === 'json') {
				const textDocument = documentFrom(document);
				const jsonDocument = jsonLanguageService.parseJSONDocument(textDocument);
				return await jsonLanguageService.doHover(textDocument, position, jsonDocument);
			}
			if (language === 'css') {
				const { textDocument, stylesheet } = cssStylesheet(document);
				return cssLanguageService.doHover(textDocument, position, stylesheet);
			}
			if (language === 'html') {
				const { textDocument, htmlDocument: parsed } = htmlDocument(document);
				return htmlLanguageService.doHover(textDocument, position, parsed);
			}
			if (language === 'markdown') return markdownHover(document, position);
			const word = wordAt(document.text, position);
			if (!word) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\` in ${language.toUpperCase()}`
				}
			};
		},
		documentSymbols(document) {
			if (language === 'json') return jsonSymbols(document);
			if (language === 'css') {
				const { textDocument, stylesheet } = cssStylesheet(document);
				return cssLanguageService.findDocumentSymbols2(textDocument, stylesheet);
			}
			if (language === 'html') {
				const { textDocument, htmlDocument: parsed } = htmlDocument(document);
				return htmlLanguageService.findDocumentSymbols2(textDocument, parsed);
			}
			if (language === 'markdown') return markdownSymbols(document);
			return [];
		},
		formatting(document, options) {
			const tabSize = Number(options.tabSize || 2);
			const insertSpaces = options.insertSpaces !== false;
			if (language === 'json') {
				return jsonLanguageService.format(documentFrom(document), undefined, {
					tabSize,
					insertSpaces
				}) as TextEdit[];
			}
			if (language === 'css') {
				return cssLanguageService.format(documentFrom(document), undefined, {
					tabSize,
					insertSpaces
				}) as TextEdit[];
			}
			if (language === 'html') {
				return htmlLanguageService.format(documentFrom(document), undefined, {
					tabSize,
					insertSpaces
				}) as TextEdit[];
			}
			if (language === 'yaml' || language === 'toml') {
				return [];
			}
			const text = document.text.replace(/[ \t]+$/gmu, '');
			return text === document.text
				? []
				: [
						{
							range: fullDocumentRange(document.text),
							newText: text
						}
					];
		}
	};
}
