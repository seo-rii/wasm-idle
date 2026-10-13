/** Parse the signed decimal/hexadecimal offsets accepted by the memory inspector. */
export function parseDebugInteger(text: string): number {
	const token = text.trim();
	if (!/^-?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/u.test(token)) return Number.NaN;
	const negative = token.startsWith('-');
	const magnitude = Number(negative ? token.slice(1) : token);
	const value = negative ? -magnitude : magnitude;
	return Number.isSafeInteger(value) ? value : Number.NaN;
}
