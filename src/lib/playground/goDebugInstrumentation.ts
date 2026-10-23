const debugImports = [
	'__wasm_idle_debug_json "encoding/json"',
	'__wasm_idle_debug_js "syscall/js"'
];

const debugSupportSource = `
type __wasmIdleDebugFrame struct {
	FunctionName string \`json:"functionName"\`
	Line int \`json:"line"\`
}

var __wasmIdleDebugStack []__wasmIdleDebugFrame

func __wasmIdleDebugStackJSON() string {
	bytes, _ := __wasm_idle_debug_json.Marshal(__wasmIdleDebugStack)
	return string(bytes)
}

func __wasmIdleDebugEnter(functionName string, line int) {
	__wasmIdleDebugStack = append(__wasmIdleDebugStack, __wasmIdleDebugFrame{FunctionName: functionName, Line: line})
	__wasmIdleDebugLine(line)
}

func __wasmIdleDebugLeave() {
	if len(__wasmIdleDebugStack) > 0 {
		__wasmIdleDebugStack = __wasmIdleDebugStack[:len(__wasmIdleDebugStack)-1]
	}
}

func __wasmIdleDebugLine(line int) {
	if len(__wasmIdleDebugStack) > 0 {
		__wasmIdleDebugStack[len(__wasmIdleDebugStack)-1].Line = line
	}
	__wasm_idle_debug_js.Global().Call("__wasmIdleGoDebugLine", line, __wasmIdleDebugStackJSON())
}
`;

function lineCommentStart(line: string) {
	let quote = '';
	let escaped = false;
	for (let index = 0; index < line.length - 1; index += 1) {
		const character = line[index] || '';
		if (quote) {
			if (quote === '`') {
				if (character === '`') quote = '';
				continue;
			}
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === '\\') {
				escaped = true;
				continue;
			}
			if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === "'" || character === '`') {
			quote = character;
			continue;
		}
		if (character === '/' && line[index + 1] === '/') return index;
	}
	return -1;
}

function stripLineComment(line: string) {
	const commentStart = lineCommentStart(line);
	return commentStart === -1 ? line : line.slice(0, commentStart);
}

const goKeywords = new Set([
	...'break case chan const continue default defer else fallthrough for func go'.split(' '),
	...'goto if import interface map package range return select struct switch type var'.split(' ')
]);

// Final tokens after which Go inserts a semicolon at a line break. Literals are tokenized as
// '0' (number), '"' (string), "'" (rune) and '`' (raw string).
const statementEndTokens = new Set([
	...'break continue fallthrough return ++ -- ) ] }'.split(' '),
	...['0', '"', "'", '`']
]);

type LexState = { rawString: boolean; blockComment: boolean };

// '{' is a composite literal and 'type' a struct/interface body; neither holds statements.
type Frame = '(' | '[' | '{' | 'type' | 'block';

function isIdentifier(token: string | undefined) {
	return token !== undefined && /^[\p{L}_]/u.test(token) && !goKeywords.has(token);
}

function endsStatement(token: string) {
	return statementEndTokens.has(token) || isIdentifier(token);
}

// Inside an if/for/switch header Go reads `T{` as the block, but `[]T{`, `[N]*pkg.T{`,
// `map[K]V{` and `struct{...}{` still open composite literals.
function followsLiteralType(tokens: string[], braceIndex: number, closedFrame?: Frame) {
	let index = braceIndex - 1;
	if (tokens[index] === '}') return closedFrame === 'type';
	if (!isIdentifier(tokens[index])) return false;
	index -= 1;
	if (tokens[index] === '.' && isIdentifier(tokens[index - 1])) index -= 2;
	const pointer = tokens[index] === '*';
	while (tokens[index] === '*') index -= 1;
	if (tokens[index] !== ']') return false;
	if (!pointer) return true;
	// `a[i] * b {` multiplies; only `[]*T` and `map[K]*V` are element types.
	let open = index - 1;
	for (let depth = 1; open >= 0; open -= 1) {
		if (tokens[open] === ']') depth += 1;
		else if (tokens[open] === '[' && --depth === 0) break;
	}
	return open === index - 1 || tokens[open - 1] === 'map';
}

function lineTokens(line: string, state: LexState, onWord?: (word: string, end: number) => void) {
	const tokens: string[] = [];
	const wordPattern = /[\p{L}_][\p{L}\p{N}_]*|\.?\d[\p{L}\p{N}_.]*/uy;
	let index = 0;
	while (index < line.length) {
		if (state.rawString || state.blockComment) {
			const end = line.indexOf(state.rawString ? '`' : '*/', index);
			if (end === -1) break;
			if (state.rawString) tokens.push('`');
			index = end + (state.rawString ? 1 : 2);
			state.rawString = false;
			state.blockComment = false;
			continue;
		}
		const character = line[index] || '';
		if (/\s/.test(character)) {
			index += 1;
			continue;
		}
		if (line.startsWith('//', index)) break;
		if (line.startsWith('/*', index)) {
			state.blockComment = true;
			index += 2;
			continue;
		}
		if (character === '`') {
			state.rawString = true;
			index += 1;
			continue;
		}
		if (character === '"' || character === "'") {
			index += 1;
			while (index < line.length && line[index] !== character) {
				index += line[index] === '\\' ? 2 : 1;
			}
			tokens.push(character);
			index += 1;
			continue;
		}
		wordPattern.lastIndex = index;
		const word = wordPattern.exec(line)?.[0];
		if (word) {
			tokens.push(/^[\p{L}_]/u.test(word) ? word : '0');
			index += word.length;
			onWord?.(word, index);
			continue;
		}
		const operator =
			['++', '--', ':=', '...'].find((candidate) => line.startsWith(candidate, index)) ||
			character;
		tokens.push(operator);
		index += operator.length;
	}
	return tokens;
}

function functionNameFromLine(line: string) {
	const source = stripLineComment(line).trim();
	const match = source.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
	return match?.[1] || null;
}

function shouldInstrumentLine(line: string) {
	const trimmed = stripLineComment(line).trim();
	if (!trimmed) return false;
	if (trimmed.startsWith('//')) return false;
	if (trimmed === '{' || trimmed === '}' || trimmed === '};') return false;
	if (trimmed.startsWith('}')) return false;
	if (/^(else|case\b|default\b)/.test(trimmed)) return false;
	if (/^[A-Za-z_]\w*:$/.test(trimmed)) return false;
	if (/^(import|const|var|type)\s*\($/.test(trimmed)) return false;
	return true;
}

function insertDebugImports(source: string) {
	const lines = source.split('\n');
	const state: LexState = { rawString: false, blockComment: false };
	let packageKeyword = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		let packageNameEnd: number | undefined;
		lineTokens(line, state, (word, end) => {
			if (packageNameEnd !== undefined) return;
			if (packageKeyword) packageNameEnd = end;
			else if (word === 'package') packageKeyword = true;
		});
		if (packageNameEnd === undefined) continue;
		// Insert before trailing comments, which may span lines or end beside an import.
		// Keep the suffix on ')' so an explicit package semicolon still terminates a declaration.
		lines.splice(
			index,
			1,
			line.slice(0, packageNameEnd),
			'',
			'import (',
			...debugImports.map((entry) => `\t${entry}`),
			')' + line.slice(packageNameEnd)
		);
		return lines.join('\n');
	}
	return source;
}

function instrumentFunctionLines(source: string) {
	const lines = source.split('\n');
	const instrumented: string[] = [];
	const functionStack: { depth: number; name: string }[] = [];
	const lexState: LexState = { rawString: false, blockComment: false };
	const frames: Frame[] = [];
	// Frame depths where a `func` signature still awaits its body, and where an if/for/switch
	// header still awaits its block.
	let pendingFunctionDepths: number[] = [];
	let headerDepth = -1;
	let closedFrame: Frame | undefined;
	let previousToken = ';';
	let continuesStatement = false;
	let followsLabel = false;
	let braceDepth = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] || '';
		const lineNumber = index + 1;
		const startsInCode = !lexState.rawString && !lexState.blockComment;
		const functionName = startsInCode ? functionNameFromLine(line) : null;
		const inFunction = functionStack.length > 0;
		const indent = line.match(/^\s*/)?.[0] || '';

		// Only hook lines that start a statement directly inside a block: not inside a raw
		// string, comment, composite literal, call or index, and not continuing the previous line.
		if (
			inFunction &&
			startsInCode &&
			frames.at(-1) === 'block' &&
			!frames.includes('(') &&
			!frames.includes('[') &&
			!continuesStatement &&
			!followsLabel &&
			shouldInstrumentLine(line)
		) {
			instrumented.push(`${indent}__wasmIdleDebugLine(${lineNumber})`);
		}
		instrumented.push(line);

		const tokens = lineTokens(line, lexState);
		let braces = 0;
		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
			const token = tokens[tokenIndex] || '';
			const depth = frames.length;
			if (token === '(' || token === '[') {
				frames.push(token);
			} else if (token === ')' || token === ']' || token === '}') {
				closedFrame = frames.pop();
				if (token === '}') braces -= 1;
				pendingFunctionDepths = pendingFunctionDepths.filter(
					(pending) => pending <= frames.length
				);
				if (headerDepth > frames.length) headerDepth = -1;
			} else if (token === '{') {
				let frame: Frame = '{';
				if (pendingFunctionDepths.includes(depth)) {
					frame = 'block';
					pendingFunctionDepths = pendingFunctionDepths.filter(
						(pending) => pending !== depth
					);
				} else if (previousToken === 'struct' || previousToken === 'interface') {
					frame = 'type';
				} else if (
					['else', 'for', 'switch', 'select'].includes(previousToken) ||
					(headerDepth === depth &&
						tokenIndex === tokens.length - 1 &&
						!followsLiteralType(tokens, tokenIndex, closedFrame)) ||
					([';', '{', ':'].includes(previousToken) &&
						(frames.at(-1) ?? 'block') === 'block')
				) {
					// Go ends an if/for/switch header at the `{` that closes its line; any other
					// `{` after an operand (`P{`, `[]int{`) opens a literal.
					frame = 'block';
					if (headerDepth === depth) headerDepth = -1;
				}
				frames.push(frame);
				braces += 1;
			} else if (token === 'func' && previousToken !== ']' && previousToken !== 'chan') {
				pendingFunctionDepths.push(depth);
			} else if (['if', 'for', 'switch', 'select'].includes(token)) {
				headerDepth = depth;
			} else if ([',', ';', '=', ':='].includes(token)) {
				pendingFunctionDepths = pendingFunctionDepths.filter(
					(pending) => pending !== depth
				);
			}
			previousToken = token;
		}

		const lastToken = tokens.at(-1);
		if (lastToken !== undefined) {
			const trimmed = stripLineComment(line).trim();
			continuesStatement = !endsStatement(lastToken) && !['{', ':', ';'].includes(lastToken);
			followsLabel = /^[A-Za-z_]\w*:$/.test(trimmed) && trimmed !== 'default:';
			if (endsStatement(lastToken)) {
				previousToken = ';';
				pendingFunctionDepths = pendingFunctionDepths.filter(
					(pending) => pending < frames.length
				);
				if (headerDepth >= frames.length) headerDepth = -1;
			}
		}

		// A signature line that ends inside a raw string or block comment has no place for the
		// entry hook; leave that function uninstrumented rather than edit the literal.
		if (functionName && braces > 0 && !lexState.rawString && !lexState.blockComment) {
			const bodyIndent = `${indent}\t`;
			instrumented.push(
				`${bodyIndent}__wasmIdleDebugEnter(${JSON.stringify(functionName)}, ${lineNumber})`,
				`${bodyIndent}defer __wasmIdleDebugLeave()`
			);
			functionStack.push({ depth: braceDepth + braces, name: functionName });
		}

		braceDepth += braces;
		while (
			functionStack.length &&
			braceDepth < functionStack[functionStack.length - 1]!.depth
		) {
			functionStack.pop();
		}
	}

	return instrumented.join('\n');
}

export function instrumentGoDebugSource(source: string) {
	if (source.includes('__wasmIdleDebugLine')) return source;
	// Declarations may follow user code; placing them here keeps every user import
	// ahead of declarations, including a second import block.
	return `${insertDebugImports(instrumentFunctionLines(source))}\n\n${debugSupportSource.trim()}\n`;
}
