// @vitest-environment node

import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import type { SandboxExecutionOptions } from './options';
import type { Sandbox } from './sandbox';

type InterpreterCase = {
	name: string;
	source: string;
	stdin: string;
	output?: string;
	fails?: boolean;
	failureMessage?: string;
	options?: Pick<SandboxExecutionOptions, 'activePath'>;
	expectedError?: { code: string; phase: string; message: string };
};

type InterpreterBrowserProfile = {
	language: string;
	enabled: boolean;
	defaultSource: () => string;
	defaultInput?: string;
	defaultOutput?: string;
	echoSource: string;
	echoSourceForInput?: (stdin: string) => string;
	infiniteSource: string;
	timeoutMaxOutputBytes?: number;
	runtimePath: string;
	cases: InterpreterCase[];
};

type InterpreterResult = {
	name: string;
	output: string;
	result?: boolean | string;
	inputRequests: number;
	elapsedMs: number;
	error?: {
		message: string;
		code?: string;
		phase?: string;
		actual?: number;
		limit?: number;
	};
};

// These helpers construct Whitespace fixtures; execution uses the pinned upstream interpreter.
function whitespaceNumber(value: number) {
	return (
		(value < 0 ? '\t' : ' ') +
		Math.abs(value).toString(2).replace(/0/g, ' ').replace(/1/g, '\t') +
		'\n'
	);
}

const ws = {
	push: (value: number) => '  ' + whitespaceNumber(value),
	copy: (depth: number) => ' \t ' + whitespaceNumber(depth),
	slide: (count: number) => ' \t\n' + whitespaceNumber(count),
	duplicate: ' \n ',
	swap: ' \n\t',
	discard: ' \n\n',
	add: '\t   ',
	subtract: '\t  \t',
	multiply: '\t  \n',
	divide: '\t \t ',
	remainder: '\t \t\t',
	store: '\t\t ',
	load: '\t\t\t',
	label: (name: string) => '\n  ' + name + '\n',
	call: (name: string) => '\n \t' + name + '\n',
	jump: (name: string) => '\n \n' + name + '\n',
	jumpZero: (name: string) => '\n\t ' + name + '\n',
	jumpNegative: (name: string) => '\n\t\t' + name + '\n',
	return: '\n\t\n',
	halt: '\n\n\n',
	readChar: '\t\n\t ',
	readNumber: '\t\n\t\t',
	printChar: '\t\n  ',
	printNumber: '\t\n \t'
};

const whitespaceEcho =
	ws.label(' ') +
	ws.push(0) +
	ws.readChar +
	ws.push(0) +
	ws.load +
	ws.duplicate +
	ws.push(1) +
	ws.add +
	ws.jumpZero('\t') +
	ws.printChar +
	ws.jump(' ') +
	ws.label('\t') +
	ws.halt;

const whitespaceReadChar = ws.push(0) + ws.readChar + ws.push(0) + ws.load;
const whitespaceNewline = ws.push(10) + ws.printChar;

// Denormalize valid input/output/halt instructions to build finite test programs.
function malbolgeEchoBytes(count: number) {
	const instructions = [...Array.from({ length: count }, () => [23, 5]).flat(), 81];
	return instructions
		.map((instruction, address) => {
			let character = (((instruction - address) % 94) + 94) % 94;
			if (character < 33) character += 94;
			return String.fromCharCode(character);
		})
		.join('');
}

const malbolgeEcho = (stdin: string) =>
	malbolgeEchoBytes(new TextEncoder().encode(stdin).byteLength);

// Matthias Lutter's nonterminating cat: https://malbolge.org/cat.html.
const malbolgeInfiniteCat =
	'(=BA#9"=<;:3y7x54-21q/p-,+*)"!h%B0/.\n~P<\n<:(8&\n66#"!~}|{zyxwvu\ngJ%';

// Aheui fixtures read and print Unicode codepoints using the original interpreter.
const aheuiEcho = (stdin: string) => '밯맣'.repeat(Array.from(stdin).length) + '희';
const aheuiStackIndices = Array.from({ length: 28 }, (_, index) => index).filter(
	(index) => index !== 21 && index !== 27
);
const aheuiSelectStorage = (index: number) => String.fromCharCode(0xac00 + 9 * 588 + index);
const aheuiAllStacks =
	aheuiStackIndices.map((index) => aheuiSelectStorage(index) + '방').join('') +
	aheuiStackIndices.map((index) => aheuiSelectStorage(index) + '망').join('') +
	'희';

// Published language-specification sample: https://aheui.readthedocs.io/ko/latest/specs.html.
const aheuiHelloWorld = `밤밣따빠밣밟따뿌
빠맣파빨받밤뚜뭏
돋밬탕빠맣붏두붇
볻뫃박발뚷투뭏붖
뫃도뫃희멓뭏뭏붘
뫃봌토범더벌뿌뚜
뽑뽀멓멓더벓뻐뚠
뽀덩벐멓뻐덕더벅`;

const profiles: InterpreterBrowserProfile[] = [
	{
		language: 'BRAINFUCK',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_BRAINFUCK === '1',
		defaultSource: () => editorDefaults.brainfuck,
		echoSource: ',[.,]',
		infiniteSource: '+[]',
		runtimePath: 'wasm-brainfuck/brainfuck.wasm',
		cases: [
			{
				name: 'utf8-explicit-eof',
				source: ',[.,]',
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{ name: 'empty-explicit-eof', source: ',[.,]', stdin: '', output: '' },
			{ name: 'partial-explicit-stdin', source: ',.', stdin: 'AB', output: 'A' },
			{
				name: 'fresh-stdin',
				source: ',[.,]',
				stdin: 'C',
				output: 'C'
			},
			{
				name: 'nested-loops',
				source: '++[>+++[>++++++++++<-]<-]>>+++++.',
				stdin: '',
				output: 'A'
			},
			{
				name: '8bit-cell-wrap',
				// A nonwrapping cell enters the branch and prints B instead of A.
				source: '+'.repeat(256) + '[[-]>+<]>' + '+'.repeat(65) + '.',
				stdin: '',
				output: 'A'
			},
			{ name: 'seed-tape', source: '+++++>+++++', stdin: '', output: '' },
			{ name: 'fresh-tape', source: '.>.', stdin: '', output: '\0\0' },
			{ name: 'unclosed-loop', source: '[+', stdin: '', fails: true },
			{ name: 'unexpected-loop-end', source: ']', stdin: '', fails: true },
			{
				name: 'after-parse-failure',
				source: ',[.,]',
				stdin: 'parse-recovered\n',
				output: 'parse-recovered\n'
			}
		]
	},
	{
		language: 'BEFUNGE93',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_BEFUNGE93 === '1',
		defaultSource: () => editorDefaults.befunge93,
		echoSource: '~:1+!#@_,',
		infiniteSource: '>',
		runtimePath: 'wasm-befunge93/befunge93.wasm',
		cases: [
			{
				name: 'utf8-explicit-eof',
				source: '~:1+!#@_,',
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{ name: 'empty-explicit-eof', source: '~:1+!#@_,', stdin: '', output: '' },
			{
				name: 'nul-byte-is-not-eof',
				source: '~:1+!#@_,',
				stdin: '\0A\n',
				output: '\0A\n'
			},
			{ name: 'partial-explicit-stdin', source: '~,@', stdin: 'AB', output: 'A' },
			{ name: 'fresh-stdin', source: '~:1+!#@_,', stdin: 'C', output: 'C' },
			{
				name: 'extensionless-source-path',
				source: '~,@',
				stdin: 'Y',
				output: 'Y',
				options: { activePath: 'program' }
			},
			{
				name: 'utf8-source-path-limit',
				source: '@',
				stdin: '',
				options: { activePath: '가'.repeat(43) + '.b93' },
				expectedError: {
					code: 'runtime-configuration',
					phase: 'configuration',
					message: 'BEFUNGE93 source path exceeds 125 UTF-8 bytes'
				}
			},
			{ name: 'signed-arithmetic', source: '38-.@', stdin: '', output: '-5 ' },
			{
				name: '32bit-integer-wrap',
				source: '99*' + '9*'.repeat(8) + '.@',
				stdin: '',
				output: '-808182895 '
			},
			{
				name: 'stack-swap-duplicate-underflow',
				source: '12\\..:..@',
				stdin: '',
				output: '1 2 0 0 '
			},
			{ name: 'string-mode', source: '"olleH",,,,,@', stdin: '', output: 'Hello' },
			{ name: '2d-directions', source: 'v\n>"A",@', stdin: '', output: 'A' },
			{
				name: 'horizontal-torus',
				source: '<' + ' '.repeat(74) + '@,"H"',
				stdin: '',
				output: 'H'
			},
			{
				name: 'vertical-torus',
				source: ['^', ...Array<string>(23).fill(''), '>"V",@'].join('\n'),
				stdin: '',
				output: 'V'
			},
			{ name: 'bridge', source: '1#9.@', stdin: '', output: '1 ' },
			{
				name: 'vertical-branch-nonzero',
				source: 'v >"U",@\n>1|\n  >"D",@',
				stdin: '',
				output: 'U'
			},
			{
				name: 'vertical-branch-zero',
				source: 'v >"U",@\n>0|\n  >"D",@',
				stdin: '',
				output: 'D'
			},
			{ name: 'playfield-put-get', source: '"A"00p00g,@', stdin: '', output: 'A' },
			{
				name: 'self-modifying-code',
				// Replace the following print instruction with @ before reaching it.
				source: '"@"70p0.@',
				stdin: '',
				output: ''
			},
			{ name: 'fresh-playfield', source: '70g.@', stdin: '', output: '32 ' },
			{ name: 'seed-stack', source: '99@', stdin: '', output: '' },
			{ name: 'fresh-stack', source: '.@', stdin: '', output: '0 ' },
			{ name: 'numeric-stdin', source: '&&+.@', stdin: '20 22\n', output: '42 ' },
			{
				name: 'signed-division-remainder',
				source: '&&/.&&%.@',
				stdin: '-7 3 -7 3\n',
				output: '-2 -1 '
			},
			{
				name: 'unknown-instructions-are-noops',
				source: 'abc123...@',
				stdin: '',
				output: '3 2 1 '
			}
		]
	},
	{
		language: 'WHITESPACE',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_WHITESPACE === '1',
		defaultSource: () => editorDefaults.whitespace,
		echoSource: whitespaceEcho,
		infiniteSource: ws.label(' ') + ws.jump(' '),
		runtimePath: 'wasm-whitespace/whitespace.wasm',
		cases: [
			{
				name: 'utf8-explicit-eof',
				source: whitespaceEcho,
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{ name: 'empty-explicit-eof', source: whitespaceEcho, stdin: '', output: '' },
			{
				name: 'nul-byte-is-not-eof',
				source: whitespaceEcho,
				stdin: '\0A\n',
				output: '\0A\n'
			},
			{
				name: 'partial-explicit-stdin',
				source: whitespaceReadChar + ws.printChar + ws.halt,
				stdin: 'AB',
				output: 'A'
			},
			{ name: 'fresh-stdin', source: whitespaceEcho, stdin: 'C', output: 'C' },
			{
				name: 'character-eof-is-negative-one',
				source: whitespaceReadChar + ws.printNumber + ws.halt,
				stdin: '',
				output: '-1'
			},
			{
				name: 'whitespace-0.3-copy-slide',
				source:
					ws.push(10) +
					ws.push(20) +
					ws.push(30) +
					ws.copy(2) +
					ws.printNumber +
					whitespaceNewline +
					ws.slide(1) +
					ws.printNumber +
					whitespaceNewline +
					ws.printNumber +
					ws.halt,
				stdin: '',
				output: '10\n30\n10'
			},
			{
				name: 'slide-zero-preserves-stack',
				source: ws.push(1) + ws.push(2) + ws.slide(0) + ws.printNumber.repeat(2) + ws.halt,
				stdin: '',
				output: '21'
			},
			{
				name: 'stack-swap-duplicate-discard',
				source:
					ws.push(65) +
					ws.push(66) +
					ws.swap +
					ws.duplicate +
					ws.printChar +
					ws.discard +
					ws.printChar +
					ws.halt,
				stdin: '',
				output: 'AB'
			},
			{
				name: 'signed-arithmetic',
				source:
					ws.push(7) +
					ws.push(5) +
					ws.add +
					ws.printNumber +
					whitespaceNewline +
					ws.push(3) +
					ws.push(8) +
					ws.subtract +
					ws.printNumber +
					whitespaceNewline +
					ws.push(-6) +
					ws.push(7) +
					ws.multiply +
					ws.printNumber +
					ws.halt,
				stdin: '',
				output: '12\n-5\n-42'
			},
			{
				name: 'signed-division-remainder',
				source:
					ws.push(-7) +
					ws.push(3) +
					ws.divide +
					ws.printNumber +
					whitespaceNewline +
					ws.push(-7) +
					ws.push(3) +
					ws.remainder +
					ws.printNumber +
					ws.halt,
				stdin: '',
				output: '-2\n-1'
			},
			{
				name: '32bit-integer-wrap',
				source: ws.push(2147483647) + ws.push(1) + ws.add + ws.printNumber + ws.halt,
				stdin: '',
				output: '-2147483648'
			},
			{
				name: 'numeric-stdin',
				source:
					ws.push(0) +
					ws.readNumber +
					ws.push(1) +
					ws.readNumber +
					ws.push(0) +
					ws.load +
					ws.push(1) +
					ws.load +
					ws.add +
					ws.printNumber +
					ws.halt,
				stdin: '-7 3\n',
				output: '-4'
			},
			{
				name: 'heap-store-load',
				source:
					ws.push(9) +
					ws.push(65) +
					ws.store +
					ws.push(9) +
					ws.load +
					ws.printChar +
					ws.halt,
				stdin: '',
				output: 'A'
			},
			{
				name: 'seed-heap',
				source: ws.push(5) + ws.push(66) + ws.store + ws.halt,
				stdin: '',
				output: ''
			},
			{
				name: 'fresh-heap',
				source: ws.push(5) + ws.load + ws.printNumber + ws.halt,
				stdin: '',
				output: '0'
			},
			{
				name: 'nested-call-return',
				source:
					ws.call(' ') +
					ws.halt +
					ws.label(' ') +
					ws.push(65) +
					ws.printChar +
					ws.call('\t') +
					ws.push(67) +
					ws.printChar +
					ws.return +
					ws.label('\t') +
					ws.push(66) +
					ws.printChar +
					ws.return,
				stdin: '',
				output: 'ABC'
			},
			{
				name: 'forward-jump',
				source:
					ws.jump(' ') +
					ws.push(88) +
					ws.printChar +
					ws.label(' ') +
					ws.push(65) +
					ws.printChar +
					ws.halt,
				stdin: '',
				output: 'A'
			},
			{
				name: 'jump-if-zero',
				source:
					ws.push(0) +
					ws.jumpZero(' ') +
					ws.push(88) +
					ws.printChar +
					ws.halt +
					ws.label(' ') +
					ws.push(65) +
					ws.printChar +
					ws.halt,
				stdin: '',
				output: 'A'
			},
			{
				name: 'jump-if-negative',
				source:
					ws.push(-1) +
					ws.jumpNegative(' ') +
					ws.push(88) +
					ws.printChar +
					ws.halt +
					ws.label(' ') +
					ws.push(65) +
					ws.printChar +
					ws.halt,
				stdin: '',
				output: 'A'
			},
			{
				name: 'comments-ignore-nonwhitespace-characters',
				source: [...whitespaceEcho].map((character) => 'COMMENT' + character).join(''),
				stdin: 'comments\n',
				output: 'comments\n'
			},
			{
				name: 'source-buffer-boundary',
				source: 'X'.repeat(65532) + ws.halt,
				stdin: '',
				output: ''
			},
			{
				name: 'source-byte-limit',
				source: ' '.repeat(65536),
				stdin: '',
				expectedError: {
					code: 'runtime-configuration',
					phase: 'configuration',
					message: 'WHITESPACE source exceeds 65535 UTF-8 bytes'
				}
			}
		]
	},
	{
		language: 'MALBOLGE',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_MALBOLGE === '1',
		defaultSource: () => editorDefaults.malbolge,
		defaultInput: 'A',
		defaultOutput: 'A',
		echoSource: malbolgeEchoBytes(1),
		echoSourceForInput: malbolgeEcho,
		infiniteSource: malbolgeInfiniteCat,
		// The published cat prints EOF forever; let its execution timer settle first.
		timeoutMaxOutputBytes: 64 * 1024 * 1024,
		runtimePath: 'wasm-malbolge/malbolge.wasm',
		cases: [
			{
				name: 'hello-world-crazy-rotate-and-encryption',
				source: '(=<`#9]~6ZY32Vx/4Rs+0No-&Jk)"Fh}|Bcy?`=*z]Kw%oG4UUS0/@-ejc(:\'8dc',
				stdin: '',
				output: 'Hello World!'
			},
			{
				name: 'utf8-input-bytes',
				source: malbolgeEcho('첫째 줄 🦀\nsecond line\n'),
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{
				name: 'character-eof-original-value',
				// Original EOF is 59048, whose low byte is 0xa8: invalid standalone UTF-8.
				source: malbolgeEchoBytes(1),
				stdin: '',
				output: '\ufffd'
			},
			{
				name: 'utf8-then-explicit-eof',
				source: malbolgeEchoBytes(new TextEncoder().encode('한글 🦀\n').byteLength + 1),
				stdin: '한글 🦀\n',
				output: '한글 🦀\n\ufffd'
			},
			{
				name: 'nul-byte-is-not-eof',
				source: malbolgeEcho('\0A\n'),
				stdin: '\0A\n',
				output: '\0A\n'
			},
			{
				name: 'partial-explicit-stdin',
				source: malbolgeEchoBytes(1),
				stdin: 'AB',
				output: 'A'
			},
			{
				name: 'fresh-stdin',
				source: malbolgeEchoBytes(1),
				stdin: 'C',
				output: 'C'
			},
			{
				name: 'fresh-accumulator',
				source: 'cP',
				stdin: '',
				output: '\0'
			},
			{
				name: 'loader-skips-ascii-whitespace',
				source: [...malbolgeEcho('bytes')].join(' \t\r\n'),
				stdin: 'bytes',
				output: 'bytes'
			},
			{ name: 'halt-without-output', source: 'QP', stdin: '', output: '' },
			{ name: 'invalid-source-character', source: '@@', stdin: '', fails: true },
			{
				name: 'after-parse-failure',
				source: malbolgeEcho('parse-recovered\n'),
				stdin: 'parse-recovered\n',
				output: 'parse-recovered\n'
			},
			{
				name: 'empty-source',
				source: '',
				stdin: '',
				expectedError: {
					code: 'runtime-configuration',
					phase: 'configuration',
					message: 'MALBOLGE source requires at least 2 non-whitespace characters'
				}
			},
			{
				name: 'source-with-one-significant-character',
				source: ' \t\n A\r ',
				stdin: '',
				expectedError: {
					code: 'runtime-configuration',
					phase: 'configuration',
					message: 'MALBOLGE source requires at least 2 non-whitespace characters'
				}
			}
		]
	},
	{
		language: 'AHEUI',
		enabled: process.env.WASM_IDLE_RUN_REAL_BROWSER_AHEUI === '1',
		defaultSource: () => editorDefaults.aheui,
		defaultInput: '가\n',
		defaultOutput: '가',
		echoSource: '밯맣희',
		echoSourceForInput: aheuiEcho,
		infiniteSource: '아',
		runtimePath: 'wasm-aheui/aheui-1.2.5-py3-none-any.whl',
		cases: [
			{
				name: 'utf8-codepoints',
				source: aheuiEcho('첫째 줄 🦀\nsecond line\n'),
				stdin: '첫째 줄 🦀\nsecond line\n',
				output: '첫째 줄 🦀\nsecond line\n'
			},
			{ name: 'empty-explicit-eof', source: '밯망희', stdin: '', output: '-1' },
			{ name: 'numeric-input', source: '방망희', stdin: '42\n', output: '42' },
			{ name: 'unicode-codepoint-input', source: '밯망희', stdin: '가', output: '44032' },
			{
				name: 'nul-codepoint-original-replacement',
				source: aheuiEcho('\0A\n'),
				stdin: '\0A\n',
				output: '\ufffdA\n'
			},
			{ name: 'nul-byte-is-not-eof', source: '밯망밯망희', stdin: '\0A', output: '065' },
			{ name: 'partial-explicit-stdin', source: '밯맣희', stdin: 'AB', output: 'A' },
			{ name: 'fresh-stdin', source: '밯맣희', stdin: 'C', output: 'C' },
			{
				name: 'nested-unicode-source-path',
				source: '밯맣희',
				stdin: '한',
				output: '한',
				options: { activePath: 'examples/한글.aheui' }
			},
			{
				name: 'specification-hello-world',
				source: aheuiHelloWorld,
				stdin: '',
				output: 'Hello, world!\n'
			},
			{ name: 'stack-lifo', source: '박밪망망희', stdin: '', output: '32' },
			{ name: 'queue-fifo', source: '상박밪망망희', stdin: '', output: '23' },
			{
				name: 'queue-swap-duplicate',
				source: '상박밪파빠망망망희',
				stdin: '',
				output: '332'
			},
			{ name: 'move-between-stacks', source: '박싹밪싼삭망산망희', stdin: '', output: '23' },
			{
				name: 'all-26-independent-stacks',
				source: aheuiAllStacks,
				stdin: Array.from({ length: 26 }, (_, index) => `${index}\n`).join(''),
				output: Array.from({ length: 26 }, (_, index) => String(index)).join('')
			},
			{
				name: 'two-dimensional-direction',
				source: '아우\n희붛\n희뭏\n희희',
				stdin: '한',
				output: '한'
			},
			{ name: 'horizontal-torus', source: '벅희멍', stdin: '', output: '2' },
			{ name: 'vertical-torus', source: '보\n희\n몽', stdin: '', output: '0' },
			{ name: 'double-step-vowels', source: '뱧X먛X희', stdin: '🦀', output: '🦀' },
			{ name: 'underflow-reflects-direction', source: '마희', stdin: '', output: '' },
			{ name: 'signed-subtraction', source: '방방타망희', stdin: '3\n8\n', output: '-5' },
			{
				name: 'arbitrary-precision-square',
				source: '방빠따망희',
				stdin: '12345678901234567890\n',
				output: '152415787532388367501905199875019052100'
			},
			{ name: 'normal-nonzero-halt', source: '방희', stdin: '77\n', output: '' },
			{
				name: 'character-eof-original-replacement',
				source: '밯맣희',
				stdin: '',
				output: '\ufffd'
			},
			{
				name: 'division-by-zero',
				source: '박바나망희',
				stdin: '',
				fails: true,
				failureMessage: 'ZeroDivisionError'
			},
			{
				name: 'after-runtime-failure',
				source: aheuiEcho('runtime-recovered\n'),
				stdin: 'runtime-recovered\n',
				output: 'runtime-recovered\n'
			}
		]
	}
];

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const configured = configuredUrl ? new URL(configuredUrl) : undefined;
		const server = shouldReuseProvidedBrowserUrl(configuredUrl)
			? { browserUrl: configuredUrl, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: configured?.origin ?? 'http://127.0.0.1:4980',
					...(configured ? { basePath: configured.pathname } : {}),
					serverMode: 'dev'
				});
		try {
			await action(server.browserUrl);
		} finally {
			await server.close();
		}
	});
}

async function prepareConsumerPage(page: Page, browserUrl: string) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			await page.evaluate(async () => {
				if (!navigator.serviceWorker) return;
				await Promise.race([
					navigator.serviceWorker.ready,
					new Promise((resolve) => setTimeout(resolve, 1_500))
				]);
			});
			if (
				await page.evaluate(
					() =>
						crossOriginIsolated &&
						typeof SharedArrayBuffer !== 'undefined' &&
						Boolean(navigator.serviceWorker?.controller)
				)
			)
				break;
		} catch (error) {
			// The isolation service worker reloads the first uncontrolled document.
			if (
				!String(error).includes('Execution context was destroyed') &&
				!String(error).includes('net::ERR_ABORTED')
			)
				throw error;
			await page.waitForTimeout(250);
		}
	}
	await page.waitForFunction(
		() =>
			crossOriginIsolated &&
			typeof SharedArrayBuffer !== 'undefined' &&
			Boolean(navigator.serviceWorker?.controller)
	);
	const base = new URL('./', browserUrl);
	const moduleUrl = new URL('src/lib/playground/index.ts', base).href;
	await page.addScriptTag({
		type: 'module',
		content: `import playground from ${JSON.stringify(moduleUrl)}; globalThis.__esolangPlayground = playground;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__esolangPlayground));
	return base.pathname;
}

async function runInterpreterBrowserCases(
	page: Page,
	profile: InterpreterBrowserProfile,
	rootUrl: string
) {
	const echoInputs = [
		'stream 한글 🦀\nsecond chunk\n',
		'가'.repeat(512),
		'output-recovered\n',
		'timeout-recovered\n',
		'abort-recovered\n',
		'stop-recovered\n',
		'reload-recovered\n'
	];
	const echoPrograms = Object.fromEntries(
		echoInputs.map((stdin) => [
			stdin,
			profile.echoSourceForInput?.(stdin) ?? profile.echoSource
		])
	);
	return await page.evaluate(
		async ({
			language,
			cases,
			echoSource,
			echoPrograms,
			infiniteSource,
			timeoutMaxOutputBytes,
			rootUrl
		}) => {
			const playground = (globalThis as any).__esolangPlayground as (
				language: string
			) => Promise<Sandbox>;
			const sandbox = await playground(language);
			const results: InterpreterResult[] = [];
			let output = '';
			sandbox.output = (text) => {
				output += text;
			};
			async function run(
				name: string,
				source: string,
				options: SandboxExecutionOptions = {},
				interact?: (inputReady: Promise<void>) => Promise<void>
			) {
				// Reload also creates a new worker after a timeout, output limit, or Stop.
				await sandbox.load({ rootUrl });
				output = '';
				const started = performance.now();
				let inputRequests = 0;
				let markInputReady!: () => void;
				const inputReady = new Promise<void>((resolve) => {
					markInputReady = resolve;
				});
				try {
					const pending = sandbox.run(
						source,
						false,
						false,
						{
							report(event) {
								if (event.kind === 'ready' && event.reason === 'stdin-request') {
									inputRequests += 1;
									markInputReady();
								}
							}
						},
						[],
						options
					);
					// Cancellation may settle before the interaction callback returns.
					void pending.catch(() => {});
					if (interact) {
						let timeout: ReturnType<typeof setTimeout> | undefined;
						try {
							await Promise.race([
								interact(inputReady),
								new Promise<never>((_, reject) => {
									timeout = setTimeout(
										() =>
											reject(new Error('Interpreter did not request stdin')),
										10_000
									);
								})
							]);
						} finally {
							clearTimeout(timeout);
						}
					}
					const result = await pending;
					results.push({
						name,
						result,
						output,
						inputRequests,
						elapsedMs: performance.now() - started
					});
				} catch (error) {
					const details = error as InterpreterResult['error'];
					results.push({
						name,
						output,
						inputRequests,
						elapsedMs: performance.now() - started,
						error: {
							message: details?.message ?? String(error),
							code: details?.code,
							phase: details?.phase,
							actual: details?.actual,
							limit: details?.limit
						}
					});
					// Retire a still-running worker if the test's stdin deadline failed.
					if (details?.message === 'Interpreter did not request stdin')
						await sandbox.terminate();
				}
			}
			try {
				for (const testCase of cases)
					await run(testCase.name, testCase.source, {
						...testCase.options,
						stdin: testCase.stdin
					});

				await run(
					'streaming-eof',
					echoPrograms['stream 한글 🦀\nsecond chunk\n'],
					{},
					async (inputReady) => {
						await inputReady;
						await new Promise((resolve) => setTimeout(resolve, 75));
						sandbox.write?.('stream 한글 🦀\n');
						sandbox.write?.('second chunk\n');
						sandbox.eof();
					}
				);

				await run('output-limit', echoPrograms['가'.repeat(512)], {
					stdin: '가'.repeat(512),
					limits: { maxOutputBytes: 1024 }
				});
				await run('after-output-limit', echoPrograms['output-recovered\n'], {
					stdin: 'output-recovered\n'
				});

				await run('infinite-loop-timeout', infiniteSource, {
					stdin: '',
					limits: {
						compileTimeoutMs: 1,
						runTimeoutMs: 500,
						...(timeoutMaxOutputBytes ? { maxOutputBytes: timeoutMaxOutputBytes } : {})
					}
				});
				await run('after-timeout', echoPrograms['timeout-recovered\n'], {
					stdin: 'timeout-recovered\n'
				});

				const controller = new AbortController();
				await run(
					'abort-stdin-wait',
					echoSource,
					{ signal: controller.signal },
					async (inputReady) => {
						await inputReady;
						controller.abort(new Error('browser interpreter abort'));
					}
				);
				await run('after-abort', echoPrograms['abort-recovered\n'], {
					stdin: 'abort-recovered\n'
				});

				await run('stop-stdin-wait', echoSource, {}, async (inputReady) => {
					await inputReady;
					await sandbox.terminate();
				});
				await run('after-stop', echoPrograms['stop-recovered\n'], {
					stdin: 'stop-recovered\n'
				});

				await sandbox.terminate();
				await run('after-explicit-reload', echoPrograms['reload-recovered\n'], {
					stdin: 'reload-recovered\n'
				});
			} finally {
				await sandbox.dispose?.();
			}
			return { crossOriginIsolated, results };
		},
		{
			language: profile.language,
			cases: profile.cases,
			echoSource: profile.echoSource,
			echoPrograms,
			infiniteSource: profile.infiniteSource,
			timeoutMaxOutputBytes: profile.timeoutMaxOutputBytes,
			rootUrl
		}
	);
}

for (const profile of profiles) {
	const browserMeta = { browser: true, requiredBrowser: profile.enabled };
	describe.skipIf(!profile.enabled)(`real ${profile.language} browser interpreter`, () => {
		it(
			'runs the default editor sample with terminal input and EOF',
			{ timeout: 180_000, meta: browserMeta },
			async () => {
				await withBrowserPreview(async (browserUrl) => {
					const expectedOutput = profile.defaultOutput ?? 'default 한글 🦀';
					const summary = await runStdinBrowserProbe({
						browserUrl,
						language: profile.language,
						source: profile.defaultSource(),
						stdinText: profile.defaultInput ?? 'default 한글 🦀\n',
						expectedOutput,
						sendEof: true,
						checkLoadingProgress: false
					});
					expect(summary.transcript).toContain(expectedOutput);
					expect(summary.pageErrors).toEqual([]);
					expect(
						summary.runtimeRequests.some((request: string) =>
							new URL(request).pathname.endsWith(profile.runtimePath)
						)
					).toBe(true);
				});
			}
		);

		it(
			'uses the real interpreter for I/O, language semantics, failures and recovery',
			{ timeout: 180_000, meta: browserMeta },
			async () => {
				await withBrowserPreview(async (browserUrl) => {
					const browser = await chromium.launch({
						headless: true,
						executablePath: await resolveChromiumExecutable(
							process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
						)
					});
					const pageErrors: string[] = [];
					try {
						const context = await browser.newContext();
						await addBrowserTestCookies(context, browserUrl);
						await disableBrowserPrewarm(context);
						const page = await context.newPage();
						page.setDefaultTimeout(60_000);
						const rootUrl = await prepareConsumerPage(page, browserUrl);
						// The isolation reload can abort imports in the initial document.
						// Record errors in the controlled document used by the consumer.
						page.on('pageerror', (error) => pageErrors.push(error.message));
						const report = await runInterpreterBrowserCases(page, profile, rootUrl);
						expect(report.crossOriginIsolated).toBe(true);
						const byName = Object.fromEntries(
							report.results.map((result) => [result.name, result])
						);
						for (const testCase of profile.cases) {
							const result = byName[testCase.name];
							if (testCase.expectedError) {
								expect(result.error, JSON.stringify(result)).toMatchObject(
									testCase.expectedError
								);
							} else if (testCase.fails) {
								expect(result.error, JSON.stringify(result)).toBeDefined();
								expect(result.error?.message).toMatch(
									testCase.failureMessage ?? /exited|bracket|syntax/iu
								);
							} else {
								expect(result.error, JSON.stringify(result)).toBeUndefined();
								expect(result.result).toBe(true);
								expect(result.output).toBe(testCase.output);
							}
						}
						expect(byName['streaming-eof'].error).toBeUndefined();
						expect(byName['streaming-eof'].inputRequests).toBeGreaterThan(0);
						expect(byName['streaming-eof'].output).toBe(
							'stream 한글 🦀\nsecond chunk\n'
						);
						expect(byName['output-limit'].error).toMatchObject({
							code: 'output-limit',
							phase: 'execute',
							limit: 1024
						});
						expect(byName['output-limit'].error?.actual).toBeGreaterThan(1024);
						expect(
							new TextEncoder().encode(byName['output-limit'].output).length
						).toBeLessThanOrEqual(1024);
						expect(byName['infinite-loop-timeout'].error).toMatchObject({
							code: 'timeout',
							phase: 'execute'
						});
						expect(byName['infinite-loop-timeout'].elapsedMs).toBeLessThan(10_000);
						expect(byName['abort-stdin-wait'].inputRequests).toBeGreaterThan(0);
						expect(byName['abort-stdin-wait'].error?.message).toBe(
							'browser interpreter abort'
						);
						expect(byName['stop-stdin-wait'].inputRequests).toBeGreaterThan(0);
						expect(byName['stop-stdin-wait'].error?.message).toBe('Process terminated');
						for (const [name, output] of [
							['after-output-limit', 'output-recovered\n'],
							['after-timeout', 'timeout-recovered\n'],
							['after-abort', 'abort-recovered\n'],
							['after-stop', 'stop-recovered\n'],
							['after-explicit-reload', 'reload-recovered\n']
						]) {
							expect(
								byName[name].error,
								JSON.stringify(byName[name])
							).toBeUndefined();
							expect(byName[name].result).toBe(true);
							expect(byName[name].output).toBe(output);
						}
						expect(pageErrors).toEqual([]);
					} finally {
						await browser.close();
					}
				});
			}
		);
	});
}
