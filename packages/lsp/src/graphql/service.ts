import { buildSchema, GraphQLError, parse, Source, validate, type GraphQLSchema } from 'graphql';
import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface GraphqlWorkerOptions {
	schema?: string;
}

const GRAPHQL_KEYWORDS = [
	'query',
	'mutation',
	'subscription',
	'fragment',
	'on',
	'schema',
	'type',
	'interface',
	'union',
	'enum',
	'input',
	'extend',
	'directive',
	'scalar',
	'implements'
] as const;

const GRAPHQL_HOVER: Record<string, string> = {
	query: 'Defines a read operation.',
	mutation: 'Defines a write operation.',
	subscription: 'Defines an event stream operation.',
	fragment: 'Defines a reusable selection set.',
	type: 'Defines an object type in a GraphQL schema.',
	interface: 'Defines fields implemented by object types.',
	union: 'Defines a type that can resolve to one of several object types.',
	input: 'Defines an input object type.',
	directive: 'Defines metadata that can modify execution or validation.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

const diagnosticFor = (error: GraphQLError): LspDiagnostic => {
	const location = error.locations?.[0];
	const line = Math.max(0, (location?.line || 1) - 1);
	const character = Math.max(0, (location?.column || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'graphql',
		message: error.message
	};
};

export function createGraphqlWorkerService(): WorkerLanguageService {
	let schema: GraphQLSchema | null = null;

	return {
		name: 'wasm-idle-graphql-lsp',
		diagnosticDelay: 150,
		capabilities: {
			completionProvider: { triggerCharacters: [' ', '{', '('] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize(options, context) {
			const config = (options || {}) as GraphqlWorkerOptions;
			context.reportProgress('load-graphql-language-service');
			schema = config.schema?.trim() ? buildSchema(config.schema) : null;
		},
		diagnostics(document: LspDocument) {
			if (!document.text.trim()) return [];
			try {
				const ast = parse(
					new Source(document.text, document.uri.split('/').pop() || 'main.graphql')
				);
				return schema ? validate(schema, ast).map(diagnosticFor) : [];
			} catch (error) {
				return error instanceof GraphQLError
					? [diagnosticFor(error)]
					: [
							{
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 1 }
								},
								severity: 1,
								source: 'graphql',
								message: error instanceof Error ? error.message : String(error)
							}
						];
			}
		},
		completion() {
			return {
				isIncomplete: false,
				items: GRAPHQL_KEYWORDS.map((label) => ({
					label,
					kind: 14,
					detail: GRAPHQL_HOVER[label] || 'GraphQL keyword'
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = GRAPHQL_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		documentSymbols(document) {
			let ast;
			try {
				ast = parse(document.text);
			} catch (error) {
				if (error instanceof GraphQLError) return [];
				throw error;
			}
			return ast.definitions.flatMap((definition) => {
				if (!('name' in definition) || !definition.name?.loc || !definition.loc) return [];
				const name = definition.name;
				const start =
					'description' in definition && definition.description?.loc
						? (definition.description.loc.endToken.next?.start ?? definition.loc.start)
						: definition.loc.start;
				return [
					{
						name: name.value,
						kind: definition.kind === 'OperationDefinition' ? 12 : 5,
						range: {
							start: positionAt(document.text, start),
							end: positionAt(document.text, definition.loc.end)
						},
						selectionRange: {
							start: positionAt(document.text, definition.name.loc.start),
							end: positionAt(document.text, definition.name.loc.end)
						}
					}
				];
			});
		}
	};
}
