export function readStr(u8: Uint8Array, o: number, len = -1) {
    const end = len === -1 ? u8.length : o + len;
    let str = '';
    for (let i = o; i < end && u8[i]; ++i) str += String.fromCharCode(u8[i]);
    return str;
}

export function readStrR(u8: Uint8Array, o: number, len = -1) {
    const end = len === -1 ? u8.length : o + len;
    let str: number[] = [];
    for (let i = o; i < end && u8[i]; ++i) str.push(u8[i]);
    return new TextDecoder().decode(Uint8Array.from(str));
}

export function readOct(u8: Uint8Array, o: number, len: number) {
    return parseInt(readStr(u8, o, len), 8);
}

export function readUint8(u8: Uint8Array, o: number, len: number) {
    return new Uint8Array(u8.buffer, o, len);
}