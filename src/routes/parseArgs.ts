/** Whitespace separates args; quotes group them, and backslash escapes outside single quotes.
 * No expansion, substitution, globbing, or shell execution is performed.
 */
export function parseArgs(input: string): string[] {
	const args: string[] = [];
	let value = '';
	let quote: '"' | "'" | null = null;
	let escaped = false;
	let started = false;
	for (const character of input) {
		if (escaped) {
			value += character;
			escaped = false;
		} else if (character === '\\' && quote !== "'") {
			escaped = true;
			started = true;
		} else if (quote) {
			if (character === quote) quote = null;
			else value += character;
		} else if (character === '"' || character === "'") {
			quote = character;
			started = true;
		} else if (/\s/u.test(character)) {
			if (started) args.push(value);
			value = '';
			started = false;
		} else {
			value += character;
			started = true;
		}
	}
	if (escaped) throw new Error('Finish the escaped character after the backslash.');
	if (quote) throw new Error(`Close the ${quote} quote in the arguments.`);
	if (started) args.push(value);
	return args;
}
