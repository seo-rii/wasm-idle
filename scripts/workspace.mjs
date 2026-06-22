#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const GROUPS = ['packages', 'runtimes', 'apps'];

function usage() {
	console.log(`Usage:
  node scripts/workspace.mjs list [--group packages|runtimes|apps]
  node scripts/workspace.mjs run <script> [--group packages|runtimes|apps] [--filter name] [--public] [--if-present] [--continue]
`);
}

function readFlag(args, name) {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	args.splice(index, value && !value.startsWith('--') ? 2 : 1);
	return value || true;
}

async function readPackageJson(dir) {
	const file = path.join(dir, 'package.json');
	return JSON.parse(await readFile(file, 'utf8'));
}

async function discoverWorkspacePackages(groupFilter) {
	const packages = [];
	const groups = groupFilter ? [groupFilter] : GROUPS;
	for (const group of groups) {
		const groupDir = path.join(REPO_ROOT, group);
		let entries = [];
		try {
			entries = await readdir(groupDir, { withFileTypes: true });
		} catch (error) {
			if (error?.code === 'ENOENT') continue;
			throw error;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(groupDir, entry.name);
			try {
				const manifest = await readPackageJson(dir);
				packages.push({
					group,
					dir,
					name: manifest.name || entry.name,
					manifest
				});
			} catch (error) {
				if (error?.code !== 'ENOENT') throw error;
			}
		}
	}
	return packages.sort((a, b) => {
		const groupOrder = GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);
		return groupOrder || a.name.localeCompare(b.name);
	});
}

function topologicallySortPackages(packages) {
	const packageByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const visited = new Set();
	const visiting = new Set();
	const sorted = [];

	const visit = (pkg) => {
		if (visited.has(pkg.name)) return;
		if (visiting.has(pkg.name)) {
			throw new Error(`Workspace dependency cycle detected at ${pkg.name}.`);
		}
		visiting.add(pkg.name);
		const dependencyNames = [
			...Object.entries(pkg.manifest.dependencies || {}),
			...Object.entries(pkg.manifest.devDependencies || {}),
			...Object.entries(pkg.manifest.optionalDependencies || {})
		]
			.filter(
				([, version]) => typeof version === 'string' && version.startsWith('workspace:')
			)
			.map(([name]) => name)
			.sort();
		for (const dependencyName of dependencyNames) {
			const dependency = packageByName.get(dependencyName);
			if (dependency) visit(dependency);
		}
		visiting.delete(pkg.name);
		visited.add(pkg.name);
		sorted.push(pkg);
	};

	for (const pkg of packages) visit(pkg);
	return sorted;
}

function pnpmCommand() {
	return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runScript(pkg, script) {
	return new Promise((resolve) => {
		const child = spawn(pnpmCommand(), ['--dir', pkg.dir, 'run', script], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			env: process.env
		});
		child.on('close', (code, signal) => {
			resolve({
				code: typeof code === 'number' ? code : signal ? 1 : 0,
				signal
			});
		});
	});
}

async function list(args) {
	const group = readFlag(args, '--group');
	if (group && !GROUPS.includes(group)) {
		throw new Error(`Unknown group: ${group}`);
	}
	const packages = await discoverWorkspacePackages(group);
	for (const pkg of packages) {
		const scriptNames = Object.keys(pkg.manifest.scripts || {}).sort();
		console.log(
			`${pkg.group}/${path.basename(pkg.dir)}\t${pkg.name}\t${scriptNames.join(', ')}`
		);
	}
}

async function run(args) {
	const script = args.shift();
	if (!script) {
		usage();
		process.exitCode = 1;
		return;
	}
	const group = readFlag(args, '--group');
	const filter = readFlag(args, '--filter');
	const publicOnly = Boolean(readFlag(args, '--public'));
	const ifPresent = Boolean(readFlag(args, '--if-present'));
	const keepGoing = Boolean(readFlag(args, '--continue'));
	if (group && !GROUPS.includes(group)) {
		throw new Error(`Unknown group: ${group}`);
	}
	let packages = await discoverWorkspacePackages(group);
	if (filter) {
		packages = packages.filter(
			(pkg) =>
				pkg.name === filter ||
				path.basename(pkg.dir) === filter ||
				pkg.name.includes(filter)
		);
	}
	if (publicOnly) {
		packages = packages.filter((pkg) => pkg.manifest.private !== true);
	}
	if (packages.length === 0) {
		throw new Error('No workspace packages matched.');
	}
	packages = topologicallySortPackages(packages);
	let failed = false;
	for (const pkg of packages) {
		if (!pkg.manifest.scripts?.[script]) {
			if (ifPresent) {
				console.log(`- ${pkg.name}: skip missing "${script}"`);
				continue;
			}
			throw new Error(`${pkg.name} does not define script "${script}"`);
		}
		console.log(`\n> ${pkg.name} ${script}`);
		const result = await runScript(pkg, script);
		if (result.code !== 0) {
			failed = true;
			if (!keepGoing) {
				process.exitCode = result.code;
				return;
			}
		}
	}
	if (failed) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);

try {
	if (command === 'list') await list(args);
	else if (command === 'run') await run(args);
	else {
		usage();
		process.exitCode = command ? 1 : 0;
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
