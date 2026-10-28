import { parse, type CstNode, type IToken } from 'java-parser';

export interface JavaDebugLocation {
	line: number;
	column: number;
}

interface JavaDebugBinding {
	name: string;
	type: string;
	context: CstNode;
	scope: CstNode;
	availableFrom: number;
}

const executableContexts = new Set([
	'methodDeclaration',
	'interfaceMethodDeclaration',
	'constructorDeclaration',
	'compactConstructorDeclaration',
	'lambdaExpression',
	'staticInitializer',
	'instanceInitializer'
]);

function nodes(node: CstNode, name?: string): CstNode[] {
	return Object.values(name ? { [name]: node.children[name] ?? [] } : node.children)
		.flat()
		.filter((child) => 'children' in child);
}

function firstNode(node: CstNode, name: string): CstNode | undefined {
	return nodes(node, name)[0];
}

function firstToken(node: CstNode, name: string): IToken | undefined {
	const child = node.children[name]?.[0];
	return child && !('children' in child) ? child : undefined;
}

/** Bindings are deliberately conservative: javac remains the definite-assignment authority. */
function collectDebugBindings(tree: CstNode, source: string) {
	const parents = new Map<CstNode, CstNode>();
	const allNodes: CstNode[] = [];
	const index = (node: CstNode) => {
		allNodes.push(node);
		for (const child of nodes(node)) {
			parents.set(child, node);
			index(child);
		}
	};
	index(tree);
	const text = (node?: CstNode) =>
		node ? source.slice(node.location.startOffset, node.location.endOffset + 1) : '';
	const nearest = (node: CstNode | undefined, predicate: (value: CstNode) => boolean) => {
		for (let current = node; current; current = parents.get(current)) {
			if (predicate(current)) return current;
		}
		return undefined;
	};
	const classBodies = new Set(['classBody', 'interfaceBody', 'enumBody', 'recordBody']);
	const contextOf = (node: CstNode) => {
		for (let current: CstNode | undefined = node; current; current = parents.get(current)) {
			if (executableContexts.has(current.name)) return current;
			// Field initializers in local/anonymous classes must not start capturing
			// otherwise-unused, potentially mutable locals from the surrounding method.
			if (classBodies.has(current.name)) return undefined;
		}
		return undefined;
	};
	const descendants = (node: CstNode, names: Set<string>): CstNode[] =>
		names.has(node.name) ? [node] : nodes(node).flatMap((child) => descendants(child, names));
	const hasModifier = (node: CstNode, modifier: string) =>
		Object.entries(node.children).some(
			([name, children]) =>
				name.endsWith('Modifier') &&
				children.some(
					(child) => 'children' in child && firstToken(child, modifier) !== undefined
				)
		);
	// The upstream grammar can interpret an empty record body as a method whose
	// return type is the restricted identifier `record`. Such a body is not code.
	const recordLikeMethods = new Set(
		allNodes.filter(
			(node) =>
				node.name === 'methodDeclaration' &&
				text(firstNode(firstNode(node, 'methodHeader')!, 'result')).trim() === 'record'
		)
	);
	const typeNodes = new Set([
		'normalClassDeclaration',
		'normalInterfaceDeclaration',
		'enumDeclaration',
		'recordDeclaration'
	]);
	const bindings: JavaDebugBinding[] = [];
	const add = (
		declaration: CstNode,
		type: string,
		context: CstNode,
		scope: CstNode,
		availableFrom = scope.location.startOffset
	) => {
		const id = firstNode(declaration, 'variableDeclaratorId');
		const name = firstToken(id ?? declaration, 'Identifier')?.image;
		if (!name || name === '_') return;
		bindings.push({
			name,
			type: type + text(id ? firstNode(id, 'dims') : undefined),
			context,
			scope,
			availableFrom
		});
	};
	for (const context of allNodes.filter((node) => executableContexts.has(node.name))) {
		if (recordLikeMethods.has(context)) continue;
		let parameterRoot: CstNode | undefined;
		let scope: CstNode | undefined;
		if (context.name === 'methodDeclaration' || context.name === 'interfaceMethodDeclaration') {
			const header = firstNode(context, 'methodHeader');
			parameterRoot = header ? firstNode(header, 'methodDeclarator') : undefined;
			scope = firstNode(context, 'methodBody');
		} else if (context.name === 'constructorDeclaration') {
			parameterRoot = firstNode(context, 'constructorDeclarator');
			scope = firstNode(context, 'constructorBody');
		} else if (context.name === 'compactConstructorDeclaration') {
			const record = nearest(
				parents.get(context),
				(node) => node.name === 'recordDeclaration'
			);
			parameterRoot = record ? firstNode(record, 'recordHeader') : undefined;
			scope = firstNode(context, 'constructorBody');
		} else if (context.name === 'lambdaExpression') {
			parameterRoot = firstNode(context, 'lambdaParameters');
			scope = firstNode(context, 'lambdaBody');
		} else scope = firstNode(context, 'block');
		if (!scope) continue;
		if (parameterRoot) {
			const parameterNames = new Set([
				'variableParaRegularParameter',
				'variableArityParameter',
				'regularLambdaParameter',
				'conciseLambdaParameter',
				'recordComponent'
			]);
			for (const parameter of descendants(parameterRoot, parameterNames)) {
				const type = text(
					firstNode(parameter, 'unannType') ?? firstNode(parameter, 'lambdaParameterType')
				);
				add(
					parameter,
					(type || 'var') + (parameter.children.DotDotDot ? '[]' : ''),
					context,
					scope
				);
			}
			if (context.name === 'lambdaExpression' && parameterRoot.children.Identifier)
				add(parameterRoot, 'var', context, scope);
		}
		// Adding a new lexical `this` use to a lambda changes what it captures.
		// Own methods/constructors and instance initializers already have a receiver.
		if (
			context.name !== 'lambdaExpression' &&
			context.name !== 'staticInitializer' &&
			!hasModifier(context, 'Static')
		) {
			const ownerBody = nearest(parents.get(context), (node) => classBodies.has(node.name));
			const owner = ownerBody ? parents.get(ownerBody) : undefined;
			const type =
				owner && typeNodes.has(owner.name)
					? text(firstNode(owner, 'typeIdentifier'))
					: 'this';
			bindings.push({
				name: 'this',
				type,
				context,
				scope,
				availableFrom:
					(firstNode(scope, 'explicitConstructorInvocation')?.location.endOffset ??
						scope.location.startOffset - 1) + 1
			});
		}
	}
	for (const node of allNodes) {
		const context = contextOf(node);
		if (!context || recordLikeMethods.has(context)) continue;
		const parent = parents.get(node);
		if (node.name === 'catchFormalParameter' && parent?.name === 'catchClause') {
			const scope = firstNode(parent, 'block');
			if (scope) add(node, text(firstNode(node, 'catchType')), context, scope);
			continue;
		}
		if (node.name !== 'localVariableDeclaration') continue;
		let scope: CstNode | undefined;
		let from: number;
		let initialized = false;
		if (parent?.name === 'enhancedForStatement') {
			scope = firstNode(parent, 'statement');
			initialized = true;
		} else if (parent?.name === 'forInit') {
			const loop = parents.get(parent);
			scope = loop ? firstNode(loop, 'statement') : undefined;
		} else if (parent?.name === 'resource') {
			const resourceTry = nearest(
				parent,
				(ancestor) => ancestor.name === 'tryWithResourcesStatement'
			);
			scope = resourceTry ? firstNode(resourceTry, 'block') : undefined;
		} else if (parent?.name === 'localVariableDeclarationStatement') {
			scope = nearest(parent, (ancestor) =>
				['block', 'constructorBody', 'switchBlockStatementGroup'].includes(ancestor.name)
			);
		} else continue; // Pattern variables require flow-sensitive scope analysis.
		if (!scope) continue;
		from = Math.max(scope.location.startOffset, node.location.endOffset + 1);
		const list = firstNode(node, 'variableDeclaratorList');
		const type = text(firstNode(node, 'localVariableType'));
		for (const declaration of list ? nodes(list, 'variableDeclarator') : []) {
			if (initialized || declaration.children.variableInitializer)
				add(declaration, type, context, scope, from);
		}
	}
	return {
		recordLikeMethods,
		at(node: CstNode, offset: number) {
			const context = contextOf(node);
			return bindings.filter(
				(binding) =>
					binding.context === context &&
					offset >= binding.availableFrom &&
					offset >= binding.scope.location.startOffset &&
					offset <= binding.scope.location.endOffset
			);
		}
	};
}

const singleStatementBodies = new Set([
	'ifStatement',
	'whileStatement',
	'doStatement',
	'basicForStatement',
	'enhancedForStatement'
]);

/** javac compiles these direct reads; inspection never uses reflection or bean accessors. */
function instrumentDebugFields(
	tree: CstNode,
	source: string,
	bridgeClass: string,
	insert: (offset: number, text: string) => void
) {
	const prefix = `${bridgeClass.split('.').at(-1)}_`;
	// The worker selects a nonce absent from every source. Keep direct callers safe too.
	if (source.includes(prefix)) return;
	const text = (node?: CstNode) =>
		node ? source.slice(node.location.startOffset, node.location.endOffset + 1) : '';
	const visit = (node: CstNode) => {
		if (node.name === 'normalClassDeclaration') {
			const body = firstNode(node, 'classBody')!;
			const fields = nodes(body, 'classBodyDeclaration').flatMap((declaration) => {
				const member = firstNode(declaration, 'classMemberDeclaration');
				const field = member && firstNode(member, 'fieldDeclaration');
				if (
					!field ||
					nodes(field, 'fieldModifier').some((modifier) => firstToken(modifier, 'Static'))
				)
					return [];
				const type = text(firstNode(field, 'unannType'));
				const list = firstNode(field, 'variableDeclaratorList')!;
				return nodes(list, 'variableDeclarator').flatMap((variable) => {
					const id = firstNode(variable, 'variableDeclaratorId')!;
					const name = firstToken(id, 'Identifier')?.image;
					return name && name !== '_'
						? [{ name, type: type + text(firstNode(id, 'dims')) }]
						: [];
				});
			});
			if (fields.length) {
				const interfaces = firstNode(node, 'classImplements');
				const before = firstNode(node, 'classPermits') ?? body;
				insert(
					interfaces ? interfaces.location.endOffset + 1 : before.location.startOffset,
					`${interfaces ? ',' : ' implements '}${bridgeClass}.Inspectable `
				);
				const cases = fields
					.slice(0, 256)
					.map(
						(field, index) =>
							`case ${index}:return new ${bridgeClass}.Field(${JSON.stringify(field.name)},${JSON.stringify(field.type)},this.${field.name});`
					);
				if (fields.length > 256)
					cases.push(
						`case 256:return new ${bridgeClass}.Field("[remaining fields]","unavailable","${fields.length - 256} fields omitted (256-field inspection limit)");`
					);
				const name = text(firstNode(node, 'typeIdentifier'));
				insert(
					firstToken(body, 'RCurly')!.startOffset,
					`public java.lang.Class<?> ${prefix}fieldOwner(){return ${name}.class;}` +
						`public int ${prefix}fieldCount(){return ${Math.min(fields.length, 257)};}` +
						`public ${bridgeClass}.Field ${prefix}field(int index){switch(index){${cases.join('')}default:throw new java.lang.IndexOutOfBoundsException();}}`
				);
			}
		}
		for (const child of nodes(node)) visit(child);
	};
	visit(tree);
}

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
	const captures = collectDebugBindings(tree, source);
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
	const hook = (node: CstNode, offset: number) => {
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
		const bindings = captures.at(node, offset);
		const position = `${JSON.stringify(sourcePath)},${location.line},${location.column}`;
		const names = bindings.map((binding) => JSON.stringify(binding.name)).join(',');
		const types = bindings.map((binding) => JSON.stringify(binding.type)).join(',');
		const values = bindings
			.map((binding) => `${bridgeClass}.capture(${binding.name})`)
			.join(',');
		// Only a requested stop allocates/boxes values. Reading an object reference
		// invokes no getters, reflection, or user-defined string conversion.
		return `if(${bridgeClass}.poll(${position}))${bridgeClass}.hit(${position},new java.lang.String[]{${names}},new java.lang.String[]{${types}},new java.lang.Object[]{${values}});`;
	};
	const blockEntry = (node: CstNode, offset?: number) => {
		const opening = node.children.LCurly?.[0] as IToken | undefined;
		if (!opening)
			throw new Error('Java Debug parser returned a block without its opening token');
		const position = offset ?? opening.endOffset + 1;
		insert(position, hook(node, position));
	};
	const visit = (node: CstNode, ancestors: CstNode[]) => {
		if (captures.recordLikeMethods.has(node)) return;
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
			insert(node.location.startOffset, hook(node, node.location.startOffset));
		} else if (node.name === 'statement' && singleStatementBodies.has(parent?.name ?? '')) {
			const withoutTrailing = node.children.statementWithoutTrailingSubstatement?.[0] as
				CstNode | undefined;
			const block = withoutTrailing?.children.block?.[0] as CstNode | undefined;
			if (block) blockEntry(block);
			else {
				// Preserve dangling else and one-statement loop bodies. Never wrap a
				// labeledStatement's child: continue label requires the original loop.
				insert(node.location.startOffset, `{${hook(node, node.location.startOffset)}`);
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
					`{${hook(body, body.location.startOffset)}${expression && isExpression ? 'yield ' : ''}`
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
	instrumentDebugFields(tree, source, bridgeClass, insert);
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
