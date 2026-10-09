// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preflightRubySplitRuntimeAssets } from '@wasm-idle/core';
import { WASM_GOLFSCRIPT_INTERPRETER_RECEIPT } from '../wasmGolfscriptVersion';

const rubyAssets = new URL('../../../../static/wasm-ruby/split/', import.meta.url);
const golfscriptAssets = new URL('../../../../static/wasm-golfscript/', import.meta.url);
const messages = vi.hoisted(() => [] as any[]);
const stats = vi.hoisted(() => ({ instances: 0 }));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: async (url: string) => {
		// Node's transport cannot import blob URLs; the real Ruby/WASI VM is unchanged.
		const source = await (await fetch(url)).text();
		const runtime = await import(
			/* @vite-ignore */ 'data:text/javascript;base64,' +
				Buffer.from(source).toString('base64')
		);
		return {
			...runtime,
			RubyVM: {
				instantiateModule: (...args: any[]) => {
					stats.instances++;
					return runtime.RubyVM.instantiateModule(...args);
				}
			}
		};
	}
}));

beforeEach(() => {
	vi.resetModules();
	messages.length = 0;
	stats.instances = 0;
	vi.stubGlobal('self', {});
	vi.stubGlobal('postMessage', (message: any) => messages.push(message));
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const interpreterBytes = async () =>
	Uint8Array.from(await readFile(new URL('golfscript.rb', golfscriptAssets)));

async function ready(context?: {
	args: string[];
	activePath: string;
	workspaceFiles: Array<{ path: string; content: string }>;
}) {
	const payload = await preflightRubySplitRuntimeAssets({
		baseUrl: 'https://runtime.test/ruby/',
		fetch: async (input) =>
			new Response(
				Uint8Array.from(
					await readFile(
						new URL(new URL(String(input)).pathname.split('/').at(-1)!, rubyAssets)
					)
				)
			)
	});
	await import('./ruby');
	const send = (data: any) => (globalThis as any).self.onmessage({ data });
	await send({
		load: true,
		language: 'golfscript',
		interpreterBytes: await interpreterBytes(),
		runtimePreflight: payload,
		maxAssetBytes: 40 * 1024 * 1024,
		...(context ? { startupContext: context } : {})
	});
	expect(messages.filter((message) => message.error || message.output || message.buffer)).toEqual(
		[]
	);
	expect(messages.some((message) => message.load === true)).toBe(true);
	return send;
}

const request = (code: string, extra: Record<string, unknown> = {}) => ({
	code,
	prepare: false,
	buffer: new SharedArrayBuffer(4096),
	stdin: '',
	activePath: 'main.gs',
	workspaceFiles: [],
	args: [],
	log: false,
	...extra
});
const stdout = () =>
	messages
		.filter((message) => message.output)
		.map((message) => message.output)
		.join('');

describe('original GolfScript interpreter on the real Ruby/WASI VM', () => {
	it('distributes unchanged upstream source and its original copyright/MIT header', async () => {
		const source = await interpreterBytes();
		const vendor = await readFile(
			new URL(
				'../../../../runtimes/esolangs/golfscript/vendor/golfscript.rb',
				import.meta.url
			)
		);
		expect(Buffer.from(source).equals(vendor)).toBe(true);
		expect(source.length).toBe(WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.sha256
		);
		const license = await readFile(new URL('LICENSE.txt', golfscriptAssets), 'utf8');
		expect(license).toBe(vendor.toString('utf8').split('\n').slice(2, 4).join('\n') + '\n');
	});

	it('rejects corrupted or oversized interpreter bytes before VM initialization', async () => {
		await import('./ruby');
		const send = (data: any) => (globalThis as any).self.onmessage({ data });
		const bytes = await interpreterBytes();
		bytes[100] ^= 1;
		const base = {
			load: true,
			language: 'golfscript',
			runtimePreflight: {},
			interpreterBytes: bytes
		};
		await send({ ...base, maxAssetBytes: 40 * 1024 * 1024 });
		expect(messages.some((message) => String(message.error).includes('SHA-256'))).toBe(true);
		expect(stats.instances).toBe(0);
		messages.length = 0;
		await send({ ...base, maxAssetBytes: WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.bytes - 1 });
		expect(messages.some((message) => String(message.error).includes('asset byte limit'))).toBe(
			true
		);
		expect(stats.instances).toBe(0);
	});

	it('prepares Ruby without parsing GolfScript or reading input, and claims the VM once', async () => {
		const send = await ready();
		const count = stats.instances;
		messages.length = 0;
		await send(request(';"unterminated', { prepare: true }));
		await send(request('~+', { prepare: true, stdin: 'stale input' }));
		expect(
			messages.filter((message) => message.output || message.error || message.buffer)
		).toEqual([]);
		expect(stats.instances).toBe(count);
		messages.length = 0;
		await send(request('~+', { stdin: '20 22\n' }));
		expect(messages.filter((message) => message.error)).toEqual([]);
		expect(stdout()).toBe('42\n');
		expect(stats.instances).toBe(count);
		messages.length = 0;
		await send(request('~+', { stdin: '10 11\n' }));
		expect(stdout()).toBe('21\n');
		expect(stats.instances).toBe(count + 1);
	}, 30000);

	it('executes original arithmetic, blocks, arrays, definitions, big integers and CLI options', async () => {
		const send = await ready();
		const fixtures: Array<[string, string, string, string[]?]> = [
			['~+', '20 22\n', '42\n'],
			['#', '가😀\0\n', '가😀\0\n\n'],
			['#', '', '\n'],
			[';-10 3 /', '', '-4\n'],
			[';[1 2 3]{2*}%', '', '246\n'],
			[';[3 1 2]$', '', '123\n'],
			[';5,', '', '01234\n'],
			[';[1 2 3 4]{2%},', '', '13\n'],
			[';7:x; x 2*', '', '14\n'],
			[';{2*}:double; 7 double', '', '14\n'],
			[';1{11}{22}if', '', '11\n'],
			[';3{7}*', '', '777\n'],
			[';1 2\\', '', '21\n'],
			[";'a' 'b'+", '', 'ab\n'],
			[";'abc'-1%", '', 'cba\n'],
			[';2 100?', '', '1267650600228229401496703205376\n'],
			[';"#{3 + 4}"', '', '7\n'],
			[';42', '', '', ['-q']],
			[';"#{3 + 4}"', '', '#{3 + 4}\n', ['-n']],
			[';-4 -1 ?', '', '-1/4\n', ['-r']],
			['#', 'ignored', 'alpha-beta\n', ['--', 'alpha', '-beta']],
			['#', 'ignored', "#{1 + 1} a'b\\c\n", ['--', "#{1 + 1} a'b\\c"]]
		];
		for (const [source, stdin, expected, args = []] of fixtures) {
			messages.length = 0;
			await send(request(source, { stdin, args }));
			expect(
				messages.filter((message) => message.error),
				source
			).toEqual([]);
			expect(stdout(), source).toBe(expected);
			expect(messages.at(-1)).toEqual({ results: true });
		}
	}, 60000);

	it('preserves leading BOM characters from stdin, literals and split writes', async () => {
		const send = await ready();
		const fixtures: Array<[string, string, string]> = [
			['#', '\ufeffA', '\ufeffA\n'],
			[';"\ufeffB"', '', '\ufeffB\n'],
			[
				String.raw`;"#{[0xef,0xbb,0xbf].each { |byte| STDOUT.write([byte].pack('C')) }; 'A'}"`,
				'',
				'\ufeffA\n'
			]
		];
		for (const [code, stdin, expected] of fixtures) {
			messages.length = 0;
			await send(request(code, { stdin }));
			expect(messages.filter((message) => message.error)).toEqual([]);
			expect(stdout()).toBe(expected);
		}
	}, 30000);

	it('streams split UTF-8 independently for stdout and stderr and reports written bytes', async () => {
		const send = await ready();
		const fixtures: Array<[string, string]> = [
			[
				String.raw`;"#{[0xed,0x95,0x9c].each { |byte| STDOUT.write([byte].pack('C')) }; 'A'}"`,
				'한A\n'
			],
			[
				String.raw`;"#{STDOUT.write([0xed].pack('C')); STDERR.write([0xef,0xbb,0xbf].pack('C*') + 'stderr'); STDOUT.write([0x95,0x9c].pack('C*')); 'A'}"`,
				'\ufeffstderr한A\n'
			],
			[
				String.raw`;"#{written = STDOUT.write('A', [0xed,0x95,0x9c].pack('C*'), 'C'); raise 'wrong byte count' unless written == 5; 'D'}"`,
				'A한CD\n'
			]
		];
		for (const [code, expected] of fixtures) {
			messages.length = 0;
			await send(request(code));
			expect(messages.filter((message) => message.error)).toEqual([]);
			expect(stdout()).toBe(expected);
		}
	}, 30000);

	it.each([false, true])(
		'flushes incomplete UTF-8 on termination and resets both streams (failure=%s)',
		async (failure) => {
			const send = await ready();
			messages.length = 0;
			const ending = failure ? "raise 'decoder-failure'" : "''";
			const code = `;"#{STDOUT.write([0xea].pack('C')); STDERR.write([0xed].pack('C')); ${ending}}"`;
			await send(request(code, { args: ['-q'] }));
			expect(stdout()).toBe('\ufffd\ufffd');
			if (failure) {
				expect(
					messages.some((message) => String(message.error).includes('decoder-failure'))
				).toBe(true);
				expect(messages.some((message) => message.results)).toBe(false);
			} else {
				expect(messages.filter((message) => message.error)).toEqual([]);
				expect(messages.at(-1)).toEqual({ results: true });
			}
			messages.length = 0;
			await send(request('#', { stdin: '\ufefffresh' }));
			expect(stdout()).toBe('\ufefffresh\n');
			expect(messages.filter((message) => message.error)).toEqual([]);
		},
		30000
	);

	it('mounts the latest source at exact Unicode filenames and keeps source/helpers/interpreter readonly', async () => {
		const activePath = "examples/한글#{1} 'quoted'.gs";
		const workspaceFiles = [{ path: 'helper.txt', content: 'workspace-value' }];
		const send = await ready({ activePath, args: [], workspaceFiles });
		const source = String.raw`;"#{File.read('helper.txt')}"`;
		messages.length = 0;
		await send(request(source, { activePath, workspaceFiles, prepare: true }));
		await send(request(source, { activePath, workspaceFiles }));
		expect(messages.filter((message) => message.error)).toEqual([]);
		expect(stdout()).toBe('workspace-value\n');

		for (const source of [
			String.raw`;"#{File.read(ARGV[0]).include?('File.read(ARGV[0])') ? 'source-visible' : 'missing'}"`,
			String.raw`;"#{begin File.write('helper.txt', 'bad'); 'WRITABLE'; rescue SystemCallError; 'readonly'; end}"`,
			String.raw`;"#{begin File.write(ARGV[0], 'bad'); 'WRITABLE'; rescue SystemCallError; 'readonly'; end}"`,
			String.raw`;"#{begin File.write('/__wasm_idle_golfscript__/golfscript.rb', 'bad'); 'WRITABLE'; rescue SystemCallError; 'readonly'; end}"`
		]) {
			messages.length = 0;
			await send(request(source, { activePath, workspaceFiles }));
			expect(messages.filter((message) => message.error)).toEqual([]);
			expect(stdout()).toBe(
				source.includes('source-visible') ? 'source-visible\n' : 'readonly\n'
			);
		}
	}, 30000);

	it('recovers from original syntax/runtime failures with fresh variables, stack and stdin', async () => {
		const send = await ready();
		for (const [source, args] of [
			[';"unterminated', []],
			[';1 0 /', []],
			[';42', ['-unknown']]
		] as Array<[string, string[]]>) {
			messages.length = 0;
			await send(request(source, { args }));
			expect(
				messages.some((message) => typeof message.error === 'string'),
				source
			).toBe(true);
			expect(messages.some((message) => message.results)).toBe(false);
			messages.length = 0;
			await send(request('~+', { stdin: '40 2\n' }));
			expect(messages.filter((message) => message.error)).toEqual([]);
			expect(stdout()).toBe('42\n');
		}
		messages.length = 0;
		await send(request(';9:custom;'));
		expect(stdout()).toBe('\n');
		messages.length = 0;
		await send(request(';custom'));
		expect(stdout()).toBe('\n');
		messages.length = 0;
		await send(request('#', { stdin: 'new input' }));
		expect(stdout()).toBe('new input\n');
	}, 30000);

	it('rejects caller files in the private runtime namespace without executing source', async () => {
		const send = await ready();
		messages.length = 0;
		await send(
			request('~+', {
				stdin: '20 22\n',
				workspaceFiles: [
					{ path: '__wasm_idle_golfscript__/golfscript.rb', content: 'puts :fake' }
				]
			})
		);
		expect(
			messages.some((message) => String(message.error).includes('private runtime mount'))
		).toBe(true);
		expect(stdout()).toBe('');
	}, 30000);

	it('reports genuine CLI exit and readonly-file failures without rewriting diagnostics', async () => {
		const send = await ready();
		messages.length = 0;
		await send(request(';42', { args: ['-x'] }));
		expect(stdout()).toContain('unknown options');
		expect(messages.some((message) => String(message.error).includes('SystemExit'))).toBe(true);
		messages.length = 0;
		await send(
			request(String.raw`;"#{File.write('helper.txt', 'bad')}"`, {
				workspaceFiles: [{ path: 'helper.txt', content: 'readonly' }]
			})
		);
		expect(
			messages.some((message) => String(message.error).includes('Read-only file system'))
		).toBe(true);
	}, 30000);

	it('prevents unlink/recreation and rename replacement through root and nested workspace directories', async () => {
		const activePath = 'examples/program.gs';
		const workspaceFiles = [
			{ path: 'data/value.txt', content: 'original' },
			{ path: 'data/other.txt', content: 'other' }
		];
		const send = await ready({ activePath, workspaceFiles, args: [] });
		for (const operation of [
			"File.unlink(ARGV[0]); File.write(ARGV[0], 'replacement')",
			"File.unlink('data/value.txt'); File.write('data/value.txt', 'replacement')",
			"Dir.chdir('data') { File.unlink('value.txt'); File.write('value.txt', 'replacement') }",
			"File.unlink('/__wasm_idle_golfscript__/golfscript.rb'); File.write('/__wasm_idle_golfscript__/golfscript.rb', 'replacement')",
			"File.rename('data/other.txt', 'data/value.txt')",
			"File.rename('data/other.txt', ARGV[0])",
			"File.rename('data/other.txt', '/__wasm_idle_golfscript__/golfscript.rb')",
			"File.write('data/new.txt', 'replacement')",
			"Dir.mkdir('data/new-directory')"
		]) {
			messages.length = 0;
			const source = `;"#{begin ${operation}; 'WRITABLE'; rescue SystemCallError => error; error.class.to_s; end}" "#{File.read('data/value.txt')}" "#{File.read('data/other.txt')}"`;
			await send(request(source, { activePath, workspaceFiles }));
			expect(
				messages.filter((message) => message.error),
				operation
			).toEqual([]);
			expect(stdout(), operation).toBe('Errno::EROFSoriginalother\n');
		}
	}, 30000);
});
