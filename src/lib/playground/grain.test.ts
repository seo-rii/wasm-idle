// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Script, runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	GRAIN_STDLIB_OBJECT_MTIME_MS,
	GRAIN_STDLIB_ROOT,
	GRAIN_STDLIB_SOURCE_MTIME_MS,
	createGrainWasi,
	parseGrainDiagnostics,
	readGrainStdlibPack
} from '../../../scripts/runtime-workers/grain-host.mjs';
import { runGrainc } from '../../../scripts/sync-wasm-grain.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import { bundledGrainProfile as profile, bundledGrainWorkerReceipt } from './wasmGrainVersion';

const staticAsset = (name: string) =>
	readFile(new URL(`../../../static/wasm-grain/${name}`, import.meta.url));
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

let compiler: Script;
let stdlib: { path: string; data: Uint8Array<ArrayBuffer>; mtimeMs: number }[];

function compile(
	source: string,
	extraFiles: { path: string; data: Uint8Array<ArrayBuffer> }[] = []
) {
	const result = runGrainc(
		compiler,
		[
			...stdlib,
			...extraFiles,
			{ path: '/work/main.gr', data: new TextEncoder().encode(source) }
		],
		[
			'--stdlib',
			GRAIN_STDLIB_ROOT,
			'--no-color',
			'--maximum-memory-pages=256',
			'-o',
			'/work/main.wasm',
			'/work/main.gr'
		]
	);
	return {
		...result,
		wasm: result.files.find((file: { path: string }) => file.path === '/work/main.wasm')?.data
	};
}

async function execute(
	wasm: Uint8Array<ArrayBuffer> | undefined,
	stdin: string,
	args: string[] = []
) {
	const input = new TextEncoder().encode(stdin);
	const decoder = new TextDecoder();
	let offset = 0;
	let output = '';
	const reads: number[] = [];
	const wasi = createGrainWasi({
		args,
		readStdin(maxLength: number) {
			reads.push(maxLength);
			const chunk = input.subarray(offset, offset + maxLength);
			offset += chunk.length;
			return chunk;
		},
		onStdout: (chunk: Uint8Array) => (output += decoder.decode(chunk)),
		onStderr: (chunk: Uint8Array) => (output += decoder.decode(chunk))
	});
	if (!wasm) throw new Error('Grain did not emit a module');
	const module = await WebAssembly.compile(wasm);
	const instance = await WebAssembly.instantiate(module, wasi.imports(module));
	wasi.setMemory(instance.exports.memory as WebAssembly.Memory);
	let status = 0;
	try {
		(instance.exports._start as () => void)();
	} catch (error) {
		const exitStatus = wasi.exitStatus(error);
		if (exitStatus === null) throw error;
		status = exitStatus;
	}
	return { output, status, reads, memory: instance.exports.memory as WebAssembly.Memory };
}

describe('Grain browser runtime assets', () => {
	beforeAll(async () => {
		const compilerStorage = await staticAsset('grainc.js.gz.bin');
		const stdlibStorage = await staticAsset('stdlib.pack.gz.bin');
		expect(receipt(compilerStorage)).toEqual(profile.compilerStorage);
		expect(receipt(stdlibStorage)).toEqual(profile.stdlibStorage);
		const compilerBytes = gunzipSync(compilerStorage);
		const stdlibBytes = new Uint8Array(gunzipSync(stdlibStorage));
		expect(receipt(compilerBytes)).toEqual(profile.compilerJavaScript);
		expect(receipt(stdlibBytes)).toEqual(profile.stdlibPack);
		compiler = new Script(compilerBytes.toString('utf8'), { filename: 'grainc.bc.js' });
		stdlib = readGrainStdlibPack(stdlibBytes).map((file) => ({
			path: `${GRAIN_STDLIB_ROOT}/${file.path}`,
			data: file.data,
			mtimeMs: file.path.endsWith('.gro')
				? GRAIN_STDLIB_OBJECT_MTIME_MS
				: GRAIN_STDLIB_SOURCE_MTIME_MS
		}));
	}, 60_000);

	it('pins the upstream release, licenses and the generated worker', async () => {
		const build = JSON.parse((await staticAsset('runtime-build.json')).toString('utf8'));
		expect(build.profile).toEqual(profile);
		expect(build.source).toMatchObject({
			repository: 'https://github.com/grain-lang/grain',
			tag: 'grain-v0.7.2',
			commit: '49829d7966b38b177291f7e91f5eb81c65ec07aa'
		});
		expect(build.licenses['LICENSE-grain-compiler.txt'].spdx).toBe('LGPL-3.0');
		expect(build.licenses['LICENSE-grain-stdlib.txt'].spdx).toBe('MIT');
		for (const [name, license] of Object.entries(build.licenses) as [
			string,
			{ sha256: string }
		][]) {
			expect(receipt(await staticAsset(name)).sha256).toBe(license.sha256);
		}
		const worker = await staticAsset('runner-worker.js');
		expect(receipt(worker)).toEqual(bundledGrainWorkerReceipt);
		const source = worker.toString('utf8');
		expect(source).toContain(JSON.stringify(profile));
		expect(source).not.toMatch(/^export /mu);
		const stdlibModules = stdlib.filter((file) => file.path.endsWith('.gr')).length;
		expect(stdlib.filter((file) => file.path.endsWith('.gro'))).toHaveLength(stdlibModules);
	});

	it(
		'compiles the editor default with the precompiled stdlib and runs it over WASI stdin',
		{ timeout: 60_000 },
		async () => {
			const result = compile(editorDefaults.grain);
			expect(result).toMatchObject({ status: 0, output: '' });
			const changedObjects = result.files.filter(
				(file: { path: string; data: Uint8Array }) =>
					file.path.endsWith('.gro') &&
					file.path.startsWith(GRAIN_STDLIB_ROOT) &&
					stdlib.find((entry) => entry.path === file.path)?.data !== file.data
			);
			expect(changedObjects).toEqual([]);
			const named = await execute(result.wasm, 'Ada Lovelace 世界\nignored\n');
			expect(named.output).toBe('What is your name?\nHello, Ada Lovelace 世界!\n');
			expect(named.status).toBe(0);
			expect(named.memory.buffer.byteLength).toBeLessThanOrEqual(256 * 65_536);
			const eof = await execute(result.wasm, '');
			expect(eof.output).toBe('What is your name?\nHello, stranger!\n');
		}
	);

	it(
		'reports compiler diagnostics, program arguments and exit statuses',
		{ timeout: 60_000 },
		async () => {
			const invalid = compile('module Main\n\nlet value: Number = "text"\nprint(value)\n');
			expect(invalid.status).not.toBe(0);
			expect(invalid.wasm).toBeUndefined();
			expect(invalid.output).not.toContain('internal error');
			expect(parseGrainDiagnostics(invalid.output)).toEqual([
				{
					fileName: 'main.gr',
					lineNumber: 3,
					columnNumber: 21,
					endLineNumber: 3,
					endColumnNumber: 27,
					severity: 'error',
					message:
						'This expression has type String but an expression was expected of type Number'
				}
			]);
			const program = compile(
				'module Main\n\nfrom "array" include Array\nfrom "wasi/process" include Process\n\nmatch (Process.argv()) {\n  Ok(args) => print(Array.length(args)),\n  Err(_) => void,\n}\nProcess.exit(3)\n'
			);
			expect(program.status).toBe(0);
			expect(await execute(program.wasm, '', ['one', 'two'])).toMatchObject({
				output: '3\n',
				status: 3
			});
		}
	);

	it('parses multi-line locations and warnings', () => {
		expect(
			parseGrainDiagnostics(
				'File "/work/lib/util.gr", lines 4-6, characters 2-9:\nWarning 3: unused\n  value\n\nother'
			)
		).toEqual([
			{
				fileName: 'lib/util.gr',
				lineNumber: 4,
				columnNumber: 3,
				endLineNumber: 6,
				endColumnNumber: 10,
				severity: 'warning',
				message: 'unused value'
			}
		]);
	});

	it('observes stdin EOF even when the close notification races the wait', async () => {
		const buffer = new SharedArrayBuffer(17);
		const channel = {
			protocol: 'wasm-idle-static-stdin-ring',
			protocolVersion: 1,
			controlBytes: 16,
			capacity: 1,
			buffer
		};
		const source = (await staticAsset('runner-worker.js')).toString('utf8');
		let waits = 0;
		const atomics = Object.create(Atomics);
		atomics.wait = (control: Int32Array, index: number, expected: number, timeout: number) => {
			waits++;
			Atomics.store(control, 2, 1);
			// The notification is lost: slot 0 did not change and no waiter existed yet.
			return Atomics.wait(control, index, expected, timeout);
		};
		const result = runInNewContext(
			`${source}\ngrainStdin('', channel)(16);`,
			{
				self: { postMessage() {} },
				TextEncoder,
				TextDecoder,
				SharedArrayBuffer,
				Int32Array,
				Uint8Array,
				DataView,
				Atomics: atomics,
				channel
			},
			{ timeout: 1000 }
		);
		expect(result.length).toBe(0);
		expect(waits).toBe(1);
	});
});
