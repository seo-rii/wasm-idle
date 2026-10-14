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

// '{' is a brace that holds no statements: a composite literal or a struct/interface body.
type Frame = '(' | '[' | '{' | 'block';

function endsStatement(token: string) {
	return statementEndTokens.has(token) || (/^[\p{L}_]/u.test(token) && !goKeywords.has(token));
}

function lineTokens(line: string, state: LexState) {
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
	const packageIndex = lines.findIndex((line) => /^\s*package\s+\w+/.test(line));
	if (packageIndex === -1) return source;
	const importStart = lines.findIndex(
		(line, index) => index > packageIndex && /^\s*import\b/.test(line)
	);
	if (importStart === -1) {
		lines.splice(
			packageIndex + 1,
			0,
			'',
			'import (',
			...debugImports.map((entry) => `\t${entry}`),
			')'
		);
		return lines.join('\n');
	}

	const importLine = lines[importStart] || '';
	if (/^\s*import\s*\(/.test(importLine)) {
		let importEnd = importStart + 1;
		for (; importEnd < lines.length; importEnd += 1) {
			if (/^\s*\)/.test(lines[importEnd] || '')) break;
		}
		lines.splice(importEnd, 0, ...debugImports.map((entry) => `\t${entry}`));
		return lines.join('\n');
	}

	const singleImport = importLine.replace(/^\s*import\s+/, '').trim();
	lines.splice(
		importStart,
		1,
		'import (',
		`\t${singleImport}`,
		...debugImports.map((entry) => `\t${entry}`),
		')'
	);
	return lines.join('\n');
}

function insertDebugSupport(source: string) {
	const lines = source.split('\n');
	let insertIndex = lines.findIndex((line) => /^\s*import\b/.test(line));
	if (insertIndex === -1) {
		insertIndex = lines.findIndex((line) => /^\s*package\s+\w+/.test(line));
		if (insertIndex === -1) return source;
		insertIndex += 1;
	} else if (/^\s*import\s*\(/.test(lines[insertIndex] || '')) {
		for (; insertIndex < lines.length; insertIndex += 1) {
			if (/^\s*\)/.test(lines[insertIndex] || '')) {
				insertIndex += 1;
				break;
			}
		}
	} else {
		insertIndex += 1;
	}
	lines.splice(insertIndex, 0, debugSupportSource.trim());
	return lines.join('\n');
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
				frames.pop();
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
				} else if (
					previousToken !== 'struct' &&
					previousToken !== 'interface' &&
					(['else', 'for', 'switch', 'select'].includes(previousToken) ||
						(headerDepth === depth && tokenIndex === tokens.length - 1) ||
						([';', '{', ':'].includes(previousToken) &&
							(frames.at(-1) ?? 'block') === 'block'))
				) {
					// Go ends an if/for/switch header at the `{` that closes its line; any other
					// `{` after an operand (`P{`, `[]int{`, `struct {`) opens a literal or type body.
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

		if (functionName && braces > 0) {
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
	return insertDebugSupport(insertDebugImports(instrumentFunctionLines(source)));
}
