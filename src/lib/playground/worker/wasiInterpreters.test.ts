// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WASI_INTERPRETERS } from '../wasiInterpreters';

let profile = WASI_INTERPRETERS.BRAINFUCK;
const messages: any[] = [];

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal('self', globalThis);
	vi.stubGlobal('postMessage', (message: unknown) => messages.push(message));
	messages.length = 0;
});

async function loadInterpreter(id: string) {
	profile = WASI_INTERPRETERS[id];
	const bytes = await readFile(`static/${profile.folder}/${profile.fileName}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(bytes))
	);
	await import('./wasm');
	await (globalThis as any).onmessage({
		data: {
			load: true,
			interpreter: profile,
			interpreterUrl: `https://wasm-idle.test/${profile.folder}/${profile.fileName}`,
			persistentCache: false
		}
	});
	expect(messages).toContainEqual({ load: true });
	messages.length = 0;
}

afterEach(() => vi.unstubAllGlobals());

async function run(code: string, stdin = '', extra: Record<string, unknown> = {}) {
	messages.length = 0;
	await (globalThis as any).onmessage({
		data: {
			code,
			stdin,
			activePath: profile.sourcePath,
			...extra
		}
	});
	return {
		output: messages.map((message) => message.output ?? '').join(''),
		error: messages.find((message) => message.error)?.error,
		completed: messages.some((message) => message.results === true)
	};
}

describe('pinned upstream Brainfuck WASI interpreter', () => {
	beforeEach(() => loadInterpreter('BRAINFUCK'));
	it('echoes UTF-8 bytes and terminates at explicit EOF', async () => {
		expect(await run(',[.,]', '한글🙂\n')).toEqual({
			output: '한글🙂\n',
			error: undefined,
			completed: true
		});
	});

	it('runs nested loops, byte wrapping and fresh memory on each execution', async () => {
		expect((await run('++++++++[>++++++++[>+<-]<-]>>+.')).output).toBe('A');
		expect((await run('-+.')).output).toBe('\0');
		expect((await run('+.')).output).toBe('\x01');
		expect((await run('+.')).output).toBe('\x01');
	});

	it('uses the requested nested source path without consuming program stdin as source', async () => {
		expect(
			await run(',.[-],.', 'AZ', {
				activePath: 'src/echo.bf',
				workspaceFiles: [{ path: 'src/unused.bf', content: '+++.' }]
			})
		).toEqual({ output: 'AZ', error: undefined, completed: true });
	});

	it.each([
		'가'.repeat(8) + '.bf',
		'가'.repeat(10) + '.bf',
		'src/한글🙂.bf',
		'가'.repeat(19) + 'xx.bf',
		'x'.repeat(59) + '.bf'
	])('runs the editor source at a UTF-8-safe path: %s', async (activePath) => {
		expect(
			await run('+'.repeat(65) + '.', '', {
				activePath,
				workspaceFiles: [{ path: activePath, content: '+'.repeat(66) + '.' }]
			})
		).toEqual({ output: 'A', error: undefined, completed: true });
	});

	it('preserves a UTF-8 BOM from the upstream output stream', async () => {
		expect(await run(',[.,]', '\ufeff첫 줄🙂\n')).toEqual({
			output: '\ufeff첫 줄🙂\n',
			error: undefined,
			completed: true
		});
	});

	it.each([false, true])(
		'rejects a path that upstream would truncate before running a colliding file (prepare=%s)',
		async (prepare) => {
			const activePath = 'x'.repeat(60) + '.bf';
			const invalid = await run('+'.repeat(65) + '.', '', {
				prepare,
				activePath,
				workspaceFiles: [{ path: activePath.slice(0, 62), content: '+'.repeat(66) + '.' }]
			});
			expect(invalid.completed).toBe(false);
			expect(invalid.error).toBe('BRAINFUCK source path exceeds 62 UTF-8 bytes');
			expect(invalid.output).toBe('');
			expect((await run(',.', 'Q')).output).toBe('Q');
		}
	);

	it('counts UTF-8 path bytes rather than JavaScript code units', async () => {
		const invalid = await run('+'.repeat(65) + '.', '', {
			activePath: '가'.repeat(20) + '.bf'
		});
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toBe('BRAINFUCK source path exceeds 62 UTF-8 bytes');
		expect(invalid.output).toBe('');
	});

	it('reports the upstream syntax error and runs a valid program afterwards', async () => {
		const invalid = await run('[');
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/exited with code/u);
		expect(invalid.output.length).toBeGreaterThan(0);
		expect((await run(',.', 'Q')).output).toBe('Q');
	});

	it('rejects invalid filesystem paths before the interpreter starts', async () => {
		const invalid = await run(',[.,]', 'secret', { activePath: '../escape.bf' });
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/path/u);
		expect(invalid.output).toBe('');
	});

	it('fails startup when the downloaded runtime differs from the code-pinned receipt', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('tampered'))
		);
		messages.length = 0;
		await (globalThis as any).onmessage({
			data: {
				load: true,
				interpreter: profile,
				interpreterUrl: `https://wasm-idle.test/${profile.folder}/${profile.fileName}`,
				persistentCache: false
			}
		});
		expect(messages.some((message) => message.load)).toBe(false);
		expect(messages.some((message) => message.error)).toBe(true);
	});

	it.each([1, profile.bytes - 1])(
		'rejects a caller asset budget below the pinned receipt before downloading: %s',
		async (maxAssetBytes) => {
			vi.mocked(fetch).mockClear();
			await (globalThis as any).onmessage({
				data: {
					load: true,
					interpreter: profile,
					interpreterUrl: `https://wasm-idle.test/${profile.folder}/${profile.fileName}`,
					maxAssetBytes,
					persistentCache: false
				}
			});
			expect(messages).toContainEqual({
				error: `BRAINFUCK interpreter exceeds the ${maxAssetBytes} byte limit`
			});
			expect(messages.some((message) => message.load)).toBe(false);
			expect(fetch).not.toHaveBeenCalled();
		}
	);

	it('accepts an exact receipt-sized download budget and runs after a failed load', async () => {
		await (globalThis as any).onmessage({
			data: {
				load: true,
				interpreter: profile,
				interpreterUrl: `https://wasm-idle.test/${profile.folder}/${profile.fileName}`,
				maxAssetBytes: 1,
				persistentCache: false
			}
		});
		messages.length = 0;
		await (globalThis as any).onmessage({
			data: {
				load: true,
				interpreter: profile,
				interpreterUrl: `https://wasm-idle.test/${profile.folder}/${profile.fileName}`,
				maxAssetBytes: profile.bytes,
				persistentCache: false
			}
		});
		expect(messages).toContainEqual({ load: true });
		expect(await run(',.', 'Q')).toEqual({ output: 'Q', error: undefined, completed: true });
	});
});

describe('original Befunge-93 WASI interpreter', () => {
	beforeEach(() => loadInterpreter('BEFUNGE93'));

	it('rejects a UTF-8 source path larger than the upstream filename buffer', async () => {
		const result = await run('@', '', { activePath: '가'.repeat(43) + '.b93' });
		expect(result.error).toMatch(/source path exceeds 125 UTF-8 bytes/u);
		expect(result.completed).toBe(false);
		expect((await run('~,@', 'X')).output).toBe('X');
	});

	it('loads extensionless source files without the upstream automatic suffix', async () => {
		expect(await run('~,@', 'Y', { activePath: 'program' })).toEqual({
			output: 'Y',
			error: undefined,
			completed: true
		});
	});

	it('echoes UTF-8 bytes and handles character EOF as minus one', async () => {
		expect(await run('~:1+!#@_,', '아희🙂\n')).toEqual({
			output: '아희🙂\n',
			error: undefined,
			completed: true
		});
		expect(await run('~.@')).toEqual({ output: '-1 ', error: undefined, completed: true });
	});

	it('reads whitespace-separated signed integers from program stdin', async () => {
		expect(await run('&.&.@', '42 -7\n')).toEqual({
			output: '42 -7 ',
			error: undefined,
			completed: true
		});
	});

	it('executes two-dimensional arrows and stack-based string mode', async () => {
		expect((await run('v\n>"KO",,@')).output).toBe('OK');
		expect((await run('.@')).output).toBe('0 ');
	});

	it('supports self-modifying p/g instructions and starts each run with a fresh playfield', async () => {
		expect((await run('"Z"01p01g,@')).output).toBe('Z');
		expect((await run('01g.@')).output).toBe('32 ');
	});

	it('uses the upstream signed division and remainder semantics', async () => {
		expect((await run('07-2/.07-2%.@')).output).toBe('-3 -1 ');
	});
});

describe('upstream Whitespace 0.3 WASI interpreter', () => {
	beforeEach(() => loadInterpreter('WHITESPACE'));
	const push = (value: number) =>
		'  ' +
		(value < 0 ? '\t' : ' ') +
		Math.abs(value).toString(2).replace(/0/gu, ' ').replace(/1/gu, '\t') +
		'\n';
	const halt = '\n\n\n';
	const numberOut = '\t\n \t';
	const charOut = '\t\n  ';
	const label = (value: string) => '\n  ' + value + '\n';
	const jump = (value: string) => '\n \n' + value + '\n';
	const echo =
		label(' ') +
		push(0) +
		'\t\n\t ' +
		push(0) +
		'\t\t\t' +
		' \n ' +
		'\n\t\t\t\n' +
		charOut +
		jump(' ') +
		label('\t') +
		' \n\n' +
		halt;

	it('echoes UTF-8 including a NUL byte and ends on character EOF', async () => {
		expect(await run(echo, '아희\0🙂\n')).toEqual({
			output: '아희\0🙂\n',
			error: undefined,
			completed: true
		});
	});

	it('reads signed numeric input through heap storage', async () => {
		const program = push(0) + '\t\n\t\t' + push(0) + '\t\t\t' + numberOut + halt;
		expect((await run(program, '-42\n')).output).toBe('-42');
	});

	it.each([
		['division', 0, 3, '\t \t ', '0'],
		['division', 0, -3, '\t \t ', '0'],
		['remainder', 0, 3, '\t \t\t', '0'],
		['remainder', 0, -3, '\t \t\t', '0'],
		['division', 7, -3, '\t \t ', '-2'],
		['division', -7, -3, '\t \t ', '2'],
		['remainder', 7, -3, '\t \t\t', '1'],
		['remainder', -7, -3, '\t \t\t', '-1']
	])(
		'computes %s for dividend %i and divisor %i',
		async (_name, dividend, divisor, operation, output) => {
			expect(
				await run(push(dividend) + push(divisor) + operation + numberOut + halt)
			).toEqual({
				output,
				error: undefined,
				completed: true
			});
		}
	);

	it.each([
		['division', '\t \t '],
		['remainder', '\t \t\t']
	])(
		'rejects a zero divisor in %s and runs a valid program afterwards',
		async (_name, operation) => {
			const invalid = await run(push(7) + push(0) + operation + numberOut + halt);
			expect(invalid.completed).toBe(false);
			expect(invalid.error).toBe('unreachable');
			expect(invalid.output).toMatch(/Assertion failed: a != 0/u);
			expect(await run(push(0) + push(-3) + operation + numberOut + halt)).toEqual({
				output: '0',
				error: undefined,
				completed: true
			});
		}
	);

	it('executes stack copy and slide from Whitespace 0.3', async () => {
		const copy =
			push(10) + push(20) + ' \t ' + ' \t\n' + numberOut + numberOut + numberOut + halt;
		expect((await run(copy)).output).toBe('102010');
		const slide =
			push(1) + push(2) + push(3) + ' \t\n' + ' \t\n' + numberOut + numberOut + halt;
		expect((await run(slide)).output).toBe('31');
	});

	it('executes subroutine calls and returns', async () => {
		const program = '\n \t \n' + halt + label(' ') + push(65) + charOut + '\n\t\n';
		expect((await run(program)).output).toBe('A');
	});

	it('rejects an oversized source before entering the upstream parser', async () => {
		const invalid = await run(' '.repeat(65536));
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/source exceeds 65535 UTF-8 bytes/u);
		expect((await run(push(42) + numberOut + halt)).output).toBe('42');
	});
});

describe('original Malbolge WASI interpreter', () => {
	beforeEach(() => loadInterpreter('MALBOLGE'));

	it('reads a byte from program stdin and writes it using the original interpreter', async () => {
		expect(await run('ubO', 'A')).toEqual({ output: 'A', error: undefined, completed: true });
		expect((await run('ubO', '\0')).output).toBe('\0');
	});

	it('ignores source whitespace and mounts a selected nested filename', async () => {
		expect(await run('u\nb\tO ', 'Z', { activePath: 'src/main.mal' })).toEqual({
			output: 'Z',
			error: undefined,
			completed: true
		});
	});

	it('rejects invalid source instructions through the upstream loader', async () => {
		const invalid = await run('@@');
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/exited with code/u);
		expect(invalid.output).toMatch(/invalid/u);
		expect((await run('QP')).completed).toBe(true);
	});

	it('rejects source that cannot safely initialize the upstream memory', async () => {
		for (const code of ['', ' ', 'u', '\tu\n']) {
			const invalid = await run(code);
			expect(invalid.completed).toBe(false);
			expect(invalid.error).toMatch(/requires at least 2/u);
		}
		expect((await run('ubO', 'Q')).output).toBe('Q');
	});
});

describe('original Umjunsik Go WASI interpreter', () => {
	beforeEach(() => loadInterpreter('UHMLANG'));
	const program = (lines: string[]) => ['어떻게', ...lines, '이 사람이름이냐ㅋㅋ'].join('\n');
	const numberEcho = program(['엄식?', '식어!']);
	const characterEcho = program(['엄식?', '식어ㅋ']);

	it('passes a nested Unicode filename through UTF-8 WASI argv', async () => {
		expect(
			await run(numberEcho, '42\n', {
				activePath: 'examples/한글🦀.umm',
				workspaceFiles: [{ path: 'examples/unused.um', content: numberEcho }]
			})
		).toEqual({ output: '42', error: undefined, completed: true });
	});

	it('reads signed numeric stdin and uses the original Unicode character output', async () => {
		expect(await run(numberEcho, '-42\n')).toEqual({
			output: '-42',
			error: undefined,
			completed: true
		});
		expect(
			await run(program(['엄식?', '식어ㅋ', '엄식?', '식어ㅋ']), '54620\n129408\n')
		).toEqual({
			output: '한🦀',
			error: undefined,
			completed: true
		});
	});

	it('preserves original numeric EOF and invalid-input behavior', async () => {
		expect((await run(numberEcho)).output).toBe('0');
		expect((await run(numberEcho, 'invalid\n')).output).toBe('0');
		expect((await run(characterEcho, '0\n')).output).toBe('\0');
	});

	it('starts a fresh stdin stream on each execution and mounts the requested source file', async () => {
		expect((await run(characterEcho, '65\n66\n', { activePath: 'src/main.umm' })).output).toBe(
			'A'
		);
		expect((await run(characterEcho, '67\n')).output).toBe('C');
	});

	it('reports an upstream parser failure and recovers with the original interpreter', async () => {
		const invalid = await run('invalid source');
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/exited with code/u);
		expect(invalid.output).toMatch(/panic/u);
		expect((await run(numberEcho, '42\n')).output).toBe('42');
	});
});

describe('original lci LOLCODE 1.3 WASI interpreter', () => {
	beforeEach(() => loadInterpreter('LOLCODE'));
	const program = (lines: string[]) => ['HAI 1.3', ...lines, 'KTHXBYE'].join('\n');
	const echo = program(['I HAS A name', 'GIMMEH name', 'VISIBLE name']);

	it('preserves a leading Unicode BOM emitted by the original interpreter', async () => {
		expect(await run('\ufeff' + program(['VISIBLE "BOM"']))).toEqual({
			output: '\ufeffBOM\n',
			error: undefined,
			completed: true
		});
	});

	it('reads UTF-8 input lines and preserves lci newline and EOF behavior', async () => {
		expect(await run(echo, '한🦀\n')).toEqual({
			output: '한🦀\n',
			error: undefined,
			completed: true
		});
		expect((await run(echo, 'last line')).output).toBe('last line\n');
		expect((await run(echo)).output).toBe('\n');
	});

	it('mounts a selected Unicode filename and starts with fresh stdin on every run', async () => {
		expect(await run(echo, 'first\nunused\n', { activePath: 'examples/한글.lol' })).toEqual({
			output: 'first\n',
			error: undefined,
			completed: true
		});
		expect((await run(echo, 'fresh\n')).output).toBe('fresh\n');
	});

	it('uses the original function calls and counted loops', async () => {
		const functionCall = program([
			'HOW IZ I add YR a AN YR b',
			'FOUND YR SUM OF a AN b',
			'IF U SAY SO',
			'VISIBLE I IZ add YR 40 AN YR 2 MKAY'
		]);
		expect((await run(functionCall)).output).toBe('42\n');
		const loop = program([
			'I HAS A index ITZ 0',
			'IM IN YR loop UPPIN YR index TIL BOTH SAEM index AN 3',
			'VISIBLE index!',
			'IM OUTTA YR loop'
		]);
		expect((await run(loop)).output).toBe('012');
	});

	it('reports the upstream syntax diagnostic and runs a valid program afterwards', async () => {
		const invalid = await run('HAI 1.3\nVISIBLE\nKTHXBYE');
		expect(invalid.completed).toBe(false);
		expect(invalid.error).toMatch(/exited with code/u);
		expect(invalid.output.length).toBeGreaterThan(0);
		expect((await run(echo, 'recovered\n')).output).toBe('recovered\n');
	});
});
