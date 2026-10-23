import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'scripts/fennel-lsp-assets.lock.json');
const OUTPUT = path.join(ROOT, 'static/wasm-fennel-lsp');
const PROFILE = path.join(ROOT, 'packages/lsp/src/fennel/profile.ts');
const requireLua = createRequire(path.join(ROOT, 'runtimes/wasm-lua/package.json'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receipt = (bytes) => ({ bytes: bytes.length, sha256: hash(bytes) });

export function verifyBytes(bytes, expected, label) {
	if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) {
		throw new Error(`${label} failed pinned size/SHA-256 verification`);
	}
	return bytes;
}

// Read files into Lua's private build filesystem; never extract an archive onto the host.
export function sourceFiles(archive) {
	const tar = gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 });
	const result = new Map();
	for (let offset = 0; offset + 512 <= tar.length;) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const text = (start, length) =>
			header
				.subarray(start, start + length)
				.toString()
				.split('\0')[0];
		const name = [text(345, 155), text(0, 100)].filter(Boolean).join('/');
		const size = Number.parseInt(text(124, 12).trim() || '0', 8);
		const checksum = Number.parseInt(text(148, 8).trim(), 8);
		let actual = 0;
		for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : header[i];
		if (
			!Number.isSafeInteger(size) ||
			size < 0 ||
			actual !== checksum ||
			offset + 512 + size > tar.length
		) {
			throw new Error('Invalid Fennel source tar header');
		}
		const components = name.split('/');
		if (
			name.startsWith('/') ||
			components.some((part) => part === '..' || part.includes('\\'))
		) {
			throw new Error('Unsafe Fennel source path');
		}
		const relative = components.slice(1).join('/');
		const type = header[156];
		if ((type === 0 || type === 48) && relative) {
			if (result.has(relative)) throw new Error('Duplicate Fennel source file');
			result.set(relative, Uint8Array.from(tar.subarray(offset + 512, offset + 512 + size)));
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	if (!result.has('src/fennel-ls/cli.fnl') || !result.has('deps/fennel.lua')) {
		throw new Error('The source archive does not contain fennel-ls');
	}
	return result;
}

export async function compileServer(files) {
	const { LuaFactory } = requireLua('wasmoon');
	const factory = new LuaFactory(requireLua.resolve('wasmoon/dist/glue.wasm'));
	for (const [name, bytes] of files) {
		if (/^(src|deps)\/.*\.(fnl|fnlm|lua)$/u.test(name)) {
			await factory.mountFile(`/fennel-ls/${name}`, bytes);
		}
	}
	const lua = await factory.createEngine();
	try {
		// Same compiler and bundling switches as upstream's Makefile. The existing
		// handle-one-message entry runs the original dispatcher and diagnostic queue.
		return await lua.doString(`
local fennel = dofile('/fennel-ls/deps/fennel.lua')
package.path = '/fennel-ls/deps/?.lua;' .. package.path
fennel.path = '/fennel-ls/src/?.fnl;/fennel-ls/deps/?.fnl'
fennel['macro-path'] = '/fennel-ls/src/?.fnlm;' .. fennel['macro-path']
return fennel.compileString('(require :fennel-ls.cli)', {
  requireAsInclude = true,
  skipInclude = {'fennel.compiler', 'fennel.specials'},
  lambdaAsFn = true
})
`);
	} finally {
		lua.global.close();
	}
}

async function engineModule() {
	const result = await build({
		stdin: {
			contents: "export { LuaFactory } from 'wasmoon';",
			resolveDir: path.join(ROOT, 'runtimes/wasm-lua')
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
		minify: true,
		plugins: [
			{
				name: 'unused-node-loader',
				setup(esbuild) {
					esbuild.onResolve(
						{ filter: /^(node:)?(fs|path|child_process|crypto|url|module)$/ },
						(args) => ({
							path: args.path,
							namespace: 'unused-node-loader'
						})
					);
					esbuild.onLoad({ filter: /.*/, namespace: 'unused-node-loader' }, () => ({
						contents: 'export default {};',
						loader: 'js'
					}));
				}
			}
		]
	});
	return result.outputFiles[0].contents;
}

export async function syncFennelLsp({ archivePath, updateLock = false } = {}) {
	const lock = JSON.parse(await readFile(LOCK, 'utf8'));
	const wasmoonPackage = requireLua('wasmoon/package.json');
	if (wasmoonPackage.version !== lock.wasmoon) throw new Error('Unexpected Wasmoon version');
	let archive;
	if (archivePath) archive = await readFile(archivePath);
	else {
		const response = await fetch(lock.upstream.url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) throw new Error(`Fennel source download failed: HTTP ${response.status}`);
		const chunks = [];
		let length = 0;
		for await (const chunk of response.body) {
			length += chunk.length;
			if (length > lock.upstream.bytes) throw new Error('Fennel source exceeds pinned size');
			chunks.push(chunk);
		}
		archive = Buffer.concat(chunks);
	}
	verifyBytes(archive, lock.upstream, 'Fennel source');
	const files = sourceFiles(archive);
	const assets = {
		'fennel-ls.lua': Buffer.from(await compileServer(files)),
		'engine.mjs': await engineModule(),
		'lua.wasm': await readFile(requireLua.resolve('wasmoon/dist/glue.wasm')),
		'LICENSE.fennel-ls': files.get('LICENSE'),
		'LICENSE.wasmoon': await readFile(requireLua.resolve('wasmoon/LICENSE'))
	};
	const receipts = Object.fromEntries(
		Object.entries(assets).map(([name, bytes]) => [name, receipt(bytes)])
	);
	if (!updateLock) {
		for (const [name, bytes] of Object.entries(assets)) {
			if (!lock.assets[name]) throw new Error(`Missing pinned receipt: ${name}`);
			verifyBytes(bytes, lock.assets[name], name);
		}
	} else {
		lock.assets = receipts;
		await writeFile(LOCK, `${JSON.stringify(lock, null, '\t')}\n`);
	}
	await mkdir(OUTPUT, { recursive: true });
	for (const [name, bytes] of Object.entries(assets))
		await writeFile(path.join(OUTPUT, name), bytes);
	await mkdir(path.dirname(PROFILE), { recursive: true });
	const profileSource = `// Generated by scripts/sync-fennel-lsp.mjs from the pinned upstream source.\nexport const FENNEL_LSP_PROFILE = ${JSON.stringify({ revision: lock.upstream.revision, assets: receipts }, null, '\t')} as const;\n`;
	await writeFile(
		PROFILE,
		await format(profileSource, { ...(await resolveConfig(PROFILE)), parser: 'typescript' })
	);
	return { output: OUTPUT, revision: lock.upstream.revision, assets: receipts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const sourceIndex = process.argv.indexOf('--source-archive');
	const result = await syncFennelLsp({
		archivePath: sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined,
		updateLock: process.argv.includes('--update-lock')
	});
	console.log(JSON.stringify(result));
}
