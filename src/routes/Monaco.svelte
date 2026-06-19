<script lang="ts">
	import { attachMonacoDebugActions, MonacoDebugView } from '$lib';
	import type { DebugLanguageAdapter } from '$lib/debug/language';
	import type {
		CompilerDiagnostic,
		DebugVariable,
		GoTarget,
		RustTargetTriple
	} from '$lib/playground/options';
	import type MonacoEditorComponent from '@seorii/monaco';
	import type {
		IMonacoInputEvent,
		IMonacoLspConnection,
		IMonacoLspProvider,
		IMonacoSetting
	} from '@seorii/monaco';
	import type { LanguageServerStatus } from '@wasm-idle/lsp';
	import type monaco from 'monaco-editor';
	import { onMount, untrack } from 'svelte';
	import {
		isEditorDefaultSource,
		isLegacyEditorDefaultSource,
		resolveEditorDefaultSource
	} from './editor-defaults';

	type DotnetLspLanguage = 'csharp' | 'fsharp' | 'vbnet';
	type ClangdStatus = LanguageServerStatus;
	type DotnetLspStatus = LanguageServerStatus;
	type GleamLspStatus = LanguageServerStatus;
	type GoLspStatus = LanguageServerStatus;
	type RustLspStatus = LanguageServerStatus;
	type TypeScriptLspStatus = LanguageServerStatus;
	type AssemblyScriptLspStatus = LanguageServerStatus;
	type WatLspStatus = LanguageServerStatus;
	type ZigLspStatus = LanguageServerStatus;
	type PhpLspStatus = LanguageServerStatus;
	type LuaLspStatus = LanguageServerStatus;
	type OcamlLspStatus = LanguageServerStatus;
	type HaskellLspStatus = LanguageServerStatus;

	const ocamlKeywords = [
		'and',
		'as',
		'assert',
		'begin',
		'class',
		'constraint',
		'do',
		'done',
		'downto',
		'else',
		'end',
		'exception',
		'external',
		'false',
		'for',
		'fun',
		'function',
		'functor',
		'if',
		'in',
		'include',
		'inherit',
		'initializer',
		'lazy',
		'let',
		'match',
		'method',
		'module',
		'mutable',
		'new',
		'nonrec',
		'object',
		'of',
		'open',
		'or',
		'private',
		'rec',
		'sig',
		'struct',
		'then',
		'to',
		'true',
		'try',
		'type',
		'val',
		'virtual',
		'when',
		'while',
		'with'
	];

	const ocamlOperators = [
		'=',
		'!=',
		'<',
		'>',
		'<=',
		'>=',
		':=',
		'::',
		'@',
		'|',
		'||',
		'&',
		'&&',
		'+',
		'-',
		'*',
		'/',
		'->',
		'<-',
		'=>'
	];

	const ocamlLanguageConfiguration = {
		comments: {
			blockComment: ['(*', '*)']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const ocamlMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.ocaml',
		keywords: ocamlKeywords,
		operators: ocamlOperators,
		symbols: /[=><!~?:&|+\-*/^%@]+/,
		escapes: /\\(?:[abfnrtv"'\\]|x[0-9A-Fa-f]{2}|[0-9]{3})/,
		tokenizer: {
			root: [
				[/[A-Z][\w']*/, 'type.identifier'],
				[/'[a-z_][\w']*/, 'type.identifier'],
				[/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
				[/\(\*/, 'comment', '@comment'],
				[/"/, 'string', '@string'],
				[/'([^'\\]|\\.)'/, 'string'],
				[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
				[/0[oO][0-7_]+/, 'number.octal'],
				[/0[bB][01_]+/, 'number.binary'],
				[/[0-9][\d_]*(\.[\d_]+)?([eE][\-+]?[\d_]+)?/, 'number'],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }]
			],
			comment: [
				[/[^(*)]+/, 'comment'],
				[/\(\*/, 'comment', '@push'],
				[/\*\)/, 'comment', '@pop'],
				[/[(*]/, 'comment']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/@escapes/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const fsharpKeywords = [
		'abstract',
		'and',
		'as',
		'assert',
		'base',
		'begin',
		'class',
		'default',
		'delegate',
		'do',
		'done',
		'downcast',
		'downto',
		'elif',
		'else',
		'end',
		'exception',
		'extern',
		'false',
		'finally',
		'for',
		'fun',
		'function',
		'if',
		'in',
		'inherit',
		'inline',
		'interface',
		'internal',
		'lazy',
		'let',
		'match',
		'member',
		'module',
		'mutable',
		'namespace',
		'new',
		'null',
		'of',
		'open',
		'or',
		'override',
		'private',
		'public',
		'rec',
		'return',
		'static',
		'struct',
		'then',
		'to',
		'true',
		'try',
		'type',
		'upcast',
		'use',
		'val',
		'void',
		'when',
		'while',
		'with',
		'yield'
	];

	const fsharpLanguageConfiguration = {
		comments: {
			lineComment: '//',
			blockComment: ['(*', '*)']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const fsharpMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.fsharp',
		keywords: fsharpKeywords,
		symbols: /[=><!~?:&|+\-*/^%@]+/,
		escapes: /\\(?:[abfnrtv"'\\]|u[0-9A-Fa-f]{4}|[0-9]{3})/,
		tokenizer: {
			root: [
				[/[A-Z][\w']*/, 'type.identifier'],
				[/'[a-z_][\w']*/, 'type.identifier'],
				[/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
				[/\/\/.*$/, 'comment'],
				[/\(\*/, 'comment', '@comment'],
				[/@"/, 'string', '@verbatimString'],
				[/"/, 'string', '@string'],
				[/'([^'\\]|\\.)'/, 'string'],
				[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
				[/[0-9][\d_]*(\.[\d_]+)?([eE][\-+]?[\d_]+)?/, 'number'],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/@symbols/, 'operator']
			],
			comment: [
				[/[^(*)]+/, 'comment'],
				[/\(\*/, 'comment', '@push'],
				[/\*\)/, 'comment', '@pop'],
				[/[(*]/, 'comment']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/@escapes/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/"/, 'string', '@pop']
			],
			verbatimString: [
				[/[^"]+/, 'string'],
				[/""/, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const dLanguageConfiguration = {
		comments: {
			lineComment: '//',
			blockComment: ['/*', '*/']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const dMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.d',
		keywords: [
			'abstract',
			'alias',
			'align',
			'asm',
			'assert',
			'auto',
			'body',
			'bool',
			'break',
			'byte',
			'case',
			'cast',
			'catch',
			'cdouble',
			'cent',
			'cfloat',
			'char',
			'class',
			'const',
			'continue',
			'creal',
			'debug',
			'default',
			'delegate',
			'delete',
			'deprecated',
			'do',
			'double',
			'else',
			'enum',
			'export',
			'extern',
			'false',
			'final',
			'finally',
			'float',
			'for',
			'foreach',
			'foreach_reverse',
			'function',
			'goto',
			'idouble',
			'if',
			'ifloat',
			'immutable',
			'import',
			'in',
			'inout',
			'int',
			'interface',
			'invariant',
			'ireal',
			'is',
			'lazy',
			'long',
			'macro',
			'mixin',
			'module',
			'new',
			'nothrow',
			'null',
			'out',
			'override',
			'package',
			'pragma',
			'private',
			'protected',
			'public',
			'pure',
			'real',
			'ref',
			'return',
			'scope',
			'shared',
			'short',
			'static',
			'struct',
			'super',
			'switch',
			'synchronized',
			'template',
			'this',
			'throw',
			'true',
			'try',
			'typeid',
			'typeof',
			'ubyte',
			'ucent',
			'uint',
			'ulong',
			'union',
			'unittest',
			'ushort',
			'version',
			'void',
			'wchar',
			'while',
			'with'
		],
		tokenizer: {
			root: [
				[/\/\/.*$/, 'comment'],
				[/\/\+/, 'comment', '@nestedComment'],
				[/\/\*/, 'comment', '@blockComment'],
				[/"/, 'string', '@stringDouble'],
				[/'([^'\\]|\\.)'/, 'string'],
				[/`[^`]*`/, 'string'],
				[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
				[/0[bB][01_]+/, 'number.binary'],
				[/\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][\-+]?\d[\d_]*)?\b/, 'number'],
				[/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!~?:&|+\-*/^%@]+/, 'operator']
			],
			blockComment: [
				[/[^*]+/, 'comment'],
				[/\*\//, 'comment', '@pop'],
				[/./, 'comment']
			],
			nestedComment: [
				[/[^/+]+/, 'comment'],
				[/\/\+/, 'comment', '@push'],
				[/\+\//, 'comment', '@pop'],
				[/[+/]/, 'comment']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[
					/\\(?:[abfnrtv"'\\]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
					'string.escape'
				],
				[/\\./, 'string.escape.invalid'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const zigLanguageConfiguration = {
		comments: {
			lineComment: '//'
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const zigMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.zig',
		keywords: [
			'addrspace',
			'align',
			'allowzero',
			'and',
			'anyframe',
			'anytype',
			'asm',
			'async',
			'await',
			'break',
			'callconv',
			'catch',
			'comptime',
			'const',
			'continue',
			'defer',
			'else',
			'enum',
			'errdefer',
			'error',
			'export',
			'extern',
			'fn',
			'for',
			'if',
			'inline',
			'linksection',
			'noalias',
			'noinline',
			'nosuspend',
			'opaque',
			'or',
			'orelse',
			'packed',
			'pub',
			'resume',
			'return',
			'struct',
			'suspend',
			'switch',
			'test',
			'threadlocal',
			'try',
			'union',
			'unreachable',
			'usingnamespace',
			'var',
			'volatile',
			'while'
		],
		builtins: [
			'bool',
			'comptime_float',
			'comptime_int',
			'f16',
			'f32',
			'f64',
			'f80',
			'f128',
			'false',
			'isize',
			'null',
			'true',
			'type',
			'undefined',
			'usize',
			'void'
		],
		tokenizer: {
			root: [
				[/\/\/.*$/, 'comment'],
				[/"/, 'string', '@stringDouble'],
				[/'([^'\\]|\\.)'/, 'string'],
				[/@[A-Za-z_]\w*/, 'annotation'],
				[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
				[/0[bB][01_]+/, 'number.binary'],
				[/\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][\-+]?\d[\d_]*)?\b/, 'number'],
				[
					/[A-Za-z_]\w*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!~?:&|+\-*/^%@]+/, 'operator']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[/\\(?:[nrt0"'\\]|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\})/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const haskellKeywords = [
		'as',
		'case',
		'class',
		'data',
		'default',
		'deriving',
		'do',
		'else',
		'family',
		'forall',
		'foreign',
		'hiding',
		'if',
		'import',
		'in',
		'infix',
		'infixl',
		'infixr',
		'instance',
		'let',
		'module',
		'newtype',
		'of',
		'qualified',
		'then',
		'type',
		'where'
	];

	const haskellLanguageConfiguration = {
		comments: {
			lineComment: '--',
			blockComment: ['{-', '-}']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const haskellMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.haskell',
		keywords: haskellKeywords,
		symbols: /[=><!~?:&|+\-*/^%@.$]+/,
		escapes: /\\(?:[abfnrtv"'\\&]|x[0-9A-Fa-f]+|o[0-7]+|[0-9]+)/,
		tokenizer: {
			root: [
				[/[A-Z][\w']*/, 'type.identifier'],
				[/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
				[/--.*$/, 'comment'],
				[/{-/, 'comment', '@comment'],
				[/"/, 'string', '@string'],
				[/'([^'\\]|\\.)'/, 'string'],
				[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
				[/0[oO][0-7_]+/, 'number.octal'],
				[/0[bB][01_]+/, 'number.binary'],
				[/[0-9][\d_]*(\.[\d_]+)?([eE][\-+]?[\d_]+)?/, 'number'],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/@symbols/, 'operator']
			],
			comment: [
				[/[^-{]+/, 'comment'],
				[/{-/, 'comment', '@push'],
				[/-}/, 'comment', '@pop'],
				[/[-{]/, 'comment']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/@escapes/, 'string.escape'],
				[/\\./, 'string.escape.invalid'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const schemeLanguageConfiguration = {
		comments: {
			lineComment: ';'
		},
		brackets: [
			['(', ')'],
			['[', ']'],
			['{', '}']
		],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const schemeMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.scheme',
		keywords: [
			'and',
			'begin',
			'case',
			'cond',
			'define',
			'define-library',
			'define-syntax',
			'delay',
			'do',
			'else',
			'if',
			'import',
			'include',
			'lambda',
			'let',
			'let*',
			'letrec',
			'let-syntax',
			'letrec-syntax',
			'or',
			'quasiquote',
			'quote',
			'set!',
			'syntax-rules',
			'unless',
			'unquote',
			'unquote-splicing',
			'when'
		],
		tokenizer: {
			root: [
				[/;.*$/, 'comment'],
				[/"/, 'string', '@string'],
				[/#\\(?:newline|space|tab|.)/, 'string.escape'],
				[/#(?:t|f|true|false)\b/, 'keyword'],
				[/[-+]?(?:\d+\.\d+|\d+)(?:[eE][-+]?\d+)?/, 'number'],
				[/[()[\]{}]/, '@brackets'],
				[/[^\s()[\]{}";]+/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const watLanguageConfiguration = {
		comments: {
			lineComment: ';;'
		},
		brackets: [
			['(', ')'],
			['[', ']']
		],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const watMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.wat',
		keywords: [
			'array',
			'block',
			'br',
			'br_if',
			'call',
			'data',
			'elem',
			'else',
			'end',
			'export',
			'func',
			'global',
			'if',
			'import',
			'local',
			'local.get',
			'local.set',
			'local.tee',
			'memory',
			'module',
			'mut',
			'param',
			'result',
			'return',
			'start',
			'table',
			'then',
			'type'
		],
		tokenizer: {
			root: [
				[/;;.*$/, 'comment'],
				[/\(;/, 'comment', '@comment'],
				[/"/, 'string', '@string'],
				[/\$[A-Za-z0-9_!#$%&'*+\-./:<=>?@\\^`|~]+/, 'variable'],
				[/(?:i32|i64|f32|f64)\.[A-Za-z0-9_.]+/, 'keyword'],
				[/[-+]?(?:0x[0-9A-Fa-f_]+|\d[\d_]*)(?:\.\d[\d_]*)?/, 'number'],
				[/[()[\]]/, '@brackets'],
				[
					/[A-Za-z_][\w.:-]*/,
					{ cases: { '@keywords': 'keyword', '@default': 'identifier' } }
				]
			],
			comment: [
				[/[^(;]+/, 'comment'],
				[/\(;/, 'comment', '@push'],
				[/;\)/, 'comment', '@pop'],
				[/[(;]/, 'comment']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\[0-9A-Fa-f]{2}/, 'string.escape'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const luaLanguageConfiguration = {
		comments: {
			lineComment: '--',
			blockComment: ['--[[', ']]']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const luaMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.lua',
		keywords: [
			'and',
			'break',
			'do',
			'else',
			'elseif',
			'end',
			'false',
			'for',
			'function',
			'goto',
			'if',
			'in',
			'local',
			'nil',
			'not',
			'or',
			'repeat',
			'return',
			'then',
			'true',
			'until',
			'while'
		],
		builtins: [
			'arg',
			'assert',
			'error',
			'ipairs',
			'io',
			'math',
			'next',
			'os',
			'pairs',
			'pcall',
			'print',
			'select',
			'string',
			'table',
			'tonumber',
			'tostring',
			'type',
			'xpcall'
		],
		tokenizer: {
			root: [
				[/--\[\[/, 'comment', '@comment'],
				[/--.*$/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/'([^'\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@stringDouble'],
				[/'/, 'string', '@stringSingle'],
				[/\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b/i, 'number'],
				[
					/[A-Za-z_]\w*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/[{}()[\]]/, '@brackets']
			],
			comment: [
				[/[^\]]+/, 'comment'],
				[/\]\]/, 'comment', '@pop'],
				[/./, 'comment']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			stringSingle: [
				[/[^\\']+/, 'string'],
				[/\\./, 'string.escape'],
				[/'/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const octaveLanguageConfiguration = {
		comments: {
			lineComment: '%',
			blockComment: ['%{', '%}']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const octaveMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.octave',
		keywords: [
			'break',
			'case',
			'catch',
			'classdef',
			'continue',
			'do',
			'else',
			'elseif',
			'end',
			'end_try_catch',
			'end_unwind_protect',
			'endclassdef',
			'endenumeration',
			'endevents',
			'endfor',
			'endfunction',
			'endif',
			'endmethods',
			'endparfor',
			'endproperties',
			'endswitch',
			'endwhile',
			'enumeration',
			'events',
			'for',
			'function',
			'global',
			'if',
			'methods',
			'otherwise',
			'parfor',
			'persistent',
			'properties',
			'return',
			'switch',
			'try',
			'until',
			'unwind_protect',
			'unwind_protect_cleanup',
			'while'
		],
		builtins: [
			'argv',
			'disp',
			'fgetl',
			'fprintf',
			'input',
			'isnan',
			'length',
			'printf',
			'size',
			'stdin',
			'str2double',
			'strtrim'
		],
		tokenizer: {
			root: [
				[/%\{/, 'comment', '@blockComment'],
				[/%.*/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/'([^'\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@stringDouble'],
				[/'/, 'string', '@stringSingle'],
				[/\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[ij]?\b/, 'number'],
				[/\b(?:Inf|NaN|true|false)\b/, 'constant'],
				[
					/[A-Za-z_]\w*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!~?:&|+\-*/\\^@]+/, 'operator']
			],
			blockComment: [
				[/%\}/, 'comment', '@pop'],
				[/[^%]+/, 'comment'],
				[/./, 'comment']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			stringSingle: [
				[/[^\\']+/, 'string'],
				[/''/, 'string.escape'],
				[/\\./, 'string.escape'],
				[/'/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const erlangLanguageConfiguration = {
		comments: {
			lineComment: '%'
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const erlangMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.erlang',
		keywords: [
			'after',
			'and',
			'andalso',
			'band',
			'begin',
			'bnot',
			'bor',
			'bsl',
			'bsr',
			'bxor',
			'case',
			'catch',
			'cond',
			'div',
			'end',
			'fun',
			'if',
			'let',
			'not',
			'of',
			'or',
			'orelse',
			'query',
			'receive',
			'rem',
			'try',
			'when',
			'xor'
		],
		attributes: ['module', 'export', 'import', 'define', 'include', 'include_lib', 'record'],
		builtins: ['erlang', 'io', 'lists', 'maps', 'string', 'timer'],
		tokenizer: {
			root: [
				[/%.*$/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@stringDouble'],
				[/'([^'\\]|\\.)*$/, 'string.invalid'],
				[/'/, 'string', '@quotedAtom'],
				[/\?[A-Za-z_]\w*/, 'variable.predefined'],
				[/-[a-z][A-Za-z0-9_@]*(?=\s*\()/, 'keyword'],
				[/\b\d+#[0-9A-Za-z]+\b/, 'number'],
				[/\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b/, 'number'],
				[
					/[a-z][A-Za-z0-9_@]*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@attributes': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/[A-Z_][A-Za-z0-9_@]*/, 'variable'],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!:+\-*/\\|&]+/, 'operator']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			quotedAtom: [
				[/[^\\']+/, 'string'],
				[/\\./, 'string.escape'],
				[/'/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const prologLanguageConfiguration = {
		comments: {
			lineComment: '%',
			blockComment: ['/*', '*/']
		},
		brackets: [
			['[', ']'],
			['(', ')'],
			['{', '}']
		],
		autoClosingPairs: [
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '{', close: '}' },
			{ open: "'", close: "'" },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '{', close: '}' },
			{ open: "'", close: "'" },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const prologMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.prolog',
		keywords: ['is', 'mod', 'not', 'true', 'fail', 'repeat', 'once'],
		builtins: [
			'format',
			'read',
			'read_line_to_string',
			'read_line_to_codes',
			'use_module',
			'write',
			'writeln'
		],
		tokenizer: {
			root: [
				[/%.*$/, 'comment'],
				[/\/\*/, 'comment', '@comment'],
				[/:-/, 'keyword'],
				[/[A-Z_][A-Za-z0-9_]*/, 'variable'],
				[
					/[a-z][A-Za-z0-9_]*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/\b\d+(?:\.\d+)?\b/, 'number'],
				[/'/, 'string', '@singleString'],
				[/"/, 'string', '@doubleString'],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!:+\-*/\\|&]+/, 'operator']
			],
			comment: [
				[/[^*/]+/, 'comment'],
				[/\/\*/, 'comment', '@push'],
				[/\*\//, 'comment', '@pop'],
				[/[*/]/, 'comment']
			],
			singleString: [
				[/[^\\']+/, 'string'],
				[/\\./, 'string.escape'],
				[/'/, 'string', '@pop']
			],
			doubleString: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const gleamLanguageConfiguration = {
		comments: {
			lineComment: '//'
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const gleamMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.gleam',
		keywords: [
			'as',
			'assert',
			'case',
			'const',
			'external',
			'fn',
			'if',
			'import',
			'let',
			'opaque',
			'pub',
			'todo',
			'type',
			'use'
		],
		constants: ['True', 'False', 'Nil', 'Ok', 'Error'],
		tokenizer: {
			root: [
				[/\/\/.*$/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@string'],
				[/\b\d+(?:\.\d+)?\b/, 'number'],
				[
					/[A-Z][A-Za-z0-9_]*/,
					{ cases: { '@constants': 'constant', '@default': 'type.identifier' } }
				],
				[
					/[a-z_][A-Za-z0-9_]*/,
					{ cases: { '@keywords': 'keyword', '@default': 'identifier' } }
				],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!:+\-*/\\|&]+/, 'operator']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const awkLanguageConfiguration = {
		comments: {
			lineComment: '#'
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: '/', close: '/' }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: '/', close: '/' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const awkMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.awk',
		keywords: [
			'BEGIN',
			'END',
			'BEGINFILE',
			'ENDFILE',
			'break',
			'continue',
			'delete',
			'do',
			'else',
			'exit',
			'for',
			'function',
			'if',
			'in',
			'next',
			'nextfile',
			'print',
			'printf',
			'return',
			'while'
		],
		builtins: [
			'atan2',
			'close',
			'cos',
			'exp',
			'fflush',
			'gsub',
			'index',
			'int',
			'length',
			'log',
			'match',
			'rand',
			'sin',
			'split',
			'sprintf',
			'sqrt',
			'srand',
			'sub',
			'substr',
			'system',
			'tolower',
			'toupper'
		],
		variables: [
			'ARGC',
			'ARGV',
			'CONVFMT',
			'ENVIRON',
			'FILENAME',
			'FNR',
			'FS',
			'NF',
			'NR',
			'OFMT',
			'OFS',
			'ORS',
			'RLENGTH',
			'RS',
			'RSTART',
			'SUBSEP'
		],
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@string'],
				[/\/([^\\/]|\\.)+\/[a-zA-Z]*/, 'regexp'],
				[/\$[0-9]+/, 'variable.predefined'],
				[/[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/, 'number'],
				[
					/[A-Za-z_][\w]*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'predefined',
							'@variables': 'variable.predefined',
							'@default': 'identifier'
						}
					}
				],
				[/[{}()[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],
				[/[=><!~?:+\-*/%^|&]+/, 'operator']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	export const editorValue = () => editor?.getValue() || '';

	let clangdStatus = $state<ClangdStatus>({ state: 'disabled' });
	let dotnetLspStatus = $state<DotnetLspStatus>({ state: 'disabled' });
	let gleamLspStatus = $state<GleamLspStatus>({ state: 'disabled' });
	let goLspStatus = $state<GoLspStatus>({ state: 'disabled' });
	let rustLspStatus = $state<RustLspStatus>({ state: 'disabled' });
	let typescriptLspStatus = $state<TypeScriptLspStatus>({ state: 'disabled' });
	let assemblyScriptLspStatus = $state<AssemblyScriptLspStatus>({ state: 'disabled' });
	let watLspStatus = $state<WatLspStatus>({ state: 'disabled' });
	let zigLspStatus = $state<ZigLspStatus>({ state: 'disabled' });
	let phpLspStatus = $state<PhpLspStatus>({ state: 'disabled' });
	let luaLspStatus = $state<LuaLspStatus>({ state: 'disabled' });
	let ocamlLspStatus = $state<OcamlLspStatus>({ state: 'disabled' });
	let haskellLspStatus = $state<HaskellLspStatus>({ state: 'disabled' });
	let model = $state<monaco.editor.ITextModel | undefined>();
	let debugView = $state<MonacoDebugView | null>(null);
	interface Props {
		compact?: boolean;
		editor: monaco.editor.IStandaloneCodeEditor | null;
		language: any;
		lspLanguage?: string;
		filePath?: string;
		value?: string;
		onChange?: (value: string) => void;
		rustTargetTriple?: RustTargetTriple;
		goTarget?: GoTarget;
		lspEnabled?: boolean;
		clangdEnabled?: boolean;
		clangdBaseUrl?: string;
		dotnetLspEnabled?: boolean;
		dotnetLspModuleUrl?: string;
		gleamLspEnabled?: boolean;
		gleamLspBaseUrl?: string;
		gleamLspManifestUrl?: string;
		goLspEnabled?: boolean;
		goLspCompilerUrl?: string;
		rustLspEnabled?: boolean;
		rustLspCompilerUrl?: string;
		typescriptLspLibUrl?: string;
		zigLspEnabled?: boolean;
		zigLspCompilerUrl?: string;
		zigLspStdlibUrl?: string;
		phpLspEnabled?: boolean;
		luaLspEnabled?: boolean;
		luaLspModuleUrl?: string;
		ocamlLspEnabled?: boolean;
		ocamlLspModuleUrl?: string;
		ocamlLspManifestUrl?: string;
		haskellLspEnabled?: boolean;
		haskellLspModuleUrl?: string;
		haskellLspRootfsUrl?: string;
		haskellLspBsdtarUrl?: string;
		breakpoints?: number[];
		debugLocals?: DebugVariable[];
		debugLanguage?: DebugLanguageAdapter | null;
		compilerDiagnostics?: CompilerDiagnostic[];
		pausedLine?: number | null;
		onCursorLineChange?: (line: number | null) => void;
		onRunToCursor?: (line: number | null) => void;
		onBreakpointsChange?: (lines: number[]) => void;
	}

	let {
		compact = false,
		editor = $bindable(),
		language,
		lspLanguage,
		filePath,
		value,
		onChange,
		rustTargetTriple = 'wasm32-wasip1',
		goTarget = 'wasip1/wasm',
		lspEnabled = false,
		clangdEnabled = false,
		clangdBaseUrl,
		dotnetLspEnabled = false,
		dotnetLspModuleUrl,
		gleamLspEnabled = false,
		gleamLspBaseUrl,
		gleamLspManifestUrl,
		goLspEnabled = false,
		goLspCompilerUrl,
		rustLspEnabled = false,
		rustLspCompilerUrl,
		typescriptLspLibUrl,
		zigLspEnabled = false,
		zigLspCompilerUrl,
		zigLspStdlibUrl,
		phpLspEnabled = false,
		luaLspEnabled = false,
		luaLspModuleUrl,
		ocamlLspEnabled = false,
		ocamlLspModuleUrl,
		ocamlLspManifestUrl,
		haskellLspEnabled = false,
		haskellLspModuleUrl,
		haskellLspRootfsUrl,
		haskellLspBsdtarUrl,
		breakpoints = [],
		debugLocals = [],
		debugLanguage = null,
		compilerDiagnostics = [],
		pausedLine = null,
		onCursorLineChange,
		onRunToCursor,
		onBreakpointsChange
	}: Props = $props();
	let Monaco = $state<typeof monaco | null>(null);
	let MonacoEditor = $state<typeof MonacoEditorComponent | null>(null);
	let applyingValue = false;
	let debugActionBindings: { dispose(): void } | null = null;
	const dotnetLspLanguage = $derived<DotnetLspLanguage | null>(
		language === 'csharp'
			? 'csharp'
			: language === 'fsharp'
				? 'fsharp'
				: language === 'vb'
					? 'vbnet'
					: null
	);
	const defaultLanguage = $derived(
		language === 'vb' ? 'vbnet' : language === 'sql' ? 'sqlite' : language
	);
	const activeLspLanguage = $derived(lspLanguage || language);
	const defaultValue = $derived(
		resolveEditorDefaultSource(
			defaultLanguage as
				| 'c'
				| 'cpp'
				| 'python'
				| 'java'
				| 'go'
				| 'd'
				| 'csharp'
				| 'fsharp'
				| 'vbnet'
				| 'elixir'
				| 'erlang'
				| 'prolog'
				| 'gleam'
				| 'perl'
				| 'tcl'
				| 'awk'
				| 'ocaml'
				| 'javascript'
				| 'typescript'
				| 'assemblyscript'
				| 'wat'
				| 'lua'
				| 'zig'
				| 'lisp'
				| 'ruby'
				| 'haskell'
				| 'r'
				| 'octave'
				| 'sqlite'
				| 'php'
				| 'rust',
			rustTargetTriple
		)
	);
	const normalizedFilePath = $derived(
		(filePath || `main.${language || 'txt'}`).replace(/\\/g, '/').replace(/^\/+/, '') ||
			'main.txt'
	);
	const modelUriString = $derived(`file:///workspace/${normalizedFilePath}`);
	const editorSetting = $derived<IMonacoSetting>({
		automaticLayout: true,
		fontSize: compact ? 13 : 14,
		lineHeight: compact ? 20 : 22,
		lineNumbersMinChars: compact ? 3 : 5,
		minimap: { enabled: false },
		occurrencesHighlight: 'off',
		glyphMargin: language === 'cpp' || !!debugLanguage,
		padding: compact ? { top: 10, bottom: 10 } : { top: 14, bottom: 14 },
		scrollbar: {
			horizontalScrollbarSize: compact ? 8 : 12,
			verticalScrollbarSize: compact ? 8 : 12
		},
		wordWrap: compact ? 'on' : 'off'
	});
	const lspConnectionKey = $derived(
		[
			language,
			normalizedFilePath,
			clangdEnabled ? clangdBaseUrl || '' : '',
			dotnetLspEnabled ? dotnetLspModuleUrl || '' : '',
			gleamLspEnabled ? gleamLspBaseUrl || '' : '',
			gleamLspEnabled ? gleamLspManifestUrl || '' : '',
			goLspEnabled ? goLspCompilerUrl || '' : '',
			goTarget,
			rustLspEnabled ? rustLspCompilerUrl || '' : '',
			rustTargetTriple,
			zigLspEnabled ? zigLspCompilerUrl || '' : '',
			zigLspEnabled ? zigLspStdlibUrl || '' : '',
			phpLspEnabled ? 'php-lsp-on' : '',
			luaLspEnabled ? luaLspModuleUrl || '' : '',
			ocamlLspEnabled ? ocamlLspModuleUrl || '' : '',
			ocamlLspEnabled ? ocamlLspManifestUrl || '' : '',
			haskellLspEnabled ? haskellLspModuleUrl || '' : '',
			haskellLspEnabled ? haskellLspRootfsUrl || '' : '',
			haskellLspEnabled ? haskellLspBsdtarUrl || '' : '',
			activeLspLanguage,
			lspEnabled ? 'lsp-on' : 'lsp-off',
			typescriptLspLibUrl || ''
		].join('\n')
	);
	const resolveLspConnection = $derived<IMonacoLspProvider>(
		((key) => async () => {
			if (key !== lspConnectionKey) return null;
			const currentUrl = globalThis.location?.href || '';
			if (!lspEnabled) {
				clangdStatus = { state: 'disabled' };
				dotnetLspStatus = { state: 'disabled' };
				gleamLspStatus = { state: 'disabled' };
				goLspStatus = { state: 'disabled' };
				rustLspStatus = { state: 'disabled' };
				typescriptLspStatus = { state: 'disabled' };
				assemblyScriptLspStatus = { state: 'disabled' };
				watLspStatus = { state: 'disabled' };
				zigLspStatus = { state: 'disabled' };
				phpLspStatus = { state: 'disabled' };
				luaLspStatus = { state: 'disabled' };
				ocamlLspStatus = { state: 'disabled' };
				haskellLspStatus = { state: 'disabled' };
				return null;
			}
			if (language === 'cpp') {
				if (!clangdEnabled || !clangdBaseUrl) {
					clangdStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getCppLanguageServer } = await import('@wasm-idle/lsp');
					const handle = await getCppLanguageServer({
						cpp: { baseUrl: clangdBaseUrl },
						currentUrl,
						onStatus: (status) => (clangdStatus = status)
					});
					handle.syncFile?.(normalizedFilePath);
					return handle as unknown as IMonacoLspConnection;
				} catch (error) {
					clangdStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (dotnetLspLanguage) {
				if (!dotnetLspEnabled || !dotnetLspModuleUrl) {
					dotnetLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const {
						getCSharpLanguageServer,
						getFSharpLanguageServer,
						getVisualBasicLanguageServer
					} = await import('@wasm-idle/lsp');
					const load =
						dotnetLspLanguage === 'csharp'
							? getCSharpLanguageServer
							: dotnetLspLanguage === 'fsharp'
								? getFSharpLanguageServer
								: getVisualBasicLanguageServer;
					return (await load({
						currentUrl,
						dotnet: { moduleUrl: dotnetLspModuleUrl },
						onStatus: (status) => (dotnetLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					dotnetLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (language === 'gleam') {
				if (!gleamLspEnabled || !gleamLspBaseUrl) {
					gleamLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getGleamLanguageServer } = await import('@wasm-idle/lsp');
					return (await getGleamLanguageServer({
						currentUrl,
						gleam: {
							baseUrl: gleamLspBaseUrl,
							manifestUrl: gleamLspManifestUrl
						},
						onStatus: (status) => (gleamLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					gleamLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (language === 'go') {
				if (!goLspEnabled || !goLspCompilerUrl) {
					goLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getGoLanguageServer } = await import('@wasm-idle/lsp');
					return (await getGoLanguageServer({
						currentUrl,
						go: {
							compilerUrl: goLspCompilerUrl,
							target: goTarget
						},
						onStatus: (status) => (goLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					goLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (language === 'rust') {
				if (!rustLspEnabled || !rustLspCompilerUrl) {
					rustLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getRustLanguageServer } = await import('@wasm-idle/lsp');
					return (await getRustLanguageServer({
						currentUrl,
						rust: {
							compilerUrl: rustLspCompilerUrl,
							targetTriple: rustTargetTriple
						},
						onStatus: (status) => (rustLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					rustLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'typescript') {
				try {
					const { getTypeScriptLanguageServer } = await import('@wasm-idle/lsp');
					return (await getTypeScriptLanguageServer({
						currentUrl,
						typescript: { libUrl: typescriptLspLibUrl },
						onStatus: (status) => (typescriptLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					typescriptLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'javascript') {
				try {
					const { getJavaScriptLanguageServer } = await import('@wasm-idle/lsp');
					return (await getJavaScriptLanguageServer({
						currentUrl,
						javascript: { libUrl: typescriptLspLibUrl },
						onStatus: (status) => (typescriptLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					typescriptLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'assemblyscript') {
				try {
					const { getAssemblyScriptLanguageServer } = await import('@wasm-idle/lsp');
					return (await getAssemblyScriptLanguageServer({
						currentUrl,
						onStatus: (status) => (assemblyScriptLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					assemblyScriptLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'wat') {
				try {
					const { getWatLanguageServer } = await import('@wasm-idle/lsp');
					return (await getWatLanguageServer({
						currentUrl,
						onStatus: (status) => (watLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					watLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'zig') {
				if (!zigLspEnabled || !zigLspCompilerUrl || !zigLspStdlibUrl) {
					zigLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getZigLanguageServer } = await import('@wasm-idle/lsp');
					return (await getZigLanguageServer({
						currentUrl,
						zig: {
							compilerUrl: zigLspCompilerUrl,
							stdlibUrl: zigLspStdlibUrl
						},
						onStatus: (status) => (zigLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					zigLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'php') {
				if (!phpLspEnabled) {
					phpLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getPhpLanguageServer } = await import('@wasm-idle/lsp');
					return (await getPhpLanguageServer({
						currentUrl,
						onStatus: (status) => (phpLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					phpLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'lua') {
				if (!luaLspEnabled || !luaLspModuleUrl) {
					luaLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getLuaLanguageServer } = await import('@wasm-idle/lsp');
					return (await getLuaLanguageServer({
						currentUrl,
						lua: {
							moduleUrl: luaLspModuleUrl
						},
						onStatus: (status) => (luaLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					luaLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'ocaml') {
				if (!ocamlLspEnabled || !ocamlLspModuleUrl || !ocamlLspManifestUrl) {
					ocamlLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getOcamlLanguageServer } = await import('@wasm-idle/lsp');
					return (await getOcamlLanguageServer({
						currentUrl,
						ocaml: {
							moduleUrl: ocamlLspModuleUrl,
							manifestUrl: ocamlLspManifestUrl
						},
						onStatus: (status) => (ocamlLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					ocamlLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			if (activeLspLanguage === 'haskell') {
				if (
					!haskellLspEnabled ||
					!haskellLspModuleUrl ||
					!haskellLspRootfsUrl ||
					!haskellLspBsdtarUrl
				) {
					haskellLspStatus = { state: 'disabled' };
					return null;
				}
				try {
					const { getHaskellLanguageServer } = await import('@wasm-idle/lsp');
					return (await getHaskellLanguageServer({
						currentUrl,
						haskell: {
							moduleUrl: haskellLspModuleUrl,
							rootfsUrl: haskellLspRootfsUrl,
							bsdtarUrl: haskellLspBsdtarUrl
						},
						onStatus: (status) => (haskellLspStatus = status)
					})) as unknown as IMonacoLspConnection;
				} catch (error) {
					haskellLspStatus = {
						state: 'error',
						message: error instanceof Error ? error.message : String(error)
					};
					throw error;
				}
			}
			return null;
		})(lspConnectionKey)
	);

	$effect(() => {
		const monacoApi = Monaco;
		if (!monacoApi) return;
		const uri = monacoApi.Uri.parse(modelUriString);
		const initialValue = untrack(() => value ?? defaultValue);
		let nextModel = monacoApi.editor.getModel(uri) as monaco.editor.ITextModel | null;
		if (!nextModel) {
			nextModel = monacoApi.editor.createModel(initialValue, language, uri);
		} else {
			monacoApi.editor.setModelLanguage(nextModel, language);
			if (nextModel.getValue() !== initialValue) nextModel.setValue(initialValue);
		}
		model = nextModel;
		return () => {
			if (!nextModel?.isDisposed()) {
				monacoApi.editor.setModelMarkers(nextModel, 'wasm-idle-compiler', []);
				nextModel.dispose();
			}
			if (model === nextModel) model = undefined;
		};
	});

	$effect(() => {
		if (!lspEnabled) {
			clangdStatus = { state: 'disabled' };
			dotnetLspStatus = { state: 'disabled' };
			gleamLspStatus = { state: 'disabled' };
			goLspStatus = { state: 'disabled' };
			rustLspStatus = { state: 'disabled' };
			typescriptLspStatus = { state: 'disabled' };
			assemblyScriptLspStatus = { state: 'disabled' };
			watLspStatus = { state: 'disabled' };
			zigLspStatus = { state: 'disabled' };
			phpLspStatus = { state: 'disabled' };
			luaLspStatus = { state: 'disabled' };
			ocamlLspStatus = { state: 'disabled' };
			haskellLspStatus = { state: 'disabled' };
			return;
		}
		if (language !== 'cpp' || !clangdEnabled || !clangdBaseUrl) {
			clangdStatus = { state: 'disabled' };
		}
		if (!dotnetLspLanguage || !dotnetLspEnabled || !dotnetLspModuleUrl) {
			dotnetLspStatus = { state: 'disabled' };
		}
		if (language !== 'gleam' || !gleamLspEnabled || !gleamLspBaseUrl) {
			gleamLspStatus = { state: 'disabled' };
		}
		if (language !== 'go' || !goLspEnabled || !goLspCompilerUrl) {
			goLspStatus = { state: 'disabled' };
		}
		if (language !== 'rust' || !rustLspEnabled || !rustLspCompilerUrl) {
			rustLspStatus = { state: 'disabled' };
		}
		if (activeLspLanguage !== 'typescript' && activeLspLanguage !== 'javascript') {
			typescriptLspStatus = { state: 'disabled' };
		}
		if (activeLspLanguage !== 'assemblyscript') {
			assemblyScriptLspStatus = { state: 'disabled' };
		}
		if (activeLspLanguage !== 'wat') {
			watLspStatus = { state: 'disabled' };
		}
		if (
			activeLspLanguage !== 'zig' ||
			!zigLspEnabled ||
			!zigLspCompilerUrl ||
			!zigLspStdlibUrl
		) {
			zigLspStatus = { state: 'disabled' };
		}
		if (activeLspLanguage !== 'php' || !phpLspEnabled) {
			phpLspStatus = { state: 'disabled' };
		}
		if (activeLspLanguage !== 'lua' || !luaLspEnabled || !luaLspModuleUrl) {
			luaLspStatus = { state: 'disabled' };
		}
		if (
			activeLspLanguage !== 'ocaml' ||
			!ocamlLspEnabled ||
			!ocamlLspModuleUrl ||
			!ocamlLspManifestUrl
		) {
			ocamlLspStatus = { state: 'disabled' };
		}
		if (
			activeLspLanguage !== 'haskell' ||
			!haskellLspEnabled ||
			!haskellLspModuleUrl ||
			!haskellLspRootfsUrl ||
			!haskellLspBsdtarUrl
		) {
			haskellLspStatus = { state: 'disabled' };
		}
	});

	const handleEditorLoad = (nextEditor: monaco.editor.IStandaloneCodeEditor) => {
		editor = nextEditor;
	};

	const handleEditorInput = (event: IMonacoInputEvent) => {
		if (!applyingValue) onChange?.(event.value);
	};

	$effect(() => {
		if (!debugView) return;
		debugView.setBreakpoints(debugLanguage ? breakpoints : []);
		debugView.setPauseState(debugLanguage ? pausedLine : null, debugLocals, debugLanguage);
	});

	$effect(() => {
		const monacoApi = Monaco;
		const activeEditor = editor;
		if (!monacoApi || !activeEditor || (language !== 'cpp' && !debugLanguage)) return;
		untrack(() => {
			debugView?.dispose();
			debugActionBindings?.dispose();
		});
		const nextDebugView = new MonacoDebugView(monacoApi, activeEditor, onBreakpointsChange);
		nextDebugView.setBreakpoints(debugLanguage ? breakpoints : []);
		nextDebugView.setPauseState(debugLanguage ? pausedLine : null, debugLocals, debugLanguage);
		debugView = nextDebugView;
		debugActionBindings = attachMonacoDebugActions(activeEditor, {
			onCursorLineChange,
			onRunToCursor
		});
		return () => {
			debugActionBindings?.dispose();
			debugActionBindings = null;
			nextDebugView.dispose();
			if (debugView === nextDebugView) debugView = null;
		};
	});

	$effect(() => {
		const activeModel = model || editor?.getModel();
		if (!activeModel || value === undefined || activeModel.getValue() === value) return;
		const viewState = editor?.saveViewState();
		applyingValue = true;
		activeModel.setValue(value);
		if (viewState) editor?.restoreViewState(viewState);
		applyingValue = false;
	});

	$effect(() => {
		const monacoApi = Monaco;
		if (!monacoApi || !editor) return;
		const activeModel = model || editor.getModel();
		if (!activeModel) return;
		const markers =
			language === 'java' ||
			language === 'rust' ||
			language === 'go' ||
			language === 'd' ||
			language === 'csharp' ||
			language === 'fsharp' ||
			language === 'vb' ||
			language === 'erlang' ||
			language === 'prolog' ||
			language === 'gleam' ||
			language === 'perl' ||
			language === 'ocaml' ||
			language === 'javascript' ||
			language === 'typescript' ||
			language === 'wat' ||
			language === 'lua' ||
			language === 'zig' ||
			language === 'lisp' ||
			language === 'haskell' ||
			language === 'r' ||
			language === 'octave' ||
			language === 'cpp'
				? compilerDiagnostics.map((diagnostic) => ({
						severity:
							diagnostic.severity === 'warning'
								? monacoApi.MarkerSeverity.Warning
								: diagnostic.severity === 'other'
									? monacoApi.MarkerSeverity.Info
									: monacoApi.MarkerSeverity.Error,
						message: diagnostic.message,
						startLineNumber: Math.max(1, diagnostic.lineNumber || 1),
						startColumn: Math.max(1, diagnostic.columnNumber || 1),
						endLineNumber: Math.max(1, diagnostic.lineNumber || 1),
						endColumn: Math.max(
							1,
							diagnostic.endColumnNumber || diagnostic.columnNumber || 2
						)
					}))
				: [];
		monacoApi.editor.setModelMarkers(activeModel, 'wasm-idle-compiler', markers);
	});

	$effect(() => {
		const activeModel = model || editor?.getModel();
		if (!activeModel) return;
		if (value !== undefined) return;
		const currentValue = activeModel.getValue();
		if (!isEditorDefaultSource(currentValue) && !isLegacyEditorDefaultSource(currentValue)) {
			return;
		}
		if (currentValue !== defaultValue) {
			activeModel.setValue(defaultValue);
		}
	});

	onMount(() => {
		let disposed = false;
		void (async () => {
			const [monacoComponent, workers] = await Promise.all([
				import('@seorii/monaco'),
				import('@seorii/monaco/workers')
			]);
			if (disposed) return;
			(globalThis as typeof globalThis & { MonacoEnvironment?: unknown }).MonacoEnvironment =
				workers.createMonacoEnvironment();
			MonacoEditor = monacoComponent.default;
			let languageContribution: Promise<unknown> = Promise.resolve();
			switch (language) {
				case 'c':
				case 'cpp':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js');
					break;
				case 'csharp':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js');
					break;
				case 'elixir':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution.js');
					break;
				case 'go':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js');
					break;
				case 'java':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js');
					break;
				case 'javascript':
				case 'typescript':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js');
					break;
				case 'perl':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js');
					break;
				case 'tcl':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/tcl/tcl.contribution.js');
					break;
				case 'php':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js');
					break;
				case 'python':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js');
					break;
				case 'r':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/r/r.contribution.js');
					break;
				case 'ruby':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js');
					break;
				case 'rust':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js');
					break;
				case 'sql':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js');
					break;
				case 'vb':
					languageContribution =
						import('monaco-editor/esm/vs/basic-languages/vb/vb.contribution.js');
					break;
			}
			const [m] = await Promise.all([monacoComponent.loadMonaco(), languageContribution]);
			if (disposed) return;
			Monaco = m;
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'ocaml')) {
				Monaco.languages.register({
					id: 'ocaml',
					aliases: ['OCaml', 'ocaml'],
					extensions: ['.ml', '.mli']
				});
			}
			Monaco.languages.setLanguageConfiguration('ocaml', ocamlLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('ocaml', ocamlMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'fsharp')) {
				Monaco.languages.register({
					id: 'fsharp',
					aliases: ['F#', 'FSharp', 'fsharp'],
					extensions: ['.fs', '.fsx', '.fsi']
				});
			}
			Monaco.languages.setLanguageConfiguration('fsharp', fsharpLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('fsharp', fsharpMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'd')) {
				Monaco.languages.register({
					id: 'd',
					aliases: ['D', 'd'],
					extensions: ['.d']
				});
			}
			Monaco.languages.setLanguageConfiguration('d', dLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('d', dMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'zig')) {
				Monaco.languages.register({
					id: 'zig',
					aliases: ['Zig', 'zig'],
					extensions: ['.zig']
				});
			}
			Monaco.languages.setLanguageConfiguration('zig', zigLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('zig', zigMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'wat')) {
				Monaco.languages.register({
					id: 'wat',
					aliases: ['WAT', 'WebAssembly Text', 'wat'],
					extensions: ['.wat', '.wast']
				});
			}
			Monaco.languages.setLanguageConfiguration('wat', watLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('wat', watMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'lua')) {
				Monaco.languages.register({
					id: 'lua',
					aliases: ['Lua', 'lua'],
					extensions: ['.lua']
				});
			}
			Monaco.languages.setLanguageConfiguration('lua', luaLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('lua', luaMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'erlang')) {
				Monaco.languages.register({
					id: 'erlang',
					aliases: ['Erlang', 'erlang', 'erl'],
					extensions: ['.erl', '.hrl']
				});
			}
			Monaco.languages.setLanguageConfiguration('erlang', erlangLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('erlang', erlangMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'prolog')) {
				Monaco.languages.register({
					id: 'prolog',
					aliases: ['Prolog', 'SWI-Prolog', 'prolog', 'swipl'],
					extensions: ['.prolog', '.pro']
				});
			}
			Monaco.languages.setLanguageConfiguration('prolog', prologLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('prolog', prologMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'gleam')) {
				Monaco.languages.register({
					id: 'gleam',
					aliases: ['Gleam', 'gleam'],
					extensions: ['.gleam']
				});
			}
			Monaco.languages.setLanguageConfiguration('gleam', gleamLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('gleam', gleamMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'awk')) {
				Monaco.languages.register({
					id: 'awk',
					aliases: ['AWK', 'awk', 'gawk'],
					extensions: ['.awk', '.gawk']
				});
			}
			Monaco.languages.setLanguageConfiguration('awk', awkLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('awk', awkMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'octave')) {
				Monaco.languages.register({
					id: 'octave',
					aliases: ['Octave', 'MATLAB', 'octave', 'matlab'],
					extensions: ['.m']
				});
			}
			Monaco.languages.setLanguageConfiguration('octave', octaveLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('octave', octaveMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'haskell')) {
				Monaco.languages.register({
					id: 'haskell',
					aliases: ['Haskell', 'haskell'],
					extensions: ['.hs', '.lhs']
				});
			}
			Monaco.languages.setLanguageConfiguration('haskell', haskellLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('haskell', haskellMonarchTokens);
			if (!Monaco.languages.getLanguages().some(({ id }) => id === 'lisp')) {
				Monaco.languages.register({
					id: 'lisp',
					aliases: ['Scheme', 'Lisp', 'scheme', 'lisp'],
					extensions: ['.scm', '.ss', '.sls', '.lisp', '.lsp']
				});
			}
			Monaco.languages.setLanguageConfiguration('lisp', schemeLanguageConfiguration);
			Monaco.languages.setMonarchTokensProvider('lisp', schemeMonarchTokens);
		})();

		return () => {
			disposed = true;
			debugActionBindings?.dispose();
			debugActionBindings = null;
			debugView?.dispose();
			debugView = null;
			const activeModel = model || editor?.getModel();
			if (Monaco && activeModel)
				Monaco.editor.setModelMarkers(activeModel, 'wasm-idle-compiler', []);
			if (!model?.isDisposed()) model?.dispose();
			model = undefined;
			editor = null;
		};
	});
</script>

<main>
	<div class="editor-host">
		{#if Monaco && model}
			<MonacoEditor
				{model}
				setting={editorSetting}
				lsp={resolveLspConnection}
				onload={handleEditorLoad}
				oninput={handleEditorInput}
			/>
		{/if}
	</div>
</main>

<style>
	main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		border-left: 0;
		position: relative;
		overflow: hidden;
	}

	.editor-host {
		flex: 1;
		min-height: 0;
	}

	:global(.monaco-editor .debug-breakpoint-glyph) {
		background: #dc2626;
		border-radius: 999px;
		margin-left: 5px;
		width: 10px !important;
		height: 10px !important;
	}

	:global(.debug-paused-line-widget) {
		background: rgba(37, 99, 235, 0.16);
		box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
		border-radius: 3px;
		pointer-events: none;
	}

	:global(.monaco-editor .debug-inline-values) {
		color: #475569;
		font-style: italic;
		font-weight: 500;
	}

	@media (max-width: 960px) {
		main {
			min-height: 360px;
			border-left: 0;
			border-top: 1px solid #e5e7eb;
		}
	}
</style>
