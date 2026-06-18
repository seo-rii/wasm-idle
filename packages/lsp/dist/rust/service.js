import { positionAt } from '../lsp.js';
const severityFor = (severity) => severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;
const diagnosticFor = (diagnostic) => {
    const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
    const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
    return {
        range: {
            start: { line, character },
            end: { line, character: character + 1 }
        },
        severity: severityFor(diagnostic.severity),
        source: 'rustc',
        message: String(diagnostic.message || 'Rust diagnostic')
    };
};
async function loadRustCompiler(compilerUrl) {
    const module = await import(/* @vite-ignore */ compilerUrl);
    const factory = typeof module.createRustCompiler === 'function'
        ? module.createRustCompiler
        : typeof module.default === 'function'
            ? module.default
            : null;
    if (!factory) {
        throw new Error('wasm-rust module must export createRustCompiler or a default factory');
    }
    return await factory();
}
export function createRustWorkerService() {
    let compiler = null;
    let targetTriple = 'wasm32-wasip1';
    let edition = '2024';
    let lastKey = '';
    let lastDiagnostics = [];
    return {
        name: 'wasm-idle-rust-lsp',
        diagnosticDelay: 800,
        capabilities: {},
        async initialize(options, context) {
            const config = (options || {});
            if (!config.compilerUrl) {
                throw new Error('Rust language server requires a wasm-rust compilerUrl');
            }
            targetTriple = config.targetTriple || targetTriple;
            edition = config.edition || edition;
            context.reportProgress('load-rust-compiler');
            compiler = await loadRustCompiler(config.compilerUrl);
        },
        async diagnostics(document, context) {
            if (!compiler)
                return [];
            if (!document.text.trim())
                return [];
            const key = `${targetTriple}\n${edition}\n${document.text}`;
            if (key === lastKey)
                return lastDiagnostics;
            context.reportProgress('rustc-diagnostics');
            const result = await compiler.compile({
                code: document.text,
                edition,
                crateType: 'bin',
                targetTriple,
                extendedTimeout: true,
                log: false,
                onProgress(progress) {
                    context.reportProgress(progress.stage || 'rustc-diagnostics', progress.completed, progress.total);
                }
            });
            lastKey = key;
            lastDiagnostics = (result.diagnostics || []).map(diagnosticFor);
            if (!result.success && !lastDiagnostics.length) {
                lastDiagnostics = [
                    {
                        range: {
                            start: positionAt(document.text, 0),
                            end: positionAt(document.text, Math.min(document.text.length, 1))
                        },
                        severity: 1,
                        source: 'rustc',
                        message: result.stderr || result.stdout || 'Rust compilation failed'
                    }
                ];
            }
            return lastDiagnostics;
        }
    };
}
//# sourceMappingURL=service.js.map