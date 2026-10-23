import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const patchPath = fileURLToPath(new URL('./patches/c3-lsp-reactor.patch', import.meta.url));
export const c3LspLock = JSON.parse(
	await readFile(new URL('./c3-lsp.lock.json', import.meta.url), 'utf8')
);
const names = ['c3_lsp.mjs', 'c3_lsp.wasm', 'stdlib.json.gz.bin'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyC3LspAsset(bytes, receipt, label) {
	if (!receipt || bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256)
		throw new Error(`C3 LSP ${label} differs from the pinned producer receipt`);
	return bytes;
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
		return verifyC3LspAsset(await readFile(filename), receipt, filename);
	} catch {}
	const response = await fetch(receipt.url, { signal: AbortSignal.timeout(180_000) });
	if (!response.ok) throw new Error(`C3 LSP input download failed: HTTP ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > receipt.bytes) throw new Error('C3 LSP input exceeds its pinned size');
		chunks.push(chunk);
	}
	const bytes = verifyC3LspAsset(Buffer.concat(chunks), receipt, filename);
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
			else if (entry.isFile() && /\.c3i?$/.test(filename))
				files[filename] = await readFile(path.join(directory, filename), 'utf8');
		}
	}
	await visit('');
	return gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
}

/** Build the original C3 dispatcher, lexer and handlers with a transport-only reactor patch. */
export async function buildC3Lsp({
	buildNative = false,
	outputDirectory = path.join(root, 'static/wasm-c3-lsp')
} = {}) {
	const lock = c3LspLock;
	if (Object.keys(lock.assets).sort().join() !== [...names].sort().join())
		throw new Error('C3 LSP lock is missing qualified assets');
	const patch = await readFile(patchPath);
	if (sha256(patch) !== lock.patchSha256) throw new Error('C3 LSP patch differs from its lock');
	const cache = path.join(
		root,
		'.cache/c3-lsp',
		`${lock.sources.server.commit}-${lock.patchSha256.slice(0, 16)}`
	);
	await mkdir(cache, { recursive: true });
	const source = path.join(cache, 'source');
	const original = path.join(cache, 'native-source');
	const compilerRoot = path.join(cache, 'compiler');
	const compiler = path.join(compilerRoot, 'c3c');
	const nativePath = path.join(original, 'build-native/lsp');
	let assets;
	try {
		assets = Object.fromEntries(
			await Promise.all(
				names.map(async (name) => [
					name,
					verifyC3LspAsset(
						await readFile(path.join(outputDirectory, name)),
						lock.assets[name],
						name
					)
				])
			)
		);
	} catch {
		assets = undefined;
	}
	if (!assets || buildNative) {
		if (process.platform !== 'linux' || process.arch !== 'x64')
			throw new Error('The pinned C3 LSP source producer requires Linux x64');
		for (const [label, receipt] of Object.entries(lock.sources))
			await input(receipt, path.join(cache, `${label}.tar.gz`));
		await input(lock.compiler, path.join(cache, 'compiler.tar.gz'));
		try {
			await readFile(path.join(compilerRoot, 'c3c'));
		} catch {
			await extract(path.join(cache, 'compiler.tar.gz'), compilerRoot);
		}
		try {
			await readFile(path.join(source, '.prepared'));
		} catch {
			const temporary = path.join(cache, `preparing-${randomUUID()}`);
			try {
				await extract(path.join(cache, 'server.tar.gz'), temporary);
				for (const label of ['lexer', 'argparse'])
					await extract(
						path.join(cache, `${label}.tar.gz`),
						path.join(temporary, `lib/${label}.c3l`)
					);
				await cp(temporary, original, { recursive: true });
				await run('patch', ['--batch', '-p1', '-i', patchPath], { cwd: temporary });
				await writeFile(path.join(temporary, '.prepared'), lock.patchSha256);
				await rename(temporary, source);
			} finally {
				await rm(temporary, { recursive: true, force: true });
			}
		}
	}
	if (!assets) {
		await input(lock.emscripten, path.join(cache, 'emscripten.tar.xz'));
		const sdk = path.join(cache, 'emscripten');
		try {
			await readFile(path.join(sdk, 'emscripten/emcc.py'));
		} catch {
			await extract(path.join(cache, 'emscripten.tar.xz'), sdk);
		}
		const config = path.join(cache, 'emscripten-config.py');
		await writeFile(
			config,
			`LLVM_ROOT = ${JSON.stringify(path.join(sdk, 'bin'))}\nBINARYEN_ROOT = ${JSON.stringify(sdk)}\nNODE_JS = [${JSON.stringify(process.execPath)}]\n`
		);
		const env = {
			...process.env,
			EM_CONFIG: config,
			EM_CACHE: path.join(cache, 'em-cache'),
			EMCC_CORES: '2',
			SOURCE_DATE_EPOCH: '0'
		};
		await run(
			compiler,
			[
				'build',
				'wasm-reactor',
				'-Oz',
				'-g0',
				'--no-entry',
				'--threads',
				'2',
				'--single-module=yes',
				'--build-dir',
				'build-wasm',
				'--output-dir',
				'build-wasm'
			],
			{ cwd: source, env }
		);
		const built = path.join(cache, 'built');
		await mkdir(built, { recursive: true });
		await run(
			'python3',
			[
				path.join(sdk, 'emscripten/emcc.py'),
				path.join(source, 'build-wasm/obj/emscripten/lsp.o'),
				'-Oz',
				'--no-entry',
				'-sMODULARIZE=1',
				'-sEXPORT_ES6=1',
				'-sENVIRONMENT=worker,node',
				'-sALLOW_MEMORY_GROWTH=1',
				'-sINITIAL_MEMORY=33554432',
				'-sMAXIMUM_MEMORY=268435456',
				'-sSTACK_SIZE=8388608',
				'-sFILESYSTEM=1',
				'-sFORCE_FILESYSTEM=1',
				'-sEXPORTED_RUNTIME_METHODS=["FS","HEAPU8"]',
				'-sEXPORTED_FUNCTIONS=["_lsp_init","_lsp_alloc","_lsp_free","_lsp_handle","_lsp_response_ptr","_lsp_response_len"]',
				'-o',
				path.join(built, 'c3_lsp.mjs')
			],
			{ env }
		);
		assets = {
			'c3_lsp.mjs': await readFile(path.join(built, 'c3_lsp.mjs')),
			'c3_lsp.wasm': await readFile(path.join(built, 'c3_lsp.wasm')),
			'stdlib.json.gz.bin': await stdlibSnapshot(path.join(compilerRoot, 'lib/std'))
		};
		for (const name of names) verifyC3LspAsset(assets[name], lock.assets[name], name);
	}
	if (buildNative)
		await run(
			compiler,
			[
				'build',
				'lsp',
				'-O2',
				'--threads',
				'2',
				'--build-dir',
				'build-native',
				'--output-dir',
				'build-native'
			],
			{ cwd: original }
		);
	await mkdir(outputDirectory, { recursive: true });
	for (const name of names) await writeFile(path.join(outputDirectory, name), assets[name]);
	const licenses = await Promise.all(
		['c3-lsp', 'c3-lexer', 'c3-argparse', 'c3-stdlib', 'c3-emscripten'].map(
			async (name) =>
				`${name}\n\n${await readFile(path.join(root, 'scripts/patches', `${name}.LICENSE`), 'utf8')}\n`
		)
	);
	await writeFile(path.join(outputDirectory, 'LICENSE'), licenses.join('\n'));
	await writeFile(
		path.join(outputDirectory, 'source.json'),
		`${JSON.stringify(lock, null, '\t')}\n`
	);
	return {
		directory: outputDirectory,
		...(buildNative ? { nativePath, stdlibDirectory: path.join(compilerRoot, 'lib/std') } : {})
	};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(await buildC3Lsp({ buildNative: process.argv.includes('--native') }));
