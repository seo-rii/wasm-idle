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
];
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
];
const loadDotnetModule = async (moduleUrl) => (await import(/* @vite-ignore */ moduleUrl));
export function createDotnetWorkerService(defaultLanguage, loadModule = loadDotnetModule) {
    let language = defaultLanguage;
    let compiler;
    let reportProgress = () => { };
    const convertDiagnostic = (diagnostic) => {
        const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
        const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
        const endCharacter = Math.max(character + 1, Number(diagnostic.endColumnNumber || character + 2) - 1);
        return {
            range: {
                start: { line, character },
                end: { line, character: endCharacter }
            },
            severity: diagnostic.severity === 'warning'
                ? 2
                : diagnostic.severity === 'other'
                    ? 3
                    : 1,
            source: language === 'csharp' ? 'roslyn-csharp' : 'roslyn-vb',
            message: String(diagnostic.message || 'Compilation error')
        };
    };
    return {
        name: defaultLanguage === 'csharp'
            ? 'wasm-idle-csharp-lsp'
            : 'wasm-idle-visual-basic-lsp',
        diagnosticDelay: 500,
        capabilities: {
            completionProvider: { triggerCharacters: ['.', ' '] }
        },
        async initialize(options, context) {
            const config = options;
            language = config.language || defaultLanguage;
            reportProgress = context.reportProgress;
            reportProgress('load-dotnet-runtime');
            const module = await loadModule(config.moduleUrl);
            if (typeof module.createDotnetCompiler !== 'function') {
                throw new Error('wasm-dotnet module must export createDotnetCompiler');
            }
            compiler = module.createDotnetCompiler();
        },
        async diagnostics(document) {
            const result = await compiler.compile({
                code: document.text,
                language,
                target: 'browser-wasm',
                prepare: true,
                onProgress(progress) {
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
                    source: language === 'csharp' ? 'roslyn-csharp' : 'roslyn-vb',
                    message: result.stderr
                });
            }
            return diagnostics;
        },
        completion() {
            const keywords = language === 'csharp' ? CSHARP_KEYWORDS : VB_KEYWORDS;
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
//# sourceMappingURL=service.js.map