// The Ruby WASI host evaluates code inside a reusable reactor. An individual
// script still owns its program name, exit status and shutdown callbacks.
export const RUBY_SCRIPT_PROCESS = String.raw`->(filename, &script) do
  $0 = filename
  callbacks = []
  register = proc do |&callback|
    raise ArgumentError, 'called without a block' unless callback
    callbacks << callback
    callback
  end
  Kernel.send(:define_method, :at_exit, &register)
  Kernel.send(:private, :at_exit)
  Kernel.define_singleton_method(:at_exit, &register)

  failure = nil
  begin
    script.call
  rescue Exception => error
    failure = error
  ensure
    while (callback = callbacks.pop)
      begin
        if failure
          # As at native process shutdown, the callback can inspect $!.
          begin
            raise failure
          rescue Exception
            callback.call
          end
        else
          callback.call
        end
      rescue Exception => error
        failure = error
      end
    end
    STDOUT.flush unless STDOUT.closed?
    STDERR.flush unless STDERR.closed?
  end
  raise failure if failure && !failure.is_a?(SystemExit)
  failure ? failure.status & 255 : 0
end`;

export function rubyStringLiteral(value: string) {
	return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export function rubyExitCode(value: unknown) {
	const code = Number(String(value));
	if (!Number.isInteger(code) || code < 0 || code > 255) {
		throw new Error('Ruby did not return a valid process exit status.');
	}
	return code;
}
