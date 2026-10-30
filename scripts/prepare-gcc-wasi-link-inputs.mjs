#!/usr/bin/env node
// Build and execute real external .o/.a fixtures, preserving every command and
// artifact. This uses an existing qualified compiler; it never edits its inputs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, inspectWasm, readBundleFile, runNodeWasi } from './gcc-wasi-artifact.mjs';
import { providers, createCases } from './gcc-wasi-link-inputs-fixtures.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
	const key = process.argv[i].replace(/^--/, '');
	assert(['work', 'sdk', 'manifest', 'sysroot', 'output'].includes(key) && process.argv[i + 1]);
	assert(!options[key], `Duplicate --${key}`);
	options[key] = await fs.realpath(process.argv[i + 1]).catch((error) => {
		if (key !== 'output' || error.code !== 'ENOENT') throw error;
		return path.resolve(process.argv[i + 1]);
	});
}
for (const key of ['work', 'sdk', 'manifest', 'sysroot', 'output'])
	assert(options[key], `Required --${key}`);
const { work, sdk, sysroot, output } = options;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const manifestBytes = await fs.readFile(options.manifest);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.target, 'wasm32-wasi');
const nativeReceiptBytes = await readBundleFile(
	path.dirname(options.manifest),
	manifest.provenance.files['native-build.json']
);
const nativeReceipt = JSON.parse(nativeReceiptBytes);
assert.deepEqual(nativeReceipt.gccSource, manifest.provenance.gccSource);
assert.equal(
	digest(await fs.readFile(path.join(work, 'native-build.json'))),
	digest(nativeReceiptBytes)
);
const tools = {
	cc1: path.join(work, 'gcc-native/gcc/cc1'),
	cc1plus: path.join(work, 'gcc-native/gcc/cc1plus'),
	assembler: path.join(work, 'wabt-native/wat2wasm'),
	clang: path.join(sdk, 'bin/clang'),
	linker: path.join(sdk, 'bin/wasm-ld'),
	ar: path.join(sdk, 'bin/llvm-ar'),
	node: process.execPath
};
const identify = async (file) => {
	const bytes = await fs.readFile(file);
	return { path: file, bytes: bytes.length, sha256: digest(bytes) };
};
const toolIdentities = {};
for (const [name, file] of Object.entries(tools)) toolIdentities[name] = await identify(file);
for (const name of ['cc1', 'cc1plus'])
	assert.equal(toolIdentities[name].sha256, nativeReceipt.tools[name].sha256);
const library = path.join(sysroot, 'lib/wasm32-wasi');
const builtins = path.join(sdk, 'lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a');
const runtimeIdentities = {};
for (const file of [
	path.join(library, 'crt1-command.o'),
	path.join(library, 'libc.a'),
	path.join(library, 'libm.a'),
	builtins
])
	runtimeIdentities[file] = await identify(file);
const runtimeReceipt = JSON.parse(
	await readBundleFile(
		path.dirname(options.manifest),
		manifest.provenance.files['runtime-build.json']
	)
);
for (const name of ['crt1-command.o', 'libc.a', 'libm.a']) {
	const expected = runtimeReceipt.files.find((file) => file.path === `lib/wasm32-wasi/${name}`);
	assert(expected, `Missing runtime identity for ${name}`);
	assert.equal(runtimeIdentities[path.join(library, name)].sha256, expected.sha256);
}
const factory = fileURLToPath(new URL('./gcc-wasi-link-inputs-fixtures.mjs', import.meta.url));
const report = {
	schemaVersion: 1,
	kind: 'gcc-wasi-external-link-input-qualification',
	status: 'running',
	compiler: manifest.compiler,
	host: 'native',
	target: 'wasm32-wasi',
	manifestSha256: digest(manifestBytes),
	nativeBuildSha256: digest(nativeReceiptBytes),
	gccSource: nativeReceipt.gccSource,
	tools: toolIdentities,
	runtime: runtimeIdentities,
	recipes: [await identify(fileURLToPath(import.meta.url)), await identify(factory)],
	commands: [],
	inputs: {},
	programs: {},
	cases: []
};
const writeReport = () =>
	fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify(report, null, 2) + '\n');
function command(tool, argv, cwd = output) {
	const result = spawnSync(tool, argv, {
		cwd,
		encoding: 'utf8',
		timeout: 180000,
		maxBuffer: 4 * 1024 * 1024
	});
	report.commands.push({
		command: tool,
		argv,
		status: result.status,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout;
}
function compile(source, object, request, family = 'gcc') {
	const cpp = request.language === 'cpp';
	const optimization = request.optimization;
	if (family === 'clang') {
		command(tools.clang, [
			'--target=wasm32-wasi',
			`--sysroot=${sdk}/share/wasi-sysroot`,
			`-O${optimization}`,
			'-c',
			source,
			'-o',
			object
		]);
		return;
	}
	const wat = object.replace(/\.o$/, '.wat');
	command(cpp ? tools.cc1plus : tools.cc1, [
		'-quiet',
		`-O${optimization}`,
		`-std=${request.standard || (cpp ? 'gnu++17' : 'gnu11')}`,
		'-fdiagnostics-color=never',
		'-Werror=attributes',
		'-Werror=pragmas',
		'-D__GCC_WASI_SINGLE_THREAD__=1',
		request.simd ? '-msimd128' : '-mno-simd128',
		'-nostdinc',
		'-isystem',
		path.join(work, 'gcc-native/gcc/include'),
		'-isystem',
		path.join(sysroot, 'include/wasm32-wasi'),
		...(cpp
			? ['-fno-exceptions', '-fno-rtti', '-fuse-cxa-atexit', '-fno-threadsafe-statics']
			: []),
		source,
		'-o',
		wat
	]);
	command(tools.assembler, ['-r', '--enable-annotations', wat, '-o', object]);
}
try {
	assert.match(
		command(tools.clang, ['--version']),
		/clang version 22\.1\.0[\s\S]*4434dabb69916856b824f68a64b029c67175e532/
	);
	const inputs = {};
	for (const optimization of ['0', '2'])
		for (const provider of providers) {
			const id = `${provider.id}-o${optimization}`;
			const source = path.join(output, `${id}.${provider.language === 'cpp' ? 'cpp' : 'c'}`);
			const object = path.join(output, `${id}.o`);
			await fs.writeFile(source, provider.code);
			compile(source, object, { ...provider, optimization }, provider.compiler);
			const objectBytes = await fs.readFile(object);
			const actualObject = inspectWasm(objectBytes, { object: true });
			const file = provider.archive ? path.join(output, `${id}.a`) : object;
			if (provider.archive) command(tools.ar, ['rcs', file, object]);
			const bytes = new Uint8Array(await fs.readFile(file));
			const profile = {
				target: 'wasm32-wasi',
				abi: 'wasm32-wasi-preview1',
				simd: Boolean(provider.simd),
				compatibility:
					provider.compiler === 'clang'
						? {
								kind: 'clang-c-scalar-v1',
								compilerVersion: '22.1.0',
								compilerCommit: '4434dabb69916856b824f68a64b029c67175e532',
								sysrootSha256: manifest.assets.sysroot.sha256
							}
						: {
								kind: 'gcc-bundle',
								manifestSha256: digest(manifestBytes),
								sysrootSha256: manifest.assets.sysroot.sha256
							}
			};
			inputs[id] = {
				path: path.basename(file),
				format: provider.archive ? 'wasm-archive' : 'wasm-object',
				bytes,
				sha256: digest(bytes),
				profile
			};
			report.inputs[id] = {
				...inputs[id],
				bytes: bytes.length,
				object: actualObject,
				source: await identify(source)
			};
		}
	const cases = createCases(inputs);
	await fs.writeFile(
		path.join(output, 'inputs.json'),
		JSON.stringify(
			Object.fromEntries(
				Object.entries(inputs).map(([id, { bytes, ...input }]) => [id, input])
			),
			null,
			2
		) + '\n'
	);
	const factoryRelative = path.relative(output, factory).split(path.sep).join('/');
	await fs.writeFile(
		path.join(output, 'fixtures.mjs'),
		`import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport { createHash } from 'node:crypto';\nimport { createCases } from ${JSON.stringify(factoryRelative.startsWith('.') ? factoryRelative : './' + factoryRelative)};\nconst hash = bytes => createHash('sha256').update(bytes).digest('hex');\nassert.equal(hash(await readFile(new URL(${JSON.stringify(factoryRelative)}, import.meta.url))), ${JSON.stringify(report.recipes[1].sha256)});\nconst inputs = JSON.parse(await readFile(new URL('./inputs.json', import.meta.url)));\nfor (const input of Object.values(inputs)) { input.bytes = new Uint8Array(await readFile(new URL(input.path, import.meta.url))); assert.equal(hash(input.bytes), input.sha256); }\nexport const cases = createCases(inputs);\n`
	);
	for (const fixture of cases) {
		const directory = path.join(output, fixture.id);
		await fs.mkdir(directory);
		const main = path.join(
			directory,
			fixture.request.language === 'cpp' ? 'main.cpp' : 'main.c'
		);
		await fs.writeFile(main, fixture.request.code);
		for (const file of fixture.request.files || [])
			await fs.writeFile(path.join(directory, file.path), file.contents);
		const objects = [];
		for (const [i, source] of [
			main,
			...(fixture.request.sources || []).map((file) => path.join(directory, file))
		].entries()) {
			const object = path.join(directory, `unit${i}.o`);
			compile(source, object, fixture.request);
			objects.push(object);
		}
		const program = path.join(output, `${fixture.id}.wasm`);
		command(tools.linker, [
			'--fatal-warnings',
			'-m',
			'wasm32',
			'-e',
			'_start',
			'-o',
			program,
			path.join(library, 'crt1-command.o'),
			`-L${library}`,
			...objects,
			...fixture.request.linkInputs.map((input) => path.join(output, input.path)),
			'-lm',
			'-lc',
			builtins
		]);
		const execution = runNodeWasi(program, fixture);
		const artifact = await identify(program);
		report.programs[fixture.id] = { ...artifact, path: path.basename(program) };
		report.cases.push({
			id: fixture.id,
			status: 'passed',
			fixtureSha256: digest(JSON.stringify(fixture)),
			execution,
			artifact,
			inputs: fixture.request.linkInputs.map(({ bytes, ...input }) => ({
				...input,
				bytes: bytes.length
			}))
		});
		await writeReport();
	}
	for (const receipt of [
		...Object.values(toolIdentities),
		...Object.values(runtimeIdentities),
		...report.recipes
	])
		assert.deepEqual(await identify(receipt.path), receipt);
	assert.equal(digest(await fs.readFile(options.manifest)), report.manifestSha256);
	report.inputsUnchanged = true;
	report.status = 'passed';
} catch (error) {
	report.status = 'failed';
	report.error = String(error.stack || error);
	process.exitCode = 1;
} finally {
	await writeReport();
}
console.log(
	JSON.stringify({
		status: report.status,
		cases: report.cases.length,
		output,
		error: report.error
	})
);
