function checkDynamicSegment(view: DataView, offset: bigint, size: bigint, memorySize: bigint) {
	// Elf64_Dyn entries contain a signed 64-bit tag and an 8-byte value or pointer.
	const end = offset + size;
	if (size < 16n || size % 16n !== 0n || size > memorySize || end > BigInt(view.byteLength))
		throw new Error('Invalid ELF dynamic segment');

	for (let cursor = Number(offset); cursor < Number(end); cursor += 16) {
		const tag = view.getBigInt64(cursor, true);
		if (tag === 0n) return; // DT_NULL
		if (tag === 1n) throw new Error('Static ELF contains a shared library dependency (DT_NEEDED)');
	}
	throw new Error('ELF dynamic segment lacks DT_NULL');
}

/** Check the program headers of an already identified little-endian ELF64 executable. */
export function assertStaticElf64ProgramHeaders(view: DataView) {
	const table = view.getBigUint64(32, true);
	const size = view.getUint16(54, true);
	const count = view.getUint16(56, true);
	const length = BigInt(view.byteLength);
	if (size !== 56 || !count || table < 64n || table + BigInt(size * count) > length)
		throw new Error('Invalid ELF program header table');

	const entry = view.getBigUint64(24, true);
	let executableEntry = false;
	for (let index = 0; index < count; index++) {
		const header = Number(table) + index * size;
		const type = view.getUint32(header, true);
		if (type === 3) throw new Error('Static ELF requests a dynamic interpreter');
		if (type !== 1 && type !== 2) continue;
		const offset = view.getBigUint64(header + 8, true);
		const fileSize = view.getBigUint64(header + 32, true);
		const memorySize = view.getBigUint64(header + 40, true);
		if (type === 2) {
			checkDynamicSegment(view, offset, fileSize, memorySize);
			continue;
		}
		if (fileSize > memorySize || (fileSize > 0n && offset + fileSize > length))
			throw new Error('Invalid ELF load segment');
		const address = view.getBigUint64(header + 16, true);
		const executable = (view.getUint32(header + 4, true) & 1) !== 0;
		if (executable && entry >= address && entry < address + fileSize) executableEntry = true;
	}
	if (!executableEntry) throw new Error('ELF entry point is outside executable file data');
}
