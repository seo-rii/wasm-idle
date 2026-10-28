import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const defaultLockPath = path.join(path.dirname(scriptPath), 'teavm/candidate-inputs.lock.json');
const logicalAssets = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compiler.wasm-deobfuscator.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
];

async function receipt(filePath) {
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of createReadStream(filePath)) {
		bytes += chunk.length;
		hash.update(chunk);
	}
	return { bytes, sha256: hash.digest('hex') };
}

async function verify(filePath, expected) {
	const actual = await receipt(filePath);
	if (
		actual.sha256 !== expected.sha256 ||
		(expected.bytes !== undefined && actual.bytes !== expected.bytes)
	) {
		throw new Error(`TeaVM candidate input differs from its lock: ${filePath}`);
	}
	return actual;
}

async function command(commandPath, args, cwd, env = process.env) {
	return execFile(commandPath, args, { cwd, env, maxBuffer: 16 * 1024 * 1024 });
}

async function buildCommand(args, cwd, env) {
	await new Promise((resolve, reject) => {
		const child = spawn('./gradlew', args, { cwd, env, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`TeaVM candidate Gradle build failed (${signal ?? code})`));
		});
	});
}

/**
 * Prepare the pinned source and migrated compatibility patches in a new directory.
 * This never publishes runtime assets or changes the existing 0.13.1 output receipts.
 */
export async function prepareTeaVmCandidate({
	sourceArchivePath,
	workDir,
	lockFilePath = defaultLockPath
}) {
	const lockBytes = await readFile(lockFilePath);
	const lock = JSON.parse(lockBytes);
	if (
		lock.format !== 'wasm-idle-teavm-candidate-inputs-v1' ||
		!/^[a-f0-9]{40}$/u.test(lock.source?.revision ?? '') ||
		!/^[a-f0-9]{40}$/u.test(lock.openjdk?.revision ?? '') ||
		!/^\d+\.\d+\.\d+$/u.test(lock.teavmVersion ?? '') ||
		!Array.isArray(lock.sourcePatches) ||
		lock.sourcePatches.length === 0
	) {
		throw new Error('Invalid TeaVM candidate input lock');
	}
	await verify(sourceArchivePath, lock.source.archive);
	const patches = [];
	for (const patch of lock.sourcePatches) {
		if (
			typeof patch.path !== 'string' ||
			!/^patches\/[a-zA-Z0-9_.-]+\.patch$/u.test(patch.path)
		) {
			throw new Error('Invalid TeaVM candidate patch path');
		}
		const patchPath = path.resolve(path.dirname(lockFilePath), patch.path);
		await verify(patchPath, patch);
		patches.push(patchPath);
	}
	const archive = path.resolve(sourceArchivePath);
	const target = path.resolve(workDir);
	// An existing directory may be another build or a published runtime. Never reuse it.
	await mkdir(target);
	const sourceDir = path.join(target, 'source');
	await mkdir(sourceDir);
	await command('tar', ['-xzf', archive, '--strip-components=1', '-C', sourceDir], target);
	const versions = await readFile(path.join(sourceDir, 'gradle/libs.versions.toml'), 'utf8');
	if (!versions.split(/\r?\n/u).includes(`teavm = "${lock.teavmVersion}"`)) {
		throw new Error('TeaVM candidate source does not use the pinned compiler version');
	}
	const properties = await readFile(path.join(sourceDir, 'gradle.properties'), 'utf8');
	if (!properties.split(/\r?\n/u).includes(`jdk.revision=${lock.openjdk.revision}`)) {
		throw new Error('TeaVM candidate javac source revision differs from its lock');
	}
	const wrapperPath = path.join(sourceDir, 'gradle/wrapper/gradle-wrapper.properties');
	const wrapper = await readFile(wrapperPath, 'utf8');
	if (
		!wrapper.replaceAll('\\:', ':').includes(`distributionUrl=${lock.gradle.distributionUrl}`)
	) {
		throw new Error('TeaVM candidate Gradle distribution differs from its lock');
	}
	const patchEnv = { ...process.env, GIT_CEILING_DIRECTORIES: target };
	for (const patch of patches) {
		await command('git', ['apply', '--check', patch], sourceDir, patchEnv);
		await command('git', ['apply', patch], sourceDir, patchEnv);
	}
	await writeFile(
		wrapperPath,
		`${wrapper.trimEnd()}\ndistributionSha256Sum=${lock.gradle.distributionSha256}\n`
	);
	await writeFile(path.join(target, 'candidate-inputs.lock.json'), lockBytes);
	await writeFile(
		path.join(target, 'candidate-status.json'),
		`${JSON.stringify({ profileId: lock.profileId, state: 'prepared', published: false }, null, 2)}\n`
	);
	return { target, sourceDir, lock };
}

/** Build only when explicitly invoked with a JDK archive. All outputs stay in workDir. */
export async function buildTeaVmCandidate(prepared, jdkArchivePath) {
	const { target, sourceDir, lock } = prepared;
	await verify(jdkArchivePath, lock.jdk.archive);
	const jdkRoot = path.join(target, 'jdk');
	await mkdir(jdkRoot);
	await command('tar', ['-xzf', path.resolve(jdkArchivePath), '-C', jdkRoot], target);
	const roots = (await readdir(jdkRoot, { withFileTypes: true })).filter((entry) =>
		entry.isDirectory()
	);
	if (roots.length !== 1) throw new Error('TeaVM candidate JDK must have one root directory');
	const javaHome = path.join(jdkRoot, roots[0].name);
	const release = await readFile(path.join(javaHome, 'release'), 'utf8');
	for (const [name, value] of Object.entries(lock.jdk.release)) {
		if (!release.split(/\r?\n/u).includes(`${name}="${value}"`)) {
			throw new Error(`TeaVM candidate JDK release identity differs for ${name}`);
		}
	}
	const env = {
		...process.env,
		JAVA_HOME: javaHome,
		GRADLE_USER_HOME: path.join(target, 'gradle-home'),
		PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`
	};
	await buildCommand(['--no-daemon', ':javac:downloadJDK'], sourceDir, env);
	await verify(
		path.join(sourceDir, 'javac/build', `jdk-${lock.openjdk.revision}.zip`),
		lock.openjdk.archive
	);
	// This is newly observed dependency evidence, to be reviewed before release lock promotion.
	await buildCommand(
		['--no-daemon', '--write-verification-metadata', 'sha256', ':compiler:createDist'],
		sourceDir,
		env
	);
	return packageTeaVmCandidate(prepared, env.GRADLE_RO_DEP_CACHE);
}

/** Package completed build outputs, including the deobfuscator omitted by TeaVM 0.16's dist ZIP. */
export async function packageTeaVmCandidate(prepared, readOnlyDependencyCache) {
	const { target, sourceDir, lock } = prepared;
	const deobfuscator = lock.deobfuscator;
	const jarName = `teavm-wasm-gc-deobfuscator-${lock.teavmVersion}.jar`;
	if (
		deobfuscator?.artifact?.name !== jarName ||
		deobfuscator?.resource?.path !== 'org/teavm/backend/wasm/deobfuscator.wasm'
	) {
		throw new Error('Invalid TeaVM candidate deobfuscator input lock');
	}
	let deobfuscatorJar;
	for (const cache of [path.join(target, 'gradle-home/caches'), readOnlyDependencyCache]) {
		if (!cache) continue;
		const versionDir = path.join(
			cache,
			'modules-2/files-2.1/org.teavm/teavm-wasm-gc-deobfuscator',
			lock.teavmVersion
		);
		const entries = await readdir(versionDir, { withFileTypes: true }).catch((error) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		});
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const candidate = path.join(versionDir, entry.name, jarName);
			const found = await stat(candidate).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			if (!found?.isFile()) continue;
			await verify(candidate, deobfuscator.artifact);
			deobfuscatorJar = candidate;
			break;
		}
		if (deobfuscatorJar) break;
	}
	if (!deobfuscatorJar)
		throw new Error('TeaVM candidate deobfuscator dependency was not resolved');
	const { stdout: deobfuscatorBytes } = await execFile(
		'unzip',
		['-p', deobfuscatorJar, deobfuscator.resource.path],
		{ encoding: 'buffer', maxBuffer: 1024 * 1024 }
	);
	if (
		deobfuscatorBytes.length !== deobfuscator.resource.bytes ||
		createHash('sha256').update(deobfuscatorBytes).digest('hex') !==
			deobfuscator.resource.sha256
	) {
		throw new Error('TeaVM candidate deobfuscator resource differs from its lock');
	}
	const distDir = path.join(target, 'dist');
	await mkdir(distDir);
	await command(
		'unzip',
		[
			'-q',
			path.join(sourceDir, 'compiler/build/distributions/dist.zip'),
			...logicalAssets.filter((asset) => asset !== 'compiler.wasm-deobfuscator.wasm'),
			'-d',
			distDir
		],
		target
	);
	await writeFile(path.join(distDir, 'compiler.wasm-deobfuscator.wasm'), deobfuscatorBytes);
	const outputs = [];
	for (const asset of logicalAssets) {
		const filePath = path.join(distDir, asset);
		if (!(await stat(filePath)).isFile())
			throw new Error(`Missing TeaVM candidate asset ${asset}`);
		outputs.push({ path: asset, ...(await receipt(filePath)) });
	}
	const buildReceipt = {
		format: 'wasm-idle-teavm-candidate-build-v1',
		profileId: lock.profileId,
		state: 'built-unvalidated',
		published: false,
		inputs: await receipt(path.join(target, 'candidate-inputs.lock.json')),
		gradleVerification: await receipt(path.join(sourceDir, 'gradle/verification-metadata.xml')),
		compatibility: lock.compatibility,
		outputs
	};
	await writeFile(
		path.join(target, 'candidate-status.json'),
		`${JSON.stringify(buildReceipt, null, 2)}\n`
	);
	return buildReceipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
	try {
		const [archive, workDir, jdkArchive, ...extra] = process.argv.slice(2);
		if (
			!archive ||
			!workDir ||
			extra.length ||
			[archive, workDir, jdkArchive].some((arg) => arg?.startsWith('-'))
		) {
			throw new Error(
				'Usage: node scripts/prepare-wasm-teavm-candidate.mjs <source.tar.gz> <new-work-dir> [jdk.tar.gz]'
			);
		}
		const prepared = await prepareTeaVmCandidate({ sourceArchivePath: archive, workDir });
		if (jdkArchive) await buildTeaVmCandidate(prepared, jdkArchive);
		console.log(
			`TeaVM ${prepared.lock.teavmVersion} candidate ${jdkArchive ? 'built; validation pending' : 'prepared'} at ${prepared.target}`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
