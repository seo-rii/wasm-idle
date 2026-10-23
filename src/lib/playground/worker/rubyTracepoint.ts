import type { DebugSourceBreakpoints } from '../options';
import { RUBY_DEBUG_PREVIEW } from './rubyDebugPreview';

export interface RubyTracepointOptions {
	path: string;
	debugPath?: string;
	breakpoints: number[];
	sourceBreakpoints?: DebugSourceBreakpoints[];
	pauseOnEntry: boolean;
	files: Array<{ path: string; content: string }>;
}

/** Real CRuby TracePoint and Binding APIs; user source is passed unchanged as eval data. */
export async function executeRubyTracepoint(
	vm: { eval(source: string): unknown },
	source: string,
	options: RubyTracepointOptions,
	notify: (message: any) => void,
	read: (blocking: boolean) => string | null
) {
	const files = [...options.files, { path: options.path, content: source }];
	const hashes: Record<string, string> = {};
	for (const file of files) {
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(file.content)
		);
		hashes[file.path] = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	}
	const key = `__wasmIdleRubyDebug_${crypto.randomUUID().replaceAll('-', '')}`;
	const globals = globalThis as unknown as Record<string, unknown>;
	globals[key] = {
		notify: (json: string) => {
			if (json.length > 2_000_000)
				throw new Error('Ruby debugger snapshot exceeds its limit');
			notify(JSON.parse(json));
		},
		read: (blocking: boolean) => read(blocking) ?? '{"op":"stop"}'
	};
	const data = JSON.stringify({ ...options, source, files, hashes, key });
	const literal = `'${data.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	try {
		vm.eval(String.raw`
require 'json'
require 'js'
Class.new do
def self.run(settings)
bridge = JS.global[settings['key']]
send_event = ->(value) { bridge.call(:notify, JSON.generate(value)) }
read_command = ->(blocking) do
  text = bridge.call(:read, blocking).to_s
  text.empty? ? nil : JSON.parse(text)
end
display_path = ->(path) do
  path = path == settings['path'] ? (settings['debugPath'] || path) : path
  '/workspace/' + path.sub(%r{\A(?:/workspace/|/+)}, '')
end
known = settings['files'].to_h { |file| [file['path'], file['content']] }
breakpoints = {}
executable = {}
known.each do |path, content|
  next unless path == settings['path'] || path.end_with?('.rb')
  begin
    lines = []
    collect = ->(iseq) do
      lines.concat(iseq.trace_points.select { |_, event| event == :line }.map(&:first))
      iseq.each_child { |child| collect.call(child) }
    end
    collect.call(RubyVM::InstructionSequence.compile(content, path, path, 1))
    executable[display_path.call(path)] = lines.uniq.sort
  rescue NameError, NoMethodError, SyntaxError
    executable[display_path.call(path)] = []
  end
end
set_breakpoints = ->(path, lines) do
  path = display_path.call(path)
  available = executable[path] || []
  resolved = lines.uniq.map do |line|
    actual = available.find { |candidate| candidate >= line }
    {requestedLine:line, line:actual || line, verified:!actual.nil?, message:actual ? nil : 'No executable Ruby line'}
  end
  breakpoints[path] = resolved.select { |item| item[:verified] }.map { |item| item[:line] }
  send_event.call({event:{type:'breakpoints',sourcePath:path,breakpoints:resolved}})
end
set_breakpoints.call(display_path.call(settings['path']), settings['breakpoints'])
(settings['sourceBreakpoints'] || []).each { |item| set_breakpoints.call(item['sourcePath'], item['lines']) }
format_value = ->(value) do
  begin
    value.inspect.encode('UTF-8', invalid: :replace, undef: :replace)[0,512]
  rescue Exception => error
    '<' + error.class.to_s + ' while inspecting>'
  end
end
${RUBY_DEBUG_PREVIEW}
local_values = ->(binding) do
  binding.local_variables.first(50).map do |name|
    value = binding.local_variable_get(name)
    {name:name.to_s,value:preview_value.call(value),type:preview_type.call(value),variablesReference:0}
  end
end
frames = []
mode = settings['pauseOnEntry'] ? 'entry' : 'continue'
target_depth = 0
pause_requested = false
stop_number = 0
trace = TracePoint.new(:line, :call, :return, :b_call, :b_return, :class, :end) do |point|
  path = point.path.sub(%r{\A/+}, '')
  next unless known.key?(path)
  case point.event
  when :return, :b_return, :end
    frames.pop unless frames.empty?
    next
  when :call, :b_call, :class
    frames << {binding:point.binding,path:path,line:point.lineno,name:point.method_id.to_s.empty? ? '<block>' : point.method_id.to_s}
    next
  end
  frames << {binding:point.binding,path:path,line:point.lineno,name:'<main>'} if frames.empty?
  frame = frames.last
  frame[:binding] = point.binding
  frame[:path] = path
  frame[:line] = point.lineno
  while (command = read_command.call(false))
    case command['op']
    when 'stop' then raise Interrupt, 'Ruby debugger stopped'
    when 'pause' then pause_requested = true
    when 'breakpoints' then set_breakpoints.call(command['sourcePath'], command['lines'])
    end
  end
  breakpoint = (breakpoints[display_path.call(path)] || []).include?(point.lineno)
  stepping = mode == 'entry' || mode == 'stepInto' || (mode == 'nextLine' && frames.length <= target_depth) || (mode == 'stepOut' && frames.length < target_depth)
  next unless pause_requested || breakpoint || stepping
  reason = pause_requested ? 'pause' : breakpoint ? 'breakpoint' : mode == 'entry' ? 'entry' : mode == 'stepInto' ? 'step' : mode
  pause_requested = false
  stop_number += 1
  bindings = {}
  snapshots = frames.reverse.first(32).each_with_index.map do |item, index|
    id = stop_number * 1000 + index + 1
    bindings[id] = item[:binding]
    {id:id,functionName:item[:name],line:item[:line],sourcePath:display_path.call(item[:path]),sourceContentSha256:settings['hashes'][item[:path]],locals:local_values.call(item[:binding])}
  end
  top = snapshots.first
  send_event.call({frames:snapshots,event:{type:'pause',reason:reason,line:top[:line],sourcePath:top[:sourcePath],sourceContentSha256:top[:sourceContentSha256],frameId:top[:id],threadId:1,locals:top[:locals],callStack:snapshots.map { |item| item.reject { |key,_| key == :locals } },scopes:[{name:'Locals',variablesReference:top[:id],namedVariables:top[:locals].length,expensive:false,variables:top[:locals]}],capabilities:{readMemory:false,writeMemory:false,dataBreakpoints:false}}})
  loop do
    command = read_command.call(true)
    next unless command
    case command['op']
    when 'stop' then raise Interrupt, 'Ruby debugger stopped'
    when 'breakpoints' then set_breakpoints.call(command['sourcePath'], command['lines'])
    when 'evaluate'
      begin
        binding = bindings.fetch(command['frameId'])
        value = format_value.call(binding.eval(command['expression']))
        send_event.call({response:{id:command['id'],value:value}})
      rescue Exception => error
        send_event.call({response:{id:command['id'],error:error.class.to_s + ': ' + error.message}})
      end
    when 'control'
      mode = command['command']
      target_depth = frames.length
      send_event.call({event:{type:'resume',command:mode}})
      break
    end
  end
end
begin
  trace.enable
  eval(settings['source'], TOPLEVEL_BINDING, settings['path'], 1)
ensure
  trace.disable
  STDOUT.flush
  STDERR.flush
end
end
end.run(JSON.parse(${literal}))
`);
	} finally {
		delete globals[key];
	}
}
