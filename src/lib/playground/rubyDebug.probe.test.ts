// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { executeRubyTracepoint } from './worker/rubyTracepoint';
import { RUBY_DEBUG_PREVIEW } from './worker/rubyDebugPreview';
import {
	preflightRubySplitRuntimeAssets,
	rewriteRubySplitRuntimeModule,
	parseRubyStdlibPack,
	createRubyStdlibPreopens
} from '@wasm-idle/core';

it('probes real Ruby rdbg prerequisites and TracePoint bindings in the pinned WASI bundle', async () => {
	const assetsRoot = new URL('../../../static/wasm-ruby/split/', import.meta.url);
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
	const runtime = await import(
		/* @vite-ignore */ 'data:text/javascript;base64,' +
			Buffer.from(rewriteRubySplitRuntimeModule(payload)).toString('base64')
	);
	const { WASI, File, OpenFile } = runtime.wasiShim;
	const preopens = createRubyStdlibPreopens(
		parseRubyStdlibPack(payload.stdlibBytes),
		runtime.wasiShim,
		new Map()
	);
	let output = '';
	const printer = runtime.consolePrinter({
		stdout: (chunk: string) => {
			output += chunk;
		},
		stderr: (chunk: string) => {
			output += chunk;
		}
	});
	const { vm } = await runtime.RubyVM.instantiateModule({
		module: await WebAssembly.compile(payload.wasmBytes as BufferSource),
		wasip1: new WASI(
			['ruby.wasm'],
			[],
			[
				new OpenFile(new File(new TextEncoder().encode('7\n'))),
				new OpenFile(new File([])),
				new OpenFile(new File([])),
				...preopens
			],
			{ debug: false }
		),
		args: ['ruby.wasm', '-EUTF-8', '-e_=0'],
		addToImports: (imports: WebAssembly.Imports) => printer.addToImports(imports),
		setMemory: (memory: WebAssembly.Memory) => printer.setMemory(memory)
	});
	vm.eval(`require 'json'
STDOUT.sync = true
result = {}
begin
  require 'debug'
  result[:rdbg] = 'available'
rescue LoadError, StandardError, NotImplementedError => error
  result[:rdbg] = error.class.to_s + ': ' + error.message
end
begin
  Thread.new {}.join
  result[:thread] = 'available'
rescue StandardError, NotImplementedError => error
  result[:thread] = error.class.to_s + ': ' + error.message
end
result[:trace] = []
trace = TracePoint.new(:line) do |event|
  if event.path == 'native-probe.rb'
    value = event.binding.local_variable_defined?(:value) ? event.binding.local_variable_get(:value) : nil
    result[:trace] << {line:event.lineno,value:value}
  end
end
trace.enable
begin
  eval("value = STDIN.gets.to_i\\nvalue += 2\\nputs value", TOPLEVEL_BINDING, 'native-probe.rb', 1)
ensure
  trace.disable
end
puts JSON.generate(result)
`);
	const lines = output.trim().split('\n');
	const result = JSON.parse(lines.at(-1)!);
	expect(lines[0]).toBe('9');
	expect(result.rdbg).toMatch(/LoadError.*debug/);
	expect(result.thread).toMatch(/(?:NotImplementedError|ThreadError)/);
	expect(result.trace).toEqual([
		{ line: 1, value: null },
		{ line: 2, value: 7 },
		{ line: 3, value: 9 }
	]);
	output = '';
	const pauses: any[] = [];
	const commands: string[] = [];
	let evaluation = '';
	await executeRubyTracepoint(
		vm,
		'def double(value)\n  result = value * 2\n  result + 1\nend\nvalue = 7\nanswer = double(value)\nputs answer',
		{
			path: 'main.rb',
			breakpoints: [6],
			pauseOnEntry: false,
			files: []
		},
		(message) => {
			if (message.response) evaluation = message.response.value;
			if (message.event?.type !== 'pause') return;
			pauses.push(message.event);
			if (pauses.length === 1)
				commands.push(
					JSON.stringify({
						op: 'evaluate',
						id: 1,
						frameId: message.event.frameId,
						expression: 'value + 4'
					})
				);
			commands.push(
				JSON.stringify({
					op: 'control',
					command:
						pauses.length === 1
							? 'stepInto'
							: pauses.length === 2
								? 'stepOut'
								: 'continue'
				})
			);
		},
		(blocking) => commands.shift() ?? (blocking ? null : '')
	);
	expect(pauses.map((pause) => pause.line)).toEqual([6, 2, 7]);
	expect(pauses.map((pause) => pause.sourcePath)).toEqual([
		'/workspace/main.rb',
		'/workspace/main.rb',
		'/workspace/main.rb'
	]);
	expect(pauses[1].callStack.map((frame: any) => frame.functionName)).toEqual([
		'double',
		'<main>'
	]);
	expect(pauses[1].locals).toEqual(
		expect.arrayContaining([expect.objectContaining({ name: 'value', value: '7' })])
	);
	expect(pauses[0].locals.some((variable: any) => variable.name === 'bridge')).toBe(false);
	expect(evaluation).toBe('11');
	expect(output).toBe('15\n');
	output = '';
	const nestedPauses: any[] = [];
	const breakpointEvents: any[] = [];
	const helper = 'def triple(value)\n  adjusted = value * 3\n  adjusted + 1\nend';
	await executeRubyTracepoint(
		vm,
		`eval(${JSON.stringify(helper)}, TOPLEVEL_BINDING, 'lib/helper.rb', 1)\nvalue = 7\nanswer = triple(value)\nputs answer`,
		{
			path: 'src/main.rb',
			debugPath: '/workspace/src/main.rb',
			breakpoints: [3],
			pauseOnEntry: false,
			files: [{ path: 'lib/helper.rb', content: helper }]
		},
		(message) => {
			if (message.event?.type === 'breakpoints') breakpointEvents.push(message.event);
			if (message.event?.type !== 'pause') return;
			nestedPauses.push(message.event);
			if (nestedPauses.length === 1)
				commands.push(
					JSON.stringify({
						op: 'breakpoints',
						sourcePath: '/workspace/lib/helper.rb',
						lines: [3]
					})
				);
			commands.push(JSON.stringify({ op: 'control', command: 'continue' }));
		},
		(blocking) => commands.shift() ?? (blocking ? null : '')
	);
	expect(nestedPauses.map((pause) => [pause.sourcePath, pause.line])).toEqual([
		['/workspace/src/main.rb', 3],
		['/workspace/lib/helper.rb', 3]
	]);
	expect(nestedPauses[1].callStack.map((frame: any) => frame.sourcePath)).toEqual([
		'/workspace/lib/helper.rb',
		'/workspace/src/main.rb'
	]);
	expect(nestedPauses[1].locals).toEqual(
		expect.arrayContaining([expect.objectContaining({ name: 'adjusted', value: '21' })])
	);
	expect(breakpointEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				sourcePath: '/workspace/lib/helper.rb',
				breakpoints: [
					expect.objectContaining({ requestedLine: 3, line: 3, verified: true })
				]
			})
		])
	);
	expect(output).toBe('22\n');
	output = '';
	const safePreviewSource = `
$preview_calls = 0
class DebugPreviewProbe
  def inspect
    $preview_calls += 1
    'explicit inspection'
  end
  def class
    raise 'automatic class override called'
  end
end
value = DebugPreviewProbe.new
puts $preview_calls
`;
	const safePreviewEvents: any[] = [];
	const safePreviewResponses = new Map<number, string>();
	await executeRubyTracepoint(
		vm,
		safePreviewSource,
		{
			path: 'preview.rb',
			breakpoints: [safePreviewSource.split('\n').indexOf('puts $preview_calls') + 1],
			pauseOnEntry: false,
			files: []
		},
		(message) => {
			if (message.response)
				safePreviewResponses.set(message.response.id, message.response.value);
			if (message.event?.type !== 'pause') return;
			safePreviewEvents.push(message.event);
			for (const [id, expression] of [
				[201, '$preview_calls'],
				[202, 'value.inspect']
			])
				commands.push(
					JSON.stringify({
						op: 'evaluate',
						id,
						expression,
						frameId: message.event.frameId
					})
				);
			commands.push(JSON.stringify({ op: 'control', command: 'continue' }));
		},
		(blocking) => commands.shift() ?? (blocking ? null : '')
	);
	expect(safePreviewEvents).toHaveLength(1);
	expect(safePreviewEvents[0].locals).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: 'value',
				value: '<DebugPreviewProbe object>',
				type: 'DebugPreviewProbe'
			})
		])
	);
	expect(safePreviewResponses.get(201)).toBe('0');
	expect(safePreviewResponses.get(202)).toBe('"explicit inspection"');
	expect(output).toBe('1\n');
	output = '';
	vm.eval(`${RUBY_DEBUG_PREVIEW}
values = [1 << 300, Array.new(8, 'a' * 200), {a: [1]}]
originals = {
  Integer => [:to_s, :bit_length, :+, :succ, :times, :>, :>=, :<=],
  Float => [:to_s], Symbol => [:name],
  String => [:to_s, :+, :<<, :length, :[], :byteslice, :bytesize, :encode, :inspect],
  Array => [:length, :[], :<<, :join, :min], Hash => [:length, :each_pair],
  Module => [:name], Kernel => [:class], BasicObject => [:equal?]
}.flat_map { |type, names| names.map { |name| [type, name, type.instance_method(name)] } }
calls = []
append = Array.instance_method(:<<)
previews = []
begin
  originals.each do |type, name, original|
    type.define_method(name) do |*args, **kwargs, &block|
      append.bind_call(calls, name)
      original.bind_call(self, *args, **kwargs, &block)
    end
  end
  values.each { |value| append.bind_call(previews, preview_value.call(value)) }
ensure
  originals.each { |type, name, original| type.define_method(name, original) }
end
puts JSON.generate({previews:previews,calls:calls})
`);
	const formattingPreview = JSON.parse(output.trim());
	expect(formattingPreview.calls).toEqual([]);
	expect(formattingPreview.previews[0]).toBe('<Integer: 301 bits>');
	expect(formattingPreview.previews[1]).toHaveLength(512);
	expect(formattingPreview.previews[1].endsWith('...')).toBe(true);
	expect(formattingPreview.previews[2]).toBe('{:"a"=>[...]}');
}, 30_000);
