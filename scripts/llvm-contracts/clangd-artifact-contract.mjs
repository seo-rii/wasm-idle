// Adapted from wasm-llvm clang-browser at e88868c; consumer-owned contract.
import { parse } from 'acorn';

const textDecoder = new TextDecoder();

// Emscripten emits these objects with ordinary identifier/string keys and
// identifier values. Reject ambiguous or dynamic mappings instead of evaluating
// artifact JavaScript or accepting an unrelated occurrence of the import name.
/** @param {any} object @returns {Map<string, string> | null} */
function importBindings(object) {
	if (object?.type !== 'ObjectExpression') return null;
	const bindings = new Map();
	for (const property of object.properties) {
		if (
			property.type !== 'Property' ||
			property.computed ||
			property.method ||
			property.kind !== 'init' ||
			property.value.type !== 'Identifier'
		)
			return null;
		const key =
			property.key.type === 'Identifier'
				? property.key.name
				: property.key.type === 'Literal' && typeof property.key.value === 'string'
					? property.key.value
					: null;
		if (key === null || bindings.has(key)) return null;
		bindings.set(key, property.value.name);
	}
	return bindings;
}

/** @param {any} node @param {string} object @param {string} property */
function isMember(node, object, property) {
	return (
		node?.type === 'MemberExpression' &&
		node.object?.type === 'Identifier' &&
		node.object.name === object &&
		((!node.computed &&
			node.property?.type === 'Identifier' &&
			node.property.name === property) ||
			(node.computed &&
				node.property?.type === 'Literal' &&
				node.property.value === property))
	);
}

/** @param {any} node @param {string} name */
const isCall = (node, name) =>
	node?.type === 'CallExpression' &&
	node.callee?.type === 'Identifier' &&
	node.callee.name === name;

/** @param {any} node @param {(node: any) => boolean} predicate @returns {boolean} */
function containsNode(node, predicate) {
	if (!node || typeof node !== 'object') return false;
	if (predicate(node)) return true;
	return Object.values(node).some((value) =>
		Array.isArray(value)
			? value.some((entry) => containsNode(entry, predicate))
			: containsNode(value, predicate)
	);
}

/** @param {any} callback */
function isStdinCallback(callback) {
	const statements = callback?.body?.body;
	if (statements?.length !== 1 || statements[0].type !== 'ReturnStatement') return false;
	const handler = statements[0].argument;
	if (
		handler?.type !== 'CallExpression' ||
		!isMember(handler.callee, 'Asyncify', 'handleAsync') ||
		handler.arguments.length !== 1
	)
		return false;
	const operation = handler.arguments[0];
	if (operation.type !== 'ArrowFunctionExpression' || !operation.async) return false;
	const expression =
		operation.body.type === 'BlockStatement' &&
		operation.body.body.length === 1 &&
		operation.body.body[0].type === 'ExpressionStatement'
			? operation.body.body[0].expression
			: operation.body;
	return (
		expression?.type === 'AwaitExpression' &&
		expression.argument?.type === 'CallExpression' &&
		isMember(expression.argument.callee, 'Module', 'stdinReady') &&
		expression.argument.arguments.length === 0
	);
}

/** @param {any[]} statements @param {string} name */
const directFunctions = (statements, name) =>
	statements.filter((node) => node.type === 'FunctionDeclaration' && node.id?.name === name);

/** @param {any[]} statements @param {string} name @returns {any[]} */
const directVariables = (statements, name) =>
	statements.flatMap((statement) =>
		statement.type === 'VariableDeclaration'
			? statement.declarations.filter(
					/** @param {any} declaration */
					(declaration) =>
						declaration.id.type === 'Identifier' && declaration.id.name === name
				)
			: []
	);

/** @param {any} create */
function usesImportMapForInstantiation(create) {
	const statements = create?.body?.body;
	if (!Array.isArray(statements)) return false;
	const infoBindings = directVariables(statements, 'info');
	if (
		infoBindings.length !== 1 ||
		!isCall(infoBindings[0].init, 'getWasmImports') ||
		infoBindings[0].init.arguments.length !== 0
	)
		return false;
	const customInstantiation = statements.some(
		(statement) =>
			statement.type === 'IfStatement' &&
			isMember(statement.test, 'Module', 'instantiateWasm') &&
			containsNode(
				statement.consequent,
				(node) =>
					node.type === 'CallExpression' &&
					isMember(node.callee, 'Module', 'instantiateWasm') &&
					node.arguments[0]?.type === 'Identifier' &&
					node.arguments[0].name === 'info'
			)
	);
	const asyncInstantiation = statements.some((statement) => {
		/** @type {any[]} */
		const expressions =
			statement.type === 'VariableDeclaration'
				? statement.declarations.map(
						/** @param {any} declaration */
						(declaration) => declaration.init
					)
				: statement.type === 'ReturnStatement'
					? [statement.argument]
					: [];
		return expressions.some((expression) => {
			const call = expression?.type === 'AwaitExpression' ? expression.argument : expression;
			return (
				isCall(call, 'instantiateAsync') &&
				call.arguments[2]?.type === 'Identifier' &&
				call.arguments[2].name === 'info'
			);
		});
	});
	return customInstantiation && asyncInstantiation;
}

/** @param {any[]} statements */
function minifiedStdinImport(statements) {
	const functionNames = [
		'__asyncjs__waitForStdin',
		'assignWasmImports',
		'getWasmImports',
		'createWasm'
	];
	const functions = new Map(
		functionNames.map((name) => [name, directFunctions(statements, name)])
	);
	if ([...functions.values()].some((declarations) => declarations.length !== 1)) return null;
	const callback = functions.get('__asyncjs__waitForStdin')?.[0];
	const assignFunction = functions.get('assignWasmImports')?.[0];
	const getFunction = functions.get('getWasmImports')?.[0];
	const create = functions.get('createWasm')?.[0];
	if (!callback || !assignFunction || !getFunction || !create || !isStdinCallback(callback))
		return null;
	if (
		!create.async ||
		!statements.some(
			(statement) =>
				statement.type === 'IfStatement' &&
				statement.test?.type === 'UnaryExpression' &&
				statement.test.operator === '!' &&
				statement.test.argument?.type === 'Identifier' &&
				statement.test.argument.name === 'ENVIRONMENT_IS_PTHREAD' &&
				containsNode(
					statement.consequent,
					(node) => isCall(node, 'createWasm') && node.arguments.length === 0
				)
		)
	)
		return null;
	const wasmImports = directVariables(statements, 'wasmImports');
	if (wasmImports.length !== 1 || wasmImports[0].init != null) return null;

	const assign = assignFunction.body.body;
	const get = getFunction.body.body;
	// Pinned Emscripten 6 emits one table assignment and a three-statement
	// namespace wrapper: assignWasmImports(); var imports = {...}; return imports.
	if (assign?.length !== 1 || get?.length !== 3) return null;
	const assignment = assign[0].expression;
	if (
		assign[0].type !== 'ExpressionStatement' ||
		assignment?.type !== 'AssignmentExpression' ||
		assignment.operator !== '=' ||
		assignment.left.type !== 'Identifier' ||
		assignment.left.name !== 'wasmImports'
	)
		return null;
	const call = get[0].expression;
	if (
		get[0].type !== 'ExpressionStatement' ||
		call?.type !== 'CallExpression' ||
		call.callee.type !== 'Identifier' ||
		call.callee.name !== 'assignWasmImports' ||
		call.arguments.length !== 0
	)
		return null;
	const declaration = get[1];
	if (declaration.type !== 'VariableDeclaration' || declaration.declarations.length !== 1)
		return null;
	const imports = declaration.declarations[0];
	if (
		imports.id.type !== 'Identifier' ||
		imports.id.name !== 'imports' ||
		get[2].type !== 'ReturnStatement' ||
		get[2].argument?.type !== 'Identifier' ||
		get[2].argument.name !== 'imports'
	)
		return null;
	const table = importBindings(assignment.right);
	const namespaces = importBindings(imports.init);
	if (!table || !namespaces) return null;
	const names = [...table].filter(([, value]) => value === '__asyncjs__waitForStdin');
	const modules = [...namespaces].filter(([, value]) => value === 'wasmImports');
	if (names.length !== 1 || modules.length !== 1 || !usesImportMapForInstantiation(create))
		return null;
	return { module: modules[0][0], name: names[0][0] };
}

/** @param {string} jsSource */
function inspectLoader(jsSource) {
	const tree = parse(jsSource, { ecmaVersion: 'latest', sourceType: 'module' });
	const moduleFunctions = directFunctions(tree.body, 'Module');
	if (moduleFunctions.length > 1) return { hasCallback: false, mapped: null };
	const scopes = [moduleFunctions.length === 1 ? moduleFunctions[0].body.body : tree.body];
	const callbacks = scopes.flatMap((statements) =>
		directFunctions(statements, '__asyncjs__waitForStdin').filter(isStdinCallback)
	);
	const mappings = scopes
		.map((statements) => minifiedStdinImport(statements))
		.filter((mapping) => mapping !== null);
	return {
		hasCallback: callbacks.length === 1,
		mapped: mappings.length === 1 ? mappings[0] : null
	};
}

/** @param {string | Uint8Array} jsBytes @param {Uint8Array<ArrayBuffer>} wasmBytes */
export async function assertClangdStdinBridge(jsBytes, wasmBytes) {
	const jsSource = typeof jsBytes === 'string' ? jsBytes : textDecoder.decode(jsBytes);
	const loader = inspectLoader(jsSource);
	if (!loader.hasCallback) {
		throw new Error('clangd.js is missing the browser stdin readiness callback');
	}

	const wasmModule = await WebAssembly.compile(wasmBytes);
	const imports = WebAssembly.Module.imports(wasmModule);
	let hasStdinImport = imports.some(
		(entry) => entry.kind === 'function' && entry.name === '__asyncjs__waitForStdin'
	);
	if (!hasStdinImport) {
		const mapped = loader.mapped;
		hasStdinImport =
			mapped !== null &&
			imports.some(
				(entry) =>
					entry.kind === 'function' &&
					entry.module === mapped.module &&
					entry.name === mapped.name
			);
	}
	if (!hasStdinImport) {
		throw new Error('clangd.wasm is missing the Asyncify stdin import');
	}
}
