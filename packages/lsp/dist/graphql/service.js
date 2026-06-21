import { buildSchema, GraphQLError, parse, Source, validate } from 'graphql';
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
];
const GRAPHQL_HOVER = {
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
const wordAt = (text, position) => {
    const line = text.split('\n')[position.line] || '';
    const character = Math.max(0, Math.min(position.character, line.length));
    return ((line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
        (line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || ''));
};
const diagnosticFor = (error) => {
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
export function createGraphqlWorkerService() {
    let schema = null;
    return {
        name: 'wasm-idle-graphql-lsp',
        diagnosticDelay: 150,
        capabilities: {
            completionProvider: { triggerCharacters: [' ', '{', '('] },
            hoverProvider: true,
            documentSymbolProvider: true
        },
        initialize(options, context) {
            const config = (options || {});
            context.reportProgress('load-graphql-language-service');
            schema = config.schema?.trim() ? buildSchema(config.schema) : null;
        },
        diagnostics(document) {
            if (!document.text.trim())
                return [];
            try {
                const ast = parse(new Source(document.text, document.uri.split('/').pop() || 'main.graphql'));
                return schema ? validate(schema, ast).map(diagnosticFor) : [];
            }
            catch (error) {
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
            if (!description)
                return null;
            return {
                contents: {
                    kind: 'markdown',
                    value: `\`${word}\`\n\n${description}`
                }
            };
        },
        documentSymbols(document) {
            const symbols = [];
            const pattern = /^\s*(query|mutation|subscription|fragment|type|interface|enum|input|scalar|union)\s+([_A-Za-z][_0-9A-Za-z]*)/gmu;
            for (const match of document.text.matchAll(pattern)) {
                const offset = match.index || 0;
                const before = document.text.slice(0, offset);
                const line = before.split('\n').length - 1;
                const character = offset - before.lastIndexOf('\n') - 1;
                symbols.push({
                    name: match[2],
                    kind: match[1] === 'query' || match[1] === 'mutation' ? 12 : 5,
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
        }
    };
}
//# sourceMappingURL=service.js.map