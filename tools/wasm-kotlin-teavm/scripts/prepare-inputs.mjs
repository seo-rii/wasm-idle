#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(THIS_DIR, '..');
const CACHE_DIR = path.join(PROJECT_DIR, '.cache');
const KOTLIN_VERSION = process.env.KOTLIN_COMPILER_VERSION || '2.3.21';
const TROVE4J_VERSION = '1.0.20200330';

async function exists(filePath) {
	const stats = await stat(filePath).catch(() => null);
	return !!stats;
}

async function run(command, args, options = {}) {
	console.log(`$ ${command} ${args.join(' ')}`);
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			...options
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} exited with code ${code}`));
			}
		});
	});
}

async function extractTarball(tarball, targetDir) {
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await run('tar', ['-xzf', tarball, '-C', targetDir]);
}

async function main() {
	await mkdir(CACHE_DIR, { recursive: true });

	const npmPackDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-kotlin-teavm-npm-'));
	try {
		await run('npm', [
			'pack',
			`kotlin-compiler@${KOTLIN_VERSION}`,
			'--pack-destination',
			npmPackDir
		]);
		const tarballs = (await readdir(npmPackDir)).filter((name) => name.endsWith('.tgz'));
		if (tarballs.length !== 1) {
			throw new Error(`Expected one kotlin-compiler tarball, found ${tarballs.length}`);
		}
		await extractTarball(
			path.join(npmPackDir, tarballs[0]),
			path.join(CACHE_DIR, 'kotlin-compiler')
		);
	} finally {
		await rm(npmPackDir, { recursive: true, force: true });
	}

	const troveDir = path.join(CACHE_DIR, 'trove4j');
	const troveJar = path.join(troveDir, `trove4j-${TROVE4J_VERSION}.jar`);
	await mkdir(troveDir, { recursive: true });
	if (!(await exists(troveJar))) {
		await run('curl', [
			'-L',
			'--fail',
			'--output',
			troveJar,
			`https://repo1.maven.org/maven2/org/jetbrains/intellij/deps/trove4j/${TROVE4J_VERSION}/trove4j-${TROVE4J_VERSION}.jar`
		]);
	}

	console.log(
		`KOTLIN_COMPILER_LIB_DIR=${path.join(CACHE_DIR, 'kotlin-compiler', 'package', 'lib')}`
	);
	console.log(`TROVE4J_JAR=${troveJar}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
