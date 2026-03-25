import type { DebugVariable } from '$lib/playground/options';

type Token =
	| { type: 'number'; value: string }
	| { type: 'boolean'; value: boolean }
	| { type: 'null' }
	| { type: 'string'; value: string }
	| { type: 'identifier'; value: string }
	| { type: 'operator'; value: string }
	| { type: 'paren'; value: '(' | ')' }
	| { type: 'bracket'; value: '[' | ']' }
	| { type: 'dot' };

const operators = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];

export function evaluateDebugExpression(expression: string, variables: DebugVariable[]) {
	const source = expression.trim();
	if (!source) throw new Error('empty expression');
	const values = new Map<string, string>();
	for (const variable of variables) values.set(variable.name, variable.value);
	type ResolvedScalar = number | boolean | string | null;
	interface ResolvedObject {
		[key: string]: ResolvedValue;
	}
	type ResolvedArray = ResolvedValue[] & { truncated?: boolean };
	type ResolvedValue = ResolvedScalar | ResolvedArray | ResolvedObject;
	const parsedValues = new Map<string, ResolvedValue>();
	const tokens: Token[] = [];
	const parseQuotedValue = (text: string, start: number): { value: string; next: number } => {
		const quote = text[start];
		if (quote !== "'" && quote !== '"') throw new Error('expected quoted string');
		let index = start + 1;
		let value = '';
		while (index < text.length) {
			const character = text[index];
			if (!character) break;
			if (character === '\\') {
				const escaped = text[index + 1];
				if (!escaped) throw new Error('unterminated string literal');
				if (escaped === 'n') value += '\n';
				else if (escaped === 'r') value += '\r';
				else if (escaped === 't') value += '\t';
				else value += escaped;
				index += 2;
				continue;
			}
			if (character === quote) return { value, next: index + 1 };
			value += character;
			index += 1;
		}
		throw new Error('unterminated string literal');
	};
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
		if (character === '.') {
			tokens.push({ type: 'dot' });
			index += 1;
			continue;
		}
		const operator = operators.find((candidate) => source.startsWith(candidate, index));
		if (operator) {
			tokens.push({ type: 'operator', value: operator });
			index += operator.length;
			continue;
		}
		if (character === "'" || character === '"') {
			const parsed = parseQuotedValue(source, index);
			tokens.push({ type: 'string', value: parsed.value });
			index = parsed.next;
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
			if (
				identifier[0] === 'true' ||
				identifier[0] === 'false' ||
				identifier[0] === 'True' ||
				identifier[0] === 'False'
			) {
				tokens.push({
					type: 'boolean',
					value: identifier[0] === 'true' || identifier[0] === 'True'
				});
			} else if (identifier[0] === 'null' || identifier[0] === 'None') {
				tokens.push({ type: 'null' });
			} else if (identifier[0] === 'and') {
				tokens.push({ type: 'operator', value: '&&' });
			} else if (identifier[0] === 'or') {
				tokens.push({ type: 'operator', value: '||' });
			} else if (identifier[0] === 'not') {
				tokens.push({ type: 'operator', value: '!' });
			} else {
				tokens.push({ type: 'identifier', value: identifier[0] });
			}
			index += identifier[0].length;
			continue;
		}
		throw new Error(`unsupported token near "${source.slice(index)}"`);
	}
	let cursor = 0;
	const parsePreviewValue = (text: string, start = 0): { value: ResolvedValue; next: number } => {
		let index = start;
		while (/\s/.test(text[index] || '')) index += 1;
		const character = text[index];
		if (character === '[') {
			index += 1;
			const items: ResolvedArray = [];
			while (true) {
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ']') return { value: items, next: index + 1 };
				if (text.startsWith('...', index)) {
					items.truncated = true;
					index += 3;
					while (/\s/.test(text[index] || '')) index += 1;
					if (text[index] === ']') return { value: items, next: index + 1 };
					throw new Error('unsupported array preview');
				}
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
		if (character === '(') {
			index += 1;
			const items: ResolvedArray = [];
			while (true) {
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ')') return { value: items, next: index + 1 };
				if (text.startsWith('...', index)) {
					items.truncated = true;
					index += 3;
					while (/\s/.test(text[index] || '')) index += 1;
					if (text[index] === ')') return { value: items, next: index + 1 };
					throw new Error('unsupported tuple preview');
				}
				const item = parsePreviewValue(text, index);
				items.push(item.value);
				index = item.next;
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ',') {
					index += 1;
					continue;
				}
				if (text[index] === ')') return { value: items, next: index + 1 };
				throw new Error('unsupported tuple preview');
			}
		}
		if (character === '{') {
			index += 1;
			const entries: Record<string, ResolvedValue> = {};
			while (true) {
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === '}') return { value: entries, next: index + 1 };
				if (text.startsWith('...', index)) throw new Error('unavailable');
				let key = '';
				if (text[index] === "'" || text[index] === '"') {
					const parsedKey = parseQuotedValue(text, index);
					key = parsedKey.value;
					index = parsedKey.next;
				} else {
					const identifier = text.slice(index).match(/^[A-Za-z_]\w*/)?.[0];
					if (!identifier) throw new Error('unsupported object preview');
					key = identifier;
					index += identifier.length;
				}
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] !== ':') throw new Error('unsupported object preview');
				index += 1;
				const entry = parsePreviewValue(text, index);
				entries[key] = entry.value;
				index = entry.next;
				while (/\s/.test(text[index] || '')) index += 1;
				if (text[index] === ',') {
					index += 1;
					continue;
				}
				if (text[index] === '}') return { value: entries, next: index + 1 };
				throw new Error('unsupported object preview');
			}
		}
		if (character === "'" || character === '"') return parseQuotedValue(text, index);
		if (text.startsWith('true', index)) return { value: true, next: index + 4 };
		if (text.startsWith('false', index)) return { value: false, next: index + 5 };
		if (text.startsWith('True', index)) return { value: true, next: index + 4 };
		if (text.startsWith('False', index)) return { value: false, next: index + 5 };
		if (text.startsWith('null', index)) return { value: null, next: index + 4 };
		if (text.startsWith('None', index)) return { value: null, next: index + 4 };
		const number = text.slice(index).match(/^-?\d+(?:\.\d+)?/);
		if (number?.[0]) return { value: Number(number[0]), next: index + number[0].length };
		throw new Error('unsupported preview');
	};
	const resolveIdentifierValue = (name: string): ResolvedValue => {
		if (parsedValues.has(name)) return parsedValues.get(name)!;
		const value = values.get(name);
		if (value == null || value === '?') throw new Error('unavailable');
		if (value === 'true' || value === 'false' || value === 'True' || value === 'False') {
			const parsed = value === 'true' || value === 'True';
			parsedValues.set(name, parsed);
			return parsed;
		}
		if (value === 'null' || value === 'None') {
			parsedValues.set(name, null);
			return null;
		}
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) {
			parsedValues.set(name, numeric);
			return numeric;
		}
		if (
			value.startsWith('[') ||
			value.startsWith('(') ||
			value.startsWith("'") ||
			value.startsWith('"')
		) {
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
		if (token.type === 'null') {
			cursor += 1;
			return null;
		}
		if (token.type === 'string') {
			cursor += 1;
			return token.value;
		}
		if (token.type === 'identifier') {
			cursor += 1;
			let resolved = resolveIdentifierValue(token.value);
			while (true) {
				const bracket = tokens[cursor];
				if (bracket?.type === 'bracket' && bracket.value === '[') {
					cursor += 1;
					const index = Number(parseOr());
					const closing = tokens[cursor];
					if (!closing || closing.type !== 'bracket' || closing.value !== ']')
						throw new Error('missing closing bracket');
					cursor += 1;
					if (!Array.isArray(resolved) || !Number.isInteger(index))
						throw new Error('unsupported index access');
					if (index < 0 || index >= resolved.length) throw new Error('unavailable');
					resolved = resolved[index]!;
					continue;
				}
				if (bracket?.type === 'dot') {
					cursor += 1;
					const property = tokens[cursor];
					if (!property || property.type !== 'identifier')
						throw new Error('missing property name');
					cursor += 1;
					if (Array.isArray(resolved) || !resolved || typeof resolved !== 'object')
						throw new Error('unsupported member access');
					if (!Object.hasOwn(resolved, property.value)) throw new Error('unavailable');
					resolved = resolved[property.value]!;
					continue;
				}
				break;
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
			if (operator?.type !== 'operator' || !['*', '/', '%'].includes(operator.value))
				return left;
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
			if (operator.value === '+') {
				if (typeof left === 'string' || typeof right === 'string') {
					left = `${left ?? 'null'}${right ?? 'null'}`;
				} else {
					left = Number(left) + Number(right);
				}
			}
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
			const leftValue =
				typeof left === 'string' && typeof right === 'string' ? left : Number(left);
			const rightValue =
				typeof left === 'string' && typeof right === 'string' ? right : Number(right);
			if (operator.value === '<') left = leftValue < rightValue;
			if (operator.value === '<=') left = leftValue <= rightValue;
			if (operator.value === '>') left = leftValue > rightValue;
			if (operator.value === '>=') left = leftValue >= rightValue;
		}
	};
	const parseEquality = (): ResolvedValue => {
		let left = parseCompare();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['==', '!='].includes(operator.value))
				return left;
			cursor += 1;
			const right = parseCompare();
			if (operator.value === '==') left = left === right;
			if (operator.value === '!=') left = left !== right;
		}
	};
	const parseAnd = (): ResolvedValue => {
		let left = parseEquality();
		while (true) {
			const operator = tokens[cursor];
			if (!operator || operator.type !== 'operator' || operator.value !== '&&') break;
			cursor += 1;
			left = Boolean(left) && Boolean(parseEquality());
		}
		return left;
	};
	const parseOr = (): ResolvedValue => {
		let left = parseAnd();
		while (true) {
			const operator = tokens[cursor];
			if (!operator || operator.type !== 'operator' || operator.value !== '||') break;
			cursor += 1;
			left = Boolean(left) || Boolean(parseAnd());
		}
		return left;
	};
	const result = parseOr();
	if (cursor !== tokens.length) throw new Error('unexpected trailing tokens');
	return `${result}`;
}
