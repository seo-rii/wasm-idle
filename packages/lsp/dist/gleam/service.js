import { positionAt } from '../lsp.js';
const GLEAM_KEYWORDS = [
    'as',
    'assert',
    'case',
    'const',
    'echo',
    'fn',
    'if',
    'import',
    'let',
    'opaque',
    'panic',
    'pub',
    'todo',
    'type',
    'use'
];
const stdinModuleSource = `@external(javascript, "./stdin_ffi.mjs", "read_line")
pub fn read_line() -> String
`;
const stdinFfiSource = `export function read_line() {
  return "";
}
`;
let nextProjectId = 0;
function assetUrl(baseUrl, path) {
    return new URL(path, baseUrl).href;
}
export function resolveGleamCompilerUrl(baseUrl) {
    return assetUrl(baseUrl, 'compiler/gleam_wasm.js');
}
async function defaultLoadGleamCompiler(baseUrl) {
    const compiler = (await import(
    /* @vite-ignore */ resolveGleamCompilerUrl(baseUrl)));
    if (typeof compiler.default === 'function') {
        await compiler.default(assetUrl(baseUrl, 'compiler/gleam_wasm_bg.wasm'));
    }
    return compiler;
}
async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`Failed to load Gleam source manifest: ${response.status}`);
    return await response.json();
}
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Failed to load ${url}: ${response.status}`);
    return await response.text();
}
function normalizeWorkspacePath(path) {
    const parts = [];
    for (const part of String(path || '')
        .replace(/^\/+/, '')
        .split('/')) {
        if (!part || part === '.' || part === '..' || part.includes('\0'))
            continue;
        parts.push(part);
    }
    return parts.join('/');
}
function moduleNameFromUri(uri) {
    let path = uri;
    try {
        path = decodeURIComponent(new URL(uri).pathname);
    }
    catch {
        path = uri;
    }
    const normalized = normalizeWorkspacePath(path.replace(/^\/?workspace\//u, ''));
    const withoutPrefix = normalized.startsWith('src/') ? normalized.slice(4) : normalized;
    const fileName = withoutPrefix.split('/').pop() || 'main.gleam';
    if (withoutPrefix.endsWith('.gleam'))
        return withoutPrefix.slice(0, -'.gleam'.length);
    if (fileName.endsWith('.gleam'))
        return fileName.slice(0, -'.gleam'.length);
    return 'main';
}
async function collectStdlibSources(baseUrl, manifest) {
    const sources = new Map();
    const files = Array.isArray(manifest?.files)
        ? manifest.files
        : [];
    for (const entry of files) {
        const path = typeof entry === 'string' ? entry : entry?.path;
        if (typeof path !== 'string' || !path.endsWith('.gleam'))
            continue;
        sources.set(path, await fetchText(assetUrl(baseUrl, `src/${path}`)));
    }
    return sources;
}
function diagnosticFromError(error, text) {
    const message = error instanceof Error ? error.message : String(error || 'Gleam compilation failed');
    const match = /(?:^|\n)[^\n]*?([\w./-]+\.gleam):(\d+):(\d+)/u.exec(message);
    if (!match) {
        return {
            range: {
                start: positionAt(text, 0),
                end: positionAt(text, Math.min(text.length, 1))
            },
            severity: 1,
            source: 'gleam',
            message
        };
    }
    const line = Math.max(0, Number(match[2]) - 1);
    const character = Math.max(0, Number(match[3]) - 1);
    return {
        range: {
            start: { line, character },
            end: { line, character: character + 1 }
        },
        severity: 1,
        source: 'gleam',
        message
    };
}
export function createGleamWorkerService(loadCompiler = defaultLoadGleamCompiler) {
    let compiler = null;
    let baseUrl = '';
    let manifestUrl = '';
    let stdlibSources = new Map();
    let lastKey = '';
    let lastDiagnostics = [];
    return {
        name: 'wasm-idle-gleam-lsp',
        diagnosticDelay: 700,
        capabilities: {
            completionProvider: { triggerCharacters: ['.', ' '] }
        },
        async initialize(options, context) {
            const config = (options || {});
            if (!config.baseUrl)
                throw new Error('Gleam language server requires a baseUrl');
            baseUrl = config.baseUrl;
            manifestUrl = config.manifestUrl || assetUrl(baseUrl, 'source-manifest.v1.json');
            context.reportProgress('load-gleam-compiler');
            compiler = await loadCompiler(baseUrl);
            const manifest = await fetchJson(manifestUrl);
            stdlibSources = await collectStdlibSources(baseUrl, manifest);
        },
        async diagnostics(document, context) {
            if (!compiler)
                return [];
            if (!document.text.trim())
                return [];
            const key = `${baseUrl}\n${manifestUrl}\n${document.uri}\n${document.text}`;
            if (key === lastKey)
                return lastDiagnostics;
            context.reportProgress('gleam-diagnostics');
            const projectId = ++nextProjectId;
            try {
                compiler.reset_filesystem(projectId);
                compiler.write_file(projectId, '/gleam.toml', 'name = "wasm_idle"\\nversion = "0.1.0"\\ntarget = "javascript"\\n');
                for (const [path, source] of stdlibSources) {
                    compiler.write_file(projectId, `/src/${path}`, source);
                }
                compiler.write_file(projectId, '/src/wasm_idle/stdin.gleam', stdinModuleSource);
                compiler.write_file(projectId, '/src/wasm_idle/stdin_ffi.mjs', stdinFfiSource);
                compiler.write_module(projectId, moduleNameFromUri(document.uri), document.text);
                compiler.compile_package(projectId, 'javascript');
                lastDiagnostics = [];
            }
            catch (error) {
                lastDiagnostics = [diagnosticFromError(error, document.text)];
            }
            finally {
                compiler.delete_project?.(projectId);
            }
            lastKey = key;
            return lastDiagnostics;
        },
        completion() {
            return {
                isIncomplete: false,
                items: GLEAM_KEYWORDS.map((keyword) => ({
                    label: keyword,
                    kind: 14
                }))
            };
        }
    };
}
//# sourceMappingURL=service.js.map