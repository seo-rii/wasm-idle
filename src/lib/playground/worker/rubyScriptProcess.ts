export function rubyStringLiteral(value: string) {
	return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
