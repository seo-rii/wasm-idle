// Trusted producer fixture only. Node WASI is not the container sandbox.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	lstatSync,
	lutimesSync,
	utimesSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WASI } from 'node:wasi';
import { checkCommandResult, compareTree, createCommandMatrix, fromHex } from './command-cases.mjs';
import {
	assertBusyboxImports,
	closeOwnedDescriptors,
	createNodeWasiMetadata
} from './node-wasi-fixture.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stable = (tree) =>
	Object.fromEntries(Object.entries(tree).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
function prepare(root, tree) {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	for (const [path, entry] of Object.entries(stable(tree))) {
		assert.ok(
			path.length &&
				!path.startsWith('/') &&
				!path.split('/').some((part) => !part || part === '.' || part === '..') &&
				!path.includes('\0')
		);
		const full = join(root, path);
		if (entry.type === 'directory') {
			mkdirSync(full, { mode: entry.mode ?? 0o755 });
			chmodSync(full, entry.mode ?? 0o755);
		} else if (entry.type === 'symlink') symlinkSync(entry.target, full);
		else {
			writeFileSync(full, fromHex(entry.hex), { mode: entry.mode ?? 0o644 });
			chmodSync(full, entry.mode ?? 0o644);
		}
	}
	for (const [path, entry] of Object.entries(tree)) {
		if (entry.atimeMs === undefined && entry.mtimeMs === undefined) continue;
		const full = join(root, path),
			info = lstatSync(full);
		const set = entry.type === 'symlink' ? lutimesSync : utimesSync;
		set(full, (entry.atimeMs ?? info.atimeMs) / 1000, (entry.mtimeMs ?? info.mtimeMs) / 1000);
	}
}
function snapshot(root, prefix = '') {
	const tree = {};
	for (const name of readdirSync(join(root, prefix)).sort()) {
		const path = prefix ? `${prefix}/${name}` : name,
			full = join(root, path),
			info = lstatSync(full);
		const meta = {
			mode: info.mode & 0o777,
			mtimeMs: Math.trunc(info.mtimeMs),
			atimeMs: Math.trunc(info.atimeMs)
		};
		if (info.isDirectory()) {
			tree[path] = { type: 'directory', ...meta };
			Object.assign(tree, snapshot(root, path));
		} else if (info.isSymbolicLink())
			tree[path] = { type: 'symlink', target: readlinkSync(full), ...meta };
		else {
			assert.ok(info.isFile());
			tree[path] = { type: 'file', hex: readFileSync(full).toString('hex'), ...meta };
		}
	}
	return stable(tree);
}
const contentTree = (tree) =>
	Object.fromEntries(
		Object.entries(tree).map(([path, entry]) => [
			path,
			Object.fromEntries(
				Object.entries(entry).filter(([key]) => ['type', 'hex', 'target'].includes(key))
			)
		])
	);

export async function runCommandSmoke(options) {
	const matrix = createCommandMatrix(Number(options.stage ?? 1));
	const work = resolve(options.work),
		output = resolve(options.output),
		artifact = readFileSync(options.artifact);
	mkdirSync(work, { mode: 0o700 });
	const module = await WebAssembly.compile(artifact),
		cases = [];
	assertBusyboxImports(WebAssembly.Module.imports(module), matrix.stage);
	const matrixBytes = Buffer.from(JSON.stringify(matrix, null, 2) + '\n');
	writeFileSync(join(work, 'command-cases.json'), matrixBytes, { flag: 'wx', mode: 0o600 });
	for (const test of matrix.cases)
		for (const invocation of ['argv0', 'multicall']) {
			const base = join(work, `${test.id}-${invocation}`),
				guestRoot = join(base, 'wasi');
			const wasiCwd = join(guestRoot, 'workspace', 'a b'),
				nativeCwd = join(base, 'native', 'workspace', 'a b');
			const stepResults = { wasm: [], native: [] };
			const errors = [];
			let wasmTree = {},
				nativeTree;
			try {
				prepare(wasiCwd, test.before);
				if (options.native && !test.wasiOnly) prepare(nativeCwd, test.before);
				for (const [index, expected] of test.steps.entries()) {
					const alias = invocation === 'argv0',
						env = { LC_ALL: 'C', TZ: 'UTC0' };
					if (options.native && !test.wasiOnly) {
						const run = spawnSync(
							resolve(options.native),
							alias ? expected.args : [expected.applet, ...expected.args],
							{
								argv0: alias ? expected.applet : 'busybox',
								cwd: nativeCwd,
								env,
								input: fromHex(expected.stdinHex),
								timeout: 30000,
								maxBuffer: 2 * 1024 * 1024
							}
						);
						if (run.error) throw run.error;
						stepResults.native.push(
							checkCommandResult(
								{ code: run.status, stdout: run.stdout, stderr: run.stderr },
								expected,
								nativeCwd
							)
						);
					}
					const inputPath = join(base, `stdin-${index}`),
						outputPath = join(base, `stdout-${index}`),
						errorPath = join(base, `stderr-${index}`);
					writeFileSync(inputPath, fromHex(expected.stdinHex), {
						flag: 'wx',
						mode: 0o600
					});
					const fds = [
						openSync(inputPath, 'r'),
						openSync(outputPath, 'wx', 0o600),
						openSync(errorPath, 'wx', 0o600)
					];
					let code, metadata;
					try {
						const wasi = new WASI({
							version: 'preview1',
							args: alias
								? [expected.applet, ...expected.args]
								: ['busybox', expected.applet, ...expected.args],
							env,
							preopens: { '/': guestRoot },
							stdin: fds[0],
							stdout: fds[1],
							stderr: fds[2],
							returnOnExit: true
						});
						let instance;
						const imports = wasi.getImportObject();
						metadata = createNodeWasiMetadata(imports.wasi_snapshot_preview1, {
							preopens: { '/': guestRoot },
							getInstance: () => instance
						});
						imports.wasm_idle_fs_v1 = metadata.imports;
						imports.wasm_idle_process_v1 = {
							initial_cwd(pointer, capacity) {
								const value = Buffer.from('/workspace/a b\0'),
									memory = new Uint8Array(instance.exports.memory.buffer);
								pointer >>>= 0;
								capacity >>>= 0;
								if (
									capacity < value.length ||
									pointer > memory.length ||
									capacity > memory.length - pointer
								)
									return -1;
								memory.set(value, pointer);
								return value.length;
							}
						};
						instance = await WebAssembly.instantiate(module, imports);
						code = wasi.start(instance);
					} finally {
						metadata?.dispose();
						closeOwnedDescriptors(fds);
					}
					stepResults.wasm.push(
						checkCommandResult(
							{
								code,
								stdout: readFileSync(outputPath),
								stderr: readFileSync(errorPath)
							},
							expected
						)
					);
				}
				wasmTree = snapshot(wasiCwd);
				if (options.native && !test.wasiOnly) nativeTree = snapshot(nativeCwd);
			} catch (error) {
				errors.push({ name: error.name, code: error.code, message: error.message });
			}
			const wasmFiles = compareTree(wasmTree, test.after);
			const nativeFiles = nativeTree ? compareTree(nativeTree, test.after) : undefined;
			const differential =
				test.wasiOnly ||
				!options.native ||
				!test.differential ||
				(!!nativeTree &&
					stepResults.wasm.length === stepResults.native.length &&
					stepResults.wasm.every(
						(result, index) =>
							result.code === stepResults.native[index].code &&
							result.stdoutHex === stepResults.native[index].stdoutHex &&
							(test.steps[index].stderrMode !== 'exact' ||
								result.stderrHex === stepResults.native[index].stderrHex)
					) &&
					JSON.stringify(contentTree(wasmTree)) ===
						JSON.stringify(contentTree(nativeTree)));
			cases.push({
				id: test.id,
				stage: test.stage,
				invocation,
				comparison: test.wasiOnly
					? 'explicit-profile-rejection'
					: options.native
						? 'native-differential'
						: 'wasi-only',
				steps: stepResults,
				wasmFiles,
				nativeFiles,
				differential,
				passed:
					!errors.length &&
					stepResults.wasm.length === test.steps.length &&
					stepResults.wasm.every((step) => step.passed) &&
					(!options.native ||
						test.wasiOnly ||
						(stepResults.native.every((step) => step.passed) && nativeFiles?.passed)) &&
					wasmFiles.passed &&
					differential,
				...(errors.length ? { errors } : {}),
				...(!wasmFiles.passed ? { actualTree: wasmTree, expectedTree: test.after } : {}),
				...(nativeFiles && !nativeFiles.passed ? { nativeTree } : {})
			});
		}
	const receipt = {
		schemaVersion: 1,
		profile: matrix.profile,
		stage: matrix.stage,
		generatedAt: new Date().toISOString(),
		node: process.version,
		artifact: { sha256: hash(artifact), bytes: artifact.length },
		nativeSha256: options.native ? hash(readFileSync(options.native)) : undefined,
		matrix: {
			path: relative(dirname(output), join(work, 'command-cases.json')),
			sha256: hash(matrixBytes),
			cases: matrix.cases.length
		},
		imports: WebAssembly.Module.imports(module),
		cases,
		passed: cases.every((test) => test.passed)
	};
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
	return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			artifact: { type: 'string' },
			native: { type: 'string' },
			stage: { type: 'string', default: '1' },
			work: { type: 'string' },
			output: { type: 'string' }
		}
	});
	for (const key of ['artifact', 'work', 'output']) assert.ok(values[key], `Required: --${key}`);
	const receipt = await runCommandSmoke(values);
	console.log(
		JSON.stringify(
			{
				passed: receipt.passed,
				stage: receipt.stage,
				cases: receipt.cases.length,
				failed: receipt.cases
					.filter((test) => !test.passed)
					.map((test) => `${test.id}:${test.invocation}`),
				output: resolve(values.output)
			},
			null,
			2
		)
	);
	if (!receipt.passed) process.exitCode = 1;
}
