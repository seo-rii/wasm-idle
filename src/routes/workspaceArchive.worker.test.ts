import { describe, expect, it } from 'vitest';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';
import { workspaceFileBytes } from './workspaceCodec';

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

function archiveOffsets(archive: Uint8Array) {
	const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
	const end = archive.byteLength - 22;
	const directory = view.getUint32(end + 16, true);
	const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
	return { view, end, directory, payload };
}

describe('workspace archive worker', () => {
	it('round trips prototype-like filenames as real ZIP entries', () => {
		const files = [
			'__proto__',
			'constructor',
			'toString',
			'hasOwnProperty',
			'nested/__proto__'
		].map((path) => ({ path, content: `contents of ${path}` }));
		expect(extractWorkspaceArchive(createWorkspaceArchive(files))).toEqual(
			files.map((file) => ({ ...file, encoding: 'utf-8' }))
		);
	});
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

	it('rejects corrupted stored contents instead of returning changed files', () => {
		const archive = zipSync({ 'main.txt': strToU8('original') }, { level: 0 });
		archive[archiveOffsets(archive).payload] ^= 1;

		expect(() => extractWorkspaceArchive(archive)).toThrow(/CRC checksum/u);
	});

	it('checks the CRC of deflated entries even when both headers agree', () => {
		const archive = zipSync({ 'main.txt': strToU8('compressed contents') });
		const { view, directory } = archiveOffsets(archive);
		const incorrect = view.getUint32(14, true) ^ 1;
		view.setUint32(14, incorrect, true);
		view.setUint32(directory + 16, incorrect, true);

		expect(() => extractWorkspaceArchive(archive)).toThrow(/CRC checksum/u);
	});

	it.each(['missing directory', 'partial directory', 'partial end record'])(
		'rejects an archive with a %s after a complete first entry',
		(truncation) => {
			const archive = zipSync({ 'main.txt': strToU8('complete payload') }, { level: 0 });
			const { directory, end } = archiveOffsets(archive);
			const length =
				truncation === 'missing directory'
					? directory
					: truncation === 'partial directory'
						? directory + 12
						: end + 12;

			expect(() => extractWorkspaceArchive(archive.subarray(0, length))).toThrow(
				/complete ZIP directory/u
			);
		}
	);

	it('rejects an unfinished later entry instead of returning the completed prefix', () => {
		const archive = zipSync(
			{ 'first.txt': strToU8('first'), 'second.txt': strToU8('second') },
			{ level: 0 }
		);
		const { payload, view } = archiveOffsets(archive);
		const secondHeader = payload + view.getUint32(18, true);

		expect(() => extractWorkspaceArchive(archive.subarray(0, secondHeader + 12))).toThrow(
			/complete ZIP directory/u
		);
	});

	it('rejects local entry metadata that disagrees with the complete directory', () => {
		const archive = zipSync({ 'main.txt': strToU8('original') }, { level: 0 });
		const { view, directory } = archiveOffsets(archive);
		view.setUint32(directory + 24, 1, true);

		expect(() => extractWorkspaceArchive(archive)).toThrow(/Inconsistent ZIP entry/u);
	});

	it('rejects an entry whose decoded length differs from both declared lengths', () => {
		const archive = zipSync({ 'main.txt': strToU8('compressed contents') });
		const { view, directory } = archiveOffsets(archive);
		view.setUint32(22, 1, true);
		view.setUint32(directory + 24, 1, true);

		expect(() => extractWorkspaceArchive(archive)).toThrow(/ZIP entry size/u);
	});

	it('supports streaming data descriptors without their optional signature', () => {
		const archive = entryArchive([['main.txt', 'streamed contents']]);
		const { view, directory, payload } = archiveOffsets(archive);
		const descriptor = payload + view.getUint32(directory + 20, true);
		expect(view.getUint32(descriptor, true)).toBe(0x08074b50);
		const unsigned = new Uint8Array(archive.byteLength - 4);
		unsigned.set(archive.subarray(0, descriptor));
		unsigned.set(archive.subarray(descriptor + 4), descriptor);
		new DataView(unsigned.buffer).setUint32(unsigned.length - 22 + 16, directory - 4, true);

		expect(extractWorkspaceArchive(unsigned)).toEqual([
			{ path: 'main.txt', content: 'streamed contents', encoding: 'utf-8' }
		]);
	});

	it('rejects an incomplete streaming data descriptor', () => {
		const archive = entryArchive([['main.txt', 'streamed contents']]);
		const { view, directory, payload } = archiveOffsets(archive);
		const descriptor = payload + view.getUint32(directory + 20, true);
		view.setUint32(descriptor + 12, 1, true);

		expect(() => extractWorkspaceArchive(archive)).toThrow(/ZIP data descriptor/u);
	});

	it('preserves ZIP header signatures inside streaming stored contents', () => {
		const content = `beforePK\u0003\u0004${'\0'.repeat(40)}after`;
		const [file] = extractWorkspaceArchive(entryArchive([['nested.zip', content]]));

		expect(workspaceFileBytes(file)).toEqual(strToU8(content));
	});

	it('rejects a truncated payload even when its central directory is complete', () => {
		const archive = zipSync({ 'main.txt': strToU8('original') }, { level: 0 });
		const { directory } = archiveOffsets(archive);
		const truncated = new Uint8Array(archive.length - 1);
		truncated.set(archive.subarray(0, directory - 1));
		truncated.set(archive.subarray(directory), directory - 1);
		new DataView(truncated.buffer).setUint32(truncated.length - 22 + 16, directory - 1, true);

		expect(() => extractWorkspaceArchive(truncated)).toThrow(/Truncated ZIP entry payload/u);
	});

	it('preserves an archive comment without treating its bytes as entries', () => {
		const archive = zipSync(
			{ 'main.txt': strToU8('original') },
			{ comment: 'a ZIP comment containing PK\u0003\u0004' }
		);

		expect(extractWorkspaceArchive(archive)).toEqual([
			{ path: 'main.txt', content: 'original', encoding: 'utf-8' }
		]);
	});

	it('rejects ZIP64 metadata explicitly', () => {
		const archive = zipSync({ 'main.txt': strToU8('original') });
		const { view, directory } = archiveOffsets(archive);
		view.setUint32(directory + 24, 0xffffffff, true);

		expect(() => extractWorkspaceArchive(archive)).toThrow(/ZIP64.*unsupported/u);
	});

	it('checks declared byte and file budgets before expanding any entry', () => {
		const oversized = zipSync({ 'main.txt': strToU8('small') });
		const { view, directory } = archiveOffsets(oversized);
		view.setUint32(22, 16 * 1024 * 1024 + 1, true);
		view.setUint32(directory + 24, 16 * 1024 * 1024 + 1, true);
		expect(() => extractWorkspaceArchive(oversized)).toThrow(/entry exceeds.*byte limit/u);

		const many = entryArchive(Array.from({ length: 1001 }, (_, index) => [`${index}.txt`, '']));
		expect(() => extractWorkspaceArchive(many)).toThrow(/more than 1000 files/u);

		const total = zipSync(
			Object.fromEntries(
				Array.from({ length: 5 }, (_, index) => [`${index}.txt`, strToU8('')])
			)
		);
		const metadata = archiveOffsets(total);
		let current = metadata.directory;
		for (let index = 0; index < 5; index++) {
			const local = metadata.view.getUint32(current + 42, true);
			metadata.view.setUint32(local + 22, 16 * 1024 * 1024, true);
			metadata.view.setUint32(current + 24, 16 * 1024 * 1024, true);
			current +=
				46 +
				metadata.view.getUint16(current + 28, true) +
				metadata.view.getUint16(current + 30, true) +
				metadata.view.getUint16(current + 32, true);
		}
		expect(() => extractWorkspaceArchive(total)).toThrow(/contents exceed.*byte limit/u);
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
