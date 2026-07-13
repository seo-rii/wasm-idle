import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-nim');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-nim-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmNimVersion.ts'
);
const UPSTREAM_REPOSITORY = 'https://github.com/benagastov/Nim-WASM-Compiler.git';
const RUNTIME_FILES = [
	'nim/nim-bundle.js',
	'nim/nim.wasm',
	'nim/nimbase.h',
	'clang/clang.js',
	'clang/clang.wasm',
	'clang/lld.wasm',
	'clang/memfs.wasm',
	'clang/sysroot.tar'
];
const OPTIONAL_SOURCE_FILES = ['LICENSE', 'README.md'];

/**
 * @typedef {object} SyncWasmNimOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 */

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

/**
 * @param {string} dir
 * @param {string} file
 */
async function targetRuntimeFileExists(dir, file) {
	return (
		(await fileExists(path.join(dir, file))) || (await fileExists(path.join(dir, `${file}.gz`)))
	);
}

/**
 * @param {string} sourceDir
 */
async function sourceLooksUsable(sourceDir) {
	const staticDir = await resolveStaticSourceDir(sourceDir).catch(() => '');
	if (!staticDir) return false;
	const results = await Promise.all(
		RUNTIME_FILES.map((file) => fileExists(path.join(staticDir, file)))
	);
	return results.every(Boolean);
}

/**
 * @param {string} targetDir
 */
async function targetLooksUsable(targetDir) {
	const results = await Promise.all(
		RUNTIME_FILES.map((file) => targetRuntimeFileExists(targetDir, file))
	);
	return results.every(Boolean);
}

/**
 * @param {string} sourceDir
 */
async function resolveStaticSourceDir(sourceDir) {
	const resolved = path.resolve(sourceDir);
	if (await fileExists(path.join(resolved, 'nim', 'nim-bundle.js'))) return resolved;
	if (await fileExists(path.join(resolved, 'static', 'nim', 'nim-bundle.js'))) {
		return path.join(resolved, 'static');
	}
	if (await fileExists(path.join(resolved, 'demo', 'static', 'nim', 'nim-bundle.js'))) {
		return path.join(resolved, 'demo', 'static');
	}
	throw new Error(`Nim WASM source assets were not found under ${resolved}`);
}

async function findOptionalSourceRoot(staticSourceDir) {
	let current = path.resolve(staticSourceDir);
	for (let depth = 0; depth < 4; depth += 1) {
		if (await fileExists(path.join(current, 'README.md'))) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return path.resolve(staticSourceDir, '..');
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_NIM_ASSET_VERSION = '${fingerprint}';\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {string} targetDir
 */
async function collectFingerprintFiles(targetDir) {
	const files = [];
	for (const file of RUNTIME_FILES) {
		if (await fileExists(path.join(targetDir, file))) {
			files.push(file);
			continue;
		}
		if (await fileExists(path.join(targetDir, `${file}.gz`))) files.push(`${file}.gz`);
	}
	for (const file of OPTIONAL_SOURCE_FILES) {
		if (await fileExists(path.join(targetDir, file))) files.push(file);
	}
	if (await fileExists(path.join(targetDir, 'runner-worker.js'))) files.push('runner-worker.js');
	return files;
}

/**
 * @param {string} targetDir
 * @param {string[]} files
 */
async function computeFingerprint(targetDir, files) {
	const hash = createHash('sha256');
	for (const fileName of files.sort()) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(path.join(targetDir, fileName)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/**
 * @param {string} targetDir
 * @param {string} fingerprint
 * @param {string[]} files
 */
async function writeRuntimeManifest(targetDir, fingerprint, files) {
	const manifest = {
		format: 'wasm-nim-runtime-manifest-v1',
		runtime: 'benagastov-nim-wasm-compiler',
		repository: UPSTREAM_REPOSITORY,
		fingerprint,
		files: files.filter((file) => file !== 'runner-worker.js').sort()
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

function patchClangJs(source) {
	const match = source.match(/a="([A-Za-z0-9+/=]+)"/);
	if (!match) throw new Error('clang.js did not contain the embedded worker payload.');
	let workerSource = Buffer.from(match[1], 'base64').toString('utf8');
	const fetchNeedle =
		'readBuffer:async t=>(await fetch(`${a}/${t}`)).arrayBuffer(),async compileStreaming(t){const e=await fetch(`${a}/${t}`,{cache:"no-store"});return WebAssembly.compile(await e.arrayBuffer())}';
	const fetchReplacement =
		'readBuffer:async t=>(await fetchAsset(a,t)).arrayBuffer(),async compileStreaming(t){const e=await fetchAsset(a,t,{cache:"no-store"});return WebAssembly.compile(await e.arrayBuffer())}';
	if (!workerSource.includes(fetchNeedle)) {
		throw new Error('clang.js embedded worker fetch path did not match the expected source.');
	}
	workerSource = workerSource.replace(fetchNeedle, fetchReplacement);
	const helperNeedle = 'let s,i;let r=null;const n=async t=>{';
	const helper =
		'async function fetchAsset(a,t,o){let r=await fetch(`${a}/${t}`,o);if(r.ok)return r;let g=await fetch(`${a}/${t}.gz`,o);if(!g.ok||!g.body)throw new Error(`asset not found: ${a}/${t}`);let e=(g.headers.get("content-encoding")||"").toLowerCase().split(",").map(t=>t.trim());if(e.includes("gzip"))return g;if(typeof DecompressionStream!="function")throw new Error(`${t}.gz requires DecompressionStream`);return new Response(g.body.pipeThrough(new DecompressionStream("gzip")))}';
	if (!workerSource.includes(helperNeedle)) {
		throw new Error('clang.js embedded worker init block did not match the expected source.');
	}
	workerSource = workerSource.replace(helperNeedle, `${helper}${helperNeedle}`);
	const compileEachNeedle = 'case"compile-each-link":{const files=h.files;';
	if (!workerSource.includes(compileEachNeedle)) {
		throw new Error('clang.js embedded worker compile-each-link case did not match.');
	}
	workerSource = workerSource.replace(
		compileEachNeedle,
		'case"compile-each-link":{try{const files=h.files;'
	);
	const runNeedle =
		'const o=s.memfs.getFileContents(h.out);const inst=await s.hostLogAsync(`Compiling ${h.out}`,WebAssembly.compile(o));const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});';
	if (!workerSource.includes(runNeedle)) {
		throw new Error('clang.js embedded worker compile-each-link block did not match.');
	}
	workerSource = workerSource.replace(
		runNeedle,
		'i.postMessage({id:"compile-each-link-done",data:{ok:true}});}catch(err){i.postMessage({id:"compile-each-link-done",data:{ok:false,error:String(err&&err.message||err)}});}'
	);
	const encoded = Buffer.from(workerSource, 'utf8').toString('base64');
	return source.replace(match[1], encoded);
}

async function downloadRepositorySource() {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-idle-nim-'));
	await execFileAsync('git', ['clone', '--depth', '1', UPSTREAM_REPOSITORY, 'source'], {
		cwd: tempDir,
		maxBuffer: 1024 * 1024
	});
	return path.join(tempDir, 'source', 'demo', 'static');
}

/**
 * @param {string | undefined} sourceDir
 * @param {string} targetDir
 */
async function resolveSourceDir(sourceDir, targetDir) {
	if (sourceDir) return await resolveStaticSourceDir(sourceDir);
	const configuredSourceDir = process.env.WASM_NIM_SOURCE_DIR
		? path.resolve(process.env.WASM_NIM_SOURCE_DIR)
		: '';
	if (configuredSourceDir && (await sourceLooksUsable(configuredSourceDir))) {
		return await resolveStaticSourceDir(configuredSourceDir);
	}
	if (await targetLooksUsable(targetDir)) return null;
	return await downloadRepositorySource();
}

/**
 * @param {SyncWasmNimOptions} [options]
 */
export async function syncWasmNimAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedSourceDir = await resolveSourceDir(sourceDir, resolvedTargetDir);
	if (resolvedSourceDir) {
		const nimBundleSource = await readFile(
			path.join(resolvedSourceDir, 'nim', 'nim-bundle.js'),
			'utf8'
		);
		if (
			!nimBundleSource.includes('__NIM_USER_CODE__') ||
			!nimBundleSource.includes('callMain')
		) {
			throw new Error(
				'nim-bundle.js does not look like the expected browser Nim compiler bundle.'
			);
		}
		await rm(resolvedTargetDir, { recursive: true, force: true });
		await mkdir(resolvedTargetDir, { recursive: true });
		for (const file of RUNTIME_FILES) {
			const sourcePath = path.join(resolvedSourceDir, file);
			const targetPath = path.join(resolvedTargetDir, file);
			await mkdir(path.dirname(targetPath), { recursive: true });
			if (file === 'clang/clang.js') {
				await writeFile(
					targetPath,
					patchClangJs(await readFile(sourcePath, 'utf8')),
					'utf8'
				);
			} else {
				await cp(sourcePath, targetPath);
			}
		}
		const sourceRoot = await findOptionalSourceRoot(resolvedSourceDir);
		for (const file of OPTIONAL_SOURCE_FILES) {
			if (await fileExists(path.join(sourceRoot, file))) {
				await cp(path.join(sourceRoot, file), path.join(resolvedTargetDir, file));
			}
		}
	} else {
		await mkdir(resolvedTargetDir, { recursive: true });
	}
	await cp(workerSourcePath, path.join(resolvedTargetDir, 'runner-worker.js'));
	const copiedFiles = await collectFingerprintFiles(resolvedTargetDir);
	if (
		!RUNTIME_FILES.every(
			(file) => copiedFiles.includes(file) || copiedFiles.includes(`${file}.gz`)
		)
	) {
		throw new Error(`Nim runtime target is missing one of: ${RUNTIME_FILES.join(', ')}`);
	}
	const fingerprint = await computeFingerprint(resolvedTargetDir, copiedFiles);
	await writeRuntimeManifest(resolvedTargetDir, fingerprint, copiedFiles);
	await writeVersionModule(versionModulePath, fingerprint);
	return {
		sourceDir: resolvedSourceDir || resolvedTargetDir,
		targetDir: resolvedTargetDir,
		fingerprint,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmNimAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-nim from ${sourceDir} to ${targetDir}`);
}
