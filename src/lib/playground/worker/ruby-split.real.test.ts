// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preflightRubySplitRuntimeAssets } from '@wasm-idle/core';
const assetsRoot = new URL('../../../../static/wasm-ruby/split/', import.meta.url);
const messages = vi.hoisted(() => [] as any[]);
const stats = vi.hoisted(() => ({ instances: 0, mounts: [] as string[][] }));
vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: async (url: string) => {
		// Node cannot import blob: modules; only the test transport is replaced.
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
					stats.mounts.push(
						args[0].wasip1.fds
							.slice(3)
							.map((fd: { prestat_name?: string }) => fd.prestat_name ?? '')
					);
					return runtime.RubyVM.instantiateModule(...args);
				}
			}
		};
	}
}));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	messages.length = 0;
	stats.instances = 0;
	stats.mounts.length = 0;
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
		const options = {
			prepare: false,
			buffer: new SharedArrayBuffer(4096),
			args: ['-r', 'must-not-be-loaded.rb'],
			stdin: 'input-line\n',
			activePath: 'main.rb',
			workspaceFiles: [
				{ path: 'data.txt', content: 'workspace' },
				{
					path: 'must-not-be-loaded.rb',
					content: 'raise "prewarm ran user source"'
				}
			]
		};
		await send({
			load: true,
			runtimePreflight: payload,
			maxAssetBytes: 40 * 1024 * 1024,
			startupContext: {
				args: options.args,
				activePath: options.activePath,
				workspaceFiles: options.workspaceFiles
			}
		});
		expect(messages.some((x) => x.load === true)).toBe(true);
		expect(messages.filter((x) => x.error || x.output || x.buffer)).toEqual([]);
		expect(stats.instances).toBe(1);
		expect(stats.mounts[0].filter((mount) => mount === '/')).toHaveLength(1);
		for (let i = 0; i < 2; i++) {
			await send({
				...options,
				prepare: true,
				code: 'raise "prepare ran user code"'
			});
			expect(messages.filter((x) => x.error || x.output || x.buffer)).toEqual([]);
			expect(stats.instances).toBe(1);
		}
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
raise 'args' unless ARGV == ['-r', 'must-not-be-loaded.rb']
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
		expect(stats.instances).toBe(1);
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
		expect(stats.instances).toBe(2);
	}, 30000);
});
