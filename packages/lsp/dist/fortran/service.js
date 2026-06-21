const TREE_SITTER_WASM_URL = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.26.9/web-tree-sitter.wasm';
const FORTRAN_KEYWORDS = [
    'program',
    'module',
    'subroutine',
    'function',
    'implicit none',
    'integer',
    'real',
    'complex',
    'logical',
    'character',
    'parameter',
    'allocatable',
    'do',
    'if',
    'then',
    'else',
    'select case',
    'contains',
    'end',
    'use',
    'call',
    'print',
    'read',
    'write'
];
const FORTRAN_HOVER = {
    program: 'Defines a main Fortran program unit.',
    module: 'Defines a module containing declarations and procedures.',
    subroutine: 'Defines a procedure called with CALL.',
    function: 'Defines a procedure that returns a value.',
    'implicit none': 'Requires explicit declarations for identifiers.',
    contains: 'Separates a program unit from its internal procedures.',
    allocatable: 'Marks an object whose storage can be allocated dynamically.'
};
async function loadExternalAnalyzer(options) {
    if (!options.analyzerUrl) {
        const [{ Parser, Language }, grammarWasm] = await Promise.all([
            import('web-tree-sitter'),
            import('@lumis-sh/wasm-fortran').then((module) => module.default)
        ]);
        await Parser.init({
            locateFile(path) {
                return path.endsWith('.wasm') ? options.parserWasmUrl || TREE_SITTER_WASM_URL : path;
            }
        });
        const parser = new Parser();
        const language = await Language.load(options.grammarUrl || grammarWasm);
        parser.setLanguage(language);
        return {
            analyze(code) {
                const tree = parser.parse(code);
                if (!tree) {
                    return [
                        {
                            message: 'Fortran parser did not produce a syntax tree',
                            severity: 'error'
                        }
                    ];
                }
                try {
                    if (!tree.rootNode.hasError)
                        return [];
                    const diagnostics = [];
                    collectTreeSitterDiagnostics(tree.rootNode, diagnostics);
                    return diagnostics.length > 0
                        ? diagnostics
                        : [
                            {
                                message: 'Fortran syntax error',
                                severity: 'error'
                            }
                        ];
                }
                finally {
                    tree.delete();
                }
            },
            dispose() {
                parser.delete();
            }
        };
    }
    const module = await import(/* @vite-ignore */ options.analyzerUrl);
    const factory = typeof module.createFortranAnalyzer === 'function'
        ? module.createFortranAnalyzer
        : typeof module.default === 'function'
            ? module.default
            : null;
    if (!factory) {
        throw new Error('Fortran analyzer module must export createFortranAnalyzer or a default factory');
    }
    return await factory();
}
function collectTreeSitterDiagnostics(node, diagnostics) {
    if (node.isError || node.isMissing) {
        const preview = node.text.replace(/\s+/gu, ' ').trim();
        diagnostics.push({
            lineNumber: node.startPosition.row + 1,
            columnNumber: node.startPosition.column + 1,
            severity: 'error',
            message: node.isMissing
                ? `Missing Fortran syntax: ${node.type}`
                : preview
                    ? `Unexpected Fortran syntax near "${preview.slice(0, 80)}"`
                    : 'Unexpected Fortran syntax'
        });
        return;
    }
    for (const child of node.children) {
        if (child.hasError)
            collectTreeSitterDiagnostics(child, diagnostics);
    }
}
const wordAt = (text, position) => {
    const line = text.split('\n')[position.line] || '';
    const character = Math.max(0, Math.min(position.character, line.length));
    return ((line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
        (line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')).toLowerCase();
};
const diagnosticFor = (diagnostic) => {
    const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
    const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
    return {
        range: {
            start: { line, character },
            end: { line, character: character + 1 }
        },
        severity: diagnostic.severity === 'warning' ? 2 : diagnostic.severity === 'info' ? 3 : 1,
        source: 'fortran',
        message: diagnostic.message
    };
};
export function createFortranWorkerService(loadAnalyzer = loadExternalAnalyzer) {
    let analyzer = null;
    let lastKey = '';
    let lastDiagnostics = [];
    return {
        name: 'wasm-idle-fortran-lsp',
        diagnosticDelay: 250,
        capabilities: {
            completionProvider: { triggerCharacters: [' ', ':', '%'] },
            hoverProvider: true,
            documentSymbolProvider: true
        },
        async initialize(options, context) {
            const config = (options || {});
            context.reportProgress(config.analyzerUrl ? 'load-fortran-analyzer' : 'load-fortran-language-service');
            analyzer = await loadAnalyzer(config);
        },
        async diagnostics(document) {
            if (!analyzer)
                return [];
            const key = `${document.uri}\n${document.text}`;
            if (key === lastKey)
                return lastDiagnostics;
            lastKey = key;
            const diagnostics = await analyzer.analyze(document.text, document.uri.split('/').pop() || 'main.f90');
            lastDiagnostics = diagnostics.map(diagnosticFor);
            return lastDiagnostics;
        },
        completion() {
            return {
                isIncomplete: false,
                items: FORTRAN_KEYWORDS.map((label) => ({
                    label,
                    kind: 14,
                    detail: FORTRAN_HOVER[label] || 'Fortran keyword'
                }))
            };
        },
        hover(document, position) {
            const word = wordAt(document.text, position);
            const description = FORTRAN_HOVER[word];
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
            const pattern = /^\s*(program|module|subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gimu;
            for (const match of document.text.matchAll(pattern)) {
                const offset = match.index || 0;
                const before = document.text.slice(0, offset);
                const line = before.split('\n').length - 1;
                const character = offset - before.lastIndexOf('\n') - 1;
                symbols.push({
                    name: match[2],
                    kind: match[1].toLowerCase() === 'module' ? 2 : 12,
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
            await analyzer?.dispose?.();
            analyzer = null;
        }
    };
}
//# sourceMappingURL=service.js.map