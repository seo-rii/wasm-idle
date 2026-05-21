#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_ROOT = path.resolve(REPO_ROOT, '..');

const MIGRATIONS = [
	['wasm-rust', 'wasm-rust', 'runtimes/wasm-rust'],
	['wasm-of-js-of-ocaml', 'wasm-of-js-of-ocaml', 'runtimes/wasm-of-js-of-ocaml'],
	['wasm-clang', 'wasm-clang', 'runtimes/wasm-clang'],
	['wasm-dotnet', 'wasm-dotnet', 'runtimes/wasm-dotnet'],
	['wasm-go', 'wasm-go', 'runtimes/wasm-go'],
	['wasm-tinygo', 'wasm-tinygo', 'runtimes/wasm-tinygo'],
	['wasm-typescript', 'wasm-typescript', 'runtimes/wasm-typescript'],
	['dool', 'dool', 'tools/dool']
];

const GENERATED_SEGMENTS = new Set([
	'.git',
	'.cache',
	'__pycache__',
	'bin',
	'coverage',
	'dist',
	'dist-ssr',
	'node_modules',
	'obj',
	'playwright-report',
	'public/tools',
	'public/vendor',
	'test-results',
	'tmp'
]);

function hasGeneratedSegment(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	const segments = normalized.split('/');
	return [...GENERATED_SEGMENTS].some((segment) => {
		if (segment.includes('/')) {
			return (
				normalized === segment ||
				normalized.startsWith(`${segment}/`) ||
				normalized.includes(`/${segment}/`)
			);
		}
		return segments.includes(segment);
	});
}

async function exists(filePath) {
	return Boolean(await stat(filePath).catch(() => null));
}

async function fingerprint(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function listFiles(rootDir, baseDir = rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		const relativePath = path.relative(baseDir, entryPath);
		if (hasGeneratedSegment(relativePath)) continue;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath, baseDir)));
			continue;
		}
		if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}

async function listGitTrackedAndUntrackedFiles(sourceDir) {
	try {
		const [tracked, untracked] = await Promise.all([
			execFileAsync('git', ['-C', sourceDir, 'ls-files'], { maxBuffer: 10 * 1024 * 1024 }),
			execFileAsync('git', ['-C', sourceDir, 'ls-files', '--others', '--exclude-standard'], {
				maxBuffer: 10 * 1024 * 1024
			})
		]);
		return [...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')]
			.map((file) => file.trim())
			.filter(Boolean)
			.filter((file) => !hasGeneratedSegment(file))
			.sort();
	} catch {
		return null;
	}
}

async function auditMigration([name, sourceRelativePath, targetRelativePath]) {
	const sourceDir = path.join(SOURCE_ROOT, sourceRelativePath);
	const targetDir = path.join(REPO_ROOT, targetRelativePath);
	if (!(await exists(sourceDir))) return { name, missing: [], changed: [], skipped: true };
	const sourceFiles =
		(await listGitTrackedAndUntrackedFiles(sourceDir)) || (await listFiles(sourceDir));
	const missing = [];
	const changed = [];
	for (const relativePath of sourceFiles) {
		const sourcePath = path.join(sourceDir, relativePath);
		const targetPath = path.join(targetDir, relativePath);
		if (!(await exists(targetPath))) {
			missing.push(relativePath);
			continue;
		}
		const [sourceHash, targetHash] = await Promise.all([
			fingerprint(sourcePath),
			fingerprint(targetPath)
		]);
		if (sourceHash !== targetHash) changed.push(relativePath);
	}
	return { name, missing, changed };
}

let failed = false;
for (const migration of MIGRATIONS) {
	const { name, missing, changed, skipped } = await auditMigration(migration);
	if (skipped) {
		console.log(`${name}: skipped (source checkout not found)`);
		continue;
	}
	if (missing.length === 0 && changed.length === 0) {
		console.log(`${name}: ok`);
		continue;
	}
	failed = true;
	console.log(`${name}: migration drift detected`);
	if (missing.length > 0) console.log('  missing source files:');
	for (const file of missing) console.log(`    ${file}`);
	if (changed.length > 0) console.log('  changed source files:');
	for (const file of changed) console.log(`    ${file}`);
}

if (failed) process.exitCode = 1;
