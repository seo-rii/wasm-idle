// This qualifies producer structure only; it does not execute or emulate Bash.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const LOCK_SHA256 = '44b9cb3b80911460f10ba439dfbbdfe1a050f349d908133b68e42ada061b1ce1';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function readProducerLock() {
	const bytes = await readFile(new URL('./inputs.lock.json', import.meta.url));
	assert.equal(sha256(bytes), LOCK_SHA256, 'producer input lock identity');
	return JSON.parse(bytes);
}

/** Inspect the new private ABI and keep the original pinned import allowlist. */
export function inspectBashShim(bytes, lock) {
	const module = new WebAssembly.Module(bytes); // Validate the entire executable first.
	const imports = WebAssembly.Module.imports(module);
	const exports = WebAssembly.Module.exports(module);
	const allowed = new Set(
		lock.baselineImportProfile.imports.map(({ module, name, kind }) =>
			JSON.stringify([module, name, kind])
		)
	);
	allowed.add(JSON.stringify(['wasm_idle_shell_v1', 'exec_v1', 'function']));
	for (const { module, name, kind } of imports) {
		assert(
			allowed.has(JSON.stringify([module, name, kind])),
			`unapproved import: ${module}.${name}`
		);
	}
	assert.equal(
		imports.filter((entry) => entry.module === 'wasm_idle_shell_v1').length,
		1,
		'real linked Bash must import exactly one framed exec_v1'
	);
	for (const name of [
		'_start',
		'asyncify_start_unwind',
		'asyncify_stop_unwind',
		'asyncify_start_rewind',
		'asyncify_stop_rewind',
		'asyncify_get_state'
	])
		assert(
			exports.some((entry) => entry.name === name && entry.kind === 'function'),
			`missing ${name}`
		);

	// The WebAssembly reflection API omits signatures and memory limits.
	// Parse only those validated wasm32 sections; never invoke guest functions.
	let offset = 8,
		end = bytes.length;
	const take = () => {
		assert(offset < end, 'truncated Wasm declaration');
		return bytes[offset++];
	};
	const u32 = () => {
		let value = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const byte = take();
			assert(shift < 28 || byte < 16, 'invalid Wasm u32');
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return value;
		}
		assert.fail('invalid Wasm u32');
	};
	const name = () => {
		const length = u32();
		assert(length <= end - offset, 'truncated Wasm name');
		const value = new TextDecoder('utf-8', { fatal: true }).decode(
			bytes.subarray(offset, offset + length)
		);
		offset += length;
		return value;
	};
	const limits = () => {
		const flags = u32();
		assert(flags <= 3, 'only wasm32 memory/table limits are supported');
		const initial = u32(),
			maximum = flags & 1 ? u32() : null;
		return { flags, initial, maximum };
	};
	const types = [],
		memories = [];
	let execType;
	while (offset < bytes.length) {
		end = bytes.length;
		const id = take(),
			length = u32();
		end = offset + length;
		assert(end <= bytes.length, 'truncated Wasm section');
		if (id === 1) {
			for (let count = u32(); count; count--) {
				assert.equal(take(), 0x60, 'only function types are supported');
				const params = Array.from({ length: u32() }, take);
				const results = Array.from({ length: u32() }, take);
				types.push({ params, results });
			}
		} else if (id === 2) {
			for (let count = u32(); count; count--) {
				const namespace = name(),
					field = name(),
					kind = take();
				if (kind === 0) {
					const index = u32();
					if (namespace === 'wasm_idle_shell_v1' && field === 'exec_v1') execType = index;
				} else if (kind === 1) {
					take();
					limits();
				} else if (kind === 2)
					memories.push({ module: namespace, name: field, ...limits() });
				else if (kind === 3) {
					take();
					take();
				} else assert.fail('unsupported import kind');
			}
		} else if (id === 5) {
			for (let count = u32(); count; count--) memories.push(limits());
		} else {
			offset = end;
		}
		assert.equal(offset, end, 'unexpected Wasm declaration payload');
	}
	assert.deepEqual(
		types[execType],
		{ params: Array(7).fill(0x7f), results: [0x7f] },
		'exec_v1 must be seven i32 -> i32'
	);
	assert.equal(memories.length, 1, 'one shared wasm32 memory is required');
	assert.equal(memories[0].flags, 3, 'WASIX Bash requires a shared memory with a maximum');
	assert(
		memories[0].initial <= memories[0].maximum && memories[0].maximum <= 65536,
		'invalid wasm32 memory bound'
	);
	return {
		imports,
		exports,
		memories,
		execSignature: types[execType],
		bytes: bytes.length,
		sha256: sha256(bytes),
		qualification: 'producer-import-profile-only; no guest execution'
	};
}
