import wabtFactory from 'wabt';
import { fullDocumentRange } from '../lsp.js';
const WAT_KEYWORDS = [
    'module',
    'type',
    'import',
    'func',
    'table',
    'memory',
    'global',
    'export',
    'start',
    'elem',
    'data',
    'param',
    'result',
    'local',
    'mut',
    'i32',
    'i64',
    'f32',
    'f64',
    'v128',
    'funcref',
    'externref',
    'block',
    'loop',
    'if',
    'then',
    'else',
    'end',
    'br',
    'br_if',
    'br_table',
    'return',
    'call',
    'call_indirect',
    'drop',
    'select',
    'local.get',
    'local.set',
    'local.tee',
    'global.get',
    'global.set',
    'i32.load',
    'i64.load',
    'f32.load',
    'f64.load',
    'i32.store',
    'i64.store',
    'f32.store',
    'f64.store',
    'memory.size',
    'memory.grow',
    'i32.const',
    'i64.const',
    'f32.const',
    'f64.const',
    'i32.eqz',
    'i32.eq',
    'i32.ne',
    'i32.lt_s',
    'i32.lt_u',
    'i32.gt_s',
    'i32.gt_u',
    'i32.le_s',
    'i32.le_u',
    'i32.ge_s',
    'i32.ge_u',
    'i32.add',
    'i32.sub',
    'i32.mul',
    'i32.div_s',
    'i32.div_u',
    'i32.rem_s',
    'i32.rem_u',
    'i32.and',
    'i32.or',
    'i32.xor',
    'i32.shl',
    'i32.shr_s',
    'i32.shr_u',
    'i64.add',
    'i64.sub',
    'i64.mul',
    'f32.add',
    'f32.sub',
    'f32.mul',
    'f32.div',
    'f64.add',
    'f64.sub',
    'f64.mul',
    'f64.div'
];
const WAT_HOVER = {
    module: 'Defines a WebAssembly module.',
    func: 'Defines or references a function.',
    param: 'Declares a function parameter.',
    result: 'Declares a function or block result type.',
    'local.get': 'Pushes the value of a local onto the stack.',
    'local.set': 'Pops a value and stores it in a local.',
    'local.tee': 'Stores a value in a local while retaining it on the stack.',
    'i32.const': 'Pushes a 32-bit integer constant.',
    'i64.const': 'Pushes a 64-bit integer constant.',
    call: 'Calls a function directly.',
    'call_indirect': 'Calls a function through a table.',
    block: 'Begins a structured block.',
    loop: 'Begins a structured loop.',
    'br_if': 'Conditionally branches to a label.',
    memory: 'Defines or imports linear memory.'
};
const wordAt = (text, position) => {
    const lines = text.split('\n');
    const line = lines[position.line] || '';
    const character = Math.max(0, Math.min(position.character, line.length));
    const left = line.slice(0, character).match(/[A-Za-z0-9_.]+$/u)?.[0] || '';
    const right = line.slice(character).match(/^[A-Za-z0-9_.]+/u)?.[0] || '';
    return left + right;
};
function parseWatDiagnostics(message, fileName) {
    const diagnostics = [];
    const pattern = /([^:\n]+):(\d+):(\d+):\s*(error|warning):\s*([^\n]+)/gu;
    for (const match of message.matchAll(pattern)) {
        const line = Math.max(0, Number(match[2]) - 1);
        const character = Math.max(0, Number(match[3]) - 1);
        diagnostics.push({
            range: {
                start: { line, character },
                end: { line, character: character + 1 }
            },
            severity: match[4] === 'warning' ? 2 : 1,
            source: 'wabt',
            message: match[5].trim()
        });
    }
    if (diagnostics.length)
        return diagnostics;
    const clean = message.replace(/^parseWat failed:\n?/u, '').trim();
    return clean
        ? [
            {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 1 }
                },
                severity: 1,
                source: 'wabt',
                message: clean || `Failed to parse ${fileName}`
            }
        ]
        : [];
}
export function createWatWorkerService() {
    let features;
    let wabt;
    const parse = (document) => wabt.parseWat(document.uri.split('/').pop() || 'main.wat', document.text, features);
    return {
        name: 'wasm-idle-wat-lsp',
        capabilities: {
            completionProvider: { triggerCharacters: ['.', '$'] },
            hoverProvider: true,
            documentFormattingProvider: true
        },
        async initialize(options, context) {
            features = options?.features;
            context.reportProgress('load-wabt');
            wabt = await wabtFactory();
        },
        diagnostics(document) {
            let module = null;
            try {
                module = parse(document);
                module.resolveNames();
                module.validate();
                return [];
            }
            catch (error) {
                return parseWatDiagnostics(error instanceof Error ? error.message : String(error), document.uri);
            }
            finally {
                module?.destroy();
            }
        },
        completion() {
            return {
                isIncomplete: false,
                items: WAT_KEYWORDS.map((keyword) => ({
                    label: keyword,
                    kind: keyword.includes('.') ? 3 : 14,
                    detail: WAT_HOVER[keyword] || 'WebAssembly text format keyword'
                }))
            };
        },
        hover(document, position) {
            const word = wordAt(document.text, position);
            const description = WAT_HOVER[word];
            if (!description)
                return null;
            return {
                contents: {
                    kind: 'markdown',
                    value: `\`${word}\`\n\n${description}`
                }
            };
        },
        formatting(document) {
            let module = null;
            try {
                module = parse(document);
                module.resolveNames();
                module.validate();
                const formatted = module.toText({
                    foldExprs: false,
                    inlineExport: false
                });
                return formatted === document.text
                    ? []
                    : [{ range: fullDocumentRange(document.text), newText: formatted }];
            }
            finally {
                module?.destroy();
            }
        }
    };
}
//# sourceMappingURL=service.js.map