import type { DebugVariable } from '$lib/playground/options';

type Token =
	| { type: 'number'; value: string }
	| { type: 'boolean'; value: boolean }
	| { type: 'identifier'; value: string }
	| { type: 'operator'; value: string }
	| { type: 'paren'; value: '(' | ')' };

const operators = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];

export function evaluateDebugExpression(expression: string, variables: DebugVariable[]) {
	const source = expression.trim();
	if (!source) throw new Error('empty expression');
	const values = new Map<string, string>();
	for (const variable of variables) values.set(variable.name, variable.value);
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
	const parsePrimary = (): number | boolean => {
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
			const value = values.get(token.value);
			if (value == null || value === '?') throw new Error('unavailable');
			if (value === 'true' || value === 'false') return value === 'true';
			const parsed = Number(value);
			if (!Number.isNaN(parsed)) return parsed;
			throw new Error(`unsupported value for ${token.value}`);
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
	const parseUnary = (): number | boolean => {
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
	const parseMul = (): number | boolean => {
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
	const parseAdd = (): number | boolean => {
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
	const parseCompare = (): number | boolean => {
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
	const parseEquality = (): number | boolean => {
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
	const parseAnd = (): number | boolean => {
		let left = parseEquality();
		while (tokens[cursor]?.type === 'operator' && tokens[cursor]?.value === '&&') {
			cursor += 1;
			left = Boolean(left) && Boolean(parseEquality());
		}
		return left;
	};
	const parseOr = (): number | boolean => {
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
