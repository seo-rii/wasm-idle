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
