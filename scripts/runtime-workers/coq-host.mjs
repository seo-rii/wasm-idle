/** Host I/O for the unchanged jsCoq kernel; this module never parses Coq source. */
export function coqWorkspacePath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		/[\\\0]/u.test(value) ||
		value.startsWith('/') ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid Coq workspace path');
	// Coq's native Load appends .v to other suffixes. Keep the UI's .coq association
	// without taking .v away from V, and let the original parser read the alias.
	return '/lib/work/' + value + (value.toLowerCase().endsWith('.coq') ? '.v' : '');
}

/** Render the kernel's Pp tree, following upstream FormatPrettyPrint.pp2Text. */
export function coqPpText(message, state = { vertical: false }) {
	if (!Array.isArray(message)) return typeof message === 'string' ? message : '';
	switch (message[0]) {
		case 'Pp_empty':
			return '';
		case 'Pp_string':
			return message[1];
		case 'Pp_glue':
			return message[1].map((part) => coqPpText(part, state)).join('');
		case 'Pp_box':
			return coqPpText(message[2], { vertical: message[1][0] === 'Pp_vbox' });
		case 'Pp_tag':
			return coqPpText(message[2], state);
		case 'Pp_force_newline':
			return '\n';
		case 'Pp_print_break':
			return state.vertical ? '\n' : ' '.repeat(Math.max(0, message[1]));
		case 'Pp_comment':
			return message[1].join('\n');
		default:
			throw new Error('Unknown Coq pretty-print protocol element');
	}
}

/** Read bytes unchanged until EOF: only the real Coq Load command parses the input. */
export function readCoqCommandInput(channel, maxBytes, notify) {
	if (
		!channel ||
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 2 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity < 1 ||
		channel.capacity > 2 ** 31 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid Coq stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const range = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const chunks = [];
	let length = 0;
	for (;;) {
		if (Atomics.load(control, 3)) throw new Error('Coq stdin cancelled');
		const write = Atomics.load(control, 0) >>> 0;
		const read = Atomics.load(control, 1) >>> 0;
		const available = (write - read + range) % range;
		if (write >= range || read >= range || available > bytes.length)
			throw new Error('Invalid Coq stdin counters');
		if (available) {
			const count = Math.min(available, bytes.length - (read % bytes.length));
			if (length + count > maxBytes)
				throw Object.assign(new Error('Coq stdin exceeds the remaining workspace limit'), {
					code: 'resource-limit',
					actual: length + count,
					limit: maxBytes
				});
			chunks.push(bytes.slice(read % bytes.length, (read % bytes.length) + count));
			length += count;
			Atomics.store(control, 1, (read + count) % range);
			notify();
			continue;
		}
		if (Atomics.load(control, 2)) break;
		notify();
		Atomics.wait(control, 0, write, 100);
	}
	const input = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		input.set(chunk, offset);
		offset += chunk.length;
	}
	return input;
}

/** Bound virtual-file growth independently of the JavaScript heap and trusted stdlib. */
export function guardCoqFilesystem(runtime, maxBytes) {
	const files = () =>
		runtime.jsoo_mount_point.flatMap(({ device }) =>
			Object.values(device.content).filter((file) => file instanceof runtime.MlFakeFile)
		);
	const readOnly = new Set(files());
	const usage = () =>
		files().reduce((total, file) => total + (readOnly.has(file) ? 0 : file.length()), 0);
	let violation;
	const check = (actual = usage()) => {
		if (actual > maxBytes)
			violation ||= Object.assign(new Error('Coq virtual files exceed the workspace limit'), {
				code: 'resource-limit',
				actual,
				limit: maxBytes
			});
		if (violation) throw violation;
	};
	const failIO = (message) => {
		// This js_of_ocaml host primitive accepts a JavaScript byte string.
		if (runtime.caml_raise_sys_error) runtime.caml_raise_sys_error(message);
		throw new Error(message);
	};
	const boundedWrite = (actual) => {
		try {
			check(actual);
		} catch (error) {
			failIO(error.message);
		}
	};
	const filePrototype = runtime.MlFakeFile.prototype;
	const write = filePrototype.write,
		truncate = filePrototype.truncate;
	filePrototype.write = function (offset, source, sourceOffset, length) {
		if (readOnly.has(this)) failIO('Coq bundled libraries are read-only');
		boundedWrite(usage() + Math.max(0, offset + length - this.length()));
		return write.call(this, offset, source, sourceOffset, length);
	};
	filePrototype.truncate = function (size = 0) {
		if (readOnly.has(this)) failIO('Coq bundled libraries are read-only');
		boundedWrite(usage() + Math.max(0, size - this.length()));
		return truncate.call(this, size);
	};
	const open = runtime.MlFakeDevice.prototype.open;
	runtime.MlFakeDevice.prototype.open = function (name, flags) {
		const file = open.call(this, name, flags);
		if (name.endsWith('.cma.js') && !readOnly.has(file))
			failIO('Only verified bundled Coq tactic plugins can be loaded');
		return file;
	};
	return { check, usage };
}
