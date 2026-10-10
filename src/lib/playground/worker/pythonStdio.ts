interface StdioRuntime {
	setStdin(options: { read: (buffer: Uint8Array) => number; isatty: boolean } | { error: true }): void;
	setStdout(options: { write: (bytes: Uint8Array) => number }): void;
	setStderr(options: { write: (bytes: Uint8Array) => number }): void;
}

interface StdioOptions {
	initialInput?: string;
	readInput: () => string | null;
	emit: (output: string) => void;
	maxChars?: number;
	maxDelayMs?: number;
	now?: () => number;
}

/** Bound host-message size; also check elapsed time during synchronous Wasm execution. */
export function createPythonStdio(runtime: StdioRuntime, options: StdioOptions) {
	const maxChars = options.maxChars ?? 16384;
	const maxDelayMs = options.maxDelayMs ?? 16;
	if (!Number.isSafeInteger(maxChars) || maxChars < 2 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
		throw new RangeError('Invalid Python output batch limits');
	}
	const now = options.now ?? (() => performance.now());
	const decoders = [new TextDecoder('utf-8', { ignoreBOM: true }), new TextDecoder('utf-8', { ignoreBOM: true })];
	const encoder = new TextEncoder();
	const parts: string[] = [];
	let chars = 0;
	let hasEmitted = false;
	let lastFlush = now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	let batch = true;
	let initialInput = options.initialInput;
	const hasInitialInput = typeof initialInput === 'string';
	let inputEnded = false;
	let inputBytes = new Uint8Array(0);
	let inputOffset = 0;

	function flush() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		lastFlush = now();
		if (!chars) return;
		const output = parts.join('');
		parts.length = 0;
		chars = 0;
		hasEmitted = true;
		options.emit(output);
	}

	function append(text: string) {
		let offset = 0;
		while (offset < text.length) {
			let take = Math.min(maxChars - chars, text.length - offset);
			const last = text.charCodeAt(offset + take - 1);
			const next = text.charCodeAt(offset + take);
			if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) take--;
			if (!take) { flush(); continue; }
			parts.push(text.slice(offset, offset + take));
			chars += take;
			offset += take;
			if (chars === maxChars || parts.length >= 256) flush();
		}
		if (!chars) return;
		// A synchronous Wasm loop prevents timers from running after its first write.
		// Publish that first output immediately; retain batching for later writes.
		if (!hasEmitted || !batch || now() - lastFlush >= maxDelayMs) flush();
		else if (timer === undefined) timer = setTimeout(flush, maxDelayMs);
	}

	function write(stream: number, bytes: Uint8Array) {
		if (closed) return bytes.length;
		// Avoid decoding an unbounded single write into one temporary JS string.
		for (let offset = 0; offset < bytes.length; offset += 16384) {
			append(decoders[stream].decode(bytes.subarray(offset, offset + 16384), { stream: true }));
		}
		return bytes.length;
	}

	function readInput() {
		flush(); // The prompt must reach the host before a blocking stdin request.
		if (inputEnded) return null;
		let value: string | null;
		if (hasInitialInput) {
			value = initialInput ?? null;
			initialInput = undefined;
		} else value = options.readInput();
		if (value === null) inputEnded = true;
		return value;
	}

	runtime.setStdin({
		read: (buffer) => {
			if (!buffer.length) return 0;
			while (inputOffset === inputBytes.length) {
				const value = readInput();
				if (value === null) return 0;
				inputBytes = encoder.encode(value);
				inputOffset = 0;
			}
			// Return the available chunk as a short read. Pyodide's character-based
			// stdin adapter otherwise requests another line to fill the whole read,
			// blocking native input() even after an interactive newline arrives.
			const length = Math.min(buffer.length, inputBytes.length - inputOffset);
			buffer.set(inputBytes.subarray(inputOffset, inputOffset + length));
			inputOffset += length;
			return length;
		},
		isatty: false
	});
	runtime.setStdout({ write: (bytes) => write(0, bytes) });
	runtime.setStderr({ write: (bytes) => write(1, bytes) });

	return {
		flush,
		prompt(output = '') { append(output); return readInput(); },
		disableBatching() { batch = false; flush(); },
		close() {
			if (closed) return;
			try {
				append(decoders[0].decode());
				append(decoders[1].decode());
				flush();
			} finally {
				closed = true;
				if (timer !== undefined) clearTimeout(timer);
				timer = undefined;
				runtime.setStdin({ error: true });
				runtime.setStdout({ write: (bytes) => bytes.length });
				runtime.setStderr({ write: (bytes) => bytes.length });
			}
		}
	};
}

/** Keep native print/input and stream identity, while observing explicit flush boundaries. */
export const PYTHON_FLUSH_HOOK_FACTORY = String.raw`
def __wasm_idle_make_flush_installer():
    import builtins
    import sys
    original_input, original_print = builtins.input, builtins.print
    original_open = builtins.open
    stdin, stdout, stderr = sys.stdin, sys.stdout, sys.stderr
    output_configurations = [
        {name: getattr(stream, name) for name in
         ("encoding", "errors", "line_buffering", "write_through") if hasattr(stream, name)}
        for stream in (stdout, stderr)
    ]

    def recover_output(stream, descriptor, configuration):
        # Native stdio descriptors belong to the runtime. A closed Python wrapper
        # can be replaced without closing or replacing the underlying descriptor.
        if stream.closed:
            stream = original_open(descriptor, "w", buffering=1, closefd=False,
                                   encoding=configuration.get("encoding", "utf-8"),
                                   errors=configuration.get("errors", "strict"))
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            # Native runtime text streams start with the platform newline policy.
            reconfigure(newline=None, **configuration)
        return stream

    def install(drain):
        builtins.input, builtins.print = original_input, original_print
        # setStdin changes the device callback, but Python's buffered reader can
        # still contain bytes from the previous run. Give each run its own reader.
        run_stdin = original_open(0, "r", encoding=stdin.encoding, errors=stdin.errors, closefd=False)
        sys.stdin, sys.stdout, sys.stderr = run_stdin, stdout, stderr
        patches = []
        writing = [0]
        restored = [False]

        def patch(stream, name, replacement):
            namespace = vars(stream)
            patches.append((stream, name, name in namespace, namespace.get(name)))
            setattr(stream, name, replacement)

        def undo():
            nonlocal stdout, stderr
            for stream, name, existed, value in reversed(patches):
                if existed:
                    setattr(stream, name, value)
                else:
                    try:
                        delattr(stream, name)
                    except AttributeError:
                        pass
            try:
                run_stdin.close()
            finally:
                try:
                    previous_stdout, previous_stderr = stdout, stderr
                    stdout = recover_output(stdout, 1, output_configurations[0])
                    stderr = recover_output(stderr, 2, output_configurations[1])
                    if sys.__stdout__ is previous_stdout:
                        sys.__stdout__ = stdout
                    if sys.__stderr__ is previous_stderr:
                        sys.__stderr__ = stderr
                finally:
                    sys.stdin, sys.stdout, sys.stderr = stdin, stdout, stderr
                    builtins.input, builtins.print = original_input, original_print

        def guarded_write(original):
            def write(*args, **kwargs):
                writing[0] += 1
                try:
                    return original(*args, **kwargs)
                finally:
                    writing[0] -= 1
            return write

        def observed_flush(original):
            def flush():
                try:
                    return original()
                finally:
                    # TextIO's implicit line-buffer flush is not an explicit user flush.
                    if writing[0] == 0:
                        drain()
            return flush

        try:
            seen = set()
            for stream in (stdout, stderr):
                patch(stream, "write", guarded_write(stream.write))
                patch(stream, "writelines", guarded_write(stream.writelines))
                current = stream
                while current is not None and id(current) not in seen:
                    seen.add(id(current))
                    patch(current, "flush", observed_flush(current.flush))
                    current = getattr(current, "buffer", getattr(current, "raw", None))
        except BaseException:
            undo()
            raise

        def restore():
            if restored[0]:
                return
            restored[0] = True
            try:
                try:
                    if not stdout.closed:
                        stdout.flush()
                finally:
                    if not stderr.closed:
                        stderr.flush()
            finally:
                undo()
        return restore
    return install

__wasm_idle_flush_installer = __wasm_idle_make_flush_installer()
del __wasm_idle_make_flush_installer
__wasm_idle_flush_installer
`;
