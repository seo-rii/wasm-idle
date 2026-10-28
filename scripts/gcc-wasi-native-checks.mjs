import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, inspectWasm, runNodeWasi } from './gcc-wasi-artifact.mjs';
import { selectCases } from './gcc-wasi-fixtures.mjs';

const usage = `Usage: node scripts/gcc-wasi-native-checks.mjs
  --provenance /native-programs/provenance.json
  --build-receipt /work/native-build.json
  --output NEW_DIRECTORY
  [--mode programs|diagnostics] [--optimization 0|1|2|3|s] [--cases comma,separated]

Reuses successful native GCC qualification commands and verifies the exact built
GCC binaries against their receipt. It never overwrites the producer's build or
qualification receipts. Programs are actual GCC -> WABT -> wasm-ld -> Node WASI.
The diagnostics mode checks actual GCC rejection of x86 target pragma/attribute,
exceptions and RTTI. Use verify-gcc-wasi.mjs for subsequent Chromium execution.
`;
if (process.argv.includes('--help')) {
	console.log(usage);
	process.exit(0);
}
const options = { mode: 'programs', optimization: '2' };
const allowed = new Set(['provenance', 'build-receipt', 'output', 'mode', 'optimization', 'cases']);
for (let index = 2; index < process.argv.length; index += 2) {
	const key = process.argv[index].replace(/^--/, '');
	assert(allowed.has(key), `Unknown option: ${process.argv[index]}\n${usage}`);
	const value = process.argv[index + 1];
	assert(value && !value.startsWith('--'), `Missing value for --${key}`);
	options[key] = value;
}
assert(options.provenance && options['build-receipt'] && options.output, usage);
assert(['programs', 'diagnostics'].includes(options.mode), 'Invalid mode');
assert(['0', '1', '2', '3', 's'].includes(options.optimization), 'Invalid optimization');
assert(options.mode !== 'diagnostics' || !options.cases, '--cases only applies to programs');

const baselineFile = await fs.realpath(options.provenance);
const baselineDirectory = path.dirname(baselineFile);
const baselineBytes = await fs.readFile(baselineFile);
const baseline = JSON.parse(baselineBytes);
const buildFile = await fs.realpath(options['build-receipt']);
const buildBytes = await fs.readFile(buildFile);
const build = JSON.parse(buildBytes);
assert.equal(baseline.status, 'passed', 'Native baseline has not passed');
assert.equal(baseline.compiler?.family, 'gcc', 'Only actual GCC receipts are accepted');
assert.equal(baseline.target, 'wasm32-wasi');
assert.match(baseline.compiler.commit, /^[a-f0-9]{40}$/);
assert.equal(build.host, 'native');
assert.equal(build.target, 'wasm32-wasi');
assert.equal(build.gccCommit, baseline.compiler.commit);
assert.equal(digest(buildBytes), baseline.buildReceiptSha256, 'Build receipt changed');

const commands = baseline.cases
	.filter((entry) => entry.status === 'passed')
	.flatMap((entry) => entry.commands);
function findCommand(name, caseId) {
	const caseCommands = baseline.cases.find(
		(entry) => entry.id === caseId && entry.status === 'passed'
	)?.commands;
	const entry = (caseCommands || commands).find((entry) => path.basename(entry.command) === name);
	assert(entry, `Native receipt does not contain ${name}`);
	assert.equal(entry.status, 0, `${name} did not succeed in the baseline`);
	return entry;
}
const tools = {};
for (const name of ['cc1', 'cc1plus', 'wat2wasm', 'wasm-ld']) {
	const invocation = findCommand(name);
	const bytes = await fs.readFile(invocation.command);
	tools[name] = { path: invocation.command, bytes: bytes.length, sha256: digest(bytes) };
	if (name === 'cc1' || name === 'cc1plus') {
		assert.equal(
			tools[name].sha256,
			build.tools[name].sha256,
			`${name} differs from its build receipt`
		);
	}
}
const output = path.resolve(options.output);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // Refuse to reuse any previous test output.
const report = {
	schemaVersion: 1,
	kind:
		options.mode === 'programs'
			? 'actual-native-gcc-wasi-programs'
			: 'actual-native-gcc-wasi-unsupported-diagnostics',
	status: 'running',
	host: 'native',
	target: 'wasm32-wasi',
	compiler: baseline.compiler,
	assembler: baseline.assembler,
	nativeLinker: baseline.nativeLinker,
	optimization: options.optimization,
	baselineReceiptSha256: digest(baselineBytes),
	buildReceiptSha256: digest(buildBytes),
	sourceLockSha256: baseline.sourceLockSha256,
	baselineReceipt: baseline,
	buildReceipt: build,
	scriptSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))),
	fixturesSha256: digest(await fs.readFile(new URL('./gcc-wasi-fixtures.mjs', import.meta.url))),
	tools,
	programs: {},
	cases: []
};
const reportFile = path.join(
	output,
	options.mode === 'programs' ? 'provenance.json' : 'diagnostics.json'
);
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');

function invoke(command, argv, entry, expectedFailure = false) {
	const result = spawnSync(command, argv, {
		cwd: output,
		encoding: 'utf8',
		timeout: 180_000,
		maxBuffer: 8 * 1024 * 1024
	});
	entry.commands.push({
		command,
		argv,
		status: result.status,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr,
		error: result.error?.message
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null, 'Compiler/tool terminated by a signal');
	if (expectedFailure)
		assert.notEqual(result.status, 0, 'Unsupported source unexpectedly compiled');
	else assert.equal(result.status, 0, result.stderr);
	return result;
}

function compilerFlags(language, request, caseId) {
	const template = findCommand(language === 'cpp' ? 'cc1plus' : 'cc1', caseId);
	const outputIndex = template.argv.indexOf('-o');
	assert(
		outputIndex > 0 && /\.(c|cc|cpp|cxx)$/.test(template.argv[outputIndex - 1]),
		'Unsupported baseline frontend argument layout'
	);
	const flags = template.argv
		.slice(0, outputIndex - 1)
		.filter(
			(argument) =>
				!argument.startsWith('-O') &&
				!argument.startsWith('-std=') &&
				!argument.startsWith('-D') &&
				![
					'-fno-exceptions',
					'-fno-rtti',
					'-fuse-cxa-atexit',
					'-fno-threadsafe-statics'
				].includes(argument)
		);
	flags.push(
		'-D__GCC_WASI_SINGLE_THREAD__=1',
		`-O${options.optimization}`,
		`-std=${request.standard}`
	);
	if (language === 'cpp')
		flags.push('-fno-exceptions', '-fno-rtti', '-fuse-cxa-atexit', '-fno-threadsafe-statics');
	for (const definition of request.defines || []) flags.push(`-D${definition}`);
	return { command: template.command, flags };
}

function linkerArguments(objects, executable, caseId) {
	const template = findCommand('wasm-ld', caseId);
	let replacedObjects = false;
	const argv = [];
	for (let index = 0; index < template.argv.length; index++) {
		const argument = template.argv[index];
		if (argument === '-o') {
			argv.push('-o', executable);
			index++;
		} else if (argument.startsWith(baselineDirectory + path.sep) && argument.endsWith('.o')) {
			if (!replacedObjects) argv.push(...objects);
			replacedObjects = true;
		} else argv.push(argument);
	}
	assert(replacedObjects, 'Could not identify user objects in native linker command');
	if (!argv.includes('--fatal-warnings')) argv.push('--fatal-warnings');
	return { command: template.command, argv };
}

async function program(fixture, entry) {
	entry.fixtureSha256 = digest(JSON.stringify(fixture));
	const directory = path.join(output, fixture.id);
	await fs.mkdir(directory);
	const main = fixture.request.language === 'cpp' ? 'main.cpp' : 'main.c';
	entry.sources = [];
	for (const source of [
		{ path: main, contents: fixture.request.code },
		...(fixture.request.files || [])
	]) {
		const file = path.resolve(directory, source.path);
		assert(file.startsWith(directory + path.sep), 'Fixture source escapes its directory');
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, source.contents);
		entry.sources.push({ path: source.path, sha256: digest(source.contents) });
	}
	entry.objects = [];
	const objects = [];
	const frontend = compilerFlags(fixture.request.language, fixture.request, fixture.id);
	for (const [index, source] of [main, ...(fixture.request.sources || [])].entries()) {
		const wat = path.join(directory, `unit${index}.wat`);
		const object = path.join(directory, `unit${index}.o`);
		invoke(
			frontend.command,
			[...frontend.flags, path.join(directory, source), '-o', wat],
			entry
		);
		invoke(tools.wat2wasm.path, ['-r', '--enable-annotations', wat, '-o', object], entry);
		const bytes = await fs.readFile(object);
		entry.objects.push({
			path: path.relative(output, object),
			...inspectWasm(bytes, { object: true })
		});
		objects.push(object);
	}
	const executable = path.join(output, fixture.id + '.wasm');
	const linker = linkerArguments(objects, executable, fixture.id);
	invoke(linker.command, linker.argv, entry);
	const bytes = await fs.readFile(executable);
	entry.artifact = inspectWasm(bytes);
	entry.node = runNodeWasi(executable, fixture);
	const first = entry.objects[0];
	report.programs[fixture.id] = {
		path: path.basename(executable),
		bytes: bytes.length,
		sha256: digest(bytes),
		object: { path: first.path, bytes: first.bytes, sha256: first.sha256 }
	};
}

const unsupported = [
	{
		id: 'x86-pragma',
		language: 'c',
		code: '#pragma GCC target("avx2,fma")\nint add(int x) { return x + 1; }\n',
		pattern: /target.*not supported/
	},
	{
		id: 'x86-attribute',
		language: 'c',
		code: '__attribute__((target("avx2"))) int add(int x) { return x + 1; }\n',
		pattern: /target.*not supported/
	},
	{
		id: 'exceptions',
		language: 'cpp',
		code: 'int main() { throw 42; }\n',
		pattern: /exception handling disabled/
	},
	{
		id: 'rtti',
		language: 'cpp',
		code: 'struct Base { virtual ~Base() {} }; struct Derived : Base {}; Derived *cast(Base *p) { return dynamic_cast<Derived *>(p); }\n',
		pattern: /dynamic_cast.*not permitted/
	}
];
async function diagnostic(fixture, entry) {
	const source = path.join(output, fixture.id + (fixture.language === 'cpp' ? '.cpp' : '.c'));
	await fs.writeFile(source, fixture.code);
	entry.sourceSha256 = digest(fixture.code);
	const frontend = compilerFlags(fixture.language, {
		standard: fixture.language === 'cpp' ? 'gnu++17' : 'gnu11'
	});
	const result = invoke(
		frontend.command,
		[...frontend.flags, source, '-o', path.join(output, fixture.id + '.wat')],
		entry,
		true
	);
	assert.match(
		result.stderr,
		fixture.pattern,
		'Failure did not diagnose the requested unsupported feature'
	);
	entry.rejected = true;
}

const fixtures =
	options.mode === 'diagnostics'
		? unsupported
		: selectCases(options.cases || Object.keys(baseline.programs).join(','));
await save();
for (const fixture of fixtures) {
	const entry = { id: fixture.id, status: 'running', commands: [] };
	report.cases.push(entry);
	try {
		if (options.mode === 'diagnostics') await diagnostic(fixture, entry);
		else await program(fixture, entry);
		entry.status = 'passed';
	} catch (error) {
		entry.status = 'failed';
		entry.error = String(error?.stack || error);
	}
	await save();
	console.log(
		JSON.stringify({
			id: entry.id,
			status: entry.status,
			...(entry.error ? { error: entry.error } : {})
		})
	);
}
// Reject a result if producer inputs were replaced while the check was running.
try {
	assert.equal(
		digest(await fs.readFile(baselineFile)),
		digest(baselineBytes),
		'Baseline receipt changed during qualification'
	);
	assert.equal(
		digest(await fs.readFile(buildFile)),
		digest(buildBytes),
		'Build receipt changed during qualification'
	);
	for (const tool of Object.values(tools))
		assert.equal(
			digest(await fs.readFile(tool.path)),
			tool.sha256,
			`${tool.path} changed during qualification`
		);
} catch (error) {
	report.inputError = String(error?.stack || error);
}
report.status =
	!report.inputError && report.cases.every((entry) => entry.status === 'passed')
		? 'passed'
		: 'failed';
await save();
if (report.status !== 'passed') process.exitCode = 1;
