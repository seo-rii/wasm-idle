import { getCSSLanguageService } from 'vscode-css-languageservice';
import { getLanguageService as getHtmlLanguageService } from 'vscode-html-languageservice';
import { getLanguageService as getJsonLanguageService } from 'vscode-json-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity, type Diagnostic, type TextEdit } from 'vscode-languageserver-types';
import MarkdownIt from 'markdown-it';
import { parse as parseToml } from 'smol-toml';
import { LineCounter, parseAllDocuments } from 'yaml';
import {
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
	meta?: { label?: string } | null;
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
// Keep the parser's hidden definition tokens so diagnostics can point to a reference destination.
markdownLanguageService.core.ruler.disable('strip_references', true);

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
	const documents = parseAllDocuments(document.text, { lineCounter });
	const diagnostics =
		'empty' in documents
			? [...documents.errors, ...documents.warnings]
			: documents.flatMap((parsed) => [...parsed.errors, ...parsed.warnings]);
	return diagnostics.map((error) => {
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
		.replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, '')
		.replace(/\s+/gu, '-');

const markdownTokens = (document: LspDocument) =>
	markdownLanguageService.parse(document.text, {}) as MarkdownToken[];

const rangeFromMarkdownToken = (document: LspDocument, token: MarkdownToken): LspRange => {
	if (!token.map) return oneCharacterRange(document.text, 0);
	const lines = document.text.split(/\r\n|[\r\n]/u);
	const startLine = Math.max(0, token.map[0]);
	const endLine = Math.max(startLine, token.map[1] - 1);
	return {
		start: { line: startLine, character: 0 },
		end: { line: endLine, character: lines[endLine]?.length || 0 }
	};
};

function markdownLinkRange(doc: TextDocument, block: MarkdownToken, href: string, from: number) {
	const start = doc.offsetAt({ line: block.map![0], character: 0 });
	const end = doc.offsetAt({ line: block.map![1], character: 0 });
	const source = doc.getText().slice(start, end);
	const prefixes = block.type === 'reference_definition' ? /\]:\s*/gu : /\]\(\s*/gu;
	prefixes.lastIndex = Math.max(0, from - start);
	while (prefixes.exec(source)) {
		const at = prefixes.lastIndex;
		const parsed = markdownLanguageService.helpers.parseLinkDestination(
			source,
			at,
			source.length
		);
		if (!parsed.ok || markdownLanguageService.normalizeLink(parsed.str) !== href) continue;
		const brackets = source[at] === '<' ? 1 : 0;
		return {
			start: doc.positionAt(start + at + brackets),
			end: doc.positionAt(start + parsed.pos - brackets)
		};
	}
}

function markdownCodeSpanEnd(source: string, from: number, end: number, token: MarkdownToken) {
	const delimiters = /`+/gu;
	delimiters.lastIndex = from;
	let contentStart: number | undefined;
	for (const run of source.matchAll(delimiters)) {
		if (run.index >= end) break;
		if (run[0] !== token.markup) continue;
		if (contentStart !== undefined) {
			// CommonMark normalizes line endings and may trim one space from each side of a code span.
			const content = source.slice(contentStart, run.index).replace(/\r\n|[\r\n]/gu, ' ');
			if (content === token.content || content === ` ${token.content} `)
				return run.index + run[0].length;
		}
		contentStart = run.index + run[0].length;
	}
	return from;
}

const headingLevelFromToken = (token: MarkdownToken) => {
	const match = /^h([1-6])$/u.exec(token.tag);
	return match ? Number(match[1]) : 1;
};

const nextInlineToken = (tokens: MarkdownToken[], index: number) => {
	const next = tokens[index + 1];
	return next?.type === 'inline' ? next : null;
};

const decodeMarkdownAnchor = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const markdownInlineText = (tokens: MarkdownToken[]): string =>
	tokens
		.map((token) => {
			if (token.children) return markdownInlineText(token.children);
			if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
			return token.type === 'text' || token.type === 'code_inline' ? token.content : '';
		})
		.join('');

const markdownHeadings = (document: LspDocument, tokens = markdownTokens(document)) => {
	const headings: Array<{
		level: number;
		text: string;
		slug: string;
		range: LspRange;
	}> = [];
	const used = new Set<string>();
	const nextSuffix = new Map<string, number>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== 'heading_open') continue;
		const inline = nextInlineToken(tokens, index);
		const title = inline?.content.trim() || '';
		const base = markdownSlug(markdownInlineText(inline?.children ?? []));
		let slug = base;
		let suffix = nextSuffix.get(base) ?? 1;
		while (used.has(slug)) slug = base + '-' + suffix++;
		used.add(slug);
		nextSuffix.set(base, suffix);
		headings.push({
			level: headingLevelFromToken(token),
			text: title,
			slug,
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
	const doc = documentFrom(document);
	const definitions = new Map<string, MarkdownToken>();
	for (const token of tokens) {
		const label = token.meta?.label;
		if (token.type === 'reference_definition' && token.map && label && !definitions.has(label))
			definitions.set(label, token);
	}

	for (const token of tokens) {
		if (token.type !== 'inline' || !token.map) continue;
		let from = doc.offsetAt({ line: token.map[0], character: 0 });
		const end = doc.offsetAt({ line: token.map[1], character: 0 });
		let openLink: MarkdownToken | undefined;
		for (const child of token.children || []) {
			if (child.type === 'code_inline') {
				from = markdownCodeSpanEnd(document.text, from, end, child);
				continue;
			}
			if (child.type === 'link_open') {
				openLink = child;
				continue;
			}
			// The source destination follows its label, including any inline code in it.
			if (child.type !== 'link_close' || !openLink) continue;
			const link = openLink;
			openLink = undefined;
			const href = linkHrefFromToken(link);
			if (!href?.startsWith('#')) continue;
			const slug = decodeMarkdownAnchor(href.slice(1));
			if (headingSlugs.has(slug)) continue;
			const definition = link.meta?.label && definitions.get(link.meta.label);
			const range = markdownLinkRange(doc, definition || token, href, definition ? 0 : from);
			if (range && !definition) from = doc.offsetAt(range.end);
			diagnostics.push({
				range: range ?? { start: doc.positionAt(from), end: doc.positionAt(from + 1) },
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
			const literals = language === 'toml' ? ['true', 'false'] : ['true', 'false', 'null'];
			return completionItems(literals, `${language.toUpperCase()} literal`);
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
			const doc = documentFrom(document);
			const codeLines = new Set<number>();
			for (const token of markdownTokens(document)) {
				if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
					for (let line = token.map[0]; line < token.map[1]; line++) codeLines.add(line);
				}
			}
			const text = document.text.replace(/[^\r\n]+/gu, (line, offset: number) => {
				if (
					codeLines.has(doc.positionAt(offset).line) ||
					(line.endsWith('  ') && line.trim())
				)
					return line;
				return line.replace(/[ \t]+$/u, '');
			});
			if (
				text === document.text ||
				markdownLanguageService.render(text) !==
					markdownLanguageService.render(document.text)
			)
				return [];
			return [
				{
					range: {
						start: { line: 0, character: 0 },
						end: doc.positionAt(document.text.length)
					},
					newText: text
				}
			];
		}
	};
}
