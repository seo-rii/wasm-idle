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
