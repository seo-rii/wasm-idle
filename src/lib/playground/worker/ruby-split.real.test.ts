// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preflightRubySplitRuntimeAssets } from '@wasm-idle/core';
const assetsRoot = new URL('../../../../static/wasm-ruby/split/', import.meta.url);
const messages = vi.hoisted(() => [] as any[]);
vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: async (url: string) => {
		// Node cannot import blob: modules; only the test transport is replaced.
		const source = await (await fetch(url)).text();
		return await import(
			/* @vite-ignore */ 'data:text/javascript;base64,' +
				Buffer.from(source).toString('base64')
		);
	}
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	messages.length = 0;
});
describe('real Ruby split runtime worker', () => {
	it('runs the complete stdlib with stdin/workspace/args and isolates subsequent runs', async () => {
		vi.resetModules();
		messages.length = 0;
		const payload = await preflightRubySplitRuntimeAssets({
			baseUrl: 'https://runtime.test/ruby/',
			fetch: async (input) =>
				new Response(
					Uint8Array.from(
						await readFile(
							new URL(new URL(String(input)).pathname.split('/').at(-1)!, assetsRoot)
						)
					)
				)
		});
		vi.stubGlobal('self', {});
		vi.stubGlobal('postMessage', (m: any) => messages.push(m));
		await import('./ruby');
		const send = (data: any) => (globalThis as any).self.onmessage({ data });
		await send({ load: true, runtimePreflight: payload, maxAssetBytes: 40 * 1024 * 1024 });
		expect(messages.some((x) => x.load === true)).toBe(true);
		expect(messages.filter((x) => x.error)).toEqual([]);
		const options = {
			prepare: false,
			buffer: new SharedArrayBuffer(4096),
			args: ['argument'],
			stdin: 'input-line\n',
			workspaceFiles: [{ path: 'data.txt', content: 'workspace' }]
		};
		const code = `require 'json'
require 'set'
require 'date'
require 'zlib'
require 'stringio'
require 'logger'
require 'test/unit'
STDOUT.sync = true
raise 'json' unless JSON.parse(JSON.generate({'a'=>1}))['a'] == 1
raise 'set' unless Set[1,1,2].size == 2
raise 'date' unless Date.new(2026,9,27).to_s == '2026-09-27'
raise 'zlib' unless Zlib.inflate(Zlib.deflate('abc')) == 'abc'
raise 'io' unless StringIO.new('text').read == 'text'
raise 'input' unless STDIN.gets.strip == 'input-line'
raise 'args' unless ARGV[0] == 'argument'
raise 'workspace' unless File.read('/data.txt') == 'workspace'
begin
  File.delete('/usr/local/lib/ruby/3.4.0/json.rb')
  raise 'stdlib delete was writable'
rescue SystemCallError
end
begin
  File.write('/usr/local/lib/ruby/3.4.0/wasm_idle_probe', 'x')
  raise 'stdlib create was writable'
rescue SystemCallError
end
raise 'stdlib delete changed the tree' unless File.file?('/usr/local/lib/ruby/3.4.0/json.rb')
raise 'stdlib create changed the tree' if File.exist?('/usr/local/lib/ruby/3.4.0/wasm_idle_probe')
File.write('/private.txt', 'must-not-leak')
puts 'ruby-split-ok'
`;
		messages.length = 0;
		await send({ ...options, code });
		expect(messages.filter((x) => x.error)).toEqual([]);
		expect(
			messages
				.filter((x) => x.output)
				.map((x) => x.output)
				.join('')
		).toBe('ruby-split-ok\n');
		expect(messages.at(-1)).toEqual({ results: true });
		messages.length = 0;
		await send({
			...options,
			stdin: '',
			code: "STDOUT.sync=true; require 'json'; raise 'leaked file' if File.exist?('/private.txt'); puts JSON.generate([1,2])"
		});
		expect(messages.filter((x) => x.error)).toEqual([]);
		expect(
			messages
				.filter((x) => x.output)
				.map((x) => x.output)
				.join('')
		).toBe('[1,2]\n');
	}, 30000);
});
