import path from 'node:path';

// Keep root and public subpath imports on the same source modules, preserving
// stateful service identities without exposing private package entry points.
const publicSourceModules = {
	'@wasm-idle/core': 'index',
	'@wasm-idle/core/runtime-wasm-module-service': 'runtime-wasm-module-service',
	'@wasm-idle/core/runtime-asset-loader': 'runtime-asset-loader',
	'@wasm-idle/core/runtime-tar': 'runtime-tar',
	'@wasm-idle/core/runtime-encode': 'runtime-encode'
};

/** @param {string} root */
export function createCoreSourceAliasMap(root) {
	return Object.fromEntries(
		Object.entries(publicSourceModules).map(([specifier, name]) => [
			specifier,
			path.join(root, 'packages/core/src', `${name}.ts`)
		])
	);
}

/** @param {string} root */
export function createCoreSourceAliases(root) {
	return Object.entries(createCoreSourceAliasMap(root)).map(([specifier, replacement]) => ({
		find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
		replacement
	}));
}
