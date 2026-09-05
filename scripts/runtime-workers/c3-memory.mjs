const C3_WASM_PAGE_BYTES = 65536;

export async function c3Digest(bytes) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
		value.toString(16).padStart(2, '0')
	).join('');
}

// Only lower the limit of one defined, unshared wasm32 memory. Instructions and data stay intact.
export async function limitC3WasmMemory(bytes, maximumBytes) {
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length < 8 ||
		!Number.isSafeInteger(maximumBytes) ||
		maximumBytes < 0
	) {
		throw new Error('Invalid C3 Wasm memory limit request');
	}
	const header = [0, 97, 115, 109, 1, 0, 0, 0];
	if (!header.every((byte, index) => bytes[index] === byte))
		throw new Error('Invalid Wasm header');
	let offset = 8;
	const u32 = (end = bytes.length) => {
		let result = 0;
		for (let index = 0; index < 5; index++) {
			if (offset >= end) throw new Error('Truncated Wasm integer');
			const byte = bytes[offset++];
			if (index === 4 && byte > 15) throw new Error('Invalid Wasm u32');
			result += (byte & 127) * 2 ** (7 * index);
			if (!(byte & 128)) return result;
		}
		throw new Error('Invalid Wasm integer');
	};
	const encode = (value) => {
		const result = [];
		do {
			const low = value % 128;
			value = Math.floor(value / 128);
			result.push(low | (value ? 128 : 0));
		} while (value);
		return result;
	};
	let memory;
	while (offset < bytes.length) {
		const start = offset;
		const id = bytes[offset++];
		const size = u32();
		const end = offset + size;
		if (end > bytes.length) throw new Error('Truncated Wasm section');
		if (id === 5) {
			if (memory || u32(end) !== 1)
				throw new Error('C3 supports exactly one defined Wasm memory');
			const flags = u32(end);
			if (flags !== 0 && flags !== 1)
				throw new Error('Shared and memory64 C3 memories are unsupported');
			const minimum = u32(end);
			const originalMaximum = flags === 1 ? u32(end) : null;
			if (
				offset !== end ||
				minimum > 65536 ||
				(originalMaximum !== null && (originalMaximum < minimum || originalMaximum > 65536))
			) {
				throw new Error('Invalid Wasm memory section');
			}
			const maximum = Math.min(
				Math.floor(maximumBytes / C3_WASM_PAGE_BYTES),
				originalMaximum ?? 65536
			);
			if (minimum > maximum) {
				const error = new Error(
					'C3 Wasm initial memory exceeds the configured memory limit'
				);
				Object.assign(error, {
					code: 'resource-limit',
					resource: 'wasm-memory',
					actual: minimum * C3_WASM_PAGE_BYTES,
					limit: maximumBytes
				});
				throw error;
			}
			memory = { start, end, minimum, maximum, originalMaximum };
		}
		offset = end;
	}
	if (!memory) throw new Error('C3 requires one defined Wasm memory');
	const module = await WebAssembly.compile(bytes);
	if (WebAssembly.Module.imports(module).some((item) => item.kind === 'memory')) {
		throw new Error('Imported C3 Wasm memories are unsupported');
	}
	const payload = [1, 1, ...encode(memory.minimum), ...encode(memory.maximum)];
	const section = Uint8Array.from([5, ...encode(payload.length), ...payload]);
	const limited = new Uint8Array(bytes.length - (memory.end - memory.start) + section.length);
	limited.set(bytes.subarray(0, memory.start));
	limited.set(section, memory.start);
	limited.set(bytes.subarray(memory.end), memory.start + section.length);
	await WebAssembly.compile(limited);
	return {
		bytes: limited,
		evidence: {
			originalSha256: await c3Digest(bytes),
			limitedSha256: await c3Digest(limited),
			initialBytes: memory.minimum * C3_WASM_PAGE_BYTES,
			maximumBytes: memory.maximum * C3_WASM_PAGE_BYTES,
			originalMaximumBytes:
				memory.originalMaximum === null ? null : memory.originalMaximum * C3_WASM_PAGE_BYTES
		}
	};
}
