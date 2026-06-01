#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_KOTLIN_LIB_DIR = path.resolve(REPO_ROOT, 'node_modules', 'kotlin-compiler', 'lib');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-kotlin-jvm');
const DEFAULT_CHEERPJ_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'cheerpj', '4.3');
const DEFAULT_PATCH_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-kotlin-jvm', 'src');

const REQUIRED_KOTLIN_JARS = [
	'kotlin-compiler.jar',
	'kotlin-stdlib.jar',
	'kotlin-reflect.jar',
	'kotlin-script-runtime.jar',
	'kotlinx-coroutines-core-jvm.jar',
	'annotations-13.0.jar'
];

/**
 * @typedef {{
 *   kotlinLibDir?: string;
 *   targetDir?: string;
 *   cheerpjDir?: string;
 *   cheerpjTargetDir?: string;
 *   trove4jJar?: string;
 *   patchJarPath?: string;
 *   patchSourceDir?: string;
 *   javacPath?: string;
 *   jarPath?: string;
 * }} SyncWasmKotlinJvmOptions
 */

/** @param {string} filePath */
async function fileExists(filePath) {
	const stats = await stat(filePath).catch(() => null);
	return !!stats?.isFile();
}

/** @param {string} dirPath */
async function directoryExists(dirPath) {
	const stats = await stat(dirPath).catch(() => null);
	return !!stats?.isDirectory();
}

/**
 * @param {string} filePath
 * @param {string} label
 */
async function assertJar(filePath, label) {
	const header = await readFile(filePath);
	if (
		header.byteLength < 4 ||
		header[0] !== 0x50 ||
		header[1] !== 0x4b ||
		header[2] !== 0x03 ||
		header[3] !== 0x04
	) {
		throw new Error(`${label} is not a valid jar file: ${filePath}`);
	}
}

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 */
async function copyDirectoryContents(sourceDir, targetDir) {
	await mkdir(targetDir, { recursive: true });
	for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
		await cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), {
			recursive: true
		});
	}
}

/**
 * @param {string} kotlinLibDir
 * @param {string | undefined} explicitJar
 */
async function resolveTrove4jJar(kotlinLibDir, explicitJar) {
	if (explicitJar) return explicitJar;
	const exact = path.join(kotlinLibDir, 'trove4j.jar');
	if (await fileExists(exact)) return exact;
	for (const entry of await readdir(kotlinLibDir).catch(() => [])) {
		if (/^trove4j[-.].*\.jar$/i.test(entry)) return path.join(kotlinLibDir, entry);
	}
	throw new Error(
		`trove4j jar was not found in ${kotlinLibDir}. Pass --trove4j-jar or TROVE4J_JAR; Kotlin 2.x expects org.jetbrains.intellij.deps:trove4j, for example trove4j-1.0.20200330.jar.`
	);
}

/**
 * @param {{
 *   kotlinLibDir: string;
 *   patchSourceDir: string;
 *   outputJarPath: string;
 *   javacPath: string;
 *   jarPath: string;
 * }} options
 */
async function buildPatchJar({ kotlinLibDir, patchSourceDir, outputJarPath, javacPath, jarPath }) {
	const sourcePath = path.join(
		patchSourceDir,
		'org',
		'jetbrains',
		'kotlin',
		'util',
		'PerformanceManager.java'
	);
	if (!(await fileExists(sourcePath))) {
		throw new Error(`Kotlin browser patch source was not found at ${sourcePath}.`);
	}

	const classesDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-kotlin-patch-'));
	try {
		const classPath = [
			path.join(kotlinLibDir, 'kotlin-compiler.jar'),
			path.join(kotlinLibDir, 'kotlin-stdlib.jar')
		].join(path.delimiter);
		await execFileAsync(javacPath, ['-cp', classPath, '-d', classesDir, sourcePath]);
		await execFileAsync(jarPath, ['cf', outputJarPath, '-C', classesDir, '.']);
	} finally {
		await rm(classesDir, { recursive: true, force: true });
	}
	await assertJar(outputJarPath, 'Kotlin browser patch jar');
}

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const options = {};
	/** @type {string[]} */
	const positional = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}
		const [key, inlineValue] = arg.slice(2).split('=', 2);
		if (key === 'help') {
			options.help = true;
			continue;
		}
		const value = inlineValue ?? argv[++index];
		if (!value) throw new Error(`Missing value for --${key}`);
		options[key] = value;
	}
	return { options, positional };
}

function usage() {
	console.log(`Usage:
  node scripts/sync-wasm-kotlin-jvm.mjs --kotlin-lib-dir <dir> [--cheerpj-dir <dir>]

Options:
  --kotlin-lib-dir       Kotlin compiler lib directory containing kotlin-compiler.jar.
                         Defaults to KOTLIN_COMPILER_LIB_DIR or node_modules/kotlin-compiler/lib.
  --trove4j-jar          trove4j jar path when it is not present in the Kotlin lib directory.
  --patch-jar            Prebuilt kotlinc-browser-patch.jar to copy instead of building it.
  --cheerpj-dir          Licensed CheerpJ 4.3 runtime directory to copy to static/cheerpj/4.3.
                         Defaults to CHEERPJ_RUNTIME_DIR when set.
  --target-dir           Kotlin static target directory. Defaults to static/wasm-kotlin-jvm.
  --cheerpj-target-dir   CheerpJ static target directory. Defaults to static/cheerpj/4.3.

CheerpJ self-hosting requires an appropriate CheerpJ license. This script never downloads CheerpJ
runtime files; it only copies a runtime directory you provide.
`);
}

/** @param {SyncWasmKotlinJvmOptions} [options] */
export async function syncWasmKotlinJvmAssets({
	kotlinLibDir = process.env.KOTLIN_COMPILER_LIB_DIR || DEFAULT_KOTLIN_LIB_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	cheerpjDir = process.env.CHEERPJ_RUNTIME_DIR || '',
	cheerpjTargetDir = DEFAULT_CHEERPJ_TARGET_DIR,
	trove4jJar = process.env.TROVE4J_JAR || '',
	patchJarPath = '',
	patchSourceDir = DEFAULT_PATCH_SOURCE_DIR,
	javacPath = process.env.JAVAC || 'javac',
	jarPath = process.env.JAR || 'jar'
} = {}) {
	if (!(await directoryExists(kotlinLibDir))) {
		throw new Error(
			`Kotlin compiler lib directory was not found at ${kotlinLibDir}. Install or unpack the kotlin-compiler distribution and pass --kotlin-lib-dir.`
		);
	}

	for (const jarName of REQUIRED_KOTLIN_JARS) {
		await assertJar(path.join(kotlinLibDir, jarName), jarName);
	}
	const resolvedTrove4jJar = await resolveTrove4jJar(kotlinLibDir, trove4jJar);
	await assertJar(resolvedTrove4jJar, 'trove4j.jar');
	if (patchJarPath) await assertJar(patchJarPath, 'kotlinc-browser-patch.jar');

	await rm(targetDir, { recursive: true, force: true });
	const libTargetDir = path.join(targetDir, 'lib');
	await mkdir(libTargetDir, { recursive: true });
	for (const jarName of REQUIRED_KOTLIN_JARS) {
		await cp(path.join(kotlinLibDir, jarName), path.join(libTargetDir, jarName));
	}
	await cp(resolvedTrove4jJar, path.join(libTargetDir, 'trove4j.jar'));
	if (patchJarPath) {
		await cp(patchJarPath, path.join(libTargetDir, 'kotlinc-browser-patch.jar'));
	} else {
		await buildPatchJar({
			kotlinLibDir,
			patchSourceDir,
			outputJarPath: path.join(libTargetDir, 'kotlinc-browser-patch.jar'),
			javacPath,
			jarPath
		});
	}

	let copiedCheerpj = false;
	if (cheerpjDir) {
		if (!(await directoryExists(cheerpjDir))) {
			throw new Error(`CheerpJ runtime directory was not found at ${cheerpjDir}.`);
		}
		await rm(cheerpjTargetDir, { recursive: true, force: true });
		await copyDirectoryContents(cheerpjDir, cheerpjTargetDir);
		copiedCheerpj = true;
	} else {
		console.warn(
			'Skipped CheerpJ runtime sync. Set CHEERPJ_RUNTIME_DIR or pass --cheerpj-dir with a licensed CheerpJ 4.3 runtime directory.'
		);
	}

	return {
		kotlinLibDir,
		targetDir,
		cheerpjDir,
		cheerpjTargetDir,
		copiedCheerpj,
		trove4jJar: resolvedTrove4jJar
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		const { options, positional } = parseArgs(process.argv.slice(2));
		if (options.help) {
			usage();
			process.exit(0);
		}
		const result = await syncWasmKotlinJvmAssets({
			kotlinLibDir:
				(options['kotlin-lib-dir'] && String(options['kotlin-lib-dir'])) ||
				positional[0] ||
				undefined,
			targetDir: (options['target-dir'] && String(options['target-dir'])) || positional[1],
			cheerpjDir: options['cheerpj-dir'] ? String(options['cheerpj-dir']) : undefined,
			cheerpjTargetDir: options['cheerpj-target-dir']
				? String(options['cheerpj-target-dir'])
				: undefined,
			trove4jJar: options['trove4j-jar'] ? String(options['trove4j-jar']) : undefined,
			patchJarPath: options['patch-jar'] ? String(options['patch-jar']) : undefined
		});
		console.log(`Synced Kotlin/JVM compiler jars to ${result.targetDir}`);
		console.log(
			result.copiedCheerpj
				? `Synced CheerpJ runtime to ${result.cheerpjTargetDir}`
				: 'CheerpJ runtime was not copied.'
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
