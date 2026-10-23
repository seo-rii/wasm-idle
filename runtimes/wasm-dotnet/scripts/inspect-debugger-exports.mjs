/** Inspect the actual Wasm bodies; JavaScript wrapper names cannot prove a native agent exists. */
export function inspectMonoDebuggerExports(bytes) {
	const header = [0, 97, 115, 109, 1, 0, 0, 0];
	if (!header.every((byte, index) => bytes[index] === byte))
		throw new Error('Invalid Wasm header');
	let cursor = 8;
	let end = bytes.length;
	const byte = () => {
		if (cursor >= end) throw new Error('Truncated Wasm section');
		return bytes[cursor++];
	};
	const uint = () => {
		let value = 0,
			shift = 0;
		for (let index = 0; index < 8; index++) {
			const next = byte();
			value += (next & 127) * 2 ** shift;
			if (!Number.isSafeInteger(value)) throw new Error('Wasm integer exceeds probe bounds');
			if (next < 128) return value;
			shift += 7;
		}
		throw new Error('Invalid Wasm integer');
	};
	const name = () => {
		const length = uint();
		if (cursor + length > end) throw new Error('Truncated Wasm name');
		const value = new TextDecoder('utf-8', { fatal: true }).decode(
			bytes.subarray(cursor, cursor + length)
		);
		cursor += length;
		return value;
	};
	const limits = () => {
		const flags = uint();
		if (flags > 7) throw new Error('Unsupported Wasm limits');
		uint();
		if (flags & 1) uint();
	};
	let importedFunctions = 0;
	const exports = [];
	const bodies = [];
	while (cursor < bytes.length) {
		end = bytes.length;
		const section = byte();
		const length = uint();
		end = cursor + length;
		if (end > bytes.length) throw new Error('Truncated Wasm section');
		if (section === 2) {
			const count = uint();
			for (let index = 0; index < count; index++) {
				name();
				name();
				switch (byte()) {
					case 0:
						importedFunctions++;
						uint();
						break;
					case 1:
						byte();
						limits();
						break;
					case 2:
						limits();
						break;
					case 3:
						byte();
						byte();
						break;
					case 4:
						byte();
						uint();
						break;
					default:
						throw new Error('Unknown Wasm import kind');
				}
			}
		} else if (section === 7) {
			const count = uint();
			for (let index = 0; index < count; index++) {
				const exportName = name(),
					kind = byte(),
					functionIndex = uint();
				if (
					kind === 0 &&
					/^mono_wasm_send_dbg_command(?:_with_parms)?$/u.test(exportName)
				) {
					exports.push({ name: exportName, functionIndex });
				}
			}
		} else if (section === 10) {
			const count = uint();
			for (let index = 0; index < count; index++) {
				const length = uint();
				if (cursor + length > end) throw new Error('Truncated Wasm function body');
				bodies.push(bytes.subarray(cursor, cursor + length));
				cursor += length;
			}
		}
		cursor = end;
	}
	return exports.map(({ name, functionIndex }) => {
		if (functionIndex < importedFunctions) return { name, functionIndex, kind: 'imported' };
		const body = bodies[functionIndex - importedFunctions];
		if (!body) throw new Error(`Missing Wasm function body for ${name}`);
		const constantFalse =
			body.length === 4 && [0, 0x41, 0, 0x0b].every((byte, index) => body[index] === byte);
		return {
			name,
			functionIndex,
			bodyBytes: body.length,
			bodyHex: Array.from(body.subarray(0, 64), (byte) =>
				byte.toString(16).padStart(2, '0')
			).join(''),
			kind: constantFalse ? 'constant-false-stub' : 'unqualified-function'
		};
	});
}
