import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCK = path.join(ROOT, 'scripts/cobol-lsp-assets.lock.json');
const PROFILE = path.join(ROOT, 'packages/lsp/src/cobol/profile.ts');
const receipt = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

/** Adapt only js_of_ocaml 5.3's VM trampoline budget for a browser worker stack.
 * This is caml_callback/caml_stack_depth from runtime/jslib.js, never COBOL analysis.
 */
export function adaptSuperbolBrowserRuntime(bytes) {
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const primitive = 'do{eB=40;try{c=V(c.joo_tramp,c.joo_args)}';
	if (source.split(primitive).length !== 2)
		throw new Error('Unexpected SuperBOL js_of_ocaml trampoline');
	return Buffer.from(source.replace(primitive, primitive.replace('eB=40', 'eB=4')));
}

export function verifyCobolLspAsset(bytes, expected, label) {
	if (bytes.length !== expected.bytes || receipt(bytes).sha256 !== expected.sha256)
		throw new Error(`${label} failed pinned size/SHA-256 verification`);
	return bytes;
}

async function fetchPinned(url, expected) {
	const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`COBOL LSP asset HTTP ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > expected.bytes) throw new Error('COBOL LSP download exceeds pinned size');
		chunks.push(chunk);
	}
	return verifyCobolLspAsset(Buffer.concat(chunks), expected, url);
}

export async function syncCobolLsp({
	archivePath,
	targetDir = path.join(ROOT, 'static/wasm-cobol-lsp'),
	updateLock = false
} = {}) {
	const lock = JSON.parse(await readFile(LOCK, 'utf8'));
	const cached = archivePath || path.join(ROOT, '.cache/cobol-lsp/superbol-0.3.0.vsix');
	let archive;
	try {
		archive = await readFile(cached);
	} catch (error) {
		if (archivePath || error.code !== 'ENOENT') throw error;
		archive = await fetchPinned(lock.release.url, lock.release);
		await mkdir(path.dirname(cached), { recursive: true });
		await writeFile(cached, archive);
	}
	verifyCobolLspAsset(archive, lock.release, 'Official SuperBOL OSS VSIX');
	const selected = new Set([
		lock.serverPath,
		'extension/LICENSE.md',
		...Object.keys(lock.configurations)
	]);
	const extracted = unzipSync(archive, { filter: ({ name }) => selected.has(name) });
	const server = verifyCobolLspAsset(
		extracted[lock.serverPath],
		lock.server,
		'Original COBOL LSP JavaScript'
	);
	const browserServer = adaptSuperbolBrowserRuntime(server);
	const license = verifyCobolLspAsset(
		extracted['extension/LICENSE.md'],
		lock.license,
		'Original SuperBOL license'
	);
	const configuration = Buffer.from(
		JSON.stringify({
			format: 'wasm-idle-superbol-config-v1',
			files: Object.entries(lock.configurations).map(([name, expected]) => ({
				path: name.slice('extension/'.length),
				content: new TextDecoder('utf-8', { fatal: true }).decode(
					verifyCobolLspAsset(extracted[name], expected, name)
				)
			}))
		})
	);
	const host = (
		await build({
			entryPoints: [path.join(ROOT, 'scripts/runtime-workers/cobol-lsp-host.mjs')],
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'esm',
			target: 'es2022',
			minify: true,
			tsconfigRaw: { compilerOptions: { target: 'ES2022' } }
		})
	).outputFiles[0].contents;
	const gpl = await fetchPinned(lock.gnucobol.license.url, lock.gnucobol.license);
	const assets = {
		'superbol-free.js.gz.bin': gzipSync(server, { level: 9 }),
		'superbol-browser.mjs.gz.bin': gzipSync(browserServer, { level: 9 }),
		'gnucobol-config.json.gz.bin': gzipSync(configuration, { level: 9 }),
		'host.mjs': host,
		'LICENSE.superbol.md': license,
		'LICENSE.gnucobol.txt': gpl,
		'SOURCE.txt': Buffer.from(
			`Original SuperBOL Studio OSS ${lock.version}\nhttps://github.com/OCamlPro/superbol-studio-oss/tree/${lock.revision}\nhttps://github.com/OCamlPro/superbol-studio-oss/archive/${lock.revision}.tar.gz\nOriginal universal build: make vsix-release TARGET_PLAT=universal (see upstream Makefile.vsix-rules and its opam dependency manifests).\nBundled GnuCOBOL configuration source: https://github.com/OCamlPro/gnucobol/tree/${lock.gnucobol.revision}/config\nThe raw original server and dialect configuration bytes are unmodified. The browser runtime changes only js_of_ocaml 5.3's caml_callback trampoline stack budget from 40 to 4 to fit browser workers; every COBOL parser/handler byte is preserved. Original runtime source: https://github.com/ocsigen/js_of_ocaml/blob/5.3.0/runtime/jslib.js Browser-only filesystem/stdio adapters: scripts/runtime-workers/cobol-lsp-host.mjs and packages/lsp/src/cobol in wasm-idle.\n`
		)
	};
	const receipts = Object.fromEntries(
		Object.entries(assets).map(([name, bytes]) => [name, receipt(bytes)])
	);
	if (updateLock) {
		lock.assets = receipts;
		lock.browserServer = receipt(browserServer);
		lock.configuration = receipt(configuration);
		await writeFile(LOCK, JSON.stringify(lock, null, '\t') + '\n');
	} else {
		verifyCobolLspAsset(browserServer, lock.browserServer, 'Browser module packaging');
		verifyCobolLspAsset(configuration, lock.configuration, 'COBOL dialect configuration pack');
		for (const [name, bytes] of Object.entries(assets)) {
			if (!lock.assets[name]) throw new Error(`Missing COBOL asset receipt: ${name}`);
			verifyCobolLspAsset(bytes, lock.assets[name], name);
		}
	}
	await mkdir(targetDir, { recursive: true });
	for (const [name, bytes] of Object.entries(assets))
		await writeFile(path.join(targetDir, name), bytes);
	const profile = {
		version: lock.version,
		revision: lock.revision,
		server: lock.server,
		browserServer: receipt(browserServer),
		configuration: receipt(configuration),
		assets: receipts
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.json'),
		JSON.stringify({ format: 'wasm-idle-cobol-lsp-v1', ...profile }, null, '\t') + '\n'
	);
	await mkdir(path.dirname(PROFILE), { recursive: true });
	await writeFile(
		PROFILE,
		await format(
			`// Generated by scripts/sync-cobol-lsp.mjs.\nexport const COBOL_LSP_PROFILE = ${JSON.stringify(profile)} as const;\n`,
			{ ...(await resolveConfig(PROFILE)), parser: 'typescript' }
		)
	);
	return { targetDir, profile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(await syncCobolLsp({ updateLock: process.argv.includes('--update-lock') }));
