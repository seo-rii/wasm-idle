/** Compose verified USTAR layers without changing any retained header or file bytes. */
export function composeSysrootLayers(base, cxx) {
	for (const layer of [base, cxx]) {
		if (
			!(layer instanceof Uint8Array) ||
			layer.length < 1024 ||
			layer.length % 512 ||
			layer.subarray(-1024).some((byte) => byte !== 0)
		)
			throw new Error('Invalid sysroot layer terminator');
	}
	const length = base.length + cxx.length - 1024;
	if (length > 128 * 1024 * 1024) throw new Error('Composed sysroot exceeds its archive budget');
	const archive = new Uint8Array(length);
	archive.set(base.subarray(0, -1024));
	archive.set(cxx.subarray(0, -1024), base.length - 1024);
	return archive;
}
