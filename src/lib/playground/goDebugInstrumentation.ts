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

function countNesting(line: string) {
	const source = stripLineComment(line);
	let quote = '';
	let escaped = false;
	let braces = 0;
	let parens = 0;
	let brackets = 0;
	for (const character of source) {
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
		if (character === '{') braces += 1;
		else if (character === '}') braces -= 1;
		else if (character === '(') parens += 1;
		else if (character === ')') parens -= 1;
		else if (character === '[') brackets += 1;
		else if (character === ']') brackets -= 1;
	}
	return { braces, parens, brackets };
}

function functionNameFromLine(line: string) {
	const source = stripLineComment(line).trim();
	const match = source.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
	return match?.[1] || null;
}

function shouldInstrumentLine(line: string, parenDepth: number, bracketDepth: number) {
	if (parenDepth > 0 || bracketDepth > 0) return false;
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
	let braceDepth = 0;
	let parenDepth = 0;
	let bracketDepth = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] || '';
		const lineNumber = index + 1;
		const functionName = functionNameFromLine(line);
		const inFunction = functionStack.length > 0;
		const indent = line.match(/^\s*/)?.[0] || '';

		if (inFunction && shouldInstrumentLine(line, parenDepth, bracketDepth)) {
			instrumented.push(`${indent}__wasmIdleDebugLine(${lineNumber})`);
		}
		instrumented.push(line);

		const nesting = countNesting(line);
		const nextBraceDepth = braceDepth + nesting.braces;
		const nextParenDepth = Math.max(0, parenDepth + nesting.parens);
		const nextBracketDepth = Math.max(0, bracketDepth + nesting.brackets);

		if (functionName && nesting.braces > 0) {
			const bodyIndent = `${indent}\t`;
			instrumented.push(
				`${bodyIndent}__wasmIdleDebugEnter(${JSON.stringify(functionName)}, ${lineNumber})`,
				`${bodyIndent}defer __wasmIdleDebugLeave()`
			);
			functionStack.push({ depth: nextBraceDepth, name: functionName });
		}

		braceDepth = nextBraceDepth;
		parenDepth = nextParenDepth;
		bracketDepth = nextBracketDepth;
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
