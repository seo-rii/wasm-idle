#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_ROOT = path.resolve(REPO_ROOT, '..');

const RUNTIMES = [
	'wasm-rust',
	'wasm-of-js-of-ocaml',
	'wasm-clang',
	'wasm-dotnet',
	'wasm-go',
	'wasm-tinygo',
	'wasm-typescript'
];

const GENERATED_SEGMENTS = new Set([
	'.git',
	'.cache',
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
			return normalized === segment || normalized.startsWith(`${segment}/`) || normalized.includes(`/${segment}/`);
		}
		return segments.includes(segment);
	});
}

async function exists(filePath) {
	return Boolean(await stat(filePath).catch(() => null));
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

async function auditRuntime(runtimeName) {
	const sourceDir = path.join(SOURCE_ROOT, runtimeName);
	const targetDir = path.join(REPO_ROOT, 'runtimes', runtimeName);
	if (!(await exists(sourceDir))) return [];
	const sourceFiles = (await listGitTrackedAndUntrackedFiles(sourceDir)) || (await listFiles(sourceDir));
	const missing = [];
	for (const relativePath of sourceFiles) {
		if (!(await exists(path.join(targetDir, relativePath)))) missing.push(relativePath);
	}
	return missing;
}

let failed = false;
for (const runtimeName of RUNTIMES) {
	const missing = await auditRuntime(runtimeName);
	if (missing.length === 0) {
		console.log(`${runtimeName}: ok`);
		continue;
	}
	failed = true;
	console.log(`${runtimeName}: missing runtime source files`);
	for (const file of missing) console.log(`  ${file}`);
}

if (failed) process.exitCode = 1;
