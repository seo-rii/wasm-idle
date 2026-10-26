// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';
import { serializeWorkspaceBackup } from './workspaceBackup';
import { captureWorkspaceImportDestination } from './workspaceImportDestination';
import { stageWorkspaceImport } from './workspaceImport';

const extractZip = async (bytes: Uint8Array) => extractWorkspaceArchive(bytes);

describe('workspace import staging', () => {
	it('prepares an entire text/binary/ZIP selection with exact referenced paths', async () => {
		const zip = createWorkspaceArchive([
			{ path: 'src/main.cpp', content: '#include "util.h"' },
			{ path: 'src/util.h', content: '#define VALUE 7' }
		]);
		const plan = await stageWorkspaceImport(
			[new File(['extra text'], 'extra.txt'), new File([zip], 'project.zip')],
			{ extractZip, assertDestination: () => {} }
		);
		expect(plan).toMatchObject({
			kind: 'files',
			fromZip: true,
			files: [
				{ path: 'extra.txt', content: 'extra text' },
				{ path: 'src/main.cpp', content: '#include "util.h"' },
				{ path: 'src/util.h', content: '#define VALUE 7' }
			]
		});
	});

	it('never commits preceding files when a later ZIP is corrupt', async () => {
		const commit = vi.fn();
		const importing = stageWorkspaceImport(
			[new File(['first'], 'first.txt'), new File([Uint8Array.of(1, 2, 3)], 'broken.zip')],
			{ extractZip, assertDestination: () => {} }
		).then(commit);
		await expect(importing).rejects.toThrow();
		expect(commit).not.toHaveBeenCalled();
	});

	it.each(['CRC mismatch', 'truncated directory'])(
		'never commits a partial selection when a readable ZIP has a %s',
		async (damage) => {
			const commit = vi.fn();
			let zip = zipSync({ 'main.txt': strToU8('original') }, { level: 0 });
			const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
			if (damage === 'CRC mismatch') {
				zip[30 + view.getUint16(26, true) + view.getUint16(28, true)] ^= 1;
			} else {
				zip = zip.slice(0, view.getUint32(zip.length - 22 + 16, true));
			}
			const importing = stageWorkspaceImport(
				[new File(['first'], 'first.txt'), new File([zip], 'broken.zip')],
				{ extractZip, assertDestination: () => {} }
			).then(commit);

			await expect(importing).rejects.toThrow();
			expect(commit).not.toHaveBeenCalled();
		}
	);

	it('never commits preceding files when a later file read rejects', async () => {
		const commit = vi.fn();
		const importing = stageWorkspaceImport(
			[
				new File(['first'], 'first.txt'),
				{
					name: 'unreadable.txt',
					arrayBuffer: async () => {
						throw new Error('read failed');
					}
				}
			],
			{ extractZip, assertDestination: () => {} }
		).then(commit);
		await expect(importing).rejects.toThrow('read failed');
		expect(commit).not.toHaveBeenCalled();
	});

	it('rejects canonical collisions across the whole selection', async () => {
		await expect(
			stageWorkspaceImport([new File(['one'], 'a/./b.txt'), new File(['two'], 'a/b.txt')], {
				extractZip,
				assertDestination: () => {}
			})
		).rejects.toThrow('Duplicate imported path: a/b.txt');
	});

	it('rejects mixed backup and file selections before returning a plan', async () => {
		const snapshot = {
			version: 6,
			language: 'CPP',
			activePath: 'main.cpp',
			files: [{ path: 'main.cpp', content: 'backup' }]
		};
		await expect(
			stageWorkspaceImport(
				[
					new File(['first'], 'first.txt'),
					new File([serializeWorkspaceBackup(snapshot)], 'renamed.json')
				],
				{ extractZip, assertDestination: () => {} }
			)
		).rejects.toThrow('backup by itself');
	});

	it('cancels a batch whose destination changes while a later read is pending', async () => {
		let files = [{ path: 'main.py', content: 'original' }];
		const destination = captureWorkspaceImportDestination(() => ({
			language: 'PYTHON',
			files
		}));
		let release!: (value: ArrayBuffer) => void;
		const pending = new Promise<ArrayBuffer>((resolve) => {
			release = resolve;
		});
		const importing = stageWorkspaceImport(
			[new File(['first'], 'first.txt'), { name: 'later.txt', arrayBuffer: () => pending }],
			{ extractZip, assertDestination: destination.assertCurrent }
		);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		files = [{ path: 'main.py', content: 'restored' }];
		release(new ArrayBuffer(0));
		await expect(importing).rejects.toThrow('workspace changed');
		expect(files).toEqual([{ path: 'main.py', content: 'restored' }]);
	});
});
