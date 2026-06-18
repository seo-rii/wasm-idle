import * as ts from 'typescript';
import { fullDocumentRange, offsetAt, pathToUri, positionAt, uriToPath } from '../lsp.js';
const normalizePath = (value) => {
    const normalized = value.replaceAll('\\', '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
};
const basename = (value) => {
    const normalized = value.replaceAll('\\', '/');
    const index = normalized.lastIndexOf('/');
    return index === -1 ? normalized : normalized.slice(index + 1);
};
const displayParts = (parts) => ts.displayPartsToString(parts ? [...parts] : undefined);
const diagnosticSeverity = (category) => {
    switch (category) {
        case ts.DiagnosticCategory.Warning:
            return 2;
        case ts.DiagnosticCategory.Suggestion:
            return 4;
        case ts.DiagnosticCategory.Message:
            return 3;
        default:
            return 1;
    }
};
const scriptElementKindValue = (kind) => String(kind);
const completionKind = (kind) => {
    const kinds = ts.ScriptElementKind;
    if (kind === kinds.keyword)
        return 14;
    if (kind === kinds.moduleElement || kind === kinds.externalModuleName)
        return 9;
    if (kind === kinds.classElement)
        return 7;
    if (kind === kinds.interfaceElement)
        return 8;
    if (kind === kinds.enumElement)
        return 13;
    if (kind === kinds.enumMemberElement)
        return 20;
    if (kind === kinds.memberFunctionElement || scriptElementKindValue(kind) === 'method')
        return 2;
    if (kind === kinds.functionElement || kind === kinds.localFunctionElement)
        return 3;
    if (kind === kinds.constructorImplementationElement)
        return 4;
    if (kind === kinds.memberVariableElement || kind === kinds.memberGetAccessorElement)
        return 5;
    if (kind === kinds.constElement)
        return 21;
    if (kind === kinds.variableElement ||
        kind === kinds.localVariableElement ||
        kind === kinds.parameterElement) {
        return 6;
    }
    if (kind === kinds.typeElement || kind === kinds.typeParameterElement)
        return 25;
    if (kind === kinds.string)
        return 1;
    return 6;
};
const symbolKind = (kind) => {
    const kinds = ts.ScriptElementKind;
    if (kind === kinds.moduleElement || kind === kinds.externalModuleName)
        return 2;
    if (kind === kinds.classElement)
        return 5;
    if (scriptElementKindValue(kind) === 'method' || kind === kinds.memberFunctionElement)
        return 6;
    if (kind === kinds.memberVariableElement)
        return 8;
    if (kind === kinds.constructorImplementationElement)
        return 9;
    if (kind === kinds.enumElement)
        return 10;
    if (kind === kinds.interfaceElement)
        return 11;
    if (kind === kinds.functionElement || kind === kinds.localFunctionElement)
        return 12;
    if (kind === kinds.constElement)
        return 14;
    return 13;
};
const scriptKind = (fileName) => {
    if (fileName.endsWith('.tsx'))
        return ts.ScriptKind.TSX;
    if (fileName.endsWith('.jsx'))
        return ts.ScriptKind.JSX;
    if (fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
};
async function loadBundledTypeScriptLibs() {
    const response = await fetch(new URL('./typescript-libs.json.gz', import.meta.url));
    if (!response.ok) {
        throw new Error(`Failed to load TypeScript standard libraries: ${response.status}`);
    }
    if (response.headers.get('content-encoding')?.toLowerCase().includes('gzip')) {
        return (await response.json());
    }
    if (typeof DecompressionStream !== 'function') {
        throw new Error("Failed to load TypeScript standard libraries: this browser does not support DecompressionStream('gzip')");
    }
    const sourceStream = response.body || new Blob([await response.arrayBuffer()]).stream();
    const decompressedResponse = new Response(sourceStream.pipeThrough(new DecompressionStream('gzip')));
    return (await decompressedResponse.json());
}
export function createTypeScriptWorkerService(defaultLanguage, loadLibs = loadBundledTypeScriptLibs) {
    let language = defaultLanguage;
    let context;
    let languageService;
    let compilerOptions;
    let libFiles = {};
    let extraLibs = {};
    const documentForFileName = (fileName) => {
        const normalized = normalizePath(fileName);
        for (const document of context.documents.values()) {
            if (normalizePath(uriToPath(document.uri)) === normalized)
                return document;
        }
        return undefined;
    };
    const sourceTextForFileName = (fileName) => documentForFileName(fileName)?.text ||
        extraLibs[normalizePath(fileName)] ||
        libFiles[basename(fileName)] ||
        '';
    const host = {
        getCompilationSettings: () => compilerOptions,
        getScriptFileNames: () => [
            ...new Set([
                ...Array.from(context.documents.values(), (document) => normalizePath(uriToPath(document.uri))),
                ...Object.keys(extraLibs).map(normalizePath)
            ])
        ],
        getScriptVersion: (fileName) => String(documentForFileName(fileName)?.version ?? (fileName in extraLibs ? 1 : 0)),
        getScriptSnapshot(fileName) {
            const source = sourceTextForFileName(fileName);
            return source ? ts.ScriptSnapshot.fromString(source) : undefined;
        },
        getScriptKind: scriptKind,
        getCurrentDirectory: () => '/workspace',
        getDefaultLibFileName: () => '/lib.es2022.full.d.ts',
        fileExists: (fileName) => !!documentForFileName(fileName) ||
            normalizePath(fileName) in extraLibs ||
            basename(fileName) in libFiles,
        readFile: sourceTextForFileName,
        readDirectory: () => [],
        directoryExists: () => true,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n'
    };
    const convertDiagnostic = (document, diagnostic) => {
        const start = diagnostic.start ?? 0;
        const length = diagnostic.length ?? 1;
        return {
            range: {
                start: positionAt(document.text, start),
                end: positionAt(document.text, start + Math.max(length, 1))
            },
            severity: diagnosticSeverity(diagnostic.category),
            code: diagnostic.code,
            source: language === 'typescript' ? 'typescript' : 'javascript',
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        };
    };
    const locationForSpan = (fileName, textSpan) => {
        const source = sourceTextForFileName(fileName);
        return {
            uri: pathToUri(normalizePath(fileName)),
            range: {
                start: positionAt(source, textSpan.start),
                end: positionAt(source, textSpan.start + textSpan.length)
            }
        };
    };
    return {
        name: defaultLanguage === 'typescript' ? 'wasm-idle-typescript-lsp' : 'wasm-idle-javascript-lsp',
        version: ts.version,
        capabilities: {
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.', '"', "'", '/', '@', '<']
            },
            hoverProvider: true,
            definitionProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ',', '<']
            },
            documentSymbolProvider: true,
            documentFormattingProvider: true
        },
        async initialize(options, nextContext) {
            const config = (options || {});
            language = config.language || defaultLanguage;
            context = nextContext;
            context.reportProgress('load-typescript-libs');
            libFiles = config.libFiles || (await loadLibs());
            extraLibs = Object.fromEntries(Object.entries(config.extraLibs || {}).map(([fileName, source]) => [
                normalizePath(fileName),
                source
            ]));
            compilerOptions = {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                allowJs: language === 'javascript',
                checkJs: language === 'javascript',
                strict: true,
                noEmit: true,
                allowNonTsExtensions: true,
                lib: ['lib.es2022.full.d.ts'],
                ...config.compilerOptions
            };
            languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
        },
        diagnostics(document) {
            const fileName = normalizePath(uriToPath(document.uri));
            return [
                ...languageService.getSyntacticDiagnostics(fileName),
                ...languageService.getSemanticDiagnostics(fileName),
                ...languageService.getSuggestionDiagnostics(fileName)
            ].map((diagnostic) => convertDiagnostic(document, diagnostic));
        },
        completion(document, position) {
            const fileName = normalizePath(uriToPath(document.uri));
            const offset = offsetAt(document.text, position);
            const completions = languageService.getCompletionsAtPosition(fileName, offset, {
                includeCompletionsForModuleExports: true,
                includeInsertTextCompletions: true
            });
            if (!completions)
                return null;
            return {
                isIncomplete: false,
                items: completions.entries.map((entry) => {
                    const details = languageService.getCompletionEntryDetails(fileName, offset, entry.name, undefined, entry.source, undefined, entry.data);
                    return {
                        label: entry.name,
                        kind: completionKind(entry.kind),
                        sortText: entry.sortText,
                        insertText: entry.insertText,
                        detail: details ? displayParts(details.displayParts) : undefined,
                        documentation: details
                            ? displayParts(details.documentation)
                            : undefined
                    };
                })
            };
        },
        hover(document, position) {
            const fileName = normalizePath(uriToPath(document.uri));
            const info = languageService.getQuickInfoAtPosition(fileName, offsetAt(document.text, position));
            if (!info)
                return null;
            return {
                contents: {
                    kind: 'markdown',
                    value: `\`\`\`${language === 'typescript' ? 'typescript' : 'javascript'}\n${displayParts(info.displayParts)}\n\`\`\`${displayParts(info.documentation) ? `\n\n${displayParts(info.documentation)}` : ''}`
                },
                range: {
                    start: positionAt(document.text, info.textSpan.start),
                    end: positionAt(document.text, info.textSpan.start + info.textSpan.length)
                }
            };
        },
        definition(document, position) {
            const fileName = normalizePath(uriToPath(document.uri));
            return (languageService
                .getDefinitionAtPosition(fileName, offsetAt(document.text, position))
                ?.map((definition) => locationForSpan(definition.fileName, definition.textSpan)) || null);
        },
        signatureHelp(document, position) {
            const fileName = normalizePath(uriToPath(document.uri));
            const help = languageService.getSignatureHelpItems(fileName, offsetAt(document.text, position), undefined);
            if (!help)
                return null;
            return {
                signatures: help.items.map((item) => ({
                    label: `${displayParts(item.prefixDisplayParts)}${item.parameters
                        .map((parameter) => displayParts(parameter.displayParts))
                        .join(displayParts(item.separatorDisplayParts))}${displayParts(item.suffixDisplayParts)}`,
                    documentation: displayParts(item.documentation),
                    parameters: item.parameters.map((parameter) => ({
                        label: displayParts(parameter.displayParts),
                        documentation: displayParts(parameter.documentation)
                    }))
                })),
                activeSignature: help.selectedItemIndex,
                activeParameter: help.argumentIndex
            };
        },
        documentSymbols(document) {
            const fileName = normalizePath(uriToPath(document.uri));
            const tree = languageService.getNavigationTree(fileName);
            const convert = (item) => item.childItems?.map((child) => ({
                name: child.text,
                kind: symbolKind(child.kind),
                range: {
                    start: positionAt(document.text, child.spans[0]?.start || 0),
                    end: positionAt(document.text, (child.spans[0]?.start || 0) + (child.spans[0]?.length || 0))
                },
                selectionRange: {
                    start: positionAt(document.text, child.nameSpan?.start || child.spans[0]?.start || 0),
                    end: positionAt(document.text, (child.nameSpan?.start || child.spans[0]?.start || 0) +
                        (child.nameSpan?.length || child.spans[0]?.length || 0))
                },
                children: convert(child)
            })) || [];
            return convert(tree);
        },
        formatting(document, options) {
            const fileName = normalizePath(uriToPath(document.uri));
            return languageService
                .getFormattingEditsForDocument(fileName, {
                indentSize: Number(options.tabSize || 2),
                tabSize: Number(options.tabSize || 2),
                convertTabsToSpaces: options.insertSpaces !== false,
                newLineCharacter: '\n',
                semicolons: ts.SemicolonPreference.Insert
            })
                .map((edit) => ({
                range: {
                    start: positionAt(document.text, edit.span.start),
                    end: positionAt(document.text, edit.span.start + edit.span.length)
                },
                newText: edit.newText
            }));
        },
        dispose() {
            languageService?.dispose();
        }
    };
}
export function replaceWholeDocument(document, newText) {
    return [{ range: fullDocumentRange(document.text), newText }];
}
//# sourceMappingURL=service.js.map