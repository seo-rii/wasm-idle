import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { createZigWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';
import { loadZigStdDirectory } from '../src/zig/service.js';

const stdlibFile = strToU8('pub const std = true;');

function createTarGzip(entries: { path: string; contents: Uint8Array }[]) {
	const blocks: Buffer[] = [];
	for (const entry of entries) {
		const header = Buffer.alloc(512);
		header.write(entry.path, 0, 100, 'utf8');
		header.write('0000644\0', 100, 8, 'ascii');
		header.write('0000000\0', 108, 8, 'ascii');
		header.write('0000000\0', 116, 8, 'ascii');
		header.write(
			`${entry.contents.byteLength.toString(8).padStart(11, '0')}\0`,
			124,
			12,
			'ascii'
		);
		header.write('00000000000\0', 136, 12, 'ascii');
		header.fill(0x20, 148, 156);
		header.write('0', 156, 1, 'ascii');
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');
		header.write(
			`${header
				.reduce((total, byte) => total + byte, 0)
				.toString(8)
				.padStart(6, '0')}\0 `,
			148,
			8,
			'ascii'
		);
		blocks.push(
			header,
			Buffer.from(entry.contents),
			Buffer.alloc((512 - (entry.contents.byteLength % 512)) % 512)
		);
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks), { level: 9 });
}

const stdlibTarGzip = createTarGzip([{ path: 'std/std.zig', contents: stdlibFile }]);

describe('loadZigStdDirectory', () => {
	it('loads a valid ZIP archive rooted at std/', async () => {
		const directory = await loadZigStdDirectory(
			zipSync({ 'std/std.zig': stdlibFile }),
			'https://static.example.com/wasm-zig/std.zip'
		);

		expect(directory.contents.has('std.zig')).toBe(true);
	});

	it('rejects ZIP output larger than the expanded-byte budget', async () => {
		await expect(
			loadZigStdDirectory(
				zipSync({ 'std/large.zig': new Uint8Array(5) }),
				'https://static.example.com/wasm-zig/std.zip',
				{ maxExpandedBytes: 4, maxFiles: 10 }
			)
		).rejects.toThrow('Zig standard library archive exceeds the 4 byte expanded-size limit');
	});

	it('rejects ZIP archives larger than the file-count budget', async () => {
		await expect(
			loadZigStdDirectory(
				zipSync({
					'std/a.zig': new Uint8Array([1]),
					'std/b.zig': new Uint8Array([2])
				}),
				'https://static.example.com/wasm-zig/std.zip',
				{ maxExpandedBytes: 16, maxFiles: 1 }
			)
		).rejects.toThrow('Zig standard library archive exceeds the 1 file limit');
	});

	it('rejects traversal paths instead of normalizing them', async () => {
		await expect(
			loadZigStdDirectory(
				zipSync({ 'std/../escape.zig': new Uint8Array([1]) }),
				'https://static.example.com/wasm-zig/std.zip'
			)
		).rejects.toThrow('Zig standard library archive has an unsafe path: std/../escape.zig');
	});

	it('rejects file and directory path collisions', async () => {
		await expect(
			loadZigStdDirectory(
				zipSync({
					'std/collision': new Uint8Array([1]),
					'std/collision/nested.zig': new Uint8Array([2])
				}),
				'https://static.example.com/wasm-zig/std.zip'
			)
		).rejects.toThrow('Zig standard library archive path collision: std/collision/nested.zig');
	});

	it('bounds gzip-expanded TAR bytes before materializing the archive', async () => {
		await expect(
			loadZigStdDirectory(
				new Uint8Array(stdlibTarGzip),
				'https://static.example.com/wasm-zig/std.tar.gz',
				{ maxExpandedBytes: 512, maxFiles: 10 }
			)
		).rejects.toThrow('512 byte limit');
	});

	it('rejects TAR archives larger than the file-count budget', async () => {
		const archive = createTarGzip([
			{ path: 'std/a.zig', contents: new Uint8Array([1]) },
			{ path: 'std/b.zig', contents: new Uint8Array([2]) }
		]);

		await expect(
			loadZigStdDirectory(
				new Uint8Array(archive),
				'https://static.example.com/wasm-zig/std.tar.gz',
				{ maxExpandedBytes: 4096, maxFiles: 1 }
			)
		).rejects.toThrow('Zig standard library archive exceeds the 1 file limit');
	});

	it('rejects unsafe TAR paths instead of normalizing traversal', async () => {
		const archive = createTarGzip([
			{ path: 'std/../escape.zig', contents: new Uint8Array([1]) }
		]);

		await expect(
			loadZigStdDirectory(
				new Uint8Array(archive),
				'https://static.example.com/wasm-zig/std.tar.gz',
				{ maxExpandedBytes: 4096, maxFiles: 10 }
			)
		).rejects.toThrow('Zig standard library archive has an unsafe path: std/../escape.zig');
	});
});

describe('createZigWorkerService', () => {
	it('uses the wasm-zig compiler host for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async (request) => ({
			success: false,
			diagnostics: [
				{
					fileName: request.activePath,
					lineNumber: 2,
					columnNumber: 9,
					severity: 'error' as const,
					message: 'use of undeclared identifier missing'
				}
			],
			stderr: 'main.zig:2:9: error: use of undeclared identifier missing'
		}));
		const service = createZigWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.zig',
			languageId: 'zig',
			version: 1,
			text: 'pub fn main() void {\n    missing();\n}\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[document.uri, document],
				[
					'file:///workspace/src/helper.zig',
					{
						uri: 'file:///workspace/src/helper.zig',
						languageId: 'zig',
						version: 1,
						text: 'pub const helper = 1;\n'
					}
				]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				compilerUrl: 'https://static.example.com/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://static.example.com/wasm-zig/std.tar.gz'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 4 }, context);

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: document.text,
				activePath: 'main.zig',
				targetTriple: 'wasm64-wasi',
				compileArgs: [],
				log: false
			})
		);
		expect(compile.mock.calls[0][0].workspaceFiles).toEqual(
			expect.arrayContaining([
				{ path: 'main.zig', content: document.text },
				{ path: 'src/helper.zig', content: 'pub const helper = 1;\n' }
			])
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 8 },
					end: { line: 1, character: 9 }
				},
				severity: 1,
				source: 'zig',
				message: 'use of undeclared identifier missing'
			}
		]);
		expect(completions?.items.some((item) => item.label === '@import')).toBe(true);
		expect(hover?.contents.value).toContain('Declares a function');
		expect(context.reportProgress).toHaveBeenCalledWith('load-zig-compiler');
		expect(context.reportProgress).toHaveBeenCalledWith('zig-diagnostics');
	});
});
