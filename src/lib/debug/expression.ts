import type { DebugVariable } from '$lib/playground/options';

type Token =
	| { type: 'number'; value: string }
	| { type: 'boolean'; value: boolean }
	| { type: 'identifier'; value: string }
	| { type: 'operator'; value: string }
	| { type: 'paren'; value: '(' | ')' }
	| { type: 'bracket'; value: '[' | ']' };

const operators = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];

export function evaluateDebugExpression(expression: string, variables: DebugVariable[]) {
	const source = expression.trim();
	if (!source) throw new Error('empty expression');
	const values = new Map<string, string>();
	for (const variable of variables) values.set(variable.name, variable.value);
	type ResolvedValue = number | boolean | string | ResolvedValue[];
	const parsedValues = new Map<string, ResolvedValue>();
	const tokens: Token[] = [];
	for (let index = 0; index < source.length; ) {
		const character = source[index];
		if (!character) break;
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}
		if (character === '(' || character === ')') {
			tokens.push({ type: 'paren', value: character });
			index += 1;
			continue;
		}
		if (character === '[' || character === ']') {
			tokens.push({ type: 'bracket', value: character });
			index += 1;
			continue;
		}
		const operator = operators.find((candidate) => source.startsWith(candidate, index));
		if (operator) {
			tokens.push({ type: 'operator', value: operator });
			index += operator.length;
			continue;
		}
		const number = source.slice(index).match(/^\d+(?:\.\d+)?/);
		if (number?.[0]) {
			tokens.push({ type: 'number', value: number[0] });
			index += number[0].length;
			continue;
		}
		const identifier = source.slice(index).match(/^[A-Za-z_]\w*/);
		if (identifier?.[0]) {
			if (identifier[0] === 'true' || identifier[0] === 'false') {
				tokens.push({ type: 'boolean', value: identifier[0] === 'true' });
			} else {
				tokens.push({ type: 'identifier', value: identifier[0] });
			}
			index += identifier[0].length;
			continue;
		}
		throw new Error(`unsupported token near "${source.slice(index)}"`);
	}
	let cursor = 0;
	const parsePreviewValue = (
		text: string,
		start = 0
	): { value: ResolvedValue; next: number } => {
		let index = start;
		while (/\s/.test(text[index] || '')) index += 1;
		const character = text[index];
		if (character === '[') {
			index += 1;
			const items: ResolvedValue[] = [];
			while (true) {
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ']') return { value: items, next: index + 1 };
				if (text.startsWith('...', index)) throw new Error('unavailable');
				const item = parsePreviewValue(text, index);
				items.push(item.value);
				index = item.next;
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ',') {
					index += 1;
					continue;
				}
				if (text[index] === ']') return { value: items, next: index + 1 };
				throw new Error('unsupported array preview');
			}
		}
		if (character === "'") {
			const end = text.indexOf("'", index + 1);
			if (end === -1) throw new Error('unsupported char preview');
			return { value: text.slice(index + 1, end), next: end + 1 };
		}
		if (text.startsWith('true', index)) return { value: true, next: index + 4 };
		if (text.startsWith('false', index)) return { value: false, next: index + 5 };
		const number = text.slice(index).match(/^-?\d+(?:\.\d+)?/);
		if (number?.[0]) return { value: Number(number[0]), next: index + number[0].length };
		throw new Error('unsupported preview');
	};
	const resolveIdentifierValue = (name: string): ResolvedValue => {
		if (parsedValues.has(name)) return parsedValues.get(name)!;
		const value = values.get(name);
		if (value == null || value === '?') throw new Error('unavailable');
		if (value === 'true' || value === 'false') {
			const parsed = value === 'true';
			parsedValues.set(name, parsed);
			return parsed;
		}
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) {
			parsedValues.set(name, numeric);
			return numeric;
		}
		if (value.startsWith('[')) {
			const parsed = parsePreviewValue(value).value;
			parsedValues.set(name, parsed);
			return parsed;
		}
		throw new Error(`unsupported value for ${name}`);
	};
	const parsePrimary = (): ResolvedValue => {
		const token = tokens[cursor];
		if (!token) throw new Error('unexpected end of expression');
		if (token.type === 'number') {
			cursor += 1;
			return Number(token.value);
		}
		if (token.type === 'boolean') {
			cursor += 1;
			return token.value;
		}
		if (token.type === 'identifier') {
			cursor += 1;
			let resolved = resolveIdentifierValue(token.value);
			while (tokens[cursor]?.type === 'bracket' && tokens[cursor]?.value === '[') {
				cursor += 1;
				const index = Number(parseOr());
				const closing = tokens[cursor];
				if (!closing || closing.type !== 'bracket' || closing.value !== ']')
					throw new Error('missing closing bracket');
				cursor += 1;
				if (!Array.isArray(resolved) || !Number.isInteger(index)) throw new Error('unsupported index access');
				const next = resolved[index];
				if (next == null) throw new Error('unavailable');
				resolved = next;
			}
			return resolved;
		}
		if (token.type === 'paren' && token.value === '(') {
			cursor += 1;
			const result = parseOr();
			const closing = tokens[cursor];
			if (!closing || closing.type !== 'paren' || closing.value !== ')')
				throw new Error('missing closing parenthesis');
			cursor += 1;
			return result;
		}
		throw new Error('expected value');
	};
	const parseUnary = (): ResolvedValue => {
		const token = tokens[cursor];
		if (token?.type === 'operator' && token.value === '!') {
			cursor += 1;
			return !Boolean(parseUnary());
		}
		if (token?.type === 'operator' && token.value === '-') {
			cursor += 1;
			return -Number(parseUnary());
		}
		if (token?.type === 'operator' && token.value === '+') {
			cursor += 1;
			return Number(parseUnary());
		}
		return parsePrimary();
	};
	const parseMul = (): ResolvedValue => {
		let left = parseUnary();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['*', '/', '%'].includes(operator.value)) return left;
			cursor += 1;
			const right = parseUnary();
			if (operator.value === '*') left = Number(left) * Number(right);
			if (operator.value === '/') left = Number(left) / Number(right);
			if (operator.value === '%') left = Number(left) % Number(right);
		}
	};
	const parseAdd = (): ResolvedValue => {
		let left = parseMul();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['+', '-'].includes(operator.value)) return left;
			cursor += 1;
			const right = parseMul();
			if (operator.value === '+') left = Number(left) + Number(right);
			if (operator.value === '-') left = Number(left) - Number(right);
		}
	};
	const parseCompare = (): ResolvedValue => {
		let left = parseAdd();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['<', '<=', '>', '>='].includes(operator.value))
				return left;
			cursor += 1;
			const right = parseAdd();
			if (operator.value === '<') left = Number(left) < Number(right);
			if (operator.value === '<=') left = Number(left) <= Number(right);
			if (operator.value === '>') left = Number(left) > Number(right);
			if (operator.value === '>=') left = Number(left) >= Number(right);
		}
	};
	const parseEquality = (): ResolvedValue => {
		let left = parseCompare();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['==', '!='].includes(operator.value)) return left;
			cursor += 1;
			const right = parseCompare();
			if (operator.value === '==') left = left === right;
			if (operator.value === '!=') left = left !== right;
		}
	};
	const parseAnd = (): ResolvedValue => {
		let left = parseEquality();
		while (tokens[cursor]?.type === 'operator' && tokens[cursor]?.value === '&&') {
			cursor += 1;
			left = Boolean(left) && Boolean(parseEquality());
		}
		return left;
	};
	const parseOr = (): ResolvedValue => {
		let left = parseAnd();
		while (tokens[cursor]?.type === 'operator' && tokens[cursor]?.value === '||') {
			cursor += 1;
			left = Boolean(left) || Boolean(parseAnd());
		}
		return left;
	};
	const result = parseOr();
	if (cursor !== tokens.length) throw new Error('unexpected trailing tokens');
	return `${result}`;
}
