#!/usr/bin/env node

// Exercise the packaged browser compilers, not a host-installed substitute.
// A completed probe can report "blocked"; it never enables a debug adapter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	WASIProcExit
} from '@bjorn3/browser_wasi_shim';

const scriptPath = fileURLToPath(import.meta.url);
const repository = path.resolve(path.dirname(scriptPath), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (text) => encoder.encode(text);
const decode = (bytes) => decoder.decode(bytes);
const GO_SOURCE = `package main
import "fmt"
func main() {
 var value int
 fmt.Scan(&value)
 value += 5
 fmt.Println(value)
}
`;

/** Inspect sections without requiring the host engine to support the target's features. */
export function inspectWasmDebugSections(bytes) {
	assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
	let offset = 8;
	function readU32(end) {
		let value = 0;
		for (let index = 0; index < 5; index += 1) {
			assert(offset < end, 'truncated WebAssembly section length');
			const byte = bytes[offset++];
			assert(index < 4 || byte <= 15, 'invalid WebAssembly u32');
			value += (byte & 127) * 2 ** (index * 7);
			if (!(byte & 128)) return value;
		}
		throw new Error('invalid WebAssembly u32');
	}
	const customSections = [];
	while (offset < bytes.length) {
		const id = bytes[offset++];
		const size = readU32(bytes.length);
		const end = offset + size;
		assert(end <= bytes.length, 'truncated WebAssembly section payload');
		if (id === 0) {
			const nameLength = readU32(end);
			assert(offset + nameLength <= end, 'truncated WebAssembly custom section name');
			const name = decode(bytes.subarray(offset, offset + nameLength));
			customSections.push({ name, bytes: end - offset - nameLength });
		}
		offset = end;
	}
	const dwarfSections = customSections.filter(({ name }) => name.startsWith('.debug_'));
	return {
		bytes: bytes.byteLength,
		sha256: sha256(bytes),
		customSections,
		dwarfSections,
		hasSourceDwarf: ['.debug_info', '.debug_abbrev', '.debug_line'].every((name) =>
			dwarfSections.some((section) => section.name === name && section.bytes > 0)
		)
	};
}

function addFile(root, guestPath, contents) {
	const parts = guestPath.split('/').filter(Boolean);
	const filename = parts.pop();
	let directory = root;
	for (const part of parts) {
		if (!directory.has(part)) directory.set(part, new Directory(new Map()));
		assert(directory.get(part) instanceof Directory);
		directory = directory.get(part).contents;
	}
	directory.set(filename, new File(contents));
}

async function runWasi(module, args, env = [], preopens = [], stdin = '') {
	const stdout = [];
	const stderr = [];
	const capture = (chunks) => new ConsoleStdout((chunk) => chunks.push(Uint8Array.from(chunk)));
	const wasi = new WASI(
		args,
		env,
		[new OpenFile(new File(encode(stdin))), capture(stdout), capture(stderr), ...preopens],
		{ debug: false }
	);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	let exitCode;
	try {
		exitCode = wasi.start(instance) ?? 0;
	} catch (error) {
		if (!(error instanceof WASIProcExit)) throw error;
		exitCode = error.code;
	}
	return {
		exitCode,
		stdout: Buffer.concat(stdout).toString(),
		stderr: Buffer.concat(stderr).toString()
	};
}

async function probeGo(outputDirectory) {
	const runtimeDir = path.join(repository, 'static/wasm-go/runtime');
	const api = await import('../static/wasm-go/index.js');
	const { executeGoToolInvocation } = await import('../static/wasm-go/tool-runtime.js');
	const manifestBytes = await readFile(path.join(runtimeDir, 'runtime-manifest.v1.json'));
	const manifest = JSON.parse(decode(manifestBytes));
	const runtimeBaseUrl = pathToFileURL(`${runtimeDir}/`).href;
	const fetchImpl = async (input) => new Response(await readFile(fileURLToPath(new URL(input))));
	const request = { target: 'wasip1/wasm', code: GO_SOURCE };
	const goCompiler = await api.createGoCompiler({
		manifest,
		runtimeBaseUrl,
		dependencies: { fetchImpl }
	});
	const plan = await goCompiler.plan(request);
	const invocations = [];
	const result = await api.compileGo(request, {
		manifest,
		runtimeBaseUrl,
		dependencies: {
			fetchImpl,
			runTool: async (invocation, context) => {
				const flags = invocation.tool === 'compile' ? ['-N', '-l'] : ['-w=false'];
				const args = [invocation.args[0], ...flags, ...invocation.args.slice(1)];
				const toolResult = await executeGoToolInvocation(
					{ ...invocation, args },
					plan,
					runtimeBaseUrl,
					fetchImpl,
					context?.reportAssetProgress,
					context
				);
				invocations.push({
					tool: invocation.tool,
					args,
					exitCode: toolResult.exitCode,
					stdout: toolResult.stdout,
					stderr: toolResult.stderr
				});
				return toolResult;
			}
		}
	});
	assert(
		result.success && result.artifact,
		result.stderr || 'Go compile did not produce an artifact'
	);
	const bytes = result.artifact.bytes;
	await writeFile(path.join(outputDirectory, 'go-debug-request.wasm'), bytes);
	let input = '7\n';
	const execution = await api.executeBrowserGoArtifact(result.artifact, {
		manifest,
		runtimeBaseUrl,
		fetchImpl,
		stdin: () => {
			const next = input;
			input = '';
			return next || null;
		}
	});
	assert.equal(execution.exitCode, 0);
	assert.equal(execution.stdout, '12\n');
	const artifact = inspectWasmDebugSections(bytes);
	return {
		status: artifact.hasSourceDwarf ? 'candidate' : 'blocked',
		blocker: artifact.hasSourceDwarf ? null : 'GO_WASM_LINKER_OMITS_DWARF',
		version: manifest.goVersion,
		manifestSha256: sha256(manifestBytes),
		target: request.target,
		source: GO_SOURCE,
		invocations,
		artifact,
		execution: {
			exitCode: execution.exitCode,
			stdin: '7\n',
			stdout: execution.stdout,
			stderr: execution.stderr
		}
	};
}

async function probeZig(outputDirectory) {
	const { untar } = await import('@wasm-idle/llvm-core');
	const base = path.join(repository, 'static/wasm-zig');
	const build = JSON.parse(await readFile(path.join(base, 'runtime-build.json'), 'utf8'));
	const compiler = gunzipSync(await readFile(path.join(base, 'zig_small.wasm.gz')));
	const stdArchive = await readFile(path.join(base, 'std.tar.gz'));
	assert.equal(sha256(compiler), build.assets['zig_small.wasm'].sha256);
	assert.equal(sha256(stdArchive), build.assets['std.tar.gz'].sha256);
	const root = new Map();
	untar(gunzipSync(stdArchive), {
		addDirectory() {},
		addFile: (filename, contents) => addFile(root, filename, contents)
	});
	const std = root.get('std');
	assert(std instanceof Directory);
	const module = await WebAssembly.compile(compiler);
	const source = `const std = @import("std");
pub fn main() !void {
    var input: [16]u8 = undefined;
    const count = try std.io.getStdIn().read(&input);
    try std.io.getStdOut().writeAll(input[0..count]);
}
`;
	const attempts = [];
	for (const [target, optimization, flags, targetFlags] of [
		['wasm64-wasi', 'ReleaseSmall', []],
		['wasm64-wasi', 'Debug', ['-fno-strip']],
		['wasm32-wasi', 'Debug', ['-fno-strip']],
		['wasm32-wasi', 'ReleaseSmall', ['-fno-strip']],
		['wasm32-wasi', 'Debug', ['-fno-strip'], ['-target', 'wasm32-wasi']]
	]) {
		const workspace = new Map([['main.zig', new File(encode(source))]]);
		const args = [
			'zigc.wasm',
			'build-exe',
			'main.zig',
			...(targetFlags ?? [`-Dtarget=${target}`]),
			'-fno-llvm',
			'-fno-lld',
			'-O',
			optimization,
			'-femit-bin=output.wasm',
			...flags
		];
		const attempt = { target, optimization, args };
		try {
			Object.assign(
				attempt,
				await runWasi(
					module,
					args,
					[],
					[
						new PreopenDirectory('.', workspace),
						new PreopenDirectory('/lib', new Map([['std', std]])),
						new PreopenDirectory('/cache', new Map())
					]
				)
			);
			const artifact = workspace.get('output.wasm');
			if (artifact instanceof File && artifact.data.length) {
				attempt.artifact = inspectWasmDebugSections(artifact.data);
				await writeFile(
					path.join(
						outputDirectory,
						`zig-${attempts.length}-${target}-${optimization}.wasm`
					),
					artifact.data
				);
				if (attempt.exitCode === 0) {
					try {
						attempt.execution = await runWasi(
							await WebAssembly.compile(artifact.data),
							['program.wasm'],
							[],
							[],
							'7\n'
						);
						assert.equal(attempt.execution.exitCode, 0);
						assert.equal(attempt.execution.stdout, '7\n');
					} catch (error) {
						attempt.executionError = String(error);
					}
				}
			}
		} catch (error) {
			attempt.error = String(error);
		}
		attempts.push(attempt);
	}
	assert(
		attempts[0].artifact,
		'the existing Zig release profile did not produce its baseline artifact'
	);
	assert.equal(attempts[0].exitCode, 0);
	assert.equal(attempts[0].executionError, undefined, 'the existing Zig profile did not execute');
	const candidate = attempts.some(
		(attempt) =>
			attempt.target === 'wasm32-wasi' &&
			attempt.exitCode === 0 &&
			attempt.artifact?.hasSourceDwarf &&
			!attempt.executionError
	);
	return {
		status: candidate ? 'candidate' : 'blocked',
		blocker: candidate ? null : 'ZIG_PACKAGED_BACKEND_HAS_NO_USABLE_WASM32_DWARF',
		version: build.profileId,
		compilerSha256: sha256(compiler),
		source,
		attempts
	};
}

async function probeTinyGo(outputDirectory) {
	// Share the browser shim's class identities with the raw protocol probe.
	// The compiler, sysroot, receipts and linker are still the shipped static assets.
	const runtime = await import('../runtimes/wasm-tinygo/src/upstream-entry.ts');
	const base = path.join(repository, 'static/wasm-tinygo/tools/upstream');
	const manifest = JSON.parse(
		await readFile(path.join(base, 'upstream-toolchain.v2.json'), 'utf8')
	);
	const read = (name) => readFile(path.join(base, name));
	const [compiler, packageGraph, lld, rootArchive, producerReceipt, packageGraphReceipt] =
		await Promise.all([
			read('tinygo-compiler.wasm.gz').then(gunzipSync),
			read('tinygo-package-graph.wasm.gz').then(gunzipSync),
			read('lld.wasm.gz').then(gunzipSync),
			read('tinygoroot.tar.gz.bin'),
			read('producer-receipt.json'),
			read('package-graph-provider-receipt.json')
		]);
	const toolchain = await runtime.prepareTinyGoUpstreamToolchain(
		{
			manifest,
			compiler,
			packageGraph,
			lld,
			rootArchive,
			producerReceipt,
			packageGraphReceipt
		},
		{ maxWasmMemoryBytes: 1024 * 1024 * 1024 }
	);
	process.stderr.write('tinygo: verified toolchain loaded\n');
	const workspace = new Map();
	runtime.addTinyGoVfsFile(workspace, 'main.go', encode(GO_SOURCE));
	runtime.addTinyGoVfsFile(workspace, 'go.mod', encode('module debugprobe\n\ngo 1.24.0\n'));
	const makeWork = () => {
		const work = new Map();
		for (const name of ['output', 'tmp', 'cache', 'home', 'gopath', 'modcache'])
			runtime.addTinyGoVfsDirectory(work, name);
		return work;
	};
	const work = makeWork();
	const preopens = (work) => [
		new PreopenDirectory('/tinygo-root', toolchain.root),
		new PreopenDirectory('/workspace', workspace),
		new PreopenDirectory('/work', work)
	];
	const commonEnv = [
		'GOENV=off',
		'GOCACHE=/work/cache',
		'GOROOT=/tinygo-root',
		'GOWORK=off',
		'HOME=/work/home',
		'PWD=/workspace',
		'TMPDIR=/work/tmp'
	];
	const graph = await runWasi(
		toolchain.packageGraph,
		[
			'go',
			'list',
			`-json=${runtime.TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
			'-deps',
			'-e',
			'-mod=readonly',
			`-tags=${runtime.TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
			'.'
		],
		[
			...commonEnv,
			'GO111MODULE=on',
			'GOARCH=wasm',
			'GOOS=wasip1',
			'CGO_ENABLED=1',
			'GOMODCACHE=/work/modcache',
			'GOPATH=/work/gopath',
			'GOPROXY=off',
			'GOSUMDB=off',
			'GOTOOLCHAIN=local',
			'GOVCS=off'
		],
		preopens(work)
	);
	assert.equal(graph.exitCode, 0, graph.stderr);
	runtime.validateTinyGoPackageJSON({
		packageJSON: graph.stdout,
		root: toolchain.root,
		workspace,
		compileProtocolVersion: toolchain.compileProtocolVersion
	});
	process.stderr.write('tinygo: package graph validated\n');
	const closure = toolchain.runtime;
	const runtimePaths = {
		compilerRT: `/tinygo-root/${closure.compilerRT.path}`,
		wasiLibc: `/tinygo-root/${closure.wasiLibc.path}`,
		...(closure.libCxx
			? {
					libCxx: `/tinygo-root/${closure.libCxx.path}`,
					libCxxAbi: `/tinygo-root/${closure.libCxxAbi.path}`
				}
			: {}),
		extraFiles: Object.fromEntries(
			Object.entries(closure.extraFiles).map(([source, asset]) => [
				source,
				`/tinygo-root/${asset.path}`
			])
		)
	};
	const attempts = [];
	// Test the requested profile first: a release build of fmt can take minutes,
	// and cannot establish whether this producer accepts debug information.
	for (const debug of [true]) {
		const work = makeWork();
		const request = {
			package: '.',
			packageJSON: '/work/package-list.json',
			workingDirectory: '/workspace',
			outputDirectory: '/work/output',
			temporaryDirectory: '/work/tmp',
			target: 'wasip1',
			opt: '1',
			gc: 'precise',
			panicStrategy: 'print',
			scheduler: 'asyncify',
			debug,
			parallelism: 1,
			runtime: runtimePaths
		};
		runtime.addTinyGoVfsFile(work, 'package-list.json', encode(graph.stdout));
		runtime.addTinyGoVfsFile(work, 'request.json', encode(JSON.stringify(request)));
		const execution = await runWasi(
			toolchain.compiler,
			['tinygo-browser-adapter', '/work/request.json'],
			[
				...commonEnv,
				'GO111MODULE=off',
				`GOVERSION=${runtime.TINYGO_GO_VERSION}`,
				'TINYGOROOT=/tinygo-root',
				`TINYGO_BROWSER_COMPILER_BUILD_ID=${toolchain.compilerSha256}`
			],
			preopens(work)
		);
		const attempt = { request, ...execution };
		if (execution.exitCode === 0) {
			const linkPlan = JSON.parse(
				decode(runtime.readTinyGoVfsFile(work, 'output/link-plan.json'))
			);
			const object = runtime.readTinyGoVfsFile(work, `output/${linkPlan.objects[0].path}`);
			attempt.linkPlan = linkPlan;
			attempt.object = inspectWasmDebugSections(object);
			await writeFile(path.join(outputDirectory, `tinygo-debug-${debug}.o`), object);
		}
		attempts.push(attempt);
	}
	const debugAttempt = attempts[0];
	if (debugAttempt.exitCode !== 0) {
		assert.match(
			debugAttempt.stderr,
			/does not provide a debug runtime closure/u,
			'compiler failed for a reason other than its debug profile; do not classify it as blocked'
		);
	}
	return {
		status: debugAttempt.object?.hasSourceDwarf ? 'candidate' : 'blocked',
		blocker:
			debugAttempt.exitCode !== 0
				? 'TINYGO_PRODUCER_REJECTS_DEBUG_PROFILE'
				: debugAttempt.object?.hasSourceDwarf
					? null
					: 'TINYGO_PRODUCER_OMITS_DWARF',
		compileProtocolVersion: toolchain.compileProtocolVersion,
		compilerSha256: toolchain.compilerSha256,
		runtimeProfile: closure.profile,
		source: GO_SOURCE,
		attempts
	};
}

async function main(argv) {
	const options = { timeoutMs: 180000, worker: false };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === '--worker') {
			options.worker = true;
			continue;
		}
		const value = argv[++index];
		assert(value && !value.startsWith('--'), `${flag} requires a value`);
		if (flag === '--language') options.language = value;
		else if (flag === '--output') options.output = path.resolve(value);
		else if (flag === '--timeout-ms') options.timeoutMs = Number(value);
		else throw new Error(`unknown option: ${flag}`);
	}
	assert(
		['go', 'zig', 'tinygo'].includes(options.language),
		'--language go|zig|tinygo is required'
	);
	assert(options.output, '--output <directory> is required');
	assert(
		Number.isSafeInteger(options.timeoutMs) &&
			options.timeoutMs > 0 &&
			options.timeoutMs <= 600000,
		'--timeout-ms must be between 1 and 600000'
	);
	await mkdir(options.output, { recursive: true, mode: 0o700 });
	const receiptPath = path.join(options.output, `${options.language}.json`);
	if (!options.worker) {
		await writeFile(
			receiptPath,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					language: options.language,
					status: 'running',
					startedAt: new Date().toISOString()
				},
				null,
				2
			)}\n`
		);
		const child = spawn(
			process.execPath,
			['--max-old-space-size=2048', scriptPath, ...argv, '--worker'],
			{ stdio: 'inherit' }
		);
		const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
		const exitCode = await new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', (code, signal) => resolve(signal ? 124 : (code ?? 1)));
		}).finally(() => clearTimeout(timer));
		if (exitCode !== 0) {
			const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
			await writeFile(
				receiptPath,
				`${JSON.stringify(
					{ ...previous, status: 'probe-error', exitCode, timeoutMs: options.timeoutMs },
					null,
					2
				)}\n`
			);
		}
		process.exitCode = exitCode;
		return;
	}
	const start = Date.now();
	let result;
	try {
		result = await { go: probeGo, zig: probeZig, tinygo: probeTinyGo }[options.language](
			options.output
		);
	} catch (error) {
		await writeFile(
			receiptPath,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					language: options.language,
					status: 'probe-error',
					milliseconds: Date.now() - start,
					error: {
						name: error?.name,
						message: error?.message ?? String(error),
						stack: error?.stack
					}
				},
				null,
				2
			)}\n`
		);
		throw error;
	}
	const receipt = {
		schemaVersion: 1,
		language: options.language,
		probedAt: new Date().toISOString(),
		hostNode: process.version,
		milliseconds: Date.now() - start,
		...result
	};
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(`${options.language}: ${receipt.status} (${receiptPath})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
