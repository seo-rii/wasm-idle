import type { DebugVariable } from '../types.js';

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

export type DebugExpressionScalar = number | boolean | string | null;
export type DebugExpressionArray = DebugExpressionValue[] & { truncated?: boolean };
export interface DebugExpressionIndexedValue {
	__debugExpressionKind: 'array';
	length?: number;
	truncated?: boolean;
	get: (index: number) => DebugExpressionValue;
	keys?: () => number[];
}
export interface DebugExpressionObjectValue {
	__debugExpressionKind: 'object';
	has: (name: string) => boolean;
	get: (name: string) => DebugExpressionValue;
	keys?: () => string[];
}
export interface DebugExpressionRecord {
	[key: string]: DebugExpressionValue;
}
export type DebugExpressionValue =
	| DebugExpressionScalar
	| DebugExpressionArray
	| DebugExpressionIndexedValue
	| DebugExpressionObjectValue
	| DebugExpressionRecord;

const operators = ['&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!'];

const isDebugExpressionIndexedValue = (
	value: DebugExpressionValue
): value is DebugExpressionIndexedValue =>
	!!value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	(value as DebugExpressionIndexedValue).__debugExpressionKind === 'array';

const isDebugExpressionObjectValue = (
	value: DebugExpressionValue
): value is DebugExpressionObjectValue =>
	!!value &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	(value as DebugExpressionObjectValue).__debugExpressionKind === 'object';

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

const tokenizeDebugExpression = (source: string) => {
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
	return tokens;
};

const parseDebugPreviewValueAt = (
	text: string,
	start = 0
): { value: DebugExpressionValue; next: number } => {
	let index = start;
	while (/\s/.test(text[index] || '')) index += 1;
	const character = text[index];
	if (character === '[') {
		index += 1;
		const items: DebugExpressionArray = [];
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
			const item = parseDebugPreviewValueAt(text, index);
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
		const items: DebugExpressionArray = [];
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
			const item = parseDebugPreviewValueAt(text, index);
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
		const entries: DebugExpressionRecord = {};
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
			const entry = parseDebugPreviewValueAt(text, index);
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

export const parseStoredDebugValue = (value: string): DebugExpressionValue => {
	const source = value.trim();
	if (!source || source === '?') throw new Error('unavailable');
	if (source === 'true' || source === 'false' || source === 'True' || source === 'False') {
		return source === 'true' || source === 'True';
	}
	if (source === 'null' || source === 'None') return null;
	const numeric = Number(source);
	if (!Number.isNaN(numeric)) return numeric;
	if (
		source.startsWith('[') ||
		source.startsWith('(') ||
		source.startsWith('{') ||
		source.startsWith("'") ||
		source.startsWith('"')
	) {
		const parsed = parseDebugPreviewValueAt(source);
		const trailing = source.slice(parsed.next).trim();
		if (trailing) throw new Error('unsupported preview');
		return parsed.value;
	}
	throw new Error('unsupported preview');
};

const quoteDebugString = (value: string) =>
	`'${value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", "\\'")
		.replaceAll('\n', '\\n')
		.replaceAll('\r', '\\r')
		.replaceAll('\t', '\\t')}'`;

const formatDebugExpressionValueInternal = (
	value: DebugExpressionValue,
	nested: boolean,
	depth: number
): string => {
	if (value === null) return 'null';
	if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
	if (typeof value === 'string') return nested ? quoteDebugString(value) : value;
	if (depth >= 4) return '...';
	if (Array.isArray(value)) {
		const previewLength = Math.min(value.length, 8);
		const items = value
			.slice(0, previewLength)
			.map((entry) => formatDebugExpressionValueInternal(entry, true, depth + 1));
		return `[${items.join(', ')}${value.truncated || value.length > previewLength ? ', ...' : ''}]`;
	}
	if (isDebugExpressionIndexedValue(value)) {
		const indexes = value.keys?.() || [];
		const previewLength = Math.min(indexes.length || value.length || 0, 8);
		const items: string[] = [];
		for (let index = 0; index < previewLength; index += 1) {
			const resolvedIndex = indexes[index] ?? index;
			items.push(
				formatDebugExpressionValueInternal(value.get(resolvedIndex), true, depth + 1)
			);
		}
		const isTruncated = value.truncated || (value.length != null && value.length > previewLength);
		return `[${items.join(', ')}${isTruncated ? ', ...' : ''}]`;
	}
	if (isDebugExpressionObjectValue(value)) {
		const keys = value.keys?.() || [];
		const previewLength = Math.min(keys.length, 8);
		const entries = keys.slice(0, previewLength).map((key) => {
			return `${key}: ${formatDebugExpressionValueInternal(value.get(key), true, depth + 1)}`;
		});
		return `{${entries.join(', ')}${keys.length > previewLength ? ', ...' : ''}}`;
	}
	const keys = Object.keys(value);
	const previewLength = Math.min(keys.length, 8);
	const entries = keys.slice(0, previewLength).map((key) => {
		return `${key}: ${formatDebugExpressionValueInternal(value[key]!, true, depth + 1)}`;
	});
	return `{${entries.join(', ')}${keys.length > previewLength ? ', ...' : ''}}`;
};

export const formatDebugExpressionValue = (value: DebugExpressionValue) =>
	formatDebugExpressionValueInternal(value, false, 0);

export const evaluateDebugExpressionWithResolver = (
	expression: string,
	resolveIdentifier: (name: string) => DebugExpressionValue
) => {
	const source = expression.trim();
	if (!source) throw new Error('empty expression');
	const tokens = tokenizeDebugExpression(source);
	const parsedValues = new Map<string, DebugExpressionValue>();
	const resolveIdentifierValue = (name: string): DebugExpressionValue => {
		if (parsedValues.has(name)) return parsedValues.get(name)!;
		const value = resolveIdentifier(name);
		parsedValues.set(name, value);
		return value;
	};
	const readIndexedValue = (value: DebugExpressionValue, index: number): DebugExpressionValue => {
		if (!Number.isInteger(index)) throw new Error('unsupported index access');
		if (Array.isArray(value)) {
			if (index < 0 || index >= value.length) throw new Error('unavailable');
			return value[index]!;
		}
		if (isDebugExpressionIndexedValue(value)) {
			if (value.length != null && (index < 0 || index >= value.length)) {
				throw new Error('unavailable');
			}
			return value.get(index);
		}
		throw new Error('unsupported index access');
	};
	const readMemberValue = (value: DebugExpressionValue, name: string): DebugExpressionValue => {
		if (Array.isArray(value) || isDebugExpressionIndexedValue(value) || !value) {
			throw new Error('unsupported member access');
		}
		if (isDebugExpressionObjectValue(value)) {
			if (!value.has(name)) throw new Error('unavailable');
			return value.get(name);
		}
		if (typeof value !== 'object' || !Object.hasOwn(value, name)) throw new Error('unavailable');
		return value[name]!;
	};
	let cursor = 0;
	const parsePrimary = (): DebugExpressionValue => {
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
					resolved = readIndexedValue(resolved, index);
					continue;
				}
				if (bracket?.type === 'dot') {
					cursor += 1;
					const property = tokens[cursor];
					if (!property || property.type !== 'identifier')
						throw new Error('missing property name');
					cursor += 1;
					resolved = readMemberValue(resolved, property.value);
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
	const parseUnary = (): DebugExpressionValue => {
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
	const parseMul = (): DebugExpressionValue => {
		let left = parseUnary();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['*', '/', '%'].includes(operator.value)) {
				return left;
			}
			cursor += 1;
			const right = parseUnary();
			if (operator.value === '*') left = Number(left) * Number(right);
			if (operator.value === '/') left = Number(left) / Number(right);
			if (operator.value === '%') left = Number(left) % Number(right);
		}
	};
	const parseAdd = (): DebugExpressionValue => {
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
	const parseCompare = (): DebugExpressionValue => {
		let left = parseAdd();
		while (true) {
			const operator = tokens[cursor];
			if (operator?.type !== 'operator' || !['<', '<=', '>', '>='].includes(operator.value)) {
				return left;
			}
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
	const parseEquality = (): DebugExpressionValue => {
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
	const parseAnd = (): DebugExpressionValue => {
		let left = parseEquality();
		while (true) {
			const operator = tokens[cursor];
			if (!operator || operator.type !== 'operator' || operator.value !== '&&') break;
			cursor += 1;
			left = Boolean(left) && Boolean(parseEquality());
		}
		return left;
	};
	const parseOr = (): DebugExpressionValue => {
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
	return formatDebugExpressionValue(result);
};

export function evaluateDebugExpression(expression: string, variables: DebugVariable[]) {
	const values = new Map<string, string>();
	for (const variable of variables) values.set(variable.name, variable.value);
	return evaluateDebugExpressionWithResolver(expression, (name) => {
		const value = values.get(name);
		if (value == null || value === '?') throw new Error('unavailable');
		return parseStoredDebugValue(value);
	});
}
