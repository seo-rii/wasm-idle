import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGleamWorkerService, type GleamCompiler } from '../src/index.js';

describe('createGleamWorkerService', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the real Gleam compiler API for diagnostics', async () => {
		const compiler: GleamCompiler = {
			reset_filesystem: vi.fn(),
			delete_project: vi.fn(),
			write_file: vi.fn(),
			write_module: vi.fn(),
			compile_package: vi.fn(() => {
				throw new Error('Syntax error\n/src/main.gleam:2:5');
			})
		};
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith('source-manifest.v1.json')) {
				return new Response(JSON.stringify({ files: ['gleam/io.gleam'] }));
			}
			return new Response('pub fn println(_value: String) -> Nil { Nil }\n');
		});
		vi.stubGlobal('fetch', fetchMock);
		const service = createGleamWorkerService(async () => compiler);
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				baseUrl: 'https://static.example.com/wasm-gleam/',
				manifestUrl: 'https://static.example.com/wasm-gleam/source-manifest.v1.json'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.gleam',
				languageId: 'gleam',
				version: 1,
				text: 'pub fn main() {\n  let\n}\n'
			},
			context
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://static.example.com/wasm-gleam/source-manifest.v1.json',
			{ cache: 'no-store' }
		);
		expect(compiler.write_file).toHaveBeenCalledWith(
			expect.any(Number),
			'/src/gleam/io.gleam',
			expect.any(String)
		);
		expect(compiler.write_file).toHaveBeenCalledWith(
			expect.any(Number),
			'/src/wasm_idle/stdin.gleam',
			expect.stringContaining('pub fn read_line')
		);
		expect(compiler.write_module).toHaveBeenCalledWith(
			expect.any(Number),
			'main',
			'pub fn main() {\n  let\n}\n'
		);
		expect(compiler.compile_package).toHaveBeenCalledWith(expect.any(Number), 'javascript');
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				},
				severity: 1,
				source: 'gleam',
				message: 'Syntax error\n/src/main.gleam:2:5'
			}
		]);
		expect(reportProgress).toHaveBeenCalledWith('load-gleam-compiler');
		expect(reportProgress).toHaveBeenCalledWith('gleam-diagnostics');
		expect(compiler.delete_project).toHaveBeenCalledWith(expect.any(Number));
	});
});
