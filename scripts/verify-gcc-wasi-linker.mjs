#!/usr/bin/env node
// Isolate the actual WASI wasm-ld host and SDK filesystem adapter while GCC is
// being built. Inputs are explicitly Clang reference objects, not GCC output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runWasiGccLinker } from '../packages/gcc/dist/wasi-linker.js';
import { digest, inspectWasm, runNodeWasi } from './gcc-wasi-artifact.mjs';
import { selectCases } from './gcc-wasi-fixtures.mjs';

const [linkerPath, sdk, requestedOutput] = process.argv.slice(2);
assert(
	linkerPath && sdk && requestedOutput,
	'Usage: node scripts/verify-gcc-wasi-linker.mjs LD.wasm WASI_SDK_DIR NEW_OUTPUT'
);
const output = path.resolve(requestedOutput);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const linkerBytes = await fs.readFile(linkerPath);
const module = await WebAssembly.compile(linkerBytes);
const report = {
	kind: 'wasi-linker-host-qualification-with-clang-reference-objects',
	note: 'This validates the real linker and SDK filesystem adapter; it does not qualify GCC code generation.',
	linker: {
		path: path.resolve(linkerPath),
		bytes: linkerBytes.length,
		sha256: digest(linkerBytes),
		imports: WebAssembly.Module.imports(module)
	},
	cases: [],
	success: false
};
try {
	const clang = path.resolve(sdk, 'bin/clang');
	const files = new Map();
	const libraries = [
		[
			'share/wasi-sysroot/lib/wasm32-wasi/crt1-command.o',
			'/sysroot/lib/wasm32-wasi/crt1-command.o'
		],
		['share/wasi-sysroot/lib/wasm32-wasi/libc.a', '/sysroot/lib/wasm32-wasi/libc.a'],
		['share/wasi-sysroot/lib/wasm32-wasi/libm.a', '/sysroot/lib/wasm32-wasi/libm.a'],
		[
			'lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a',
			'/sysroot/lib/wasm32-wasi/libclang_rt.builtins.a'
		]
	];
	report.libraries = [];
	for (const [source, destination] of libraries) {
		const bytes = await fs.readFile(path.resolve(sdk, source));
		files.set(destination, bytes);
		report.libraries.push({ path: source, bytes: bytes.length, sha256: digest(bytes) });
	}
	for (const fixture of selectCases('c-hello,c-libm,c-multiple')) {
		const directory = path.join(output, fixture.id);
		await fs.mkdir(directory);
		await fs.writeFile(path.join(directory, 'main.c'), fixture.request.code);
		for (const file of fixture.request.files || [])
			await fs.writeFile(path.join(directory, file.path), file.contents);
		const workspace = new Map(files);
		const objects = [];
		const compileCommands = [];
		for (const [index, source] of ['main.c', ...(fixture.request.sources || [])].entries()) {
			const object = `program.${index}.o`;
			const argv = ['-O0', '-std=gnu11', '-c', source, '-o', object];
			const compilation = spawnSync(clang, argv, {
				cwd: directory,
				encoding: 'utf8',
				timeout: 60_000
			});
			assert.ifError(compilation.error);
			assert.equal(compilation.status, 0, compilation.stderr);
			compileCommands.push({ tool: 'clang-reference-only', argv });
			objects.push(`/workspace/${object}`);
			workspace.set(objects.at(-1), await fs.readFile(path.join(directory, object)));
		}
		const argv = [
			'-m',
			'wasm32',
			'-e',
			'_start',
			'-o',
			'/workspace/program.wasm',
			'/sysroot/lib/wasm32-wasi/crt1-command.o',
			'-L/sysroot/lib/wasm32-wasi',
			...objects,
			'-lm',
			'-lc',
			'/sysroot/lib/wasm32-wasi/libclang_rt.builtins.a'
		];
		const diagnostics = [];
		const result = await runWasiGccLinker(
			module,
			argv,
			workspace,
			'/workspace/program.wasm',
			(stream, text) => diagnostics.push({ stream, text })
		);
		const entry = {
			id: fixture.id,
			compileCommands,
			argv,
			diagnostics,
			exitCode: result.exitCode,
			peakMemoryBytes: result.peakMemoryBytes
		};
		report.cases.push(entry);
		assert.equal(result.exitCode, 0, JSON.stringify(diagnostics));
		assert(result.output);
		entry.artifact = inspectWasm(result.output);
		const program = path.join(directory, 'program.wasm');
		await fs.writeFile(program, result.output);
		entry.execution = runNodeWasi(program, fixture);
		entry.success = true;
	}
	report.success = true;
} catch (error) {
	report.error = String(error?.stack || error);
	process.exitCode = 1;
} finally {
	await fs.writeFile(
		path.join(output, 'linker-host.json'),
		JSON.stringify(report, null, 2) + '\n'
	);
	console.log(
		JSON.stringify({
			success: report.success,
			output,
			...(report.error ? { error: report.error } : {})
		})
	);
}
