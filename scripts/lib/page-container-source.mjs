import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exports = {
	'@wasm-idle/container': 'dist/index.js',
	'@wasm-idle/container/adapters/wasix': 'dist/adapters/wasix/index.js',
	'@wasm-idle/container/adapters/clang': 'dist/adapters/clang/index.js',
	'@wasm-idle/container/adapters/clang-live': 'dist/adapters/clang-live/index.js',
	'@wasm-idle/container/adapters/wasi-live': 'dist/adapters/wasi-live/index.js',
	'@wasm-idle/container/persistence': 'dist/fs/persistence/index.js',
	'@wasm-idle/container/workspace': 'dist/workspace/index.js',
	'@wasm-idle/container/terminal': 'dist/terminal/index.js'
};
const workers = {
	'live-worker': 'dist/adapters/wasi-live/worker.js',
	'clang-worker': 'dist/adapters/clang-live/worker.js'
};

/** Build-time paths only. Configuration can select a source, never a host module path. */
export async function selectPageContainerSource({
	workspaceRoot,
	source,
	resolvedEntry,
	requiresMetadata = false
}) {
	assert(
		source === undefined || source === 'workspace' || source === 'published',
		'containerSource must be workspace or published'
	);
	assert(isAbsolute(workspaceRoot), 'Absolute workspace root required');
	const workspacePackage = join(workspaceRoot, 'packages/container');
	const workspaceEntry = join(workspacePackage, exports['@wasm-idle/container']);
	let selected = source;
	if (selected === undefined) {
		assert(isAbsolute(resolvedEntry ?? ''), 'Resolved Container entry required');
		// A local build may put dist on another volume. Compare file identities,
		// while retaining the fixed package paths for its metadata and exports.
		const local = await realpath(workspaceEntry).catch((error) => {
			if (error.code !== 'ENOENT') throw error;
			return undefined;
		});
		assert.equal(
			await realpath(resolvedEntry),
			local,
			'Install workspace dependencies, select containerSource: workspace, or explicitly select published for legacy assets'
		);
		selected = 'workspace';
	}
	assert(
		!requiresMetadata || selected === 'workspace',
		'BusyBox wasm_idle_fs_v1 metadata imports require the workspace Container SDK'
	);
	if (selected === 'published') {
		assert(isAbsolute(resolvedEntry ?? ''), 'Installed published Container entry required');
		assert.notEqual(
			await realpath(resolvedEntry),
			await realpath(workspaceEntry).catch((error) => {
				if (error.code !== 'ENOENT') throw error;
				return undefined;
			}),
			'Published preparation requires an installed published Container package'
		);
	}
	const packageRoot =
		selected === 'workspace'
			? workspacePackage
			: dirname(dirname(await realpath(resolvedEntry)));
	const packageBytes = await readFile(join(packageRoot, 'package.json'));
	const packageMetadata = JSON.parse(packageBytes);
	assert.equal(packageMetadata.name, '@wasm-idle/container', 'Expected Container package');
	assert(
		typeof packageMetadata.version === 'string' && packageMetadata.version.length > 0,
		'Container package version required'
	);
	if (selected === 'published')
		assert.equal(
			packageMetadata.version,
			'0.1.0',
			'Only the qualified legacy published SDK is supported'
		);
	const aliases = {};
	const sourceFiles = {};
	for (const [name, relative] of Object.entries(exports)) {
		const exportName =
			name === '@wasm-idle/container' ? '.' : `.${name.slice('@wasm-idle/container'.length)}`;
		assert.equal(
			packageMetadata.exports?.[exportName]?.import,
			`./${relative}`,
			`Fixed trusted Container export required: ${name}`
		);
		aliases[name] = resolve(packageRoot, relative);
		sourceFiles[relative] = sha256(await readFile(aliases[name]));
	}
	const entryPoints = {};
	for (const [name, relative] of Object.entries(workers)) {
		entryPoints[name] = resolve(packageRoot, relative);
		sourceFiles[relative] = sha256(await readFile(entryPoints[name]));
	}
	if (selected === 'published')
		assert.equal(
			await realpath(resolvedEntry),
			await realpath(aliases['@wasm-idle/container']),
			'Published Container must resolve its fixed entry'
		);
	return {
		packageRoot,
		aliases,
		entryPoints,
		// The qualified legacy package predates owner module-service preparation.
		clangModuleServices: selected === 'workspace',
		identity: {
			source: selected,
			profile: selected === 'workspace' ? 'virtual-metadata-v1' : 'published-0.1.0',
			package: packageMetadata.name,
			version: packageMetadata.version,
			packageJsonSha256: sha256(packageBytes),
			files: sourceFiles
		}
	};
}
