export function readStr(u8: Uint8Array, o: number, len = -1) {
	const end = len === -1 ? u8.length : o + len;
	let str = '';
	for (let i = o; i < end && u8[i]; ++i) str += String.fromCharCode(u8[i]);
	return str;
}

export function readStrR(u8: Uint8Array, o: number, len = -1) {
	const end = len === -1 ? u8.length : o + len;
	const str: number[] = [];
	for (let i = o; i < end && u8[i]; ++i) str.push(u8[i]);
	return new TextDecoder().decode(Uint8Array.from(str));
}

export function readOct(u8: Uint8Array, o: number, len: number) {
	let field = '';
	for (const byte of u8.subarray(o, o + len)) field += String.fromCharCode(byte);
	if (field.length !== len || /[^0-7\0 ]/.test(field) || !/^ *[0-7]+[\0 ]*$/.test(field)) {
		throw new Error('TAR has an invalid octal number');
	}
	const value = Number.parseInt(field, 8);
	if (!Number.isSafeInteger(value)) throw new Error('TAR number exceeds the safe integer range');
	return value;
}

export function readUint8(u8: Uint8Array, o: number, len: number) {
	return new Uint8Array(u8.buffer, o, len);
}
