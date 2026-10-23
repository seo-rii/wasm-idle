import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'scripts/rescript-lsp-assets.lock.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyReScriptAsset(bytes, receipt, label = 'ReScript asset') {
	if (!receipt || bytes.length !== receipt.bytes || hash(bytes) !== receipt.sha256)
		throw Error(`${label} failed its pinned receipt`);
}

export async function syncReScriptLsp({
	targetDir = path.join(ROOT, 'static/wasm-rescript-lsp'),
	cacheDir = path.join(ROOT, '.cache/rescript-lsp-producer'),
	opamRoot = path.join(cacheDir, 'opam'),
	switchName = 'rescript-lsp',
	updateLock = false,
	rebuild = false
} = {}) {
	const lock = JSON.parse(await readFile(LOCK, 'utf8'));
	if (!rebuild && !updateLock && lock.assets) {
		try {
			for (const [name, receipt] of Object.entries(lock.assets))
				verifyReScriptAsset(await readFile(path.join(targetDir, name)), receipt, name);
			return { targetDir, cached: true };
		} catch {}
	}
	const sourceDirs = {};
	for (const [name, source] of Object.entries(lock.sources)) {
		const archive = path.join(cacheDir, 'archives', name + '.tar.gz');
		let bytes;
		try {
			bytes = await readFile(archive);
			verifyReScriptAsset(bytes, source, name);
		} catch {
			const response = await fetch(source.url);
			if (!response.ok) throw Error(`ReScript ${name} HTTP ${response.status}`);
			if (Number(response.headers.get('content-length')) > 96 * 1024 * 1024)
				throw Error('ReScript source archive exceeds limit');
			bytes = new Uint8Array(await response.arrayBuffer());
			verifyReScriptAsset(bytes, source, name);
			await mkdir(path.dirname(archive), { recursive: true });
			await writeFile(archive, bytes);
		}
		const listing = spawnSync('tar', ['-tzf', archive], {
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		});
		if (
			listing.status !== 0 ||
			listing.stdout
				.split('\n')
				.filter(Boolean)
				.some((name) => name.startsWith('/') || name.split('/').includes('..'))
		)
			throw Error('Invalid ReScript source archive paths');
		const directory = path.join(cacheDir, 'sources', name);
		await mkdir(directory, { recursive: true });
		const extracted = spawnSync(
			'tar',
			['-xzf', archive, '--strip-components=1', '-C', directory],
			{ stdio: 'inherit' }
		);
		if (extracted.status !== 0) throw Error('Cannot extract original ReScript source');
		sourceDirs[name] = directory;
	}
	const producer = path.join(ROOT, 'producers/rescript-language-server');
	const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
		cwd: producer,
		stdio: 'inherit'
	});
	if (install.status !== 0) throw Error('Cannot install isolated ReScript producer');
	const { buildReScriptLanguageServer } =
		await import('../producers/rescript-language-server/build.mjs');
	const result = await buildReScriptLanguageServer({
		sourceDirs,
		cacheDir,
		targetDir,
		opamRoot,
		switchName,
		lock
	});
	if (updateLock) {
		Object.assign(lock, result);
		await writeFile(LOCK, JSON.stringify(lock, null, '\t') + '\n');
	} else {
		if (!lock.assets) throw Error('ReScript assets require reviewed pinned output receipts');
		for (const [name, receipt] of Object.entries(lock.assets))
			verifyReScriptAsset(await readFile(path.join(targetDir, name)), receipt, name);
	}
	await writeFile(
		path.join(targetDir, 'runtime-manifest.json'),
		JSON.stringify(
			{
				format: 'wasm-idle-rescript-lsp-v1',
				version: lock.version,
				compilerVersion: lock.compilerVersion,
				sources: lock.sources,
				...result
			},
			null,
			'\t'
		) + '\n'
	);
	await writeFile(
		path.join(targetDir, 'SOURCE.txt'),
		Object.values(lock.sources)
			.map((s) => s.repository + '/tree/' + s.revision)
			.join('\n') +
			'\nReproduce with the pinned toolchain in scripts/rescript-lsp-assets.lock.json and pnpm run sync:rescript-lsp. Only the bsc Dune executable gains a bytecode build mode. Original parser, compiler, analysis and LSP handler sources remain unchanged.\n'
	);
	const profile = {
		version: lock.version,
		compilerVersion: lock.compilerVersion,
		assets: lock.assets,
		decoded: lock.decoded
	};
	const profilePath = path.join(ROOT, 'packages/lsp/src/rescript/profile.ts');
	if (updateLock) {
		await mkdir(path.dirname(profilePath), { recursive: true });
		await writeFile(
			profilePath,
			'// Generated from the reviewed ReScript LSP asset lock.\nexport const RESCRIPT_LSP_PROFILE = ' +
				JSON.stringify(profile, null, '\t') +
				' as const;\n'
		);
	}
	return { targetDir, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			'target-dir': { type: 'string' },
			'cache-dir': { type: 'string' },
			'opam-root': { type: 'string' },
			switch: { type: 'string' },
			'update-lock': { type: 'boolean' },
			rebuild: { type: 'boolean' }
		}
	});
	console.log(
		JSON.stringify(
			await syncReScriptLsp({
				targetDir: values['target-dir'] && path.resolve(values['target-dir']),
				cacheDir: values['cache-dir'] && path.resolve(values['cache-dir']),
				opamRoot: values['opam-root'] && path.resolve(values['opam-root']),
				switchName: values.switch,
				updateLock: values['update-lock'],
				rebuild: values.rebuild
			})
		)
	);
}
