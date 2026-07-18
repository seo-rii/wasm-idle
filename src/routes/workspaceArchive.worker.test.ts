import { describe, expect, it } from 'vitest';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';

function duplicateEntryArchive() {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const zip = new Zip((error, data) => {
		if (error) throw error;
		chunks.push(data);
		length += data.byteLength;
	});
	for (const content of ['first', 'second']) {
		const file = new ZipPassThrough('duplicate.txt');
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

		expect(extractWorkspaceArchive(createWorkspaceArchive(files))).toEqual(files);
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
			{ path: 'src/main.txt', content: 'stored' }
		]);
	});

	it('preserves duplicate ZIP entries in archive order', () => {
		expect(extractWorkspaceArchive(duplicateEntryArchive())).toEqual([
			{ path: 'duplicate.txt', content: 'first' },
			{ path: 'duplicate.txt', content: 'second' }
		]);
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
