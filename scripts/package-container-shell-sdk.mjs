// Local host-module packaging only. No SDK build, installation, fetch, or guest run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRevision = '93b8b738ebd3ee57e118da0f0eb795b97d5b999e';
const originalIndex = '8367e412be98ea4a76eb65835799dd1ee9bbee86955c2643b2a3ef15d056a927';
const originalWorker = 'fd68ebbfac577202f1ac5fa6e64dac9e90ef9442bd52f24ecd8f0cffd1364a86';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (bytes) => ({ bytes: bytes.length, sha256: digest(bytes) });

async function pinnedFile(path, expected) {
	const information = await lstat(path);
	assert(
		information.isFile() && !information.isSymbolicLink(),
		`Regular pinned file required: ${path}`
	);
	assert(information.size <= 256 * 1024 * 1024, `Input size bound: ${path}`);
	const bytes = await readFile(path);
	if (typeof expected === 'string')
		assert.equal(digest(bytes), expected, `Independent digest: ${path}`);
	else assert.deepEqual(identity(bytes), expected, `Input identity: ${path}`);
	return bytes;
}

async function inventory(root) {
	const files = [];
	let directories = 0;
	async function visit(directory, depth = 0) {
		assert(depth <= 64 && ++directories <= 4096, 'Directory/depth bound');
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert(!entry.isSymbolicLink(), `Source symlink rejected: ${entry.name}`);
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path, depth + 1);
			else {
				assert(entry.isFile());
				files.push(path);
			}
			assert(files.length <= 4096, 'File count bound');
		}
	}
	await visit(root);
	return files.sort();
}

export async function verifyBinaryInputs(configuration) {
	const receiptPath = resolve(configuration.binaryReceipt);
	const receiptBytes = await pinnedFile(receiptPath, configuration.binaryReceiptSha256);
	const receipt = JSON.parse(receiptBytes);
	assert(
		receipt.complete === true &&
			receipt.readOnlyInputsUnchanged === true &&
			receipt.finalStatus === 0,
		'An independently pinned successful SDK binary receipt is required'
	);
	assert(
		receipt.guestQualified === false,
		'Binary gate must remain distinct from guest qualification'
	);
	const root = dirname(receiptPath);
	const policyBytes = await pinnedFile(
		join(root, 'checked-source-policy.json'),
		receipt.sourcePolicyIdentity
	);
	const recipeBytes = await pinnedFile(join(root, 'build-plan.json'), receipt.buildPlanIdentity);
	const policy = JSON.parse(policyBytes);
	const recipe = JSON.parse(recipeBytes);
	assert.equal(recipe.sdkSourceRevision, sourceRevision, 'Pinned SDK source profile');
	assert.equal(recipe.bindgenVersion, 'wasm-bindgen 0.2.101', 'Generated glue ABI');
	assert.equal(recipe.sourceCommit, receipt.sourceCommit, 'Compiled source identity');
	assert.equal(recipe.profile, receipt.profile, 'Compiled profile identity');
	assert(Object.keys(receipt.outputs).length <= 1024, 'Artifact count bound');
	const artifacts = new Map();
	let totalBytes = 0;
	for (const [name, expected] of Object.entries(receipt.outputs).sort()) {
		assert(
			name &&
				!name.includes('\\') &&
				!isAbsolute(name) &&
				posix.normalize(name) === name &&
				!name.split('/').some((part) => part === '..' || part === '.'),
			'Canonical relative artifact path'
		);
		const bytes = await pinnedFile(join(root, name), expected);
		totalBytes += bytes.length;
		assert(totalBytes <= 256 * 1024 * 1024, 'Total artifact byte bound');
		artifacts.set(name, bytes);
	}
	assert(
		artifacts.has('artifacts/web/wasmer_js.js') &&
			artifacts.has('artifacts/web/wasmer_js_bg.wasm'),
		'Actual generated web glue and Wasm required'
	);
	const actualWeb = await inventory(join(root, 'artifacts/web'));
	assert.deepEqual(
		actualWeb.map((name) => relative(root, name)).sort(),
		[...artifacts.keys()].filter((name) => name.startsWith('artifacts/web/')).sort(),
		'Unlisted glue files rejected'
	);
	const sources = new Map();
	assert(Object.keys(policy.sourcePins).length <= 4096, 'Source pin count bound');
	for (const [name, expected] of Object.entries(policy.sourcePins).sort()) {
		await pinnedFile(name, expected);
	}
	const sourceTrees = policy.sourceTrees ?? ['wasmer-sdk', 'wasmer-wasix'];
	assert(Array.isArray(sourceTrees) && new Set(sourceTrees).size === sourceTrees.length &&
		sourceTrees.includes('wasmer-sdk') && sourceTrees.includes('wasmer-wasix') &&
		sourceTrees.every(name => ['wasmer-sdk', 'wasmer-wasix', 'virtual-fs'].includes(name)),
		'Explicit supported source tree inventory');
	const actualTrees = (await readdir(policy.preparedSource, { withFileTypes: true }))
		.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name).sort();
	assert.deepEqual(actualTrees, [...sourceTrees].sort(), 'No unlisted dependency source trees');
	for (const name of sourceTrees) {
		const directory = join(policy.preparedSource, name);
		assert((await lstat(directory)).isDirectory(), 'Source tree must be a real directory');
		assert.deepEqual(
			await inventory(directory),
			Object.keys(policy.sourcePins)
				.filter((path) => path.startsWith(directory + '/'))
				.sort(),
			'Complete source inventory'
		);
	}
	for (const name of ['src-js/index.ts', 'src-js/worker.js', 'LICENSE']) {
		const path = join(policy.preparedSource, 'wasmer-sdk', name);
		sources.set('sdk/' + name, await pinnedFile(path, policy.sourcePins[path]));
	}
	assert.equal(
		digest(sources.get('sdk/src-js/index.ts')),
		originalIndex,
		'Original SDK index semantics'
	);
	assert.equal(
		digest(sources.get('sdk/src-js/worker.js')),
		originalWorker,
		'Original thread-worker semantics'
	);
	for (const [name, bytes] of artifacts) {
		if (name.startsWith('artifacts/web/') && /\.(?:m?js)$/.test(name))
			sources.set('bindgen/' + name.slice('artifacts/web/'.length), bytes);
	}
	const memories = receipt.wasmInventory?.bindgen?.memories;
	assert(
		Array.isArray(memories) &&
			memories.length === 1 &&
			memories[0].shared === true &&
			Number.isSafeInteger(memories[0].minimumPages) &&
			Number.isSafeInteger(memories[0].maximumPages) &&
			memories[0].minimumPages >= 0 &&
			memories[0].maximumPages >= memories[0].minimumPages &&
			memories[0].maximumPages <= 65536,
		'Pinned shared wasm32 memory profile'
	);
	assert.deepEqual(
		identity(artifacts.get('artifacts/web/wasmer_js_bg.wasm')),
		{
			bytes: receipt.wasmInventory.bindgen.bytes,
			sha256: receipt.wasmInventory.bindgen.sha256
		},
		'Inspected Wasm identity'
	);
	return {
		root,
		receipt,
		receiptIdentity: identity(receiptBytes),
		sources,
		artifacts,
		memory: memories[0]
	};
}

export function wrapperSources(memory) {
	const validation = `
const requiredMemory = ${JSON.stringify(memory)};
const sdkUrl = new URL('./index.mjs', import.meta.url).href;
const workerUrl = new URL('./worker.mjs', import.meta.url).href;
function validate(value) {
  if (!value || !(value.module instanceof WebAssembly.Module)) throw new TypeError('SDK_PACKAGE_VERIFIED_MODULE_REQUIRED');
  if (!(value.memory instanceof WebAssembly.Memory) || typeof SharedArrayBuffer !== 'function' || !(value.memory.buffer instanceof SharedArrayBuffer)) throw new TypeError('SDK_PACKAGE_SHARED_MEMORY_REQUIRED');
  const pages = value.memory.buffer.byteLength / 65536;
  if (pages < requiredMemory.minimumPages || pages > requiredMemory.maximumPages) throw new RangeError('SDK_PACKAGE_MEMORY_PROFILE');
  if (value.sdkUrl !== undefined && String(value.sdkUrl) !== sdkUrl) throw new TypeError('SDK_PACKAGE_FIXED_MODULE_URL');
  if (value.workerUrl !== undefined && String(value.workerUrl) !== workerUrl) throw new TypeError('SDK_PACKAGE_FIXED_WORKER_URL');
}
`;
	return new Map([
		[
			'entry/index.js',
			Buffer.from(`
import { init as upstreamInit } from 'wasm-idle:upstream-index';
export * from 'wasm-idle:upstream-index';
${validation}
let binding;
export function init(value) {
  validate(value);
  if (binding && (binding.module !== value.module || binding.memory !== value.memory)) throw new TypeError('SDK_PACKAGE_BINDING_CHANGED');
  binding ??= { module: value.module, memory: value.memory };
  return upstreamInit({ ...value, module: binding.module, memory: binding.memory, sdkUrl, workerUrl });
}
`)
		],
		[
			'entry/worker.js',
			Buffer.from(`
import 'wasm-idle:upstream-worker';
${validation}
const upstreamOnMessage = globalThis.onmessage;
if (typeof upstreamOnMessage !== 'function') throw new Error('SDK_PACKAGE_WORKER_BOOTSTRAP');
let initialized = false;
globalThis.onmessage = function(event) {
  if (event?.data?.type === 'init') {
    validate(event.data);
    if (event.data.sdkUrl !== sdkUrl) throw new TypeError('SDK_PACKAGE_FIXED_MODULE_URL');
    if (!Number.isInteger(event.data.id) || event.data.id < 0 || event.data.id > 0xffffffff) throw new TypeError('SDK_PACKAGE_WORKER_ID');
    if (initialized) throw new TypeError('SDK_PACKAGE_DUPLICATE_WORKER_INIT');
    initialized = true;
  }
  return upstreamOnMessage.call(this, event);
};
`)
		]
	]);
}

export async function bundleLocalGraph(esbuild, inputs, memory) {
	const files = new Map([...inputs, ...wrapperSources(memory)]);
	assert(
		[...files.values()].reduce((total, bytes) => total + bytes.length, 0) <= 64 * 1024 * 1024,
		'Host module closure byte bound'
	);
	const plugin = {
		name: 'pinned-local-sdk',
		setup(build) {
			build.onResolve({ filter: /.*/ }, (args) => {
				let name;
				if (args.kind === 'entry-point') name = 'entry/' + args.path + '.js';
				else if (args.path === 'wasm-idle:upstream-index') name = 'sdk/src-js/index.ts';
				else if (args.path === 'wasm-idle:upstream-worker') name = 'sdk/src-js/worker.js';
				else if (
					args.importer === 'sdk/src-js/index.ts' &&
					args.path === '../pkg/wasmer_js'
				)
					name = 'bindgen/wasmer_js.js';
				else if (args.path.startsWith('./') || args.path.startsWith('../')) {
					const base = posix.normalize(
						posix.join(posix.dirname(args.importer), args.path)
					);
					name = [base, base + '.js', base + '.mjs', base + '.ts'].find((candidate) =>
						files.has(candidate)
					);
				}
				assert(name && files.has(name), `Unregistered SDK host import: ${args.path}`);
				return { path: name, namespace: 'pinned-sdk' };
			});
			build.onLoad({ filter: /.*/, namespace: 'pinned-sdk' }, (args) => {
				assert(
					/\.(?:m?js|ts)$/.test(args.path),
					`Unsupported host module format: ${args.path}`
				);
				return {
					contents: new TextDecoder('utf-8', { fatal: true }).decode(
						files.get(args.path)
					),
					loader: args.path.endsWith('.ts') ? 'ts' : 'js'
				};
			});
		}
	};
	const outputs = new Map();
	const metadata = {};
	for (const entry of ['index', 'worker']) {
		const result = await esbuild.build({
			entryPoints: [entry],
			plugins: [plugin],
			bundle: true,
			platform: 'browser',
			format: 'esm',
			target: 'es2022',
			charset: 'utf8',
			legalComments: 'inline',
			treeShaking: true,
			write: false,
			metafile: true,
			logLevel: 'silent',
			logOverride: { 'unsupported-dynamic-import': entry === 'worker' ? 'silent' : 'error' },
			outfile: '/wasm-idle-sdk-package/' + entry + '.mjs'
		});
		assert.equal(result.outputFiles.length, 1, 'One self-contained host entry');
		for (const output of Object.values(result.metafile.outputs)) {
			assert(
				output.imports.every((item) => !item.external),
				'No unresolved static host import'
			);
		}
		outputs.set(entry + '.mjs', Buffer.from(result.outputFiles[0].contents));
		metadata[entry] = result.metafile;
	}
	return { outputs, metadata };
}

export async function packageSDK(configuration, checkOnly = false) {
	assert.equal(
		digest(await readFile(process.execPath)),
		configuration.nodeSha256,
		'Pinned Node executable'
	);
	const binary = await verifyBinaryInputs(configuration);
	const toolPaths = [
		configuration.esbuildApi,
		configuration.esbuildPackage,
		configuration.esbuildBinary
	];
	const toolHashes = [
		configuration.esbuildApiSha256,
		configuration.esbuildPackageSha256,
		configuration.esbuildBinarySha256
	];
	const toolBytes = [];
	for (let index = 0; index < toolPaths.length; index++)
		toolBytes.push(await pinnedFile(toolPaths[index], toolHashes[index]));
	const version = JSON.parse(toolBytes[1]).version;
	assert.equal(version, '0.28.2', 'Pinned local esbuild profile');
	assert.equal(
		configuration.esbuildApi,
		join(dirname(configuration.esbuildPackage), 'lib/main.js'),
		'Pinned esbuild API/package correspondence'
	);
	const output = resolve(configuration.output);
	assert(!(await lstat(output).catch(() => null)), 'Output must be fresh');
	const source = JSON.parse(
		await readFile(join(binary.root, 'checked-source-policy.json'))
	).preparedSource;
	assert(
		!output.startsWith(resolve(source) + '/') && !resolve(source).startsWith(output + '/'),
		'Separate package output'
	);
	if (checkOnly)
		return {
			prepared: true,
			packaged: false,
			binaryReceiptIdentity: binary.receiptIdentity,
			esbuildVersion: version
		};
	assert.equal(
		execFileSync(configuration.esbuildBinary, ['--version'], {
			encoding: 'utf8',
			timeout: 5000
		}).trim(),
		version,
		'Matched esbuild native executable'
	);
	process.env.ESBUILD_BINARY_PATH = configuration.esbuildBinary;
	process.env.ESBUILD_WORKER_THREADS = '0';
	const imported = await import(pathToFileURL(configuration.esbuildApi).href);
	const esbuild = imported.default ?? imported;
	let bundle;
	try {
		bundle = await bundleLocalGraph(esbuild, binary.sources, binary.memory);
	} finally {
		esbuild.stop();
	}
	// Revalidate before publishing a complete package. Failed builds publish no entry.
	await verifyBinaryInputs(configuration);
	for (let index = 0; index < toolPaths.length; index++)
		await pinnedFile(toolPaths[index], toolHashes[index]);
	const files = bundle.outputs;
	files.set('wasmer_js_bg.wasm', binary.artifacts.get('artifacts/web/wasmer_js_bg.wasm'));
	files.set('LICENSE.sdk', binary.sources.get('sdk/LICENSE'));
	const declaration = binary.artifacts.get('artifacts/web/wasmer_js.d.ts');
	if (declaration) files.set('wasmer_js.d.ts', declaration);
	const entries = Object.fromEntries(
		[...files]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([name, bytes]) => [name, identity(bytes)])
	);
	const packageId = 'sha256-' + digest(Buffer.from(JSON.stringify(entries)));
	await mkdir(output, { mode: 0o700 });
	const staged = join(output, '.staged');
	await mkdir(staged, { mode: 0o700 });
	for (const [name, bytes] of files)
		await writeFile(join(staged, name), bytes, { flag: 'wx', mode: 0o600 });
	await rename(staged, join(output, packageId));
	await writeFile(
		join(output, 'metafile.json'),
		JSON.stringify(bundle.metadata, null, 2) + '\n',
		{ flag: 'wx', mode: 0o600 }
	);
	const receipt = {
		schemaVersion: 1,
		complete: true,
		guestQualified: false,
		qualification:
			'Deterministic local SDK host/module/thread-worker packaging; no real SDK or guest execution',
		binaryReceiptIdentity: binary.receiptIdentity,
		sourceCommit: binary.receipt.sourceCommit,
		buildProfile: binary.receipt.profile,
		esbuildVersion: version,
		tools: Object.fromEntries(
			toolPaths.map((path, index) => [path, identity(toolBytes[index])])
		),
		packageId,
		entries,
		memoryProfile: binary.memory,
		initialization:
			'Caller-provided verified WebAssembly.Module and shared Memory; package-local index/worker URLs',
		runtimeHostImport:
			'Original thread-worker dynamic import of exact package-local index.mjs; normal trusted JS module-graph boundary, not per-worker asset-service verification',
		remainingGates: [
			'Actual generated 0.2.101 initializer/browser acceptance',
			'Pinned immutable host-module hosting/CSP',
			'Descendant-worker ownership and cancellation',
			'Trusted command registry and common live fd/VFS',
			'Complete dependency source/license notices'
		]
	};
	await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
		flag: 'wx',
		mode: 0o600
	});
	return { packaged: true, guestQualified: false, packageId, output };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const configuration = JSON.parse(await readFile(process.argv[2], 'utf8'));
	const result = await packageSDK(configuration, process.argv.includes('--check'));
	console.log(JSON.stringify(result));
}
