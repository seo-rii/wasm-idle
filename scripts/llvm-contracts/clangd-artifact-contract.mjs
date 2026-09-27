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

/** @param {string} jsSource */
function minifiedStdinImport(jsSource) {
	const tree = parse(jsSource, { ecmaVersion: 'latest', sourceType: 'module' });
	const functions = new Map();
	/** @type {any[]} */
	const pending = [tree];
	while (pending.length) {
		const node = pending.pop();
		if (!node || typeof node !== 'object') continue;
		if (
			node.type === 'FunctionDeclaration' &&
			['assignWasmImports', 'getWasmImports'].includes(node.id?.name)
		) {
			if (functions.has(node.id.name)) return null;
			functions.set(node.id.name, node);
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) pending.push(...value);
			else if (value && typeof value === 'object') pending.push(value);
		}
	}

	const assign = functions.get('assignWasmImports')?.body.body;
	const get = functions.get('getWasmImports')?.body.body;
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
	if (names.length !== 1 || modules.length !== 1) return null;
	return { module: modules[0][0], name: names[0][0] };
}

/** @param {string | Uint8Array} jsBytes @param {Uint8Array<ArrayBuffer>} wasmBytes */
export async function assertClangdStdinBridge(jsBytes, wasmBytes) {
	const jsSource = typeof jsBytes === 'string' ? jsBytes : textDecoder.decode(jsBytes);
	if (!jsSource.includes('Module.stdinReady')) {
		throw new Error('clangd.js is missing the browser stdin readiness callback');
	}

	const wasmModule = await WebAssembly.compile(wasmBytes);
	const imports = WebAssembly.Module.imports(wasmModule);
	let hasStdinImport = imports.some(
		(entry) => entry.kind === 'function' && entry.name === '__asyncjs__waitForStdin'
	);
	if (!hasStdinImport) {
		const mapped = minifiedStdinImport(jsSource);
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
