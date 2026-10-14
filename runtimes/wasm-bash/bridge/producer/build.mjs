// Opt-in experiment. Never calls or updates the existing Bash producer/distribution.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, link, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBashShim, LOCK_SHA256, readProducerLock, sha256 } from './verify.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const HERE = path.dirname(THIS_FILE),
	BRIDGE = path.resolve(HERE, '..');
const REPOSITORY = path.resolve(HERE, '../../../..');
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const REDIRECT_HOSTS = new Set([
	'github.com',
	'codeload.github.com',
	'release-assets.githubusercontent.com',
	'objects.githubusercontent.com'
]);

export function parseOptions(args) {
	const options = { jobs: 2, webc: false, download: false, fetchOnly: false, plan: false };
	const seen = new Set();
	for (let i = 0; i < args.length; i++) {
		const key = args[i];
		assert(!seen.has(key), `duplicate option: ${key}`);
		seen.add(key);
		if (['--plan', '--download', '--fetch-only', '--webc'].includes(key)) {
			options[
				{
					'--plan': 'plan',
					'--download': 'download',
					'--fetch-only': 'fetchOnly',
					'--webc': 'webc'
				}[key]
			] = true;
		} else if (['--output', '--cache', '--jobs'].includes(key)) {
			const value = args[++i];
			assert(value && !value.startsWith('--'), `missing ${key} value`);
			if (key === '--jobs') {
				assert(/^[1-4]$/.test(value), '--jobs must be an integer from 1 to 4');
				options.jobs = Number(value);
			} else {
				assert(
					path.isAbsolute(value) && /^[A-Za-z0-9_/.-]+$/.test(value),
					`${key} requires an absolute ASCII path without shell/make metacharacters`
				);
				const absolute = path.resolve(value);
				assert(
					absolute !== REPOSITORY && !absolute.startsWith(`${REPOSITORY}/`),
					`${key} must be outside this source checkout`
				);
				options[key.slice(2)] = absolute;
			}
		} else assert.fail(`unknown option: ${key}`);
	}
	assert(
		!options.plan ||
			(!options.download && !options.fetchOnly && !options.output && !options.cache),
		'--plan cannot download or create output/cache'
	);
	assert(
		!options.fetchOnly || (options.download && !options.output),
		'--fetch-only requires --download and forbids --output'
	);
	if (!options.plan) {
		assert(options.cache, 'required --cache');
		assert(
			options.fetchOnly || options.output,
			'required --output (or --download --fetch-only)'
		);
		if (options.output) {
			assert(
				options.output !== options.cache &&
					!options.output.startsWith(`${options.cache}/`) &&
					!options.cache.startsWith(`${options.output}/`),
				'output and cache must be disjoint'
			);
		}
	}
	return options;
}

export async function verifyLocalSources(lock) {
	assert.equal(
		sha256(await readFile(path.resolve(HERE, lock.baselineRecipe.path))),
		lock.baselineRecipe.sha256,
		'unchanged original producer recipe'
	);
	const files = {};
	for (const [relative, digest] of Object.entries(lock.sdkPrerequisite.localFiles)) {
		const bytes = await readFile(path.join(BRIDGE, relative));
		assert.equal(sha256(bytes), digest, `source dependency identity: ${relative}`);
		files[relative] = { bytes: bytes.length, sha256: digest };
	}
	return files;
}

export async function verifyArchive(file, expectedSha256) {
	const info = await lstat(file);
	assert(info.isFile() && !info.isSymbolicLink(), `archive must be a regular file: ${file}`);
	assert(info.size > 0 && info.size <= MAX_ARCHIVE_BYTES, 'archive size bound');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	const digest = hash.digest('hex');
	assert.equal(
		digest,
		expectedSha256,
		`archive SHA-256 mismatch: ${path.basename(file)}; existing data was preserved`
	);
	return { bytes: info.size, sha256: digest };
}

async function ensurePrivateDirectory(directory) {
	await mkdir(directory, { mode: 0o700 }).catch((error) => {
		if (error.code !== 'EEXIST') throw error;
	});
	const info = await lstat(directory);
	assert(info.isDirectory() && !info.isSymbolicLink(), 'cache must be a real directory');
	assert.equal(await realpath(directory), directory, 'cache ancestor must not be a symlink');
	assert.equal(info.uid, process.getuid(), 'cache must be owned by the current user');
	assert.equal(info.mode & 0o077, 0, 'cache must be private (chmod 700 before use)');
}

async function fetchPinned(input, destination, signal) {
	let url = input.url,
		response;
	for (let redirects = 0; redirects <= 5; redirects++) {
		const parsed = new URL(url);
		assert(
			parsed.protocol === 'https:' &&
				!parsed.username &&
				!parsed.password &&
				REDIRECT_HOSTS.has(parsed.hostname),
			'unapproved producer download/redirect URL'
		);
		response = await fetch(url, { credentials: 'omit', redirect: 'manual', signal });
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		const location = response.headers.get('location');
		assert(location && redirects < 5, 'missing/excessive producer redirect');
		url = new URL(location, url).href;
		await response.body?.cancel();
	}
	assert.equal(
		response.status,
		200,
		`source download HTTP ${response.status}; only complete responses accepted`
	);
	assert(!response.headers.has('content-range'), 'partial source archive response rejected');
	const declared = response.headers.get('content-length');
	if (declared !== null)
		assert(
			/^\d+$/.test(declared) && Number(declared) <= MAX_ARCHIVE_BYTES,
			'download size bound'
		);
	assert(response.body, 'empty producer response body');
	const partial = `${destination}.partial-${process.pid}-${randomUUID()}`;
	const file = await open(partial, 'wx', 0o600);
	const hash = createHash('sha256');
	let bytes = 0;
	try {
		for await (const chunk of response.body) {
			bytes += chunk.length;
			assert(bytes <= MAX_ARCHIVE_BYTES, 'download size bound');
			hash.update(chunk);
			await file.writeFile(chunk);
		}
		assert(bytes > 0, 'empty producer archive');
		assert.equal(
			hash.digest('hex'),
			input.sha256,
			'download archive SHA-256 mismatch; partial file retained for diagnosis'
		);
		await file.sync();
	} finally {
		await file.close();
	}
	// Publish without overwriting a concurrent writer or any mismatching cache entry.
	await link(partial, destination).catch(async (error) => {
		if (error.code !== 'EEXIST') throw error;
		await verifyArchive(destination, input.sha256);
	});
	return verifyArchive(destination, input.sha256);
}

export function compilerWrapper(clang, resource, object) {
	for (const value of [clang, resource, object])
		assert(/^[A-Za-z0-9_/.-]+$/.test(value), 'unsafe compiler wrapper path');
	return `#!/bin/sh
set -eu
link=1
if [ "$#" = 0 ] || { [ "$#" = 1 ] && [ "$1" = -v ]; }; then link=0; fi
for arg in "$@"; do
  case "$arg" in
    --) break ;;
    -c|-S|-E|-M|-MM|-fsyntax-only|--version|--help|--help-hidden|-help|-dumpmachine|-dumpversion|-print-*|--print-*) link=0 ;;
  esac
done
if [ "$link" = 1 ]; then
  exec '${clang}' -resource-dir '${resource}' '${object}' "$@"
fi
exec '${clang}' -resource-dir '${resource}' "$@"
`;
}

export async function buildBashShim(options) {
	const lock = await readProducerLock();
	const localFiles = await verifyLocalSources(lock);
	const producerFiles = {};
	for (const name of [
		'build.mjs',
		'verify.mjs',
		'inputs.lock.json',
		'README.md',
		'build.test.mjs'
	]) {
		const bytes = await readFile(path.join(HERE, name));
		producerFiles[name] = { bytes: bytes.length, sha256: sha256(bytes) };
	}
	const required = [
		'source',
		'sysroot',
		'toolchain',
		'binaryen',
		...(options.webc ? ['wasmer'] : [])
	];
	if (options.plan)
		return {
			status: 'plan-only-no-download-no-build',
			lockSha256: LOCK_SHA256,
			inputs: required.map((name) => ({ name, ...lock.inputs[name] })),
			localFiles,
			producerFiles,
			jobs: options.jobs,
			buildTarget: 'shell',
			shimTarget: 'wasm32-wasmer-wasi',
			qualification: 'not-run; SDK/browser execution remains a separate gate'
		};
	assert(
		process.platform === 'linux' && process.arch === 'x64',
		'producer is pinned to linux-x64'
	);
	if (options.output) {
		assert.equal(
			await lstat(options.output).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			}),
			null,
			'output must be fresh; existing data was preserved'
		);
		assert.equal(
			await realpath(path.dirname(options.output)),
			path.dirname(options.output),
			'output parent must exist without symlink ancestors'
		);
	}
	await ensurePrivateDirectory(options.cache);
	const abort = new AbortController();
	const onSignal = () => abort.abort();
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	const archives = {},
		identities = {};
	let receipt;
	const save = async () =>
		writeFile(
			path.join(options.output, 'build-receipt.json'),
			`${JSON.stringify(receipt, null, 2)}\n`,
			{ mode: 0o600 }
		);
	try {
		for (const name of required) {
			const input = lock.inputs[name],
				destination = path.join(options.cache, input.filename);
			const present = await lstat(destination).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			assert(
				present || options.download,
				`missing pinned ${name} archive; use --download explicitly`
			);
			identities[name] = present
				? await verifyArchive(destination, input.sha256)
				: await fetchPinned(input, destination, abort.signal);
			archives[name] = destination;
		}
		if (options.fetchOnly)
			return { status: 'inputs-verified-not-built', lockSha256: LOCK_SHA256, identities };
		await mkdir(options.output, { mode: 0o700 }); // No recursive creation or removal/replacement.
		receipt = {
			schemaVersion: 1,
			status: 'building',
			producerVerified: false,
			runtimeQualified: false,
			startedAt: new Date().toISOString(),
			sourceRevision: lock.sourceRevision,
			lockSha256: LOCK_SHA256,
			baselineRecipe: lock.baselineRecipe,
			inputs: Object.fromEntries(
				required.map((name) => [name, { ...lock.inputs[name], ...identities[name] }])
			),
			localFiles,
			producerFiles,
			sdkPrerequisite: lock.sdkPrerequisite,
			recipe: {
				jobs: options.jobs,
				upstreamTarget: 'shell',
				sourceDateEpoch: lock.sourceDateEpoch,
				shimTarget: 'wasm32-wasmer-wasi',
				wrapper: 'link-time execve object; original configure and Asyncify recipe unchanged'
			},
			commands: [],
			artifacts: {},
			limitations: [
				'No SDK binary, real Bash execution, JS host command registry or common fd/VFS qualification',
				'No shell MVP, terminal/job-control, cancellation or performance qualification',
				'Bash source and local bridge materials are included; corresponding-source review for linked WASIX libc/runtime libraries remains a release gate'
			]
		};
		await save();
		const work = path.join(options.output, 'work');
		await mkdir(work);
		const source = path.join(work, 'bash'),
			sysroot = path.join(work, 'wasix-libc/sysroot32');
		const toolchain = path.join(work, 'wasi-sdk'),
			binaryen = path.join(work, 'binaryen');
		const wasmer = path.join(work, 'wasmer'),
			resource = path.join(work, 'clang-resource');
		const temp = path.join(work, 'tmp'),
			output = path.join(options.output, 'candidate');
		for (const directory of [
			source,
			sysroot,
			toolchain,
			binaryen,
			resource,
			temp,
			output,
			...(options.webc ? [wasmer] : [])
		])
			await mkdir(directory, { recursive: true });
		const env = {
			PATH: `${toolchain}/bin:${binaryen}/bin:/usr/bin:/bin`,
			LC_ALL: 'C',
			SOURCE_DATE_EPOCH: lock.sourceDateEpoch,
			TZ: 'UTC',
			ZERO_AR_DATE: '1',
			TMPDIR: temp
		};
		const run = async (command, args, cwd = work, capture = false) => {
			const entry = {
				command,
				args,
				cwd,
				startedAt: new Date().toISOString(),
				exitCode: null
			};
			receipt.commands.push(entry);
			await save();
			const start = performance.now();
			let stdout = '';
			try {
				await new Promise((resolve, reject) => {
					const child = spawn(command, args, {
						cwd,
						env,
						stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
						signal: abort.signal
					});
					if (capture)
						child.stdout.on('data', (chunk) => {
							stdout += chunk.toString('utf8');
							if (stdout.length > 16384) {
								child.kill();
								reject(new Error('native version output exceeded 16 KiB'));
							}
						});
					child.once('error', reject);
					child.once('close', (code, signal) => {
						entry.exitCode = code;
						entry.signal = signal;
						if (code === 0) resolve();
						else
							reject(
								new Error(
									`producer command failed: ${command}; code=${code}; signal=${signal}`
								)
							);
					});
				});
				if (capture) entry.stdout = stdout;
				return stdout;
			} finally {
				entry.elapsedMs = performance.now() - start;
				await save();
			}
		};
		for (const [name, directory, strip] of [
			['source', source, true],
			['sysroot', sysroot, true],
			['toolchain', toolchain, true],
			['binaryen', binaryen, true],
			...(options.webc ? [['wasmer', wasmer, false]] : [])
		]) {
			await run('tar', [
				'-xzf',
				archives[name],
				'-C',
				directory,
				'--no-same-owner',
				...(strip ? ['--strip-components=1'] : [])
			]);
		}
		const license = await readFile(path.join(source, 'COPYING'));
		assert.equal(sha256(license), lock.licenseSha256, 'original GNU Bash license');
		receipt.recipe.upstreamBuildFiles = [];
		for (const name of ['Makefile', 'makefile', 'GNUmakefile', 'configure', 'Makefile.in']) {
			const bytes = await readFile(path.join(source, name)).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			if (bytes)
				receipt.recipe.upstreamBuildFiles.push({
					path: name,
					bytes: bytes.length,
					sha256: sha256(bytes)
				});
		}
		await cp(path.join(toolchain, 'lib/clang/16'), resource, { recursive: true });
		await mkdir(path.join(resource, 'lib/wasm32-wasmer-wasi'), { recursive: true });
		await cp(
			path.join(sysroot, 'lib/wasm32-wasi/libclang_rt.builtins-wasm32.a'),
			path.join(resource, 'lib/wasm32-wasmer-wasi/libclang_rt.builtins.a')
		);
		const clang = path.join(toolchain, 'bin/clang-16'),
			wasmOpt = path.join(binaryen, 'bin/wasm-opt');
		const clangVersion = await run(clang, ['--version'], work, true);
		const binaryenVersion = await run(wasmOpt, ['--version'], work, true);
		assert.match(clangVersion, /\bclang version 16\.0\.0\b/, 'pinned native Clang version');
		assert.match(binaryenVersion, /\bwasm-opt version 108\b/, 'pinned native Binaryen version');
		const object = path.join(work, 'execve.o'),
			shim = path.join(work, 'execve.c');
		await cp(path.join(BRIDGE, 'execve.c'), shim);
		await run(clang, [
			'--target=wasm32-wasmer-wasi',
			`--sysroot=${sysroot}`,
			'-resource-dir',
			resource,
			'-O2',
			'-pthread',
			'-matomics',
			'-mbulk-memory',
			'-mmutable-globals',
			'-msign-ext',
			'-c',
			shim,
			'-o',
			object
		]);
		const objectBytes = await readFile(object);
		receipt.artifacts.shimObject = { bytes: objectBytes.length, sha256: sha256(objectBytes) };
		const wrapper = path.join(work, 'clang-with-exec-shim');
		await writeFile(wrapper, compilerWrapper(clang, resource, object), { mode: 0o700 });
		await run(
			'make',
			[`-j${options.jobs}`, `CC=${wrapper}`, `LLD_PATH=${toolchain}/bin`, 'shell'],
			source
		);
		const wasm = path.join(output, 'bash-exec-shim.wasm');
		await run(wasmOpt, ['--strip-debug', path.join(source, 'shell.wasm'), '-o', wasm]);
		receipt.artifacts.wasm = inspectBashShim(await readFile(wasm), lock);
		await writeFile(path.join(output, 'LICENSE.txt'), license);
		receipt.artifacts.license = {
			sha256: sha256(license),
			bytes: license.length,
			spdx: 'GPL-3.0-or-later'
		};
		if (options.webc) {
			const manifest = `[package]\nname = "wasm-idle/bash-exec-shim"\nversion = "0.0.0"\ndescription = "Unqualified source-pinned Bash exec ABI candidate"\nlicense = "GPL-3.0-or-later"\nwasmer-extra-flags = "--enable-threads --enable-bulk-memory"\nentrypoint = "bash"\n\n[[module]]\nname = "bash"\nsource = "bash-exec-shim.wasm"\nabi = "wasi"\n\n[[command]]\nname = "bash"\nmodule = "bash"\nrunner = "wasi@unstable_"\n\n[[command]]\nname = "sh"\nmodule = "bash"\nrunner = "wasi@unstable_"\n`;
			await writeFile(path.join(output, 'wasmer.toml'), manifest);
			const cli = path.join(wasmer, 'bin/wasmer');
			assert.match(
				await run(cli, ['--version'], work, true),
				/\bwasmer 7\.2\.0\b/,
				'pinned native Wasmer version'
			);
			await run(
				cli,
				['package', 'build', '--out', path.join(output, 'bash-exec-shim.webc')],
				output
			);
			const webc = await readFile(path.join(output, 'bash-exec-shim.webc'));
			assert(webc.length > 0, 'WEBc builder must produce bytes');
			receipt.artifacts.webc = {
				bytes: webc.length,
				sha256: sha256(webc),
				packagingVerified: true,
				guestExecution: 'not-run'
			};
		}
		const sources = path.join(options.output, 'source-materials');
		await mkdir(sources);
		await cp(archives.source, path.join(sources, lock.inputs.source.filename));
		await cp(path.join(source, 'COPYING'), path.join(sources, 'COPYING'));
		for (const relative of Object.keys(localFiles)) {
			const destination = path.join(
				sources,
				'repository/runtimes/wasm-bash/bridge',
				relative
			);
			await mkdir(path.dirname(destination), { recursive: true });
			await cp(path.join(BRIDGE, relative), destination);
		}
		const producerMaterials = path.join(
			sources,
			'repository/runtimes/wasm-bash/bridge/producer'
		);
		await mkdir(producerMaterials);
		for (const name of Object.keys(producerFiles))
			await cp(path.join(HERE, name), path.join(producerMaterials, name));
		const originalProducer = path.join(sources, 'repository/runtimes/wasm-bash/scripts');
		await mkdir(originalProducer);
		await cp(
			path.resolve(HERE, lock.baselineRecipe.path),
			path.join(originalProducer, 'prepare-runtime.mjs')
		);
		const generatedConfiguration = path.join(sources, 'generated-configuration');
		await mkdir(generatedConfiguration);
		for (const name of [
			'config.h',
			'config.status',
			'config.log',
			'config.cache',
			'Makefile'
		]) {
			if (
				await lstat(path.join(source, name)).catch((error) => {
					if (error.code === 'ENOENT') return null;
					throw error;
				})
			)
				await cp(path.join(source, name), path.join(generatedConfiguration, name));
		}
		await cp(wrapper, path.join(sources, 'clang-with-exec-shim'));
		await writeFile(
			path.join(sources, 'commands.json'),
			`${JSON.stringify(receipt.commands, null, 2)}\n`
		);
		await run('tar', [
			'--sort=name',
			`--mtime=@${lock.sourceDateEpoch}`,
			'--owner=0',
			'--group=0',
			'--numeric-owner',
			'-czf',
			path.join(options.output, 'source-materials.tar.gz'),
			'-C',
			sources,
			'.'
		]);
		const sourcePack = await readFile(path.join(options.output, 'source-materials.tar.gz'));
		receipt.artifacts.sourceMaterials = {
			bytes: sourcePack.length,
			sha256: sha256(sourcePack),
			completeReleaseSourcePack: false
		};
		// Recheck local dependencies and source archives after compilation, before success.
		await verifyLocalSources(lock);
		for (const [name, identity] of Object.entries(producerFiles)) {
			const bytes = await readFile(path.join(HERE, name));
			assert.deepEqual(
				{ bytes: bytes.length, sha256: sha256(bytes) },
				identity,
				`producer file changed during build: ${name}`
			);
		}
		for (const name of required)
			assert.deepEqual(
				await verifyArchive(archives[name], lock.inputs[name].sha256),
				identities[name],
				'input changed during build'
			);
		receipt.status = 'built-imports-verified-not-runtime-qualified';
		receipt.producerVerified = true;
		receipt.finishedAt = new Date().toISOString();
		await save();
		return {
			output: options.output,
			receipt: 'build-receipt.json',
			status: receipt.status,
			producerVerified: true,
			runtimeQualified: false
		};
	} catch (error) {
		if (receipt) {
			receipt.status = abort.signal.aborted ? 'cancelled' : 'failed';
			receipt.error = String(error);
			receipt.finishedAt = new Date().toISOString();
			await save();
		}
		throw error;
	} finally {
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		console.log(
			JSON.stringify(await buildBashShim(parseOptions(process.argv.slice(2))), null, 2)
		);
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
