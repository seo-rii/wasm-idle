/** Bound the original module's sole memory before instantiation; language code stays unchanged. */
export function capVerilogWasmMemory(bytes, maxBytes) {
	const u32 = (offset) => {
		let value = 0;
		let shift = 0;
		for (let count = 0; count < 5; count++) {
			const byte = bytes[offset++];
			if (byte === undefined) throw new Error('Truncated Verilog Wasm section');
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return [value, offset];
			shift += 7;
		}
		throw new Error('Invalid Verilog Wasm integer');
	};
	const encode = (value) => {
		const result = [];
		do {
			const byte = value % 128;
			value = Math.floor(value / 128);
			result.push(byte | (value ? 128 : 0));
		} while (value);
		return result;
	};
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 97 ||
		bytes[2] !== 115 ||
		bytes[3] !== 109
	)
		throw new Error('Invalid Verilog Wasm module');
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
		throw new Error('Invalid Verilog memory limit');
	for (let offset = 8; offset < bytes.length;) {
		const start = offset;
		const id = bytes[offset++];
		let length;
		[length, offset] = u32(offset);
		const end = offset + length;
		if (end > bytes.length) throw new Error('Truncated Verilog Wasm section');
		if (id !== 5) {
			offset = end;
			continue;
		}
		let count, flags, minimum, maximum;
		[count, offset] = u32(offset);
		[flags, offset] = u32(offset);
		[minimum, offset] = u32(offset);
		if (count !== 1 || flags > 1) throw new Error('Unsupported Verilog Wasm memory');
		if (flags === 1) [maximum, offset] = u32(offset);
		if (offset !== end) throw new Error('Invalid Verilog Wasm memory section');
		const pages = Math.min(Math.floor(maxBytes / 65536), maximum ?? 65536);
		if (pages < minimum)
			throw Object.assign(new Error('Verilog memory limit is below the stage minimum'), {
				code: 'resource-limit',
				resource: 'wasm-memory',
				actual: minimum * 65536,
				limit: maxBytes
			});
		const payload = [1, 1, ...encode(minimum), ...encode(pages)];
		const section = [5, ...encode(payload.length), ...payload];
		const result = new Uint8Array(start + section.length + bytes.length - end);
		result.set(bytes.subarray(0, start));
		result.set(section, start);
		result.set(bytes.subarray(end), start + section.length);
		return result;
	}
	throw new Error('Verilog Wasm memory is missing');
}

export function createVerilogStdin(source, channel, notify) {
	if (!channel) {
		const bytes = new TextEncoder().encode(source || '');
		let offset = 0;
		return () => (offset < bytes.length ? bytes[offset++] : null);
	}
	if (
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 2 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity <= 0 ||
		channel.capacity > 2 ** 31 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid Verilog stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const range = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	return () => {
		for (;;) {
			if (Atomics.load(control, 3)) throw new Error('Verilog stdin cancelled');
			const write = Atomics.load(control, 0) >>> 0;
			const read = Atomics.load(control, 1) >>> 0;
			const available = (write - read + range) % range;
			if (write >= range || read >= range || available > bytes.length)
				throw new Error('Invalid Verilog stdin counters');
			if (available) {
				const byte = bytes[read % bytes.length];
				Atomics.store(control, 1, (read + 1) % range);
				if (available === 1 || (read + 1) % 4096 === 0) notify();
				return byte;
			}
			if (Atomics.load(control, 2)) return null;
			notify();
			Atomics.wait(control, 0, write, 100);
		}
	};
}

export function verilogWorkspacePath(name) {
	if (
		typeof name !== 'string' ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid Verilog workspace path');
	return '/work/' + name;
}

/** MEMFS stores file contents in JavaScript memory; bound file growth separately from Wasm. */
export function guardVerilogFilesystem(fs, maxBytes) {
	let violation;
	const usage = (directory = '/') => {
		let total = 0;
		for (const name of fs.readdir(directory)) {
			if (name === '.' || name === '..') continue;
			const file = directory.replace(/\/$/u, '') + '/' + name;
			if (file === '/dev' || file === '/proc') continue;
			const stat = fs.lstat(file);
			if (fs.isDir(stat.mode)) total += usage(file);
			else if (fs.isFile(stat.mode)) total += stat.size;
		}
		return total;
	};
	const check = (actual) => {
		if (actual > maxBytes)
			throw (violation = Object.assign(
				new Error('Verilog filesystem exceeds workspace limit'),
				{
					code: 'resource-limit',
					resource: 'workspace-bytes',
					actual,
					limit: maxBytes
				}
			));
	};
	check(usage());
	const write = fs.write.bind(fs);
	fs.write = (stream, buffer, offset, length, position, ...rest) => {
		if (fs.isFile(stream.node.mode)) {
			const size = fs.stat(stream.path).size;
			const end = (position ?? stream.position) + length;
			check(usage() + Math.max(0, end - size));
		}
		return write(stream, buffer, offset, length, position, ...rest);
	};
	return () => {
		if (violation) throw violation;
	};
}
