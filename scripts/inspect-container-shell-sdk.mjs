// Compile for static inspection only: no guest instance or host import is created.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [rawPath, boundPath, outputPath] = process.argv.slice(2);
assert(rawPath && boundPath && outputPath, 'Required raw Wasm, bindgen Wasm and output paths');

function inspect(path) {
	const bytes = readFileSync(path);
	assert(bytes.length <= 256 * 1024 * 1024, 'Wasm inspection size bound');
	assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
	const module = new WebAssembly.Module(bytes);
	let offset = 8;
	const memories = [];
	function byte() {
		assert(offset < bytes.length, 'Truncated Wasm');
		return bytes[offset++];
	}
	function u32() {
		let value = 0;
		for (let index = 0; index < 5; index++) {
			const current = byte();
			assert(index !== 4 || (current & 0xf0) === 0, 'u32 LEB overflow');
			value += (current & 0x7f) * 2 ** (index * 7);
			if ((current & 0x80) === 0) return value;
		}
		throw new Error('u32 LEB overflow');
	}
	function skipName() {
		const size = u32();
		assert(offset + size <= bytes.length, 'Name bounds');
		offset += size;
	}
	function limits(memory) {
		const flags = u32();
		assert((flags & ~3) === 0, 'Only the pinned wasm32 limits profile is supported');
		const minimumPages = u32();
		const maximumPages = flags & 1 ? u32() : null;
		if (memory) memories.push({ shared: Boolean(flags & 2), minimumPages, maximumPages });
	}
	while (offset < bytes.length) {
		const id = byte();
		const size = u32();
		const end = offset + size;
		assert(end <= bytes.length, 'Section bounds');
		if (id === 2) {
			const count = u32();
			for (let index = 0; index < count; index++) {
				skipName();
				skipName();
				const kind = byte();
				if (kind === 0) u32();
				else if (kind === 1) {
					byte();
					limits(false);
				} else if (kind === 2) limits(true);
				else if (kind === 3) {
					byte();
					byte();
				} else if (kind === 4) {
					byte();
					u32();
				} else throw new Error('Unsupported import kind');
			}
		} else if (id === 5) {
			const count = u32();
			for (let index = 0; index < count; index++) limits(true);
		}
		assert(offset <= end, 'Decoded section bounds');
		offset = end;
	}
	assert.equal(memories.length, 1, 'Pinned SDK has one linear memory');
	assert(
		memories[0].shared && memories[0].maximumPages !== null,
		'Shared memory with a maximum is required'
	);
	return {
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		imports: WebAssembly.Module.imports(module),
		exports: WebAssembly.Module.exports(module),
		memories
	};
}

writeFileSync(
	outputPath,
	JSON.stringify(
		{
			schemaVersion: 1,
			qualification:
				'Static WebAssembly compile/import/export/memory inspection; no guest or shell execution',
			raw: inspect(rawPath),
			bindgen: inspect(boundPath)
		},
		null,
		2
	) + '\n',
	{ flag: 'wx', mode: 0o600 }
);
