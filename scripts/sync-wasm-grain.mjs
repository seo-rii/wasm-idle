#!/usr/bin/env node
// Rebuilds static/wasm-grain from the pinned upstream Grain 0.7.2 release.
//
// Upstream's release binary is a `pkg` bundle whose snapshot contains the official js_of_ocaml
// compiler build (cli/bin/grainc.bc.js, produced by `dune build @js`) and the @grain/stdlib
// sources. This script extracts those files byte-for-byte, verifies their pinned hashes, uses the
// same in-memory host as the browser worker to precompile the stdlib objects with that compiler,
// and writes gzip receipts plus the code-pinned profile module.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { brotliDecompressSync, gzipSync } from 'node:zlib';
import {
	GRAIN_STDLIB_OBJECT_MTIME_MS,
	GRAIN_STDLIB_PACK_FORMAT,
	GRAIN_STDLIB_ROOT,
	GRAIN_STDLIB_SOURCE_MTIME_MS,
	createGrainCompilerHost,
	readGrainStdlibPack
} from './runtime-workers/grain-host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receiptFor = (bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) });

export const GRAIN_RELEASE = Object.freeze({
	version: '0.7.2',
	tag: 'grain-v0.7.2',
	commit: '49829d7966b38b177291f7e91f5eb81c65ec07aa',
	binaryUrl: 'https://github.com/grain-lang/grain/releases/download/grain-v0.7.2/grain-linux-x64',
	binary: {
		bytes: 79_185_888,
		sha256: '82658891d33f5431e7bd260f0c00b8e86c43eb9182c5327f41db25d60b54dadd'
	},
	compilerSnapshotPath: '/snapshot/grain/cli/bin/grainc.bc.js',
	compiler: {
		bytes: 20_872_240,
		sha256: '0a85cf0120aafd873e41eb901a18090453010f8f819074b77c14e1c359cafd1e'
	},
	stdlibSnapshotRoot: '/snapshot/grain/stdlib/',
	licenses: {
		'LICENSE-grain-compiler.txt': {
			url: 'https://raw.githubusercontent.com/grain-lang/grain/49829d7966b38b177291f7e91f5eb81c65ec07aa/LICENSE',
			spdx: 'LGPL-3.0',
			sha256: '8224a89fea46649b1ec4338c71a736d4a358e799ef239dfbe592a10bfb4df7ec'
		},
		'LICENSE-grain-stdlib.txt': {
			url: 'https://raw.githubusercontent.com/grain-lang/grain/49829d7966b38b177291f7e91f5eb81c65ec07aa/stdlib/LICENSE',
			spdx: 'MIT',
			sha256: '7a7e23ff2b9f4a275793b20ef057195e11f4637d4e5cedaa0c64387eeb7ab30c'
		}
	}
});
export const GRAIN_PROFILE_ID = 'grain-0.7.2-jsoo-wasi-v1';

async function fetchPinned(url, expectedSha256, cacheName) {
	const cachePath = path.join(root, '.cache/grain', cacheName);
	try {
		const cached = await readFile(cachePath);
		if (sha256(cached) === expectedSha256) return cached;
	} catch {
		// Download below.
	}
	const response = await fetch(url, { redirect: 'follow' });
	if (!response.ok) throw new Error(`Grain download failed (${response.status}): ${url}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (sha256(bytes) !== expectedSha256) throw new Error(`Grain download hash mismatch: ${url}`);
	await mkdir(path.dirname(cachePath), { recursive: true });
	await writeFile(cachePath, bytes);
	return bytes;
}

/** Read the files of a `pkg` (yao-pkg 6) snapshot: ELF, then payload, then prelude + VFS index. */
export function extractPkgSnapshot(binary) {
	const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
	if (view.getUint32(0, false) !== 0x7f454c46 || binary[4] !== 2 || binary[5] !== 1) {
		throw new Error('Grain release binary is not a little-endian ELF64 executable');
	}
	const sectionHeaderOffset = Number(view.getBigUint64(0x28, true));
	const payloadStart =
		sectionHeaderOffset + view.getUint16(0x3a, true) * view.getUint16(0x3c, true);
	const tail = Buffer.from(binary.subarray(binary.length - 1_048_576)).toString('latin1');
	const entryMarker = '\n,\n"/snapshot/grain/cli/bin/grain.js"\n,\n';
	const entryIndex = tail.lastIndexOf(entryMarker);
	const vfsIndex = tail.lastIndexOf('\n{"', entryIndex) + 1;
	if (entryIndex < 0 || vfsIndex <= 0) throw new Error('Grain pkg snapshot index was not found');
	const vfs = JSON.parse(tail.slice(vfsIndex, entryIndex));
	const rest = tail.slice(entryIndex + entryMarker.length).split('\n,\n');
	const dictionary = JSON.parse(rest[1]);
	if (rest[2].trim().replace(/\n\);[\s\S]*$/u, '') !== '2') {
		throw new Error('Grain pkg snapshot is not Brotli compressed');
	}
	const names = Object.fromEntries(Object.entries(dictionary).map(([name, id]) => [id, name]));
	const files = new Map();
	for (const [key, stores] of Object.entries(vfs)) {
		const content = stores['1'];
		if (!content) continue;
		const [offset, size] = content;
		const snapshotPath = key
			.split('/')
			.map((id) => names[id])
			.join('/');
		files.set(
			snapshotPath,
			new Uint8Array(
				brotliDecompressSync(
					binary.subarray(payloadStart + offset, payloadStart + offset + size)
				)
			)
		);
	}
	return files;
}

/** Run upstream grainc.bc.js in a fresh realm through the browser worker's host. */
export function runGrainc(script, files, argv) {
	const decoder = new TextDecoder();
	let output = '';
	const collect = (chunk) => (output += decoder.decode(chunk));
	const host = createGrainCompilerHost({ files, argv, onStdout: collect, onStderr: collect });
	const context = createContext({
		process: host.process,
		require: host.require,
		console,
		TextDecoder,
		TextEncoder
	});
	try {
		script.runInContext(context);
	} catch (error) {
		if (host.exitCode() === null) throw error;
	}
	return { status: host.exitCode() ?? 0, output, files: host.files() };
}

export function writeGrainStdlibPack(files) {
	const sorted = [...files].sort((left, right) => (left.path < right.path ? -1 : 1));
	const header = Buffer.from(
		JSON.stringify({
			format: GRAIN_STDLIB_PACK_FORMAT,
			files: sorted.map(({ path, data }) => ({ path, size: data.length }))
		})
	);
	const length = Buffer.alloc(4);
	length.writeUInt32LE(header.length);
	return new Uint8Array(Buffer.concat([length, header, ...sorted.map(({ data }) => data)]));
}

export function precompileGrainStdlib(compiler, sources) {
	const script = new Script(Buffer.from(compiler).toString('utf8'), { filename: 'grainc.bc.js' });
	let files = sources.map(({ path: name, data }) => ({
		path: `${GRAIN_STDLIB_ROOT}/${name}`,
		data,
		mtimeMs: GRAIN_STDLIB_SOURCE_MTIME_MS
	}));
	for (const { path: name } of sources) {
		const object = `${GRAIN_STDLIB_ROOT}/${name.replace(/\.gr$/u, '.gro')}`;
		if (files.some((file) => file.path === object)) continue;
		// `--no-link` compiles the module (and its dependencies) to .gro objects only.
		const result = runGrainc(script, files, [
			'--stdlib',
			GRAIN_STDLIB_ROOT,
			'--no-color',
			'--no-link',
			'-o',
			'/work/stdlib-module.wasm',
			`${GRAIN_STDLIB_ROOT}/${name}`
		]);
		if (result.status !== 0) throw new Error(`Grain stdlib ${name} failed:\n${result.output}`);
		files = result.files
			.filter((file) => file.path.startsWith(`${GRAIN_STDLIB_ROOT}/`))
			.map((file) => ({
				...file,
				mtimeMs: file.path.endsWith('.gro')
					? GRAIN_STDLIB_OBJECT_MTIME_MS
					: GRAIN_STDLIB_SOURCE_MTIME_MS
			}));
		if (!files.some((file) => file.path === object)) {
			throw new Error(`Grain stdlib ${name} did not produce ${object}`);
		}
		process.stdout.write(`Precompiled Grain stdlib ${name}\n`);
	}
	return files.map((file) => ({
		path: file.path.slice(GRAIN_STDLIB_ROOT.length + 1),
		data: file.data
	}));
}

export async function syncGrain() {
	const binary = await fetchPinned(
		GRAIN_RELEASE.binaryUrl,
		GRAIN_RELEASE.binary.sha256,
		'grain-linux-x64'
	);
	const snapshot = extractPkgSnapshot(binary);
	const compiler = snapshot.get(GRAIN_RELEASE.compilerSnapshotPath);
	if (
		!compiler ||
		JSON.stringify(receiptFor(compiler)) !== JSON.stringify(GRAIN_RELEASE.compiler)
	) {
		throw new Error('Grain release snapshot compiler does not match the pinned grainc.bc.js');
	}
	const sources = [...snapshot]
		.filter(
			([name]) => name.startsWith(GRAIN_RELEASE.stdlibSnapshotRoot) && name.endsWith('.gr')
		)
		.map(([name, data]) => ({
			path: name.slice(GRAIN_RELEASE.stdlibSnapshotRoot.length),
			data
		}));
	const stdlibVersion = JSON.parse(
		Buffer.from(snapshot.get(`${GRAIN_RELEASE.stdlibSnapshotRoot}package.json`)).toString(
			'utf8'
		)
	).version;
	if (stdlibVersion !== GRAIN_RELEASE.version || sources.length < 70) {
		throw new Error('Grain release snapshot stdlib is not the pinned version');
	}
	const pack = writeGrainStdlibPack(precompileGrainStdlib(compiler, sources));
	if (readGrainStdlibPack(pack).length !== sources.length * 2) {
		throw new Error('Every Grain stdlib module must ship its precompiled object');
	}
	const files = {
		'grainc.js.gz.bin': gzipSync(compiler, { level: 9 }),
		'stdlib.pack.gz.bin': gzipSync(pack, { level: 9 })
	};
	for (const [name, license] of Object.entries(GRAIN_RELEASE.licenses)) {
		files[name] = await fetchPinned(license.url, license.sha256, name);
	}
	const profile = {
		profileId: GRAIN_PROFILE_ID,
		grainVersion: GRAIN_RELEASE.version,
		compilerJavaScript: receiptFor(compiler),
		compilerStorage: receiptFor(files['grainc.js.gz.bin']),
		stdlibPack: receiptFor(pack),
		stdlibStorage: receiptFor(files['stdlib.pack.gz.bin'])
	};
	files['runtime-build.json'] = Buffer.from(
		JSON.stringify(
			{
				format: 'wasm-idle-grain-runtime-build-v1',
				profile,
				source: {
					repository: 'https://github.com/grain-lang/grain',
					tag: GRAIN_RELEASE.tag,
					commit: GRAIN_RELEASE.commit,
					releaseAsset: { url: GRAIN_RELEASE.binaryUrl, ...GRAIN_RELEASE.binary },
					compiler: {
						snapshotPath: GRAIN_RELEASE.compilerSnapshotPath,
						builtBy: 'js_of_ocaml 6.0.1 (upstream `dune build @js`)'
					},
					stdlib: {
						snapshotRoot: GRAIN_RELEASE.stdlibSnapshotRoot,
						modules: sources.length
					}
				},
				licenses: Object.fromEntries(
					Object.entries(GRAIN_RELEASE.licenses).map(([name, license]) => [
						name,
						{ spdx: license.spdx, url: license.url, sha256: license.sha256 }
					])
				),
				notes: 'grainc.bc.js embeds Binaryen (Apache-2.0) compiled to JavaScript; stdlib .gro objects are produced by this exact compiler.'
			},
			null,
			'\t'
		) + '\n'
	);
	const host = await readFile(path.join(root, 'scripts/runtime-workers/grain-host.mjs'), 'utf8');
	const worker = await readFile(
		path.join(root, 'scripts/runtime-workers/wasm-grain-runner-worker.js'),
		'utf8'
	);
	if (worker.split('__WASM_IDLE_GRAIN_PROFILE__').length !== 2)
		throw new Error('Grain worker profile placeholder must occur exactly once');
	files['runner-worker.js'] = Buffer.from(
		host.replace(/^export /gm, '') +
			'\n' +
			worker.replace('__WASM_IDLE_GRAIN_PROFILE__', JSON.stringify(profile))
	);
	const { format, resolveConfig } = await import('prettier');
	const versionModulePath = path.join(root, 'src/lib/playground/wasmGrainVersion.ts');
	const version = await format(
		'// Generated by scripts/sync-wasm-grain.mjs from the pinned upstream Grain release.\n' +
			`export const bundledGrainProfile = ${JSON.stringify(profile)} as const;\n` +
			`export const bundledGrainWorkerReceipt = ${JSON.stringify(receiptFor(files['runner-worker.js']))} as const;\n`,
		{ ...(await resolveConfig(versionModulePath)), parser: 'typescript' }
	);
	const target = path.join(root, 'static/wasm-grain');
	const staging = `${target}.staging`;
	await rm(staging, { recursive: true, force: true });
	await mkdir(staging, { recursive: true });
	for (const [name, bytes] of Object.entries(files))
		await writeFile(path.join(staging, name), bytes);
	await rm(target, { recursive: true, force: true });
	await rename(staging, target);
	await writeFile(versionModulePath, version);
	console.log(`Synced Grain ${GRAIN_RELEASE.version} to ${target}`);
	for (const [name, bytes] of Object.entries(files))
		console.log(`  ${name}: ${bytes.length} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await syncGrain();
}
