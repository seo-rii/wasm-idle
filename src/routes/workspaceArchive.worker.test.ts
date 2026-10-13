import { describe, expect, it } from 'vitest';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';

function entryArchive(entries: Array<[string, string]>) {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const zip = new Zip((error, data) => {
		if (error) throw error;
		chunks.push(data);
		length += data.byteLength;
	});
	for (const [path, content] of entries) {
		const file = new ZipPassThrough(path);
		zip.add(file);
		file.push(strToU8(content), true);
	}
	zip.end();
	const archive = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return archive;
}

describe('workspace archive worker', () => {
	it('round trips Unicode files and nested paths', () => {
		const files = [
			{ path: 'src/main.ts', content: 'console.log("안녕");\n' },
			{ path: 'README.md', content: '# wasm-idle\n' }
		];

		expect(extractWorkspaceArchive(createWorkspaceArchive(files))).toEqual(
			files.map((file) => ({ ...file, encoding: 'utf-8' }))
		);
	});

	it('extracts stored files and ignores directory entries', () => {
		const archive = zipSync(
			{
				'src/': new Uint8Array(),
				'src/main.txt': strToU8('stored')
			},
			{ level: 0 }
		);

		expect(extractWorkspaceArchive(archive)).toEqual([
			{ path: 'src/main.txt', content: 'stored', encoding: 'utf-8' }
		]);
	});

	it.each([
		['duplicate.txt', 'duplicate.txt'],
		['a/./b.py', 'a/b.py'],
		['a//b.py', 'a/b.py'],
		['a\\b.py', 'a/b.py'],
		['자료/./실행.py', '자료/실행.py']
	])(
		'rejects duplicate or canonical-colliding paths %j and %j in both directions',
		(left, right) => {
			for (const paths of [
				[left, right],
				[right, left]
			]) {
				const files = paths.map((path, index) => ({ path, content: String(index) }));
				expect(() => createWorkspaceArchive(files)).toThrow(/duplicate entry path/u);
				expect(() =>
					extractWorkspaceArchive(
						entryArchive(files.map(({ path, content }) => [path, content]))
					)
				).toThrow(/duplicate entry path/u);
			}
		}
	);

	it('rejects traversal instead of merging it with a distinct valid file', () => {
		const files = [
			{ path: 'a/../b.py', content: 'traversal' },
			{ path: 'a/b.py', content: 'valid' }
		];
		expect(() => createWorkspaceArchive(files)).toThrow(/traverse directories/u);
		expect(() =>
			extractWorkspaceArchive(entryArchive(files.map(({ path, content }) => [path, content])))
		).toThrow(/traverse directories/u);
	});

	it.each(['', '.', '/absolute.py', 'C:file.py', 'a\0b.py'])(
		'rejects invalid file path %j on export and import',
		(path) => {
			expect(() => createWorkspaceArchive([{ path, content: 'invalid' }])).toThrow();
			expect(() => extractWorkspaceArchive(entryArchive([[path, 'invalid']]))).toThrow();
		}
	);

	it('validates directory paths before skipping their entries', () => {
		expect(() =>
			extractWorkspaceArchive(
				entryArchive([
					['a/../', ''],
					['valid.py', 'valid']
				])
			)
		).toThrow(/traverse directories/u);
		expect(() =>
			extractWorkspaceArchive(
				entryArchive([
					['a/', ''],
					['a/./', ''],
					['a/valid.py', 'valid']
				])
			)
		).toThrow(/duplicate entry path/u);
	});

	it('normalizes unambiguous Unicode and separator paths consistently', () => {
		const files = [{ path: '資料\\.\\실행.py', content: 'print("안녕")' }];
		expect(extractWorkspaceArchive(createWorkspaceArchive(files))).toEqual([
			{ path: '資料/실행.py', content: 'print("안녕")', encoding: 'utf-8' }
		]);
		expect(
			extractWorkspaceArchive(entryArchive(files.map(({ path, content }) => [path, content])))
		).toEqual([{ path: '資料/실행.py', content: 'print("안녕")', encoding: 'utf-8' }]);
	});

	it('rejects traversal paths, malformed archives, and excessive file counts', () => {
		expect(() =>
			extractWorkspaceArchive(zipSync({ '../outside.txt': strToU8('blocked') }))
		).toThrow(/traverse directories/u);
		expect(() => extractWorkspaceArchive(Uint8Array.of(1, 2, 3))).toThrow();
		expect(() =>
			createWorkspaceArchive(
				Array.from({ length: 1001 }, (_, index) => ({
					path: `${index}.txt`,
					content: ''
				}))
			)
		).toThrow(/more than 1000 files/u);
	});
});
