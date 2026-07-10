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
		IMonacoLspProvider,
		IMonacoLspProviderResult,
		IMonacoSetting
	} from '@seorii/monaco';
	import type { EditorLanguageServerHandle, LanguageServerStatus } from '@wasm-idle/lsp';
	import type monaco from 'monaco-editor';
	import { onMount, untrack } from 'svelte';
	import {
		isEditorDefaultSource,
		isLegacyEditorDefaultSource,
		resolveEditorDefaultSource
	} from './editor-defaults';
	import {
		debugViewLanguages,
		defaultLanguageAliases,
		diagnosticMarkerLanguages,
		dotnetMonacoLspLanguages,
		monacoLanguageContributionLoaders,
		type DotnetLspLanguage
	} from './language-registry';

	type MonacoTestGlobal = typeof globalThis & {
		__wasmIdleMonacoApi?: typeof monaco | null;
		__wasmIdleMonacoEditor?: monaco.editor.IStandaloneCodeEditor | null;
		__wasmIdleMonacoLspStatus?: Record<string, LanguageServerStatus> | null;
	};
	type MonacoLspStatusView = {
		label: string;
		state: 'loading' | 'ready' | 'error';
		text: string;
		title: string;
		progressPercent: number | null;
	};
	type MonacoLspProviderContext = {
		signal?: AbortSignal;
	};
	interface LspRoute {
		languages: readonly string[];
		isEnabled: () => boolean;
		setStatus: (status: LanguageServerStatus) => void;
		load: (currentUrl: string) => Promise<EditorLanguageServerHandle>;
	}

	const monacoTestHooksEnabled = () => {
		try {
			return new URL(globalThis.location?.href || '').searchParams.get('lsp-test') === '1';
		} catch {
			return false;
		}
	};
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

	const janetLanguageConfiguration = {
		comments: {
			lineComment: '#'
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

	const janetMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.janet',
		keywords: [
			'break',
			'def',
			'defglobal',
			'defmacro',
			'defn',
			'do',
			'each',
			'eachk',
			'fn',
			'for',
			'if',
			'import',
			'let',
			'loop',
			'macex',
			'quote',
			'try',
			'var',
			'when',
			'while'
		],
		builtins: ['file/read', 'getline', 'print', 'printf', 'scan-number', 'string/trim'],
		tokenizer: {
			root: [
				[/#!.*$/, 'comment'],
				[/#.*$/, 'comment'],
				[/@"/, 'string', '@string'],
				[/"/, 'string', '@string'],
				[/:(?:[^\s()[\]{}";]+)/, 'type.identifier'],
				[/[-+]?(?:\d+\.\d+|\d+)(?:[eE][-+]?\d+)?/, 'number'],
				[/[()[\]{}]/, '@brackets'],
				[
					/[^\s()[\]{}";]+/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'predefined',
							'@default': 'identifier'
						}
					}
				]
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const juliaLanguageConfiguration = {
		comments: {
			lineComment: '#'
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
			{ open: '"', close: '"' },
			{ open: '"""', close: '"""' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const juliaMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.julia',
		keywords: [
			'abstract',
			'baremodule',
			'begin',
			'break',
			'catch',
			'const',
			'continue',
			'do',
			'else',
			'elseif',
			'end',
			'export',
			'finally',
			'for',
			'function',
			'global',
			'if',
			'import',
			'let',
			'local',
			'macro',
			'module',
			'mutable',
			'primitive',
			'quote',
			'return',
			'struct',
			'try',
			'type',
			'using',
			'while'
		],
		builtins: [
			'eachline',
			'parse',
			'print',
			'println',
			'read',
			'readline',
			'readlines',
			'stdin'
		],
		tokenizer: {
			root: [
				[/#=.*=#/, 'comment'],
				[/#.*$/, 'comment'],
				[/"""/, 'string', '@tripleString'],
				[/"/, 'string', '@string'],
				[/:(?:[A-Za-z_]\w*)/, 'type.identifier'],
				[/[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eEfF][-+]?\d+)?/, 'number'],
				[/[()[\]{}]/, '@brackets'],
				[
					/[A-Za-z_]\w*!?/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'predefined',
							'@default': 'identifier'
						}
					}
				]
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			tripleString: [
				[/[^"]+/, 'string'],
				[/"""/, 'string', '@pop'],
				[/"/, 'string']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const nimLanguageConfiguration = {
		comments: {
			lineComment: '#'
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
			{ open: '"', close: '"' },
			{ open: '"""', close: '"""' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const nimMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.nim',
		keywords: [
			'addr',
			'and',
			'as',
			'asm',
			'bind',
			'block',
			'break',
			'case',
			'cast',
			'concept',
			'const',
			'continue',
			'converter',
			'defer',
			'discard',
			'distinct',
			'do',
			'elif',
			'else',
			'end',
			'enum',
			'except',
			'export',
			'finally',
			'for',
			'from',
			'func',
			'if',
			'import',
			'in',
			'include',
			'interface',
			'is',
			'isnot',
			'iterator',
			'let',
			'macro',
			'method',
			'mixin',
			'not',
			'notin',
			'object',
			'of',
			'or',
			'out',
			'proc',
			'ptr',
			'raise',
			'ref',
			'return',
			'static',
			'template',
			'try',
			'tuple',
			'type',
			'using',
			'var',
			'when',
			'while',
			'xor',
			'yield'
		],
		builtins: ['echo', 'parseInt', 'readAll', 'readLine', 'stdin', 'stdout', 'stderr'],
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/"""/, 'string', '@tripleString'],
				[/"/, 'string', '@string'],
				[/\b(?:true|false|nil)\b/, 'constant'],
				[/[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/, 'number'],
				[/[()[\]{}]/, '@brackets'],
				[
					/[A-Za-z_]\w*\*?/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'predefined',
							'@default': 'identifier'
						}
					}
				]
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			tripleString: [
				[/[^"]+/, 'string'],
				[/"""/, 'string', '@pop'],
				[/"/, 'string']
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

	const wasmLanguageConfiguration = {
		comments: {
			lineComment: '#'
		}
	} satisfies monaco.languages.LanguageConfiguration;

	const wasmMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.wasm',
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/^data:[^,]+,/, 'keyword'],
				[/^(?:base64|wasm):/i, 'keyword'],
				[/0x[0-9A-Fa-f]+/, 'number.hex'],
				[/[0-9A-Fa-f]{2,}/, 'number.hex'],
				[/[A-Za-z0-9+/=_-]+/, 'string']
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

	const forthLanguageConfiguration = {
		comments: {
			lineComment: '\\'
		},
		brackets: [['(', ')']],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const forthMonarchTokens = {
		defaultToken: '',
		ignoreCase: true,
		tokenPostfix: '.forth',
		keywords: [
			':',
			';',
			'begin',
			'until',
			'while',
			'repeat',
			'if',
			'else',
			'then',
			'do',
			'loop',
			'constant',
			'variable',
			'create',
			'does>',
			'immediate',
			'recurse'
		],
		builtins: [
			'accept',
			'cr',
			'drop',
			'dup',
			'emit',
			'key',
			'over',
			'refill',
			'rot',
			'swap',
			'tuck',
			'type',
			'words'
		],
		operators: [
			'+',
			'-',
			'*',
			'/',
			'/mod',
			'<',
			'<=',
			'=',
			'<>',
			'>',
			'>=',
			'and',
			'invert',
			'mod',
			'or',
			'xor'
		],
		tokenizer: {
			root: [
				[/\\.*$/, 'comment'],
				[/\([^)]*\)/, 'comment'],
				[/\."/, 'keyword', '@string'],
				[/S"/, 'keyword', '@string'],
				[/[-+]?\d+/, 'number'],
				[
					/[^\s()[\]"\\]+/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@operators': 'operator',
							'@default': 'identifier'
						}
					}
				],
				[/[()[\]]/, '@brackets']
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const jLanguageConfiguration = {
		comments: {
			lineComment: 'NB.'
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
			{ open: "'", close: "'" },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: "'", close: "'" },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const jMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.j',
		keywords: [
			'assert.',
			'break.',
			'case.',
			'catch.',
			'do.',
			'else.',
			'elseif.',
			'end.',
			'for.',
			'if.',
			'return.',
			'select.',
			'throw.',
			'try.',
			'while.'
		],
		builtins: ['cocurrent', 'coinsert', 'coname', 'load', 'require', 'smoutput'],
		tokenizer: {
			root: [
				[/NB\..*$/, 'comment'],
				[/'/, 'string', '@string'],
				[/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
				[
					/[A-Za-z_][A-Za-z0-9_]*(?:\.)?/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'type.identifier',
							'@default': 'identifier'
						}
					}
				],
				[/[(){}[\]]/, '@brackets'],
				[/[=:+\-*/%<>^$~|,;#.?!@&`\\]+/, 'operator']
			],
			string: [
				[/[^']+/, 'string'],
				[/''/, 'string.escape'],
				[/'/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const bqnLanguageConfiguration = {
		comments: {
			lineComment: '#'
		},
		brackets: [
			['(', ')'],
			['[', ']'],
			['{', '}'],
			['⟨', '⟩']
		],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '⟨', close: '⟩' },
			{ open: '"', close: '"' }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '⟨', close: '⟩' },
			{ open: '"', close: '"' }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const bqnMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.bqn',
		builtins: [
			'•BQN',
			'•Fmt',
			'•GetLine',
			'•Out',
			'•ParseFloat',
			'•Repr',
			'•Show',
			'•ToUTF8',
			'•term.OutRaw'
		],
		systemVariables: ['𝕩', '𝕨', '𝕊', '𝕤', '𝔽', '𝔾'],
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/"/, 'string', '@string'],
				[/¯?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
				[
					/•[A-Za-z._][A-Za-z0-9._]*/,
					{
						cases: {
							'@builtins': 'type.identifier',
							'@default': 'predefined'
						}
					}
				],
				[
					/[𝕩𝕨𝕊𝕤𝔽𝔾]/,
					{
						cases: {
							'@systemVariables': 'variable.predefined',
							'@default': 'identifier'
						}
					}
				],
				[/[A-Za-z_][A-Za-z0-9_]*/, 'identifier'],
				[/[(){}[\]⟨⟩]/, '@brackets'],
				[/[⋄,;]/, 'delimiter'],
				[
					/[-+×÷⋆√⌊⌈|¬∧∨<>≠=≤≥≡≢⊣⊢⥊∾≍⋈↑↓↕«»⌽⍉\/⍋⍒⊏⊑⊐⊒∊⍷⊔!˙˜˘¨⌜⁼´˝`∘○⊸⟜⌾⊘◶⎉⚇⍟⎊←↩?:]+/,
					'operator'
				]
			],
			string: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const fortranLanguageConfiguration = {
		comments: {
			lineComment: '!'
		},
		brackets: [
			['(', ')'],
			['[', ']']
		],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const fortranMonarchTokens = {
		ignoreCase: true,
		keywords: [
			'allocate',
			'call',
			'case',
			'character',
			'contains',
			'deallocate',
			'do',
			'else',
			'elsewhere',
			'end',
			'enddo',
			'endif',
			'function',
			'if',
			'implicit',
			'integer',
			'interface',
			'logical',
			'module',
			'none',
			'parameter',
			'print',
			'program',
			'real',
			'return',
			'select',
			'stop',
			'subroutine',
			'then',
			'type',
			'use',
			'where',
			'while'
		],
		tokenizer: {
			root: [
				[/!.*$/, 'comment'],
				[/"/, 'string', '@doubleQuotedString'],
				[/'/, 'string', '@singleQuotedString'],
				[/\b\d+(?:\.\d+)?(?:[eEdD][+-]?\d+)?\b/, 'number'],
				[
					/[A-Za-z_][A-Za-z0-9_]*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@default': 'identifier'
						}
					}
				],
				[/[()[\]]/, '@brackets'],
				[/[,:;%]/, 'delimiter'],
				[/[=><+\-*/]+/, 'operator']
			],
			doubleQuotedString: [
				[/[^"\n]+/, 'string'],
				[/""/, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			singleQuotedString: [
				[/[^'\n]+/, 'string'],
				[/''/, 'string.escape'],
				[/'/, 'string', '@pop']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	const tomlLanguageConfiguration = {
		comments: {
			lineComment: '#'
		},
		brackets: [
			['[', ']'],
			['{', '}']
		],
		autoClosingPairs: [
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		surroundingPairs: [
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		]
	} satisfies monaco.languages.LanguageConfiguration;

	const tomlMonarchTokens = {
		defaultToken: '',
		tokenPostfix: '.toml',
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/^\s*\[[^\]]+\]/, 'type.identifier'],
				[/[A-Za-z0-9_-]+(?=\s*=)/, 'attribute.name'],
				[/"([^"\\]|\\.)*$/, 'string.invalid'],
				[/"([^"\\]|\\.)*"/, 'string'],
				[/'[^']*'/, 'string'],
				[/\b(?:true|false)\b/, 'keyword'],
				[/\b\d{4}-\d{2}-\d{2}(?:[Tt ][0-9:.+-Zz]+)?\b/, 'number'],
				[/[-+]?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b/, 'number'],
				[/[=,.]/, 'delimiter'],
				[/[\[\]{}]/, '@brackets']
			]
		}
	} satisfies monaco.languages.IMonarchLanguage;

	export const editorValue = () => editor?.getValue() || '';

	let clangdStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let pythonLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let dotnetLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let elixirLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let erlangLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let gleamLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let dLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let tclLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let pascalLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let goLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let rustLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let typescriptLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let assemblyScriptLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let watLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let wasmLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let zigLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let luaLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let janetLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let lispLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let ocamlLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let haskellLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let fortranLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let graphqlLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let duckdbLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let sqlLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let prologLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let rubyLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let rLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let octaveLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let awkLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let perlLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
	let documentLspStatus = $state<LanguageServerStatus>({ state: 'disabled' });
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
		elixirLspEnabled?: boolean;
		elixirLspBundleUrl?: string;
		elixirLspWorkerUrl?: string;
		erlangLspEnabled?: boolean;
		erlangLspBundleUrl?: string;
		erlangLspWorkerUrl?: string;
		gleamLspEnabled?: boolean;
		gleamLspBaseUrl?: string;
		gleamLspManifestUrl?: string;
		dLspEnabled?: boolean;
		dLspModuleUrl?: string;
		tclLspEnabled?: boolean;
		tclLspBaseUrl?: string;
		tclLspWorkerUrl?: string;
		pascalLspEnabled?: boolean;
		pascalLspBaseUrl?: string;
		pascalLspWorkerUrl?: string;
		goLspEnabled?: boolean;
		goLspCompilerUrl?: string;
		rustLspEnabled?: boolean;
		rustLspCompilerUrl?: string;
		typescriptLspLibUrl?: string;
		zigLspEnabled?: boolean;
		zigLspCompilerUrl?: string;
		zigLspStdlibUrl?: string;
		luaLspEnabled?: boolean;
		luaLspModuleUrl?: string;
		janetLspEnabled?: boolean;
		janetLspBaseUrl?: string;
		janetLspWorkerUrl?: string;
		lispLspEnabled?: boolean;
		lispLspModuleUrl?: string;
		ocamlLspEnabled?: boolean;
		ocamlLspModuleUrl?: string;
		ocamlLspManifestUrl?: string;
		haskellLspEnabled?: boolean;
		haskellLspModuleUrl?: string;
		haskellLspRootfsUrl?: string;
		haskellLspBsdtarUrl?: string;
		fortranLspAnalyzerUrl?: string;
		sqlLspEnabled?: boolean;
		sqlLspWasmUrl?: string;
		prologLspEnabled?: boolean;
		prologLspBaseUrl?: string;
		prologLspWorkerUrl?: string;
		rubyLspEnabled?: boolean;
		rubyLspWasmUrl?: string;
		rLspEnabled?: boolean;
		rLspBaseUrl?: string;
		octaveLspEnabled?: boolean;
		octaveLspBaseUrl?: string;
		octaveLspWorkerUrl?: string;
		octaveLspManifestUrl?: string;
		awkLspEnabled?: boolean;
		awkLspBaseUrl?: string;
		awkLspWorkerUrl?: string;
		perlLspEnabled?: boolean;
		perlLspBaseUrl?: string;
		perlLspWorkerUrl?: string;
		pythonLspBaseUrl?: string;
		breakpoints?: number[];
		debugLocals?: DebugVariable[];
		debugLanguage?: DebugLanguageAdapter | null;
		compilerDiagnostics?: CompilerDiagnostic[];
		pausedLine?: number | null;
		lspStatus?: MonacoLspStatusView | null;
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
		elixirLspEnabled = false,
		elixirLspBundleUrl,
		elixirLspWorkerUrl,
		erlangLspEnabled = false,
		erlangLspBundleUrl,
		erlangLspWorkerUrl,
		gleamLspEnabled = false,
		gleamLspBaseUrl,
		gleamLspManifestUrl,
		dLspEnabled = false,
		dLspModuleUrl,
		tclLspEnabled = false,
		tclLspBaseUrl,
		tclLspWorkerUrl,
		pascalLspEnabled = false,
		pascalLspBaseUrl,
		pascalLspWorkerUrl,
		goLspEnabled = false,
		goLspCompilerUrl,
		rustLspEnabled = false,
		rustLspCompilerUrl,
		typescriptLspLibUrl,
		zigLspEnabled = false,
		zigLspCompilerUrl,
		zigLspStdlibUrl,
		luaLspEnabled = false,
		luaLspModuleUrl,
		janetLspEnabled = false,
		janetLspBaseUrl,
		janetLspWorkerUrl,
		lispLspEnabled = false,
		lispLspModuleUrl,
		ocamlLspEnabled = false,
		ocamlLspModuleUrl,
		ocamlLspManifestUrl,
		haskellLspEnabled = false,
		haskellLspModuleUrl,
		haskellLspRootfsUrl,
		haskellLspBsdtarUrl,
		fortranLspAnalyzerUrl,
		sqlLspEnabled = false,
		sqlLspWasmUrl,
		prologLspEnabled = false,
		prologLspBaseUrl,
		prologLspWorkerUrl,
		rubyLspEnabled = false,
		rubyLspWasmUrl,
		rLspEnabled = false,
		rLspBaseUrl,
		octaveLspEnabled = false,
		octaveLspBaseUrl,
		octaveLspWorkerUrl,
		octaveLspManifestUrl,
		awkLspEnabled = false,
		awkLspBaseUrl,
		awkLspWorkerUrl,
		perlLspEnabled = false,
		perlLspBaseUrl,
		perlLspWorkerUrl,
		pythonLspBaseUrl,
		breakpoints = [],
		debugLocals = [],
		debugLanguage = null,
		compilerDiagnostics = [],
		pausedLine = null,
		lspStatus = $bindable<MonacoLspStatusView | null>(null),
		onCursorLineChange,
		onRunToCursor,
		onBreakpointsChange
	}: Props = $props();
	let Monaco = $state<typeof monaco | null>(null);
	let MonacoEditor = $state<typeof MonacoEditorComponent | null>(null);
	let applyingValue = false;
	let debugActionBindings: { dispose(): void } | null = null;
	const dotnetLspLanguage = $derived<DotnetLspLanguage | null>(
		dotnetMonacoLspLanguages[language] ?? null
	);
	const defaultLanguage = $derived(
		lspLanguage === 'duckdb' ? 'duckdb' : (defaultLanguageAliases[language] ?? language)
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
				| 'pascal'
				| 'forth'
				| 'j'
				| 'bqn'
				| 'janet'
				| 'ocaml'
				| 'javascript'
				| 'typescript'
				| 'assemblyscript'
				| 'wat'
				| 'wasm'
				| 'lua'
				| 'zig'
				| 'lisp'
				| 'ruby'
				| 'haskell'
				| 'r'
				| 'octave'
				| 'fortran'
				| 'graphql'
				| 'duckdb'
				| 'sqlite'
				| 'php'
				| 'json'
				| 'yaml'
				| 'toml'
				| 'html'
				| 'css'
				| 'markdown'
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
		glyphMargin: debugViewLanguages.has(language) || !!debugLanguage,
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
			elixirLspEnabled ? elixirLspBundleUrl || '' : '',
			elixirLspEnabled ? elixirLspWorkerUrl || '' : '',
			erlangLspEnabled ? erlangLspBundleUrl || '' : '',
			erlangLspEnabled ? erlangLspWorkerUrl || '' : '',
			gleamLspEnabled ? gleamLspBaseUrl || '' : '',
			gleamLspEnabled ? gleamLspManifestUrl || '' : '',
			dLspEnabled ? dLspModuleUrl || '' : '',
			tclLspEnabled ? tclLspBaseUrl || '' : '',
			tclLspEnabled ? tclLspWorkerUrl || '' : '',
			pascalLspEnabled ? pascalLspBaseUrl || '' : '',
			pascalLspEnabled ? pascalLspWorkerUrl || '' : '',
			goLspEnabled ? goLspCompilerUrl || '' : '',
			goTarget,
			rustLspEnabled ? rustLspCompilerUrl || '' : '',
			rustTargetTriple,
			zigLspEnabled ? zigLspCompilerUrl || '' : '',
			zigLspEnabled ? zigLspStdlibUrl || '' : '',
			luaLspEnabled ? luaLspModuleUrl || '' : '',
			janetLspEnabled ? janetLspBaseUrl || '' : '',
			janetLspEnabled ? janetLspWorkerUrl || '' : '',
			lispLspEnabled ? lispLspModuleUrl || '' : '',
			ocamlLspEnabled ? ocamlLspModuleUrl || '' : '',
			ocamlLspEnabled ? ocamlLspManifestUrl || '' : '',
			haskellLspEnabled ? haskellLspModuleUrl || '' : '',
			haskellLspEnabled ? haskellLspRootfsUrl || '' : '',
			haskellLspEnabled ? haskellLspBsdtarUrl || '' : '',
			fortranLspAnalyzerUrl || '',
			sqlLspEnabled ? sqlLspWasmUrl || '' : '',
			prologLspEnabled ? prologLspBaseUrl || '' : '',
			prologLspEnabled ? prologLspWorkerUrl || '' : '',
			rubyLspEnabled ? rubyLspWasmUrl || '' : '',
			rLspEnabled ? rLspBaseUrl || '' : '',
			octaveLspEnabled ? octaveLspBaseUrl || '' : '',
			octaveLspEnabled ? octaveLspWorkerUrl || '' : '',
			octaveLspEnabled ? octaveLspManifestUrl || '' : '',
			awkLspEnabled ? awkLspBaseUrl || '' : '',
			awkLspEnabled ? awkLspWorkerUrl || '' : '',
			perlLspEnabled ? perlLspBaseUrl || '' : '',
			perlLspEnabled ? perlLspWorkerUrl || '' : '',
			pythonLspBaseUrl || '',
			activeLspLanguage,
			lspEnabled ? 'lsp-on' : 'lsp-off',
			typescriptLspLibUrl || ''
		].join('\n')
	);
	const activeLspStatusView = $derived.by<MonacoLspStatusView | null>(() => {
		if (!lspEnabled) return null;
		let label = '';
		let status: LanguageServerStatus | null = null;
		switch (activeLspLanguage) {
			case 'c':
				label = 'C LSP';
				status = clangdStatus;
				break;
			case 'cpp':
				label = 'C++ LSP';
				status = clangdStatus;
				break;
			case 'python':
				label = 'Python LSP';
				status = pythonLspStatus;
				break;
			case 'csharp':
				label = 'C# LSP';
				status = dotnetLspStatus;
				break;
			case 'fsharp':
				label = 'F# LSP';
				status = dotnetLspStatus;
				break;
			case 'vb':
				label = 'VB.NET LSP';
				status = dotnetLspStatus;
				break;
			case 'elixir':
				label = 'Elixir LSP';
				status = elixirLspStatus;
				break;
			case 'erlang':
				label = 'Erlang LSP';
				status = erlangLspStatus;
				break;
			case 'gleam':
				label = 'Gleam LSP';
				status = gleamLspStatus;
				break;
			case 'd':
				label = 'D LSP';
				status = dLspStatus;
				break;
			case 'tcl':
				label = 'Tcl LSP';
				status = tclLspStatus;
				break;
			case 'pascal':
				label = 'Pascal LSP';
				status = pascalLspStatus;
				break;
			case 'go':
				label = 'Go LSP';
				status = goLspStatus;
				break;
			case 'rust':
				label = 'Rust LSP';
				status = rustLspStatus;
				break;
			case 'typescript':
				label = 'TypeScript LSP';
				status = typescriptLspStatus;
				break;
			case 'javascript':
				label = 'JavaScript LSP';
				status = typescriptLspStatus;
				break;
			case 'assemblyscript':
				label = 'AssemblyScript LSP';
				status = assemblyScriptLspStatus;
				break;
			case 'wat':
				label = 'WAT LSP';
				status = watLspStatus;
				break;
			case 'wasm':
				label = 'WASM LSP';
				status = wasmLspStatus;
				break;
			case 'zig':
				label = 'Zig LSP';
				status = zigLspStatus;
				break;
			case 'lua':
				label = 'Lua LSP';
				status = luaLspStatus;
				break;
			case 'janet':
				label = 'Janet LSP';
				status = janetLspStatus;
				break;
			case 'lisp':
				label = 'Scheme LSP';
				status = lispLspStatus;
				break;
			case 'ocaml':
				label = 'OCaml LSP';
				status = ocamlLspStatus;
				break;
			case 'haskell':
				label = 'Haskell LSP';
				status = haskellLspStatus;
				break;
			case 'fortran':
				label = 'Fortran LSP';
				status = fortranLspStatus;
				break;
			case 'graphql':
				label = 'GraphQL LSP';
				status = graphqlLspStatus;
				break;
			case 'duckdb':
				label = 'DuckDB LSP';
				status = duckdbLspStatus;
				break;
			case 'sql':
				label = 'SQL LSP';
				status = sqlLspStatus;
				break;
			case 'prolog':
				label = 'Prolog LSP';
				status = prologLspStatus;
				break;
			case 'ruby':
				label = 'Ruby LSP';
				status = rubyLspStatus;
				break;
			case 'r':
				label = 'R LSP';
				status = rLspStatus;
				break;
			case 'octave':
				label = 'Octave LSP';
				status = octaveLspStatus;
				break;
			case 'awk':
				label = 'AWK LSP';
				status = awkLspStatus;
				break;
			case 'perl':
				label = 'Perl LSP';
				status = perlLspStatus;
				break;
			case 'json':
				label = 'JSON LSP';
				status = documentLspStatus;
				break;
			case 'yaml':
				label = 'YAML LSP';
				status = documentLspStatus;
				break;
			case 'toml':
				label = 'TOML LSP';
				status = documentLspStatus;
				break;
			case 'html':
				label = 'HTML LSP';
				status = documentLspStatus;
				break;
			case 'css':
				label = 'CSS LSP';
				status = documentLspStatus;
				break;
			case 'markdown':
				label = 'Markdown LSP';
				status = documentLspStatus;
				break;
		}
		if (!status || status.state === 'disabled') return null;
		if (status.state === 'loading') {
			const pieces = ['loading'];
			const titlePieces = [`${label} loading`];
			let progressPercent: number | null = null;
			if (status.stage) pieces.push(status.stage.replace(/[-_]+/gu, ' '));
			if (
				typeof status.loaded === 'number' &&
				Number.isFinite(status.loaded) &&
				typeof status.total === 'number' &&
				Number.isFinite(status.total) &&
				status.total > 0
			) {
				const fraction = Math.max(0, Math.min(status.loaded / status.total, 1));
				progressPercent = Math.round(fraction * 100);
				pieces.push(`${progressPercent}%`);
				titlePieces.push(`${progressPercent}%`);
				if (status.total !== 1) titlePieces.push(`${status.loaded}/${status.total}`);
			}
			if (status.stage) {
				titlePieces.push(status.stage.replace(/[-_]+/gu, ' '));
			}
			const text = `${label} ${pieces.join(' ')}`;
			return {
				label,
				state: 'loading',
				text,
				title: titlePieces.join(' - '),
				progressPercent
			};
		}
		if (status.state === 'ready') {
			const text = `${label} ready`;
			return { label, state: 'ready', text, title: text, progressPercent: null };
		}
		const text = `${label} failed`;
		return {
			label,
			state: 'error',
			text,
			title: `${text}: ${status.message}`,
			progressPercent: null
		};
	});
	const lspRoutes: LspRoute[] = [
		{
			languages: ['c', 'cpp'],
			isEnabled: () => clangdEnabled && !!clangdBaseUrl,
			setStatus: (status) => (clangdStatus = status),
			load: async (currentUrl) => {
				const { getCppLanguageServer } = await import('@wasm-idle/lsp');
				const handle = await getCppLanguageServer({
					cpp: { baseUrl: clangdBaseUrl || '' },
					currentUrl,
					onStatus: (status) => (clangdStatus = status)
				});
				handle.syncFile?.(normalizedFilePath);
				return handle;
			}
		},
		{
			languages: ['python'],
			isEnabled: () => true,
			setStatus: (status) => (pythonLspStatus = status),
			load: async (currentUrl) => {
				const { getPythonLanguageServer } = await import('@wasm-idle/lsp');
				return await getPythonLanguageServer({
					currentUrl,
					python: { baseUrl: pythonLspBaseUrl },
					onStatus: (status) => (pythonLspStatus = status)
				});
			}
		},
		{
			languages: ['csharp', 'fsharp', 'vb'],
			isEnabled: () => dotnetLspEnabled && !!dotnetLspModuleUrl && !!dotnetLspLanguage,
			setStatus: (status) => (dotnetLspStatus = status),
			load: async (currentUrl) => {
				const activeDotnetLanguage = dotnetLspLanguage;
				if (!activeDotnetLanguage)
					throw new Error(`Unsupported .NET LSP language: ${language}`);
				const {
					getCSharpLanguageServer,
					getFSharpLanguageServer,
					getVisualBasicLanguageServer
				} = await import('@wasm-idle/lsp');
				const load = {
					csharp: getCSharpLanguageServer,
					fsharp: getFSharpLanguageServer,
					vbnet: getVisualBasicLanguageServer
				}[activeDotnetLanguage];
				return await load({
					currentUrl,
					dotnet: { moduleUrl: dotnetLspModuleUrl || '' },
					onStatus: (status) => (dotnetLspStatus = status)
				});
			}
		},
		{
			languages: ['elixir'],
			isEnabled: () => elixirLspEnabled && !!elixirLspBundleUrl && !!elixirLspWorkerUrl,
			setStatus: (status) => (elixirLspStatus = status),
			load: async (currentUrl) => {
				const { getElixirLanguageServer } = await import('@wasm-idle/lsp');
				return await getElixirLanguageServer({
					currentUrl,
					elixir: {
						bundleUrl: elixirLspBundleUrl || '',
						workerUrl: elixirLspWorkerUrl || ''
					},
					onStatus: (status) => (elixirLspStatus = status)
				});
			}
		},
		{
			languages: ['erlang'],
			isEnabled: () => erlangLspEnabled && !!erlangLspBundleUrl && !!erlangLspWorkerUrl,
			setStatus: (status) => (erlangLspStatus = status),
			load: async (currentUrl) => {
				const { getErlangLanguageServer } = await import('@wasm-idle/lsp');
				return await getErlangLanguageServer({
					currentUrl,
					erlang: {
						bundleUrl: erlangLspBundleUrl || '',
						workerUrl: erlangLspWorkerUrl || ''
					},
					onStatus: (status) => (erlangLspStatus = status)
				});
			}
		},
		{
			languages: ['gleam'],
			isEnabled: () => gleamLspEnabled && !!gleamLspBaseUrl,
			setStatus: (status) => (gleamLspStatus = status),
			load: async (currentUrl) => {
				const { getGleamLanguageServer } = await import('@wasm-idle/lsp');
				return await getGleamLanguageServer({
					currentUrl,
					gleam: {
						baseUrl: gleamLspBaseUrl || '',
						manifestUrl: gleamLspManifestUrl
					},
					onStatus: (status) => (gleamLspStatus = status)
				});
			}
		},
		{
			languages: ['d'],
			isEnabled: () => dLspEnabled && !!dLspModuleUrl,
			setStatus: (status) => (dLspStatus = status),
			load: async (currentUrl) => {
				const { getDLanguageServer } = await import('@wasm-idle/lsp');
				return await getDLanguageServer({
					currentUrl,
					d: {
						moduleUrl: dLspModuleUrl || ''
					},
					onStatus: (status) => (dLspStatus = status)
				});
			}
		},
		{
			languages: ['tcl'],
			isEnabled: () => tclLspEnabled && !!tclLspBaseUrl && !!tclLspWorkerUrl,
			setStatus: (status) => (tclLspStatus = status),
			load: async (currentUrl) => {
				const { getTclLanguageServer } = await import('@wasm-idle/lsp');
				return await getTclLanguageServer({
					currentUrl,
					tcl: {
						baseUrl: tclLspBaseUrl || '',
						workerUrl: tclLspWorkerUrl || ''
					},
					onStatus: (status) => (tclLspStatus = status)
				});
			}
		},
		{
			languages: ['pascal'],
			isEnabled: () => pascalLspEnabled && !!pascalLspBaseUrl && !!pascalLspWorkerUrl,
			setStatus: (status) => (pascalLspStatus = status),
			load: async (currentUrl) => {
				const { getPascalLanguageServer } = await import('@wasm-idle/lsp');
				return await getPascalLanguageServer({
					currentUrl,
					pascal: {
						baseUrl: pascalLspBaseUrl || '',
						workerUrl: pascalLspWorkerUrl || ''
					},
					onStatus: (status) => (pascalLspStatus = status)
				});
			}
		},
		{
			languages: ['go'],
			isEnabled: () => goLspEnabled && !!goLspCompilerUrl,
			setStatus: (status) => (goLspStatus = status),
			load: async (currentUrl) => {
				const { getGoLanguageServer } = await import('@wasm-idle/lsp');
				return await getGoLanguageServer({
					currentUrl,
					go: {
						compilerUrl: goLspCompilerUrl || '',
						target: goTarget
					},
					onStatus: (status) => (goLspStatus = status)
				});
			}
		},
		{
			languages: ['rust'],
			isEnabled: () => rustLspEnabled && !!rustLspCompilerUrl,
			setStatus: (status) => (rustLspStatus = status),
			load: async (currentUrl) => {
				const { getRustLanguageServer } = await import('@wasm-idle/lsp');
				return await getRustLanguageServer({
					currentUrl,
					rust: {
						compilerUrl: rustLspCompilerUrl || '',
						targetTriple: rustTargetTriple
					},
					onStatus: (status) => (rustLspStatus = status)
				});
			}
		},
		{
			languages: ['typescript', 'javascript'],
			isEnabled: () => true,
			setStatus: (status) => (typescriptLspStatus = status),
			load: async (currentUrl) => {
				const { getJavaScriptLanguageServer, getTypeScriptLanguageServer } =
					await import('@wasm-idle/lsp');
				if (activeLspLanguage === 'javascript') {
					return await getJavaScriptLanguageServer({
						currentUrl,
						javascript: { libUrl: typescriptLspLibUrl },
						onStatus: (status) => (typescriptLspStatus = status)
					});
				}
				return await getTypeScriptLanguageServer({
					currentUrl,
					typescript: { libUrl: typescriptLspLibUrl },
					onStatus: (status) => (typescriptLspStatus = status)
				});
			}
		},
		{
			languages: ['assemblyscript'],
			isEnabled: () => true,
			setStatus: (status) => (assemblyScriptLspStatus = status),
			load: async (currentUrl) => {
				const { getAssemblyScriptLanguageServer } = await import('@wasm-idle/lsp');
				return await getAssemblyScriptLanguageServer({
					currentUrl,
					onStatus: (status) => (assemblyScriptLspStatus = status)
				});
			}
		},
		{
			languages: ['wat'],
			isEnabled: () => true,
			setStatus: (status) => (watLspStatus = status),
			load: async (currentUrl) => {
				const { getWatLanguageServer } = await import('@wasm-idle/lsp');
				return await getWatLanguageServer({
					currentUrl,
					onStatus: (status) => (watLspStatus = status)
				});
			}
		},
		{
			languages: ['wasm'],
			isEnabled: () => true,
			setStatus: (status) => (wasmLspStatus = status),
			load: async (currentUrl) => {
				const { getWasmLanguageServer } = await import('@wasm-idle/lsp');
				return await getWasmLanguageServer({
					currentUrl,
					onStatus: (status) => (wasmLspStatus = status)
				});
			}
		},
		{
			languages: ['zig'],
			isEnabled: () => zigLspEnabled && !!zigLspCompilerUrl && !!zigLspStdlibUrl,
			setStatus: (status) => (zigLspStatus = status),
			load: async (currentUrl) => {
				const { getZigLanguageServer } = await import('@wasm-idle/lsp');
				return await getZigLanguageServer({
					currentUrl,
					zig: {
						compilerUrl: zigLspCompilerUrl || '',
						stdlibUrl: zigLspStdlibUrl || ''
					},
					onStatus: (status) => (zigLspStatus = status)
				});
			}
		},
		{
			languages: ['lua'],
			isEnabled: () => luaLspEnabled && !!luaLspModuleUrl,
			setStatus: (status) => (luaLspStatus = status),
			load: async (currentUrl) => {
				const { getLuaLanguageServer } = await import('@wasm-idle/lsp');
				return await getLuaLanguageServer({
					currentUrl,
					lua: {
						moduleUrl: luaLspModuleUrl || ''
					},
					onStatus: (status) => (luaLspStatus = status)
				});
			}
		},
		{
			languages: ['janet'],
			isEnabled: () => janetLspEnabled && !!janetLspBaseUrl && !!janetLspWorkerUrl,
			setStatus: (status) => (janetLspStatus = status),
			load: async (currentUrl) => {
				const { getJanetLanguageServer } = await import('@wasm-idle/lsp');
				return await getJanetLanguageServer({
					currentUrl,
					janet: {
						baseUrl: janetLspBaseUrl || '',
						workerUrl: janetLspWorkerUrl || ''
					},
					onStatus: (status) => (janetLspStatus = status)
				});
			}
		},
		{
			languages: ['lisp'],
			isEnabled: () => lispLspEnabled && !!lispLspModuleUrl,
			setStatus: (status) => (lispLspStatus = status),
			load: async (currentUrl) => {
				const { getLispLanguageServer } = await import('@wasm-idle/lsp');
				return await getLispLanguageServer({
					currentUrl,
					lisp: {
						moduleUrl: lispLspModuleUrl || ''
					},
					onStatus: (status) => (lispLspStatus = status)
				});
			}
		},
		{
			languages: ['ocaml'],
			isEnabled: () => ocamlLspEnabled && !!ocamlLspModuleUrl && !!ocamlLspManifestUrl,
			setStatus: (status) => (ocamlLspStatus = status),
			load: async (currentUrl) => {
				const { getOcamlLanguageServer } = await import('@wasm-idle/lsp');
				return await getOcamlLanguageServer({
					currentUrl,
					ocaml: {
						moduleUrl: ocamlLspModuleUrl || '',
						manifestUrl: ocamlLspManifestUrl || ''
					},
					onStatus: (status) => (ocamlLspStatus = status)
				});
			}
		},
		{
			languages: ['haskell'],
			isEnabled: () =>
				haskellLspEnabled &&
				!!haskellLspModuleUrl &&
				!!haskellLspRootfsUrl &&
				!!haskellLspBsdtarUrl,
			setStatus: (status) => (haskellLspStatus = status),
			load: async (currentUrl) => {
				const { getHaskellLanguageServer } = await import('@wasm-idle/lsp');
				return await getHaskellLanguageServer({
					currentUrl,
					haskell: {
						moduleUrl: haskellLspModuleUrl || '',
						rootfsUrl: haskellLspRootfsUrl || '',
						bsdtarUrl: haskellLspBsdtarUrl || ''
					},
					onStatus: (status) => (haskellLspStatus = status)
				});
			}
		},
		{
			languages: ['fortran'],
			isEnabled: () => !!fortranLspAnalyzerUrl,
			setStatus: (status) => (fortranLspStatus = status),
			load: async (currentUrl) => {
				const { getFortranLanguageServer } = await import('@wasm-idle/lsp');
				return await getFortranLanguageServer({
					currentUrl,
					fortran: {
						analyzerUrl: fortranLspAnalyzerUrl
					},
					onStatus: (status) => (fortranLspStatus = status)
				});
			}
		},
		{
			languages: ['graphql'],
			isEnabled: () => true,
			setStatus: (status) => (graphqlLspStatus = status),
			load: async (currentUrl) => {
				const { getGraphqlLanguageServer } = await import('@wasm-idle/lsp');
				return await getGraphqlLanguageServer({
					currentUrl,
					onStatus: (status) => (graphqlLspStatus = status)
				});
			}
		},
		{
			languages: ['duckdb'],
			isEnabled: () => true,
			setStatus: (status) => (duckdbLspStatus = status),
			load: async (currentUrl) => {
				const { getDuckDbLanguageServer } = await import('@wasm-idle/lsp');
				return await getDuckDbLanguageServer({
					currentUrl,
					onStatus: (status) => (duckdbLspStatus = status)
				});
			}
		},
		{
			languages: ['sql'],
			isEnabled: () => sqlLspEnabled && !!sqlLspWasmUrl,
			setStatus: (status) => (sqlLspStatus = status),
			load: async (currentUrl) => {
				const { getSqlLanguageServer } = await import('@wasm-idle/lsp');
				return await getSqlLanguageServer({
					currentUrl,
					sql: {
						dialect: 'sqlite',
						wasmUrl: sqlLspWasmUrl || ''
					},
					onStatus: (status) => (sqlLspStatus = status)
				});
			}
		},
		{
			languages: ['prolog'],
			isEnabled: () => prologLspEnabled && !!prologLspBaseUrl && !!prologLspWorkerUrl,
			setStatus: (status) => (prologLspStatus = status),
			load: async (currentUrl) => {
				const { getPrologLanguageServer } = await import('@wasm-idle/lsp');
				return await getPrologLanguageServer({
					currentUrl,
					prolog: {
						baseUrl: prologLspBaseUrl || '',
						workerUrl: prologLspWorkerUrl || ''
					},
					onStatus: (status) => (prologLspStatus = status)
				});
			}
		},
		{
			languages: ['ruby'],
			isEnabled: () => rubyLspEnabled && !!rubyLspWasmUrl,
			setStatus: (status) => (rubyLspStatus = status),
			load: async (currentUrl) => {
				const { getRubyLanguageServer } = await import('@wasm-idle/lsp');
				return await getRubyLanguageServer({
					currentUrl,
					ruby: {
						wasmUrl: rubyLspWasmUrl || ''
					},
					onStatus: (status) => (rubyLspStatus = status)
				});
			}
		},
		{
			languages: ['r'],
			isEnabled: () => rLspEnabled && !!rLspBaseUrl,
			setStatus: (status) => (rLspStatus = status),
			load: async (currentUrl) => {
				const { getRLanguageServer } = await import('@wasm-idle/lsp');
				return await getRLanguageServer({
					currentUrl,
					r: {
						baseUrl: rLspBaseUrl || ''
					},
					onStatus: (status) => (rLspStatus = status)
				});
			}
		},
		{
			languages: ['octave'],
			isEnabled: () =>
				octaveLspEnabled &&
				!!octaveLspBaseUrl &&
				!!octaveLspWorkerUrl &&
				!!octaveLspManifestUrl,
			setStatus: (status) => (octaveLspStatus = status),
			load: async (currentUrl) => {
				const { getOctaveLanguageServer } = await import('@wasm-idle/lsp');
				return await getOctaveLanguageServer({
					currentUrl,
					octave: {
						baseUrl: octaveLspBaseUrl || '',
						workerUrl: octaveLspWorkerUrl || '',
						manifestUrl: octaveLspManifestUrl || ''
					},
					onStatus: (status) => (octaveLspStatus = status)
				});
			}
		},
		{
			languages: ['awk'],
			isEnabled: () => awkLspEnabled && !!awkLspBaseUrl && !!awkLspWorkerUrl,
			setStatus: (status) => (awkLspStatus = status),
			load: async (currentUrl) => {
				const { getAwkLanguageServer } = await import('@wasm-idle/lsp');
				return await getAwkLanguageServer({
					currentUrl,
					awk: {
						baseUrl: awkLspBaseUrl || '',
						workerUrl: awkLspWorkerUrl || ''
					},
					onStatus: (status) => (awkLspStatus = status)
				});
			}
		},
		{
			languages: ['perl'],
			isEnabled: () => perlLspEnabled && !!perlLspBaseUrl && !!perlLspWorkerUrl,
			setStatus: (status) => (perlLspStatus = status),
			load: async (currentUrl) => {
				const { getPerlLanguageServer } = await import('@wasm-idle/lsp');
				return await getPerlLanguageServer({
					currentUrl,
					perl: {
						baseUrl: perlLspBaseUrl || '',
						workerUrl: perlLspWorkerUrl || ''
					},
					onStatus: (status) => (perlLspStatus = status)
				});
			}
		},
		{
			languages: ['json', 'yaml', 'toml', 'html', 'css', 'markdown'],
			isEnabled: () => true,
			setStatus: (status) => (documentLspStatus = status),
			load: async (currentUrl) => {
				const {
					getCssLanguageServer,
					getHtmlLanguageServer,
					getJsonLanguageServer,
					getMarkdownLanguageServer,
					getTomlLanguageServer,
					getYamlLanguageServer
				} = await import('@wasm-idle/lsp');
				const load = {
					json: getJsonLanguageServer,
					yaml: getYamlLanguageServer,
					toml: getTomlLanguageServer,
					html: getHtmlLanguageServer,
					css: getCssLanguageServer,
					markdown: getMarkdownLanguageServer
				}[activeLspLanguage as 'json' | 'yaml' | 'toml' | 'html' | 'css' | 'markdown'];
				if (!load)
					throw new Error(`Unsupported document LSP language: ${activeLspLanguage}`);
				return await load({
					currentUrl,
					onStatus: (status) => (documentLspStatus = status)
				});
			}
		}
	];

	function disableAllLspStatuses() {
		for (const route of lspRoutes) route.setStatus({ state: 'disabled' });
	}
	const resolveLspConnection = $derived<IMonacoLspProvider>(
		((key) => async (_providerLanguage: string, context?: MonacoLspProviderContext) => {
			if (context?.signal?.aborted || key !== lspConnectionKey) return null;
			const currentUrl = globalThis.location?.href || '';
			if (!lspEnabled) {
				disableAllLspStatuses();
				return null;
			}
			const route = lspRoutes.find((candidate) =>
				candidate.languages.includes(activeLspLanguage)
			);
			if (!route) return null;
			if (!route.isEnabled()) {
				route.setStatus({ state: 'disabled' });
				return null;
			}
			try {
				route.setStatus({ state: 'loading', stage: 'startup', loaded: 0, total: 1 });
				const connection = await route.load(currentUrl);
				if (context?.signal?.aborted || key !== lspConnectionKey) {
					connection.dispose();
					return null;
				}
				return connection as unknown as Exclude<IMonacoLspProviderResult, null | undefined>;
			} catch (error) {
				if (context?.signal?.aborted || key !== lspConnectionKey) return null;
				route.setStatus({
					state: 'error',
					message: error instanceof Error ? error.message : String(error)
				});
				throw error;
			}
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
			disableAllLspStatuses();
			return;
		}
		for (const route of lspRoutes) {
			if (!route.languages.includes(activeLspLanguage) || !route.isEnabled()) {
				route.setStatus({ state: 'disabled' });
			}
		}
	});

	const handleEditorLoad = (nextEditor: monaco.editor.IStandaloneCodeEditor) => {
		editor = nextEditor;
		if (monacoTestHooksEnabled()) {
			(globalThis as MonacoTestGlobal).__wasmIdleMonacoEditor = nextEditor;
		}
	};

	$effect(() => {
		if (!monacoTestHooksEnabled()) return;
		const testGlobal = globalThis as MonacoTestGlobal;
		testGlobal.__wasmIdleMonacoApi = Monaco;
		testGlobal.__wasmIdleMonacoLspStatus = {
			clangd: clangdStatus,
			python: pythonLspStatus,
			dotnet: dotnetLspStatus,
			elixir: elixirLspStatus,
			erlang: erlangLspStatus,
			gleam: gleamLspStatus,
			d: dLspStatus,
			tcl: tclLspStatus,
			pascal: pascalLspStatus,
			go: goLspStatus,
			rust: rustLspStatus,
			typescript: typescriptLspStatus,
			assemblyscript: assemblyScriptLspStatus,
			wat: watLspStatus,
			wasm: wasmLspStatus,
			zig: zigLspStatus,
			lua: luaLspStatus,
			janet: janetLspStatus,
			lisp: lispLspStatus,
			ocaml: ocamlLspStatus,
			haskell: haskellLspStatus,
			fortran: fortranLspStatus,
			graphql: graphqlLspStatus,
			duckdb: duckdbLspStatus,
			sql: sqlLspStatus,
			prolog: prologLspStatus,
			ruby: rubyLspStatus,
			r: rLspStatus,
			octave: octaveLspStatus,
			awk: awkLspStatus,
			perl: perlLspStatus,
			json: documentLspStatus,
			yaml: documentLspStatus,
			toml: documentLspStatus,
			html: documentLspStatus,
			css: documentLspStatus,
			markdown: documentLspStatus
		};
	});

	$effect(() => {
		lspStatus = activeLspStatusView;
	});

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
		if (!monacoApi || !activeEditor || (!debugViewLanguages.has(language) && !debugLanguage))
			return;
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
		const markers = diagnosticMarkerLanguages.has(language)
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
			const languageContribution =
				monacoLanguageContributionLoaders[language]?.() ?? Promise.resolve();
			const [m] = await Promise.all([monacoComponent.loadMonaco(), languageContribution]);
			if (disposed) return;
			const monacoApi = m;
			Monaco = monacoApi;
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'ocaml')) {
				monacoApi.languages.register({
					id: 'ocaml',
					aliases: ['OCaml', 'ocaml'],
					extensions: ['.ml', '.mli']
				});
			}
			monacoApi.languages.setLanguageConfiguration('ocaml', ocamlLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('ocaml', ocamlMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'fsharp')) {
				monacoApi.languages.register({
					id: 'fsharp',
					aliases: ['F#', 'FSharp', 'fsharp'],
					extensions: ['.fs', '.fsx', '.fsi']
				});
			}
			monacoApi.languages.setLanguageConfiguration('fsharp', fsharpLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('fsharp', fsharpMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'd')) {
				monacoApi.languages.register({
					id: 'd',
					aliases: ['D', 'd'],
					extensions: ['.d']
				});
			}
			monacoApi.languages.setLanguageConfiguration('d', dLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('d', dMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'zig')) {
				monacoApi.languages.register({
					id: 'zig',
					aliases: ['Zig', 'zig'],
					extensions: ['.zig']
				});
			}
			monacoApi.languages.setLanguageConfiguration('zig', zigLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('zig', zigMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'wat')) {
				monacoApi.languages.register({
					id: 'wat',
					aliases: ['WAT', 'WebAssembly Text', 'wat'],
					extensions: ['.wat', '.wast']
				});
			}
			monacoApi.languages.setLanguageConfiguration('wat', watLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('wat', watMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'wasm')) {
				monacoApi.languages.register({
					id: 'wasm',
					aliases: ['WASM', 'WebAssembly Binary', 'wasm'],
					extensions: ['.wasm']
				});
			}
			monacoApi.languages.setLanguageConfiguration('wasm', wasmLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('wasm', wasmMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'lua')) {
				monacoApi.languages.register({
					id: 'lua',
					aliases: ['Lua', 'lua'],
					extensions: ['.lua']
				});
			}
			monacoApi.languages.setLanguageConfiguration('lua', luaLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('lua', luaMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'erlang')) {
				monacoApi.languages.register({
					id: 'erlang',
					aliases: ['Erlang', 'erlang', 'erl'],
					extensions: ['.erl', '.hrl']
				});
			}
			monacoApi.languages.setLanguageConfiguration('erlang', erlangLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('erlang', erlangMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'prolog')) {
				monacoApi.languages.register({
					id: 'prolog',
					aliases: ['Prolog', 'SWI-Prolog', 'prolog', 'swipl'],
					extensions: ['.prolog', '.pro']
				});
			}
			monacoApi.languages.setLanguageConfiguration('prolog', prologLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('prolog', prologMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'gleam')) {
				monacoApi.languages.register({
					id: 'gleam',
					aliases: ['Gleam', 'gleam'],
					extensions: ['.gleam']
				});
			}
			monacoApi.languages.setLanguageConfiguration('gleam', gleamLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('gleam', gleamMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'awk')) {
				monacoApi.languages.register({
					id: 'awk',
					aliases: ['AWK', 'awk', 'gawk'],
					extensions: ['.awk', '.gawk']
				});
			}
			monacoApi.languages.setLanguageConfiguration('awk', awkLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('awk', awkMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'forth')) {
				monacoApi.languages.register({
					id: 'forth',
					aliases: ['Forth', 'forth', 'gforth'],
					extensions: ['.fth', '.forth', '.4th']
				});
			}
			monacoApi.languages.setLanguageConfiguration('forth', forthLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('forth', forthMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'j')) {
				monacoApi.languages.register({
					id: 'j',
					aliases: ['J', 'j'],
					extensions: ['.ijs', '.ijt', '.ijx']
				});
			}
			monacoApi.languages.setLanguageConfiguration('j', jLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('j', jMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'bqn')) {
				monacoApi.languages.register({
					id: 'bqn',
					aliases: ['BQN', 'bqn'],
					extensions: ['.bqn']
				});
			}
			monacoApi.languages.setLanguageConfiguration('bqn', bqnLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('bqn', bqnMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'janet')) {
				monacoApi.languages.register({
					id: 'janet',
					aliases: ['Janet', 'janet'],
					extensions: ['.janet']
				});
			}
			monacoApi.languages.setLanguageConfiguration('janet', janetLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('janet', janetMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'julia')) {
				monacoApi.languages.register({
					id: 'julia',
					aliases: ['Julia', 'julia'],
					extensions: ['.jl']
				});
			}
			monacoApi.languages.setLanguageConfiguration('julia', juliaLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('julia', juliaMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'nim')) {
				monacoApi.languages.register({
					id: 'nim',
					aliases: ['Nim', 'nim', 'nimrod'],
					extensions: ['.nim', '.nims']
				});
			}
			monacoApi.languages.setLanguageConfiguration('nim', nimLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('nim', nimMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'octave')) {
				monacoApi.languages.register({
					id: 'octave',
					aliases: ['Octave', 'MATLAB', 'octave', 'matlab'],
					extensions: ['.m']
				});
			}
			monacoApi.languages.setLanguageConfiguration('octave', octaveLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('octave', octaveMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'haskell')) {
				monacoApi.languages.register({
					id: 'haskell',
					aliases: ['Haskell', 'haskell'],
					extensions: ['.hs', '.lhs']
				});
			}
			monacoApi.languages.setLanguageConfiguration('haskell', haskellLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('haskell', haskellMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'fortran')) {
				monacoApi.languages.register({
					id: 'fortran',
					aliases: ['Fortran', 'fortran', 'f90'],
					extensions: ['.f', '.for', '.f90', '.f95']
				});
			}
			monacoApi.languages.setLanguageConfiguration('fortran', fortranLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('fortran', fortranMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'toml')) {
				monacoApi.languages.register({
					id: 'toml',
					aliases: ['TOML', 'toml'],
					extensions: ['.toml']
				});
			}
			monacoApi.languages.setLanguageConfiguration('toml', tomlLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('toml', tomlMonarchTokens);
			if (!monacoApi.languages.getLanguages().some(({ id }) => id === 'lisp')) {
				monacoApi.languages.register({
					id: 'lisp',
					aliases: ['Scheme', 'Lisp', 'scheme', 'lisp'],
					extensions: ['.scm', '.ss', '.sls', '.lisp', '.lsp']
				});
			}
			monacoApi.languages.setLanguageConfiguration('lisp', schemeLanguageConfiguration);
			monacoApi.languages.setMonarchTokensProvider('lisp', schemeMonarchTokens);
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
			const testGlobal = globalThis as MonacoTestGlobal;
			if (testGlobal.__wasmIdleMonacoEditor === editor) {
				testGlobal.__wasmIdleMonacoEditor = null;
			}
			testGlobal.__wasmIdleMonacoApi = null;
			testGlobal.__wasmIdleMonacoLspStatus = null;
			lspStatus = null;
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
