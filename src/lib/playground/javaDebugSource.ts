import { parse, type CstNode, type IToken } from 'java-parser';

export interface JavaDebugLocation {
	line: number;
	column: number;
}

const singleStatementBodies = new Set([
	'ifStatement',
	'whileStatement',
	'doStatement',
	'basicForStatement',
	'enhancedForStatement'
]);

/** Add statement callbacks using the upstream Java CST; javac/TeaVM still execute the program. */
export function instrumentJavaDebugSource(source: string, sourcePath: string, bridgeClass: string) {
	if (
		bridgeClass.trim() !== bridgeClass ||
		!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(bridgeClass)
	)
		throw new Error('Invalid Java debugger helper name');
	if (/[\u0000-\u001f\u007f]/.test(sourcePath))
		throw new Error('Unsupported Java debug source path');
	// javac preprocesses these even inside comments. The CST must describe the same
	// tokens as the compiler, so never transform a source requiring that preprocessing.
	if (/\\u+[0-9a-fA-F]{4}/.test(source))
		throw new Error(
			'Java Debug does not support Unicode preprocessing escapes; use Run for this source.'
		);
	let tree: CstNode;
	try {
		tree = parse(source);
	} catch (error) {
		throw new Error(
			`Java Debug parser cannot safely instrument this syntax; use Run for this source. ${error instanceof Error ? error.message : String(error)}`
		);
	}
	const lineStarts = [0];
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '\r') {
			if (source[index + 1] === '\n') index++;
			lineStarts.push(index + 1);
		} else if (source[index] === '\n') lineStarts.push(index + 1);
	}
	const locations: JavaDebugLocation[] = [];
	const hookOffsets = new Set<number>();
	const insertions = new Map<number, Array<{ text: string; closing: boolean }>>();
	const insert = (offset: number, text: string, closing = false) => {
		const atOffset = insertions.get(offset) ?? [];
		atOffset.push({ text, closing });
		insertions.set(offset, atOffset);
	};
	const hook = (offset: number) => {
		if (hookOffsets.has(offset)) return '';
		hookOffsets.add(offset);
		let low = 0;
		let high = lineStarts.length;
		while (low + 1 < high) {
			const middle = (low + high) >>> 1;
			if (lineStarts[middle] <= offset) low = middle;
			else high = middle;
		}
		const location = { line: low + 1, column: offset - lineStarts[low] + 1 };
		locations.push(location);
		return `${bridgeClass}.hit(${JSON.stringify(sourcePath)},${location.line},${location.column});`;
	};
	const blockEntry = (node: CstNode, offset?: number) => {
		const opening = node.children.LCurly?.[0] as IToken | undefined;
		if (!opening)
			throw new Error('Java Debug parser returned a block without its opening token');
		const position = offset ?? opening.endOffset + 1;
		insert(position, hook(position));
	};
	const visit = (node: CstNode, ancestors: CstNode[]) => {
		const parent = ancestors[ancestors.length - 1];
		if (node.name === 'constructorBody') {
			const invocation = node.children.explicitConstructorInvocation?.[0] as
				CstNode | undefined;
			// this()/super() must remain the first constructor statement.
			blockEntry(node, invocation ? invocation.location.endOffset + 1 : undefined);
		} else if (
			node.name === 'block' &&
			(parent?.name === 'methodBody' ||
				parent?.name === 'lambdaBody' ||
				parent?.name === 'switchRule')
		) {
			blockEntry(node);
		} else if (
			node.name === 'blockStatement' &&
			(node.children.statement || node.children.localVariableDeclarationStatement)
		) {
			insert(node.location.startOffset, hook(node.location.startOffset));
		} else if (node.name === 'statement' && singleStatementBodies.has(parent?.name ?? '')) {
			const withoutTrailing = node.children.statementWithoutTrailingSubstatement?.[0] as
				CstNode | undefined;
			const block = withoutTrailing?.children.block?.[0] as CstNode | undefined;
			if (block) blockEntry(block);
			else {
				// Preserve dangling else and one-statement loop bodies. Never wrap a
				// labeledStatement's child: continue label requires the original loop.
				insert(node.location.startOffset, `{${hook(node.location.startOffset)}`);
				insert(node.location.endOffset + 1, '}', true);
			}
		} else if (node.name === 'switchRule') {
			const expression = node.children.expression?.[0] as CstNode | undefined;
			const thrown = node.children.throwStatement?.[0] as CstNode | undefined;
			const body = expression ?? thrown;
			if (body) {
				const switchIndex = ancestors.findLastIndex(
					(ancestor) => ancestor.name === 'switchStatement'
				);
				// java-parser represents switch expressions with the same rule as
				// statements, under primaryPrefix. Keep their result and target type.
				const isExpression = ancestors[switchIndex - 1]?.name === 'primaryPrefix';
				insert(
					body.location.startOffset,
					`{${hook(body.location.startOffset)}${expression && isExpression ? 'yield ' : ''}`
				);
				insert(node.location.endOffset + 1, '}', true);
			}
		}
		for (const children of Object.values(node.children)) {
			for (const child of children) {
				if ('children' in child) visit(child, [...ancestors, node]);
			}
		}
	};
	visit(tree, []);
	let code = source;
	for (const [offset, additions] of [...insertions].sort(([left], [right]) => right - left)) {
		// A wrapped body's closing brace must precede a following statement's
		// callback, including adjacent statements with no intervening whitespace.
		const text = additions
			.sort((left, right) => Number(right.closing) - Number(left.closing))
			.map((addition) => addition.text)
			.join('');
		code = code.slice(0, offset) + text + code.slice(offset);
	}
	return { code, locations };
}
