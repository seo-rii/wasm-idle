import { parser } from '@lezer/rust';

export const RUST_DEBUG_MARKER = '__WASM_IDLE_RUST_DEBUG__';

interface SyntaxNode {
	type: { name: string };
	from: number;
	to: number;
	firstChild: SyntaxNode | null;
	nextSibling: SyntaxNode | null;
	name?: string;
}

const instrumentableBlockChildren = new Set([
	'LetDeclaration',
	'ExpressionStatement',
	'MacroInvocation'
]);

interface Insertion {
	offset: number;
	text: string;
}

function lineStartsFor(source: string) {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source.charCodeAt(index) === 10) starts.push(index + 1);
	}
	return starts;
}

function lineNumberAt(lineStarts: number[], offset: number) {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lineStarts[mid] <= offset) low = mid + 1;
		else high = mid - 1;
	}
	return Math.max(1, high + 1);
}

function functionNameFor(node: SyntaxNode) {
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.type.name === 'BoundIdentifier') {
			return child.name ? child.name : 'fn';
		}
	}
	return 'fn';
}

function sourceText(source: string, node: SyntaxNode) {
	return source.slice(node.from, node.to);
}

function directFunctionName(source: string, node: SyntaxNode) {
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.type.name === 'BoundIdentifier') {
			return sourceText(source, child) || 'fn';
		}
	}
	return functionNameFor(node);
}

export function instrumentRustDebugSource(source: string) {
	const tree = parser.parse(source);
	const lineStarts = lineStartsFor(source);
	const insertions: Insertion[] = [];

	const visit = (node: SyntaxNode, currentFunction: string) => {
		const nextFunction =
			node.type.name === 'FunctionItem' ? directFunctionName(source, node) : currentFunction;

		if (node.type.name === 'Block') {
			for (let child = node.firstChild; child; child = child.nextSibling) {
				if (!instrumentableBlockChildren.has(child.type.name)) continue;
				const line = lineNumberAt(lineStarts, child.from);
				insertions.push({
					offset: child.from,
					text: `eprintln!("${RUST_DEBUG_MARKER}:{}:{}", ${line}, ${JSON.stringify(nextFunction)}); `
				});
			}
		}

		for (let child = node.firstChild; child; child = child.nextSibling) {
			visit(child, nextFunction);
		}
	};

	visit(tree.topNode, 'main');
	if (!insertions.length) return source;

	let output = source;
	for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
		output = `${output.slice(0, insertion.offset)}${insertion.text}${output.slice(insertion.offset)}`;
	}
	return output;
}
