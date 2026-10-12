import { RuntimeConfigurationError } from '@wasm-idle/core';

const WASM_PAGE_BYTES = 65_536;

export function resolveWasmMemoryLimit(bytes: number | undefined): number | undefined {
	if (bytes === undefined) return undefined;
	if (!Number.isSafeInteger(bytes) || bytes < WASM_PAGE_BYTES) {
		throw new RuntimeConfigurationError(
			'Clang Wasm memory limit must allow at least one 64 KiB page'
		);
	}
	return Math.min(65_536, Math.floor(bytes / WASM_PAGE_BYTES)) * WASM_PAGE_BYTES;
}

/** Require a native module maximum; an initial allocation check cannot restrict memory.grow. */
export function assertWasmMemoryLimit(bytes: Uint8Array, limit: number) {
	let offset = 8;
	let end = bytes.length;
	const readU32 = () => {
		let value = 0;
		for (let shift = 0; shift < 35; shift += 7) {
			if (offset >= end)
				throw new RuntimeConfigurationError('Truncated Wasm memory declaration');
			const byte = bytes[offset++];
			if (shift === 28 && byte > 15) {
				throw new RuntimeConfigurationError(
					'Invalid Wasm section length or memory declaration'
				);
			}
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return value;
		}
		throw new RuntimeConfigurationError('Invalid Wasm memory declaration');
	};
	while (offset < bytes.length) {
		const id = bytes[offset++];
		const length = readU32();
		const sectionEnd = offset + length;
		if (sectionEnd > bytes.length)
			throw new RuntimeConfigurationError('Truncated Wasm section');
		if (id === 5) {
			end = sectionEnd;
			if (readU32() !== 1 || readU32() !== 1) {
				throw new RuntimeConfigurationError(
					'Clang memory limits require one bounded wasm32 memory'
				);
			}
			const initial = readU32();
			const maximum = readU32();
			if (offset !== end || initial > maximum || maximum * WASM_PAGE_BYTES > limit) {
				throw new RuntimeConfigurationError(
					`Wasm memory declaration exceeds the ${limit} byte limit`
				);
			}
			return;
		}
		offset = sectionEnd;
	}
	throw new RuntimeConfigurationError('Clang memory limits require a bounded memory declaration');
}
