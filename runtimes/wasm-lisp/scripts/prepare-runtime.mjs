import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(THIS_FILE), '..');
const distRoot = path.join(projectRoot, 'dist');
const vendorRoot = path.join(distRoot, 'vendor');
const compilerComponentPath = path.join(projectRoot, 'vendor', 'puppy-scheme', 'puppyc.wasm');
const preview2ShimRoot = path.join(
	projectRoot,
	'node_modules',
	'@bytecodealliance',
	'preview2-shim',
	'lib'
);
const jcoRoot = path.join(projectRoot, 'node_modules', '@bytecodealliance', 'jco');

async function listFiles(rootDir) {
	const entries = await fs.readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

async function copyTree(sourceRoot, targetRoot) {
	for (const filePath of await listFiles(sourceRoot)) {
		const targetPath = path.join(targetRoot, path.relative(sourceRoot, filePath));
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.copyFile(filePath, targetPath);
	}
}

function toImportPath(fromFilePath, targetPath) {
	const relativePath = path
		.relative(path.dirname(fromFilePath), targetPath)
		.replaceAll(path.sep, '/');
	return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function replaceQuotedSpecifier(input, specifier, replacement) {
	return input
		.replaceAll(`'${specifier}'`, `'${replacement}'`)
		.replaceAll(`"${specifier}"`, `"${replacement}"`);
}

async function rewriteBareImports() {
	const preview2ShimVendorRoot = path.join(vendorRoot, 'preview2-shim');
	const jcoVendorRoot = path.join(vendorRoot, 'jco');
	const replacementTargets = [
		{
			specifier: '@bytecodealliance/jco/component',
			targetPath: path.join(jcoVendorRoot, 'src', 'browser.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'index.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/cli',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'cli.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/clocks',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'clocks.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/filesystem',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'filesystem.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/io',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'io.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/random',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'random.js')
		}
	];

	for (const filePath of await listFiles(distRoot)) {
		if (!filePath.endsWith('.js')) continue;
		const current = await fs.readFile(filePath, 'utf8');
		let next = current;
		for (const rule of replacementTargets) {
			if (!next.includes(rule.specifier)) continue;
			next = replaceQuotedSpecifier(
				next,
				rule.specifier,
				toImportPath(filePath, rule.targetPath)
			);
		}
		if (next !== current) await fs.writeFile(filePath, next);
	}
}

async function writeBuildMetadata() {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(distRoot)) {
		if (filePath.endsWith('runtime-build.json')) continue;
		hash.update(path.relative(distRoot, filePath));
		hash.update('\0');
		hash.update(await fs.readFile(filePath));
		hash.update('\n');
	}
	await fs.writeFile(
		path.join(distRoot, 'runtime-build.json'),
		`${JSON.stringify(
			{
				upstream: 'puppy-scheme',
				upstreamRelease: 'v0.0.7',
				compiler: 'puppyc.wasm',
				fingerprint: hash.digest('hex').slice(0, 16)
			},
			null,
			2
		)}\n`
	);
}

await fs.mkdir(distRoot, { recursive: true });
await execFileAsync('jco', [
	'transpile',
	compilerComponentPath,
	'--name',
	'puppyc',
	'--instantiation',
	'async',
	'--no-typescript',
	'--no-nodejs-compat',
	'--out-dir',
	distRoot
]);

await fs.copyFile(compilerComponentPath, path.join(distRoot, 'puppyc.component.wasm'));

await fs.rm(vendorRoot, { recursive: true, force: true });
await copyTree(preview2ShimRoot, path.join(vendorRoot, 'preview2-shim', 'lib'));
await copyTree(path.join(jcoRoot, 'obj'), path.join(vendorRoot, 'jco', 'obj'));
await fs.mkdir(path.join(vendorRoot, 'jco', 'src'), { recursive: true });
await fs.copyFile(
	path.join(jcoRoot, 'src', 'browser.js'),
	path.join(vendorRoot, 'jco', 'src', 'browser.js')
);

await rewriteBareImports();
await writeBuildMetadata();
