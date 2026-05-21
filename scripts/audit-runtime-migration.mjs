#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const BUILD_FILE_NAMES = new Set([
	'Cargo.lock',
	'Cargo.toml',
	'Dockerfile',
	'Makefile',
	'go.mod',
	'go.sum',
	'package-lock.json',
	'package.json',
	'pnpm-lock.yaml',
	'tsconfig.json',
	'tsconfig.build.json',
	'tsconfig.browser-harness.json',
	'vite.config.ts',
	'yarn.lock'
]);

const BUILD_EXTENSIONS = new Set([
	'.cs',
	'.csproj',
	'.go',
	'.js',
	'.json',
	'.mjs',
	'.patch',
	'.sh',
	'.ts',
	'.yaml',
	'.yml'
]);

const GENERATED_SEGMENTS = new Set([
	'.cache',
	'artifacts',
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

function isBuildFile(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	if (normalized.startsWith('.github/')) return true;
	if (hasGeneratedSegment(relativePath)) return false;
	const basename = path.basename(relativePath);
	if (BUILD_FILE_NAMES.has(basename)) return true;
	return BUILD_EXTENSIONS.has(path.extname(basename));
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
		if (entry.isFile() && isBuildFile(relativePath)) files.push(relativePath);
	}
	return files.sort();
}

async function auditRuntime(runtimeName) {
	const sourceDir = path.join(SOURCE_ROOT, runtimeName);
	const targetDir = path.join(REPO_ROOT, 'runtimes', runtimeName);
	if (!(await exists(sourceDir))) return [];
	const sourceFiles = await listFiles(sourceDir);
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
	console.log(`${runtimeName}: missing build files`);
	for (const file of missing) console.log(`  ${file}`);
}

if (failed) process.exitCode = 1;
