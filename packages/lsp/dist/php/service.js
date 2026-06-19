import { positionAt } from '../lsp.js';
const PHP_KEYWORDS = [
    'abstract',
    'and',
    'array',
    'as',
    'break',
    'callable',
    'case',
    'catch',
    'class',
    'clone',
    'const',
    'continue',
    'declare',
    'default',
    'do',
    'echo',
    'else',
    'elseif',
    'empty',
    'enddeclare',
    'endfor',
    'endforeach',
    'endif',
    'endswitch',
    'endwhile',
    'enum',
    'eval',
    'exit',
    'extends',
    'final',
    'finally',
    'fn',
    'for',
    'foreach',
    'function',
    'global',
    'goto',
    'if',
    'implements',
    'include',
    'include_once',
    'instanceof',
    'insteadof',
    'interface',
    'isset',
    'list',
    'match',
    'namespace',
    'new',
    'or',
    'print',
    'private',
    'protected',
    'public',
    'readonly',
    'require',
    'require_once',
    'return',
    'static',
    'switch',
    'throw',
    'trait',
    'try',
    'unset',
    'use',
    'var',
    'while',
    'xor',
    'yield'
];
const PHP_FUNCTIONS = [
    'array_filter',
    'array_map',
    'array_merge',
    'array_reduce',
    'count',
    'explode',
    'file_get_contents',
    'fgets',
    'implode',
    'in_array',
    'is_array',
    'is_null',
    'is_numeric',
    'json_decode',
    'json_encode',
    'printf',
    'sort',
    'sprintf',
    'str_contains',
    'str_replace',
    'strlen',
    'strpos',
    'strtolower',
    'strtoupper',
    'substr',
    'trim',
    'var_dump'
];
const PHP_HOVER = {
    echo: 'Outputs one or more expressions.',
    function: 'Declares a function.',
    class: 'Declares a class.',
    interface: 'Declares an interface.',
    trait: 'Declares a trait.',
    enum: 'Declares an enum.',
    match: 'Compares a subject expression against arms and returns the matching arm value.',
    array: 'Creates an array.',
    file_get_contents: 'Reads an entire file or stream into a string.',
    json_decode: 'Decodes a JSON string.',
    json_encode: 'Returns the JSON representation of a value.',
    strlen: 'Returns the length of a string.',
    trim: 'Strips whitespace from the beginning and end of a string.',
    printf: 'Outputs a formatted string.'
};
const OPEN_TO_CLOSE = {
    '(': ')',
    '[': ']',
    '{': '}'
};
const CLOSE_TO_OPEN = {
    ')': '(',
    ']': '[',
    '}': '{'
};
const wordAt = (text, position) => {
    const line = text.split('\n')[position.line] || '';
    const character = Math.max(0, Math.min(position.character, line.length));
    return ((line.slice(0, character).match(/\$?[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
        (line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || ''));
};
const skipQuotedString = (text, start, quote) => {
    let index = start + 1;
    while (index < text.length) {
        const character = text[index];
        if (character === '\\') {
            index += 2;
            continue;
        }
        if (character === quote)
            return index + 1;
        index += 1;
    }
    return -1;
};
function scanPhpSyntax(text) {
    const diagnostics = [];
    const stack = [];
    let index = 0;
    const pushDiagnostic = (offset, message) => {
        const bounded = Math.max(0, Math.min(offset, text.length));
        diagnostics.push({
            range: {
                start: positionAt(text, bounded),
                end: positionAt(text, Math.min(text.length, bounded + 1))
            },
            severity: 1,
            source: 'php',
            message
        });
    };
    while (index < text.length) {
        const character = text[index];
        const next = text[index + 1];
        if (character === '/' && next === '/') {
            const newline = text.indexOf('\n', index + 2);
            index = newline === -1 ? text.length : newline + 1;
            continue;
        }
        if (character === '#') {
            const newline = text.indexOf('\n', index + 1);
            index = newline === -1 ? text.length : newline + 1;
            continue;
        }
        if (character === '/' && next === '*') {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) {
                pushDiagnostic(index, 'Unterminated block comment');
                break;
            }
            index = end + 2;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            const end = skipQuotedString(text, index, character);
            if (end === -1) {
                pushDiagnostic(index, 'Unterminated string literal');
                break;
            }
            index = end;
            continue;
        }
        if (character in OPEN_TO_CLOSE) {
            stack.push({ character, offset: index });
            index += 1;
            continue;
        }
        if (character in CLOSE_TO_OPEN) {
            const expectedOpen = CLOSE_TO_OPEN[character];
            const last = stack.at(-1);
            if (!last || last.character !== expectedOpen) {
                pushDiagnostic(index, `Unexpected '${character}'`);
            }
            else {
                stack.pop();
            }
        }
        index += 1;
    }
    for (const item of stack.reverse()) {
        pushDiagnostic(item.offset, `Unclosed '${item.character}', expected '${OPEN_TO_CLOSE[item.character]}'`);
    }
    return diagnostics;
}
export function createPhpWorkerService() {
    let version = '8.4';
    return {
        name: 'wasm-idle-php-lsp',
        version,
        diagnosticDelay: 150,
        capabilities: {
            completionProvider: { triggerCharacters: ['$', ':', '>', '\\'] },
            hoverProvider: true,
            documentSymbolProvider: true
        },
        initialize(options, context) {
            const config = (options || {});
            version = config.version || version;
            context.reportProgress('load-php-language-service');
        },
        diagnostics(document) {
            return scanPhpSyntax(document.text);
        },
        completion() {
            return {
                isIncomplete: false,
                items: [
                    ...PHP_KEYWORDS.map((label) => ({
                        label,
                        kind: 14,
                        detail: PHP_HOVER[label] || 'PHP keyword'
                    })),
                    ...PHP_FUNCTIONS.map((label) => ({
                        label,
                        kind: 3,
                        insertText: `${label}($0)`,
                        detail: PHP_HOVER[label] || 'PHP function'
                    }))
                ]
            };
        },
        hover(document, position) {
            const word = wordAt(document.text, position).replace(/^\$/u, '');
            const description = PHP_HOVER[word];
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
            const pattern = /\b(class|interface|trait|enum|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gu;
            for (const match of document.text.matchAll(pattern)) {
                const offset = match.index || 0;
                const nameOffset = offset + match[0].lastIndexOf(match[2]);
                const kind = match[1] === 'function' ? 12 : match[1] === 'enum' ? 10 : 5;
                symbols.push({
                    name: match[2],
                    kind,
                    range: {
                        start: positionAt(document.text, offset),
                        end: positionAt(document.text, offset + match[0].length)
                    },
                    selectionRange: {
                        start: positionAt(document.text, nameOffset),
                        end: positionAt(document.text, nameOffset + match[2].length)
                    }
                });
            }
            return symbols;
        }
    };
}
//# sourceMappingURL=service.js.map