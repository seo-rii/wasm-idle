import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	WASI
} from '@bjorn3/browser_wasi_shim';
import { untar } from '@wasm-idle/llvm-core';

const staticDir = path.resolve(process.cwd(), 'static/wasm-zig');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const gunzipAsync = promisify(gunzip);
type WasiStartInstance = { exports: { memory: WebAssembly.Memory; _start: () => unknown } };

function instantiateResult(
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) {
	return result instanceof WebAssembly.Instance ? result : result.instance;
}

function toWasiStartInstance(instance: WebAssembly.Instance) {
	return instance as unknown as WasiStartInstance;
}

function addFileToDirectory(root: Directory, filePath: string, data: Uint8Array) {
	const parts = filePath.split('/').filter(Boolean);
	let current = root;
	for (const part of parts.slice(0, -1)) {
		const next = current.contents.get(part);
		if (next instanceof Directory) {
			current = next;
			continue;
		}
		const directory = new Directory(new Map());
		current.contents.set(part, directory);
		current = directory;
	}
	current.contents.set(parts.at(-1) || 'file', new File(data, { readonly: true }));
}

function untarStdDirectory(source: Uint8Array) {
	const root = new Directory(new Map());
	untar(source, {
		addDirectory() {},
		addFile(filePath, contents) {
			addFileToDirectory(root, filePath, contents);
		}
	});
	const stdDirectory = root.contents.get('std');
	if (!(stdDirectory instanceof Directory)) throw new Error('std directory missing');
	return stdDirectory;
}

async function readStaticAsset(fileName: string) {
	const plainPath = path.join(staticDir, fileName);
	const plain = await readFile(plainPath).catch(() => null);
	if (plain) return plain;
	return await gunzipAsync(await readFile(`${plainPath}.gz`));
}

describe('bundled wasm-zig runtime', () => {
	it('compiles a Zig program to WASI and runs it with the browser WASI shim', async () => {
		const [compilerBytes, stdDirectory] = await Promise.all([
			readStaticAsset('zig_small.wasm'),
			readFile(path.join(staticDir, 'std.tar.gz'))
				.then((data) => gunzipAsync(data))
				.then((data) => untarStdDirectory(data))
		]);
		const workDir = new Map<string, File>([
			[
				'main.zig',
				new File(
					encoder.encode(`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("zig-real-ok\\n", .{});
}
`)
				)
			]
		]);
		let compilerOutput = '';
		const compilerWasi = new WASI(
			[
				'zigc.wasm',
				'build-exe',
				'main.zig',
				'-Dtarget=wasm64-wasi',
				'-fno-llvm',
				'-fno-lld',
				'-O',
				'ReleaseSmall',
				'-femit-bin=output.wasm'
			],
			[],
			[
				new OpenFile(new File([])),
				new ConsoleStdout((chunk) => {
					compilerOutput += decoder.decode(chunk, { stream: true });
				}),
				new ConsoleStdout((chunk) => {
					compilerOutput += decoder.decode(chunk, { stream: true });
				}),
				new PreopenDirectory('.', workDir),
				new PreopenDirectory('/lib', new Map([['std', stdDirectory]])),
				new PreopenDirectory('/cache', new Map())
			],
			{ debug: false }
		);
		const compilerInstance = await WebAssembly.instantiate(compilerBytes, {
			wasi_snapshot_preview1: compilerWasi.wasiImport
		});
		const compilerExitCode = compilerWasi.start(
			toWasiStartInstance(instantiateResult(compilerInstance))
		);
		expect(compilerExitCode, compilerOutput).toBe(0);
		const output = workDir.get('output.wasm');
		expect(output?.data.byteLength).toBeGreaterThan(0);

		let programOutput = '';
		const programWasi = new WASI(
			['output.wasm'],
			['USER=jungol'],
			[
				new OpenFile(new File([])),
				new ConsoleStdout((chunk) => {
					programOutput += decoder.decode(chunk, { stream: true });
				}),
				new ConsoleStdout((chunk) => {
					programOutput += decoder.decode(chunk, { stream: true });
				})
			],
			{ debug: false }
		);
		const programInstance = await WebAssembly.instantiate(output!.data, {
			wasi_snapshot_preview1: programWasi.wasiImport
		});
		expect(programWasi.start(toWasiStartInstance(instantiateResult(programInstance)))).toBe(0);
		expect(programOutput).toBe('zig-real-ok\n');
	}, 120_000);
});
