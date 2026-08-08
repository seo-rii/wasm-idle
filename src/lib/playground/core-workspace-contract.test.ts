import { describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_EXECUTION_LIMITS,
	DEFAULT_WORKSPACE_LIMITS,
	WorkspaceValidationError,
	createPlaygroundBinding,
	normalizeWorkspacePath,
	validateExecutionWorkspace,
	validateWorkspaceFiles,
	type Sandbox
} from '@wasm-idle/core';

describe('core workspace policy', () => {
	it('normalizes portable relative paths without changing file contents', () => {
		const files = validateWorkspaceFiles([
			{ path: 'src\\main.ts', content: 'export const answer = 42;\n' },
			{ path: 'assets/data.bin', content: new Uint8Array([0, 1, 2]) }
		]);

		expect(files).toEqual([
			{ path: 'src/main.ts', content: 'export const answer = 42;\n' },
			{ path: 'assets/data.bin', content: new Uint8Array([0, 1, 2]) }
		]);
		expect(normalizeWorkspacePath('Sources/main.swift')).toBe('Sources/main.swift');
	});

	it.each([
		'',
		'/etc/passwd',
		'../secret',
		'src/../secret',
		'./main.c',
		'src//main.c',
		'C:\\workspace\\main.c',
		'file:///workspace/main.c',
		'https://example.com/main.c',
		'\\\\server\\share\\main.c',
		'main\0.c'
	])('rejects unsafe workspace path %j', (path) => {
		expect(() => normalizeWorkspacePath(path)).toThrow(WorkspaceValidationError);
	});

	it('rejects duplicate and case-colliding paths', () => {
		expect(() =>
			validateWorkspaceFiles([
				{ path: 'src/main.ts', content: '' },
				{ path: 'src\\main.ts', content: '' }
			])
		).toThrowError(expect.objectContaining({ code: 'duplicate-path' }));

		expect(() =>
			validateWorkspaceFiles([
				{ path: 'Readme.md', content: '' },
				{ path: 'README.md', content: '' }
			])
		).toThrowError(expect.objectContaining({ code: 'case-collision' }));
	});

	it.each([
		[
			{ path: 'cache', content: 'file' },
			{ path: 'cache/data.bin', content: 'child' }
		],
		[
			{ path: 'cache/data.bin', content: 'child' },
			{ path: 'cache', content: 'file' }
		],
		[
			{ path: 'Cache', content: 'file' },
			{ path: 'cache/data.bin', content: 'child' }
		]
	])('rejects file and directory prefix collisions regardless of order', (...files) => {
		expect(() => validateWorkspaceFiles(files)).toThrowError(
			expect.objectContaining({ code: 'path-prefix-collision' })
		);
	});

	it('enforces file count, per-file bytes, total bytes, and path bytes', () => {
		expect(() =>
			validateWorkspaceFiles(
				[
					{ path: 'a.txt', content: '' },
					{ path: 'b.txt', content: '' }
				],
				{ maxFiles: 1 }
			)
		).toThrowError(expect.objectContaining({ code: 'file-count-limit' }));

		expect(() =>
			validateWorkspaceFiles([{ path: 'unicode.txt', content: '한글' }], {
				maxFileBytes: 5
			})
		).toThrowError(expect.objectContaining({ code: 'file-size-limit' }));

		expect(() =>
			validateWorkspaceFiles(
				[
					{ path: 'a.txt', content: '1234' },
					{ path: 'b.txt', content: '5678' }
				],
				{ maxTotalBytes: 7 }
			)
		).toThrowError(expect.objectContaining({ code: 'total-size-limit' }));

		expect(() =>
			validateWorkspaceFiles([{ path: '한.txt', content: '' }], { maxPathBytes: 6 })
		).toThrowError(expect.objectContaining({ code: 'path-size-limit' }));
	});

	it('validates the active source and workspace as one execution filesystem', () => {
		const workspace = validateExecutionWorkspace(
			'export const answer = helper;\n',
			[
				{ path: 'src\\helper.ts', content: 'export const helper = 42;\n' },
				{ path: 'src\\main.ts', content: 'throw new Error("stale source");\n' }
			],
			'src\\main.ts'
		);

		expect(workspace).toEqual({
			activePath: 'src/main.ts',
			workspaceFiles: [{ path: 'src/helper.ts', content: 'export const helper = 42;\n' }]
		});
		expect(() => validateExecutionWorkspace('source', [], '../main.ts')).toThrowError(
			expect.objectContaining({ code: 'invalid-path' })
		);
		expect(() =>
			validateExecutionWorkspace(
				'source',
				[{ path: 'src', content: 'file at directory path' }],
				'src/main.ts'
			)
		).toThrowError(expect.objectContaining({ code: 'path-prefix-collision' }));
		expect(() =>
			validateExecutionWorkspace('1234', [{ path: 'data.txt', content: '5678' }], undefined, {
				maxTotalBytes: 7
			})
		).toThrowError(
			expect.objectContaining({
				code: 'total-size-limit',
				actual: 8,
				limit: 7
			})
		);
	});

	it('replaces one stale active file before content and quota validation', () => {
		expect(
			validateExecutionWorkspace(
				'new',
				[{ path: 'src/main.ts', content: 'stale content beyond the limit' }],
				'src/main.ts',
				{ maxFileBytes: 3, maxTotalBytes: 3 }
			)
		).toEqual({ activePath: 'src/main.ts', workspaceFiles: [] });

		expect(
			validateExecutionWorkspace(
				'new',
				[{ path: 'SRC/Main.ts', content: 'stale content beyond the limit' }],
				'src/main.ts',
				{ maxFileBytes: 3, maxTotalBytes: 3 }
			)
		).toEqual({ activePath: 'src/main.ts', workspaceFiles: [] });

		expect(
			validateExecutionWorkspace(
				'new',
				[{ path: 'src/main.ts', content: 42 as never }],
				'src/main.ts'
			)
		).toEqual({ activePath: 'src/main.ts', workspaceFiles: [] });
	});

	it('retains active-path collision checks and case-sensitive siblings', () => {
		expect(() =>
			validateExecutionWorkspace(
				'new',
				[
					{ path: 'src/main.ts', content: 'first' },
					{ path: 'src/main.ts', content: 'second' }
				],
				'src/main.ts'
			)
		).toThrowError(expect.objectContaining({ code: 'duplicate-path' }));

		expect(() =>
			validateExecutionWorkspace(
				'new',
				[
					{ path: 'SRC/Main.ts', content: 'first' },
					{ path: 'src/main.ts', content: 'second' }
				],
				'src/main.ts'
			)
		).toThrowError(expect.objectContaining({ code: 'case-collision' }));

		expect(
			validateExecutionWorkspace(
				'new',
				[{ path: 'SRC/Main.ts', content: 'sibling' }],
				'src/main.ts',
				{ caseSensitive: true }
			)
		).toEqual({
			activePath: 'src/main.ts',
			workspaceFiles: [{ path: 'SRC/Main.ts', content: 'sibling' }]
		});
	});

	it('publishes finite conservative defaults', () => {
		expect(DEFAULT_WORKSPACE_LIMITS).toEqual({
			maxFiles: 256,
			maxFileBytes: 2 * 1024 * 1024,
			maxTotalBytes: 8 * 1024 * 1024,
			maxPathBytes: 1024,
			caseSensitive: false
		});
	});

	it('normalizes and validates workspaces before bound runs', async () => {
		const run = vi.fn(async () => true);
		const sandbox = {
			constructor: Object,
			eof() {},
			load: vi.fn(async () => undefined),
			run,
			terminate() {},
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const binding = createPlaygroundBinding({}, async () => sandbox);
		const bound = await binding.load('TYPESCRIPT');

		await expect(
			bound.run('export {};', false, true, undefined, [], {
				activePath: 'src\\main.ts',
				workspaceFiles: [{ path: 'src\\helper.ts', content: 'export {};' }]
			})
		).resolves.toBe(true);
		expect(run).toHaveBeenCalledWith('export {};', false, true, undefined, [], {
			activePath: 'src/main.ts',
			limits: DEFAULT_EXECUTION_LIMITS,
			workspaceFiles: [{ path: 'src/helper.ts', content: 'export {};' }]
		});

		const rejected = bound.run('export {};', false, true, undefined, [], {
			activePath: '../main.ts'
		});
		expect(rejected).toBeInstanceOf(Promise);
		await expect(rejected).rejects.toMatchObject({ code: 'invalid-path' });
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('counts the active source in binding quotas and validates bound loads', async () => {
		const load = vi.fn(async () => undefined);
		const run = vi.fn(async () => true);
		const sandbox = {
			constructor: Object,
			eof() {},
			load,
			run,
			terminate() {},
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const binding = createPlaygroundBinding({}, async () => sandbox);
		const bound = await binding.load('TYPESCRIPT');

		await expect(
			bound.run('한글', false, true, undefined, [], {
				workspaceLimits: { maxFileBytes: 5 }
			})
		).rejects.toMatchObject({ code: 'file-size-limit' });
		expect(run).not.toHaveBeenCalled();

		const rejected = bound.load('export {};', true, [], {
			workspaceFiles: [{ path: 'src/../main.ts', content: '' }]
		});
		expect(rejected).toBeInstanceOf(Promise);
		await expect(rejected).rejects.toMatchObject({ code: 'invalid-path' });
		expect(load).not.toHaveBeenCalled();
	});
});
