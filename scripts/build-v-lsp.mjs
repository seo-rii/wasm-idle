import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const patchPath = fileURLToPath(new URL('./patches/v-lsp-reactor.patch', import.meta.url));
export const vLspLock = JSON.parse(
	await readFile(new URL('./v-lsp.lock.json', import.meta.url), 'utf8')
);
const names = ['v_analyzer.mjs', 'v_analyzer.wasm', 'stdlib.json.gz.bin'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyVLspAsset(bytes, receipt, label) {
	if (!receipt || bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256)
		throw new Error(`V LSP ${label} differs from the pinned producer receipt`);
	return bytes;
}
/** V 0.5.1 hashes absolute source paths into opaque embedded-file lookup keys. */
export function normalizeVEmbeddedFileIds(source) {
	const metadata =
		/^v__embed_file__EmbedFileData _v_embed_file_metadata\(u64 ef_hash\) \{\n[\s\S]*?^\}/m.exec(
			source
		)?.[0];
	if (!metadata) throw new Error('Missing V embedded-file metadata');
	const identifiers = new Map();
	const normalized = metadata
		.replace(/\bcase (\d+)U:/g, (_, identifier) => {
			if (identifiers.has(identifier))
				throw new Error('Duplicate V embedded-file lookup key');
			const canonical = String(identifiers.size + 1);
			identifiers.set(identifier, canonical);
			return `case ${canonical}U:`;
		})
		.replace(/\/\/ case (\d+)/g, (_, identifier) => `// case ${identifiers.get(identifier)}`);
	if (!identifiers.size) throw new Error('Missing V embedded-file lookup keys');
	const used = new Set();
	const result = source
		.replace(metadata, normalized)
		.replace(/_v_embed_file_metadata\(\s*(-?\d+)U\s*\)/g, (_, literal) => {
			const identifier = BigInt.asUintN(64, BigInt(literal)).toString();
			const canonical = identifiers.get(identifier);
			if (!canonical) throw new Error('Unknown V embedded-file lookup key');
			used.add(identifier);
			return `_v_embed_file_metadata( ${canonical}U )`;
		});
	if (used.size !== identifiers.size) throw new Error('Unused V embedded-file lookup key');
	return result;
}
function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit', ...options });
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal})`))
		);
	});
}
async function input(receipt, filename) {
	try {
		return verifyVLspAsset(await readFile(filename), receipt, filename);
	} catch {}
	const response = await fetch(receipt.url, { signal: AbortSignal.timeout(180_000) });
	if (!response.ok) throw new Error(`V LSP input download failed: HTTP ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > receipt.bytes) throw new Error('V LSP input exceeds its pinned size');
		chunks.push(chunk);
	}
	const bytes = verifyVLspAsset(Buffer.concat(chunks), receipt, filename);
	await writeFile(filename, bytes);
	return bytes;
}
async function extract(archive, destination) {
	await mkdir(destination, { recursive: true });
	await run('tar', ['-xf', archive, '--strip-components=1', '-C', destination]);
}
async function stdlibSnapshot(directory) {
	const files = {};
	async function visit(relative) {
		for (const entry of (
			await readdir(path.join(directory, relative), { withFileTypes: true })
		).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
			const filename = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(filename);
			else if (
				entry.isFile() &&
				/\.v(?:sh)?$/.test(filename) &&
				!filename.endsWith('_test.v') &&
				!filename.endsWith('.js.v') &&
				!/(?:^|\/)(?:tests|slow_tests|\.git)\//.test(filename) &&
				!/^builtin\/(?:wasm|js|linux_bare)\//.test(filename)
			)
				files[filename] = await readFile(path.join(directory, filename), 'utf8');
		}
	}
	await visit('');
	return gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
}

/** Builds the pinned original analyzer with browser transport and synchronous indexing adapters. */
export async function buildVLsp({
	buildNative = false,
	outputDirectory = path.join(root, 'static/wasm-v-lsp')
} = {}) {
	const lock = vLspLock;
	if (Object.keys(lock.assets).sort().join() !== [...names].sort().join())
		throw new Error('V LSP lock is missing qualified assets');
	const patch = await readFile(patchPath);
	if (sha256(patch) !== lock.patchSha256) throw new Error('V LSP patch differs from its lock');
	const cache = path.join(
		root,
		'.cache/v-lsp',
		`${lock.sources.server.commit}-${lock.patchSha256.slice(0, 16)}`
	);
	const source = path.join(cache, 'source'),
		original = path.join(cache, 'native-source');
	const compilerRoot = path.join(cache, 'compiler'),
		compiler = path.join(compilerRoot, 'v/v');
	const nativePath = path.join(cache, 'v-analyzer-native');
	await mkdir(cache, { recursive: true });
	let assets;
	try {
		assets = Object.fromEntries(
			await Promise.all(
				names.map(async (name) => [
					name,
					verifyVLspAsset(
						await readFile(path.join(outputDirectory, name)),
						lock.assets[name],
						name
					)
				])
			)
		);
	} catch {}
	const env = {
		...process.env,
		VFLAGS: '',
		VMODULES: path.join(cache, 'modules'),
		EMCC_CORES: '2',
		BINARYEN_CORES: '2',
		SOURCE_DATE_EPOCH: '0',
		BUILD_COMMIT: lock.sources.server.commit.slice(0, 8),
		BUILD_DATETIME: '1970-01-01 00:00:00'
	};
	if (!assets || buildNative) {
		if (process.platform !== 'linux' || process.arch !== 'x64')
			throw new Error('The pinned V LSP source producer requires Linux x64');
		await mkdir(env.VMODULES, { recursive: true });
		for (const name of ['server', 'treeSitter'])
			await input(lock.sources[name], path.join(cache, `${name}.tar.gz`));
		await input(lock.compiler, path.join(cache, 'compiler.zip'));
		try {
			await readFile(path.join(cache, 'prepared'));
		} catch {
			await rm(source, { recursive: true, force: true });
			await rm(original, { recursive: true, force: true });
			await extract(path.join(cache, 'server.tar.gz'), source);
			await extract(
				path.join(cache, 'treeSitter.tar.gz'),
				path.join(source, 'tree_sitter_v/bindings/core')
			);
			await cp(source, original, { recursive: true });
			await run('patch', ['-p1', '--batch', '-i', patchPath], { cwd: source });
			await writeFile(path.join(cache, 'prepared'), lock.patchSha256);
		}
		try {
			await readFile(compiler);
		} catch {
			await mkdir(compilerRoot, { recursive: true });
			await run('unzip', ['-q', path.join(cache, 'compiler.zip'), '-d', compilerRoot]);
			await chmod(compiler, 0o755);
		}
	}
	if (!assets) {
		await input(lock.emscripten, path.join(cache, 'emscripten.tar.xz'));
		const sdk = path.join(cache, 'emscripten');
		try {
			await readFile(path.join(sdk, 'emscripten/emcc'));
		} catch {
			await extract(path.join(cache, 'emscripten.tar.xz'), sdk);
		}
		const configPath = path.join(cache, 'em-config');
		await writeFile(
			configPath,
			`LLVM_ROOT = ${JSON.stringify(path.join(sdk, 'bin'))}\nBINARYEN_ROOT = ${JSON.stringify(sdk)}\nNODE_JS = ${JSON.stringify(process.execPath)}\n`
		);
		env.EM_CONFIG = configPath;
		env.EM_CACHE = path.join(cache, 'em-cache');
		await mkdir(path.join(cache, 'build'), { recursive: true });
		await run(
			compiler,
			[
				'-os',
				'wasm32_emscripten',
				'-d',
				'browser_lsp',
				'-d',
				'no_gc_threads',
				'-enable-globals',
				'-no-parallel',
				'-gc',
				'boehm',
				'-path',
				'source/src|source|@vlib|@vmodules',
				'-o',
				'build/reactor.c',
				'source/src/browser'
			],
			{ cwd: cache, env }
		);
		const generated = await readFile(path.join(cache, 'build/reactor.c'), 'utf8');
		// Native V closures allocate machine-code thunks. Only unused declarations may remain.
		if ((generated.match(/builtin__closure__closure_create\(/g) || []).length > 2)
			throw new Error('The V browser profile contains a native captured closure');
		await writeFile(path.join(cache, 'build/reactor.c'), normalizeVEmbeddedFileIds(generated));
		await run(
			path.join(sdk, 'emscripten/emcc'),
			[
				'-Oz',
				'-DNDEBUG',
				'build/reactor.c',
				'compiler/v/thirdparty/cJSON/cJSON.c',
				'compiler/v/thirdparty/libgc/gc.c',
				'source/src/browser/gc-roots.c',
				'source/tree_sitter_v/bindings/core/lib/src/lib.c',
				'source/tree_sitter_v/src/parser.c',
				...[
					'compiler/v/thirdparty/cJSON',
					'compiler/v/thirdparty/libgc/include',
					'compiler/v/thirdparty/zip',
					'compiler/v/thirdparty/stdatomic/nix',
					'source/tree_sitter_v/bindings',
					'source/tree_sitter_v/src',
					'source/tree_sitter_v/bindings/core/lib/include',
					'source/tree_sitter_v/bindings/core/lib/src'
				].map((directory) => `-I${directory}`),
				'-DGC_BUILTIN_ATOMIC=1',
				'-DEMSCRIPTEN_ASYNCIFY=1',
				'-Wno-incompatible-pointer-types',
				'-Wno-pointer-sign',
				'-Wno-incompatible-function-pointer-types',
				'-sMODULARIZE=1',
				'-sEXPORT_ES6=1',
				'-sENVIRONMENT=worker,node',
				'-sALLOW_MEMORY_GROWTH=1',
				'-sINITIAL_MEMORY=33554432',
				'-sMAXIMUM_MEMORY=536870912',
				'-sSTACK_SIZE=8388608',
				'-sGLOBAL_BASE=65536',
				'-sASYNCIFY=1',
				'-sASYNCIFY_STACK_SIZE=1048576',
				'-sFILESYSTEM=1',
				'-sFORCE_FILESYSTEM=1',
				'-sEXPORTED_RUNTIME_METHODS=["FS","HEAPU8","ccall"]',
				'-sEXPORTED_FUNCTIONS=["_main","_malloc","_free","_lsp_init","_lsp_handle","_lsp_response_ptr","_lsp_response_len","_lsp_gc_init","_GC_gcollect","_GC_get_heap_size","_GC_get_free_bytes"]',
				'-o',
				'build/v_analyzer.mjs'
			],
			{ cwd: cache, env }
		);
		assets = {
			'v_analyzer.mjs': await readFile(path.join(cache, 'build/v_analyzer.mjs')),
			'v_analyzer.wasm': await readFile(path.join(cache, 'build/v_analyzer.wasm')),
			'stdlib.json.gz.bin': await stdlibSnapshot(path.join(compilerRoot, 'v/vlib'))
		};
		for (const name of names) verifyVLspAsset(assets[name], lock.assets[name], name);
	}
	if (buildNative)
		await run(
			compiler,
			['-enable-globals', '-no-parallel', '-cc', 'gcc', '-o', nativePath, original],
			{ cwd: cache, env }
		);
	await mkdir(outputDirectory, { recursive: true });
	for (const name of names) await writeFile(path.join(outputDirectory, name), assets[name]);
	await writeFile(
		path.join(outputDirectory, 'LICENSE'),
		(
			await Promise.all(
				['v-lsp', 'v-grammar', 'v-tree-sitter', 'v-runtime', 'v-emscripten'].map(
					async (name) =>
						`${name}\n\n${await readFile(path.join(root, 'scripts/patches', `${name}.LICENSE`), 'utf8')}\n`
				)
			)
		).join('\n')
	);
	await writeFile(
		path.join(outputDirectory, 'source.json'),
		`${JSON.stringify(lock, null, '\t')}\n`
	);
	return {
		directory: outputDirectory,
		...(buildNative ? { nativePath, stdlibDirectory: path.join(compilerRoot, 'v/vlib') } : {})
	};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(await buildVLsp({ buildNative: process.argv.includes('--native') }));
