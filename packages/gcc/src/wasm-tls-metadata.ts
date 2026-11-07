/** Decode the object ABI's TLS markers. TLS is not a Wasm target_features name.
 * https://github.com/WebAssembly/tool-conventions/blob/main/Linking.md
 * Cross-object resolution and all non-TLS relocations remain the link-input
 * validator/linker's responsibility; arbitrary data bytes are never searched.
 */
export function inspectGccTlsMetadata(
	bytes: Uint8Array,
	i32ConstantOffsets: ReadonlySet<number>
): boolean {
	let position = 8;
	const invalid = () => new Error('Invalid GCC Wasm TLS object metadata');
	function byte(end: number) {
		if (position >= end) throw invalid();
		return bytes[position++];
	}
	function uint(end: number) {
		let value = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const next = byte(end);
			if (shift === 28 && next > 15) break;
			value += (next & 127) * 2 ** shift;
			if (next < 128) return value;
		}
		throw invalid();
	}
	function count(end: number) {
		const size = uint(end);
		if (size > end - position) throw invalid();
		return size;
	}
	function name(end: number) {
		const size = count(end),
			start = position;
		position += size;
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, position));
	}
	function signed(end: number, width: number) {
		for (let remaining = width; remaining; remaining--) {
			const next = byte(end);
			if (next < 128) {
				if (
					remaining === 1 &&
					(width === 5 ? next > 7 && next < 120 : next !== 0 && next !== 127)
				)
					throw invalid();
				return;
			}
		}
		throw invalid();
	}
	const sections: { id: number; start: number; payload: number; end: number; name?: string }[] =
		[];
	while (position < bytes.length) {
		const id = byte(bytes.length),
			size = uint(bytes.length),
			start = position,
			end = start + size;
		if (end > bytes.length) throw invalid();
		const text = id === 0 ? name(end) : undefined;
		sections.push({ id, start, payload: position, end, name: text });
		position = end;
	}
	const linking = sections.filter((section) => section.name === 'linking');
	if (linking.length !== 1) throw invalid();
	position = linking[0].payload;
	if (uint(linking[0].end) !== 2) throw invalid();
	const subsections = new Map<number, { start: number; end: number }>();
	while (position < linking[0].end) {
		const id = byte(linking[0].end),
			size = uint(linking[0].end),
			start = position,
			end = start + size;
		if (end > linking[0].end || subsections.has(id)) throw invalid();
		subsections.set(id, { start, end });
		position = end;
	}
	const symbols: { kind: number; tls: boolean; segment?: number }[] = [];
	const symbolTable = subsections.get(8);
	if (symbolTable) {
		position = symbolTable.start;
		for (let remaining = count(symbolTable.end); remaining; remaining--) {
			const kind = byte(symbolTable.end),
				flags = uint(symbolTable.end),
				undefinedSymbol = Boolean(flags & 0x10),
				tls = Boolean(flags & 0x100);
			const symbol: { kind: number; tls: boolean; segment?: number } = { kind, tls };
			if (tls && kind !== 1) throw invalid();
			if ([0, 2, 4, 5].includes(kind)) {
				uint(symbolTable.end);
				if (!undefinedSymbol || flags & 0x40) name(symbolTable.end);
			} else if (kind === 1) {
				name(symbolTable.end);
				if (!undefinedSymbol) {
					symbol.segment = uint(symbolTable.end);
					uint(symbolTable.end);
					uint(symbolTable.end);
				}
			} else if (kind === 3) uint(symbolTable.end);
			else throw invalid();
			symbols.push(symbol);
		}
		if (position !== symbolTable.end) throw invalid();
	}
	const segmentTls: boolean[] = [];
	const segmentInfo = subsections.get(5);
	if (segmentInfo) {
		position = segmentInfo.start;
		for (let remaining = count(segmentInfo.end); remaining; remaining--) {
			name(segmentInfo.end);
			if (uint(segmentInfo.end) > 31) throw invalid();
			const flags = uint(segmentInfo.end);
			if (flags & ~7) throw invalid();
			segmentTls.push(Boolean(flags & 2));
		}
		if (position !== segmentInfo.end) throw invalid();
	}
	const dataSection = sections.find((section) => section.id === 11);
	let dataCount = 0;
	if (dataSection) {
		position = dataSection.payload;
		dataCount = uint(dataSection.end);
	}
	if (segmentInfo && segmentTls.length !== dataCount) throw invalid();
	for (const symbol of symbols) {
		if (symbol.segment !== undefined && (symbol.tls || segmentTls[symbol.segment])) {
			if (symbol.segment >= dataCount || segmentTls[symbol.segment] !== symbol.tls)
				throw invalid();
		}
	}
	let tls = symbols.some((symbol) => symbol.tls) || segmentTls.some(Boolean);
	for (const section of sections.filter((section) => section.name?.startsWith('reloc.'))) {
		position = section.payload;
		const targetIndex = uint(section.end),
			target = sections[targetIndex];
		for (let remaining = count(section.end); remaining; remaining--) {
			const type = byte(section.end),
				offset = uint(section.end),
				index = uint(section.end);
			if (type > 26) throw invalid();
			if ([3, 4, 5, 8, 9, 11, 14, 15, 16, 17, 21, 22, 23, 25].includes(type))
				signed(section.end, [14, 15, 16, 17, 22, 25].includes(type) ? 10 : 5);
			if (type === 25) throw new Error('GCC TLS requires wasm32 relocation 21, not memory64');
			if (type === 21) {
				const symbol = symbols[index],
					start = (target?.start ?? 0) + offset,
					end = start + 5;
				if (
					!symbol?.tls ||
					symbol.kind !== 1 ||
					target?.id !== 10 ||
					end > target.end ||
					!i32ConstantOffsets.has(start) ||
					![0, 1, 2, 3].every((i) => bytes[start + i] >= 128) ||
					bytes[end - 1] >= 128 ||
					(bytes[end - 1] > 7 && bytes[end - 1] < 120)
				)
					throw invalid();
				tls = true;
			}
		}
		if (position !== section.end) throw invalid();
	}
	if (tls) {
		const featureSections = sections.filter((section) => section.name === 'target_features');
		if (featureSections.length !== 1) throw invalid();
		const featureSection = featureSections[0],
			features = new Map<string, number>();
		position = featureSection.payload;
		for (let remaining = count(featureSection.end); remaining; remaining--) {
			const prefix = byte(featureSection.end),
				feature = name(featureSection.end);
			if (![43, 45].includes(prefix) || features.has(feature)) throw invalid();
			features.set(feature, prefix);
		}
		if (
			position !== featureSection.end ||
			features.get('atomics') !== 43 ||
			features.get('bulk-memory') !== 43
		)
			throw new Error('GCC TLS object ABI requires atomics and bulk-memory metadata');
	}
	return tls;
}
