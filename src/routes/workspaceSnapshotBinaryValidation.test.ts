// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
	parseWorkspaceBackup,
	serializeWorkspaceBackup,
	WORKSPACE_BACKUP_FORMAT
} from './workspaceBackup';
import { workspaceFileBytes, workspaceFileFromBytes, type WorkspaceFile } from './workspaceCodec';
import { stageWorkspaceImport } from './workspaceImport';
import { validateWorkspaceSnapshot } from './workspaceSnapshot';

function snapshot(files: WorkspaceFile[]) {
	return { version: 6, language: 'CPP', activePath: files[0].path, files };
}

describe('binary workspace JSON boundary', () => {
	it.each([
		'not a data URL',
		'data:application/octet-stream,AQID',
		'data:application/octet-stream;base64,!',
		'data:application/octet-stream;base64,A',
		'data:application/octet-stream;base64,AA=',
		'data:application/octet-stream;base64,AAA==',
		'data:application/octet-stream;base64,A===',
		'data:application/octet-stream;charset=utf-8;base64,AQID'
	])(
		'refuses undecodable binary content before root or language workspace restore: %s',
		(content) => {
			const files: WorkspaceFile[] = [{ path: 'payload.bin', content, encoding: 'data-url' }];
			for (const value of [snapshot(files), { version: 6, workspaces: { CPP: { files } } }]) {
				const before = JSON.stringify(value);
				expect(() => validateWorkspaceSnapshot(value)).toThrow('files[].content');
				expect(JSON.stringify(value)).toBe(before);
			}
		}
	);

	it('also validates legacy wasm data URLs recognized by the codec', () => {
		expect(() =>
			validateWorkspaceSnapshot(
				snapshot([{ path: 'legacy.wasm', content: 'data:application/wasm;base64,A' }])
			)
		).toThrow('files[].content');
	});

	it.each(['legacy.wasm/.', 'legacy.wasm/', 'legacy.wasm\\.'])(
		'rejects malformed legacy bytes after normalizing %s, before import commits',
		async (path) => {
			const files: WorkspaceFile[] = [{ path, content: 'data:application/wasm;base64,A' }];
			for (const value of [snapshot(files), { version: 6, workspaces: { CPP: { files } } }]) {
				const before = JSON.stringify(value);
				expect(() => validateWorkspaceSnapshot(value)).toThrow('files[].content');
				expect(JSON.stringify(value)).toBe(before);
				const backup = JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, snapshot: value });
				const commit = vi.fn();
				await expect(
					stageWorkspaceImport([new File([backup], 'workspace.json')], {
						extractZip: vi.fn(),
						assertDestination: () => {}
					}).then(commit)
				).rejects.toThrow('files[].content');
				expect(commit).not.toHaveBeenCalled();
			}
		}
	);

	it('preserves valid legacy bytes and explicit text at normalized wasm paths', () => {
		for (const file of [
			{ path: 'legacy.wasm/.', content: 'data:application/wasm;base64,AP+A' },
			{
				path: 'source.wasm/.',
				content: 'data:application/wasm;base64,A',
				encoding: 'utf-8' as const
			}
		]) {
			const value = snapshot([file]);
			const before = JSON.stringify(value);
			expect(() => validateWorkspaceSnapshot(value)).not.toThrow();
			expect(JSON.stringify(value)).toBe(before);
			expect(parseWorkspaceBackup(serializeWorkspaceBackup(value))).toEqual(value);
		}
	});

	it('rejects a marked malformed binary backup before an import plan can commit', async () => {
		const value = snapshot([
			{ path: 'payload.bin', content: 'not a data URL', encoding: 'data-url' }
		]);
		const backup = JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, snapshot: value });
		expect(() => parseWorkspaceBackup(backup)).toThrow('files[].content');
		const commit = vi.fn();
		const extractZip = vi.fn();
		const importing = stageWorkspaceImport([new File([backup], 'workspace.json')], {
			extractZip,
			assertDestination: () => {}
		}).then(commit);
		await expect(importing).rejects.toThrow('files[].content');
		expect(commit).not.toHaveBeenCalled();
		expect(extractZip).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'empty payload',
			file: workspaceFileFromBytes('empty.bin', new Uint8Array()),
			bytes: []
		},
		{
			name: 'arbitrary bytes',
			file: workspaceFileFromBytes('assets/문서.bin', Uint8Array.of(0, 255, 128, 1)),
			bytes: [0, 255, 128, 1]
		},
		{
			name: 'legacy wasm',
			file: { path: 'legacy.wasm', content: 'data:application/wasm;base64,AP+A' },
			bytes: [0, 255, 128]
		},
		{
			name: 'unpadded base64 accepted by the codec',
			file: {
				path: 'payload.bin',
				content: 'data:application/octet-stream;base64,AQI',
				encoding: 'data-url' as const
			},
			bytes: [1, 2]
		}
	])(
		'keeps valid $name bytes unchanged through snapshot and backup serialization',
		({ file, bytes }) => {
			const value = snapshot([file]);
			const before = JSON.stringify(value);
			validateWorkspaceSnapshot(value);
			expect(JSON.stringify(value)).toBe(before);
			const restored = parseWorkspaceBackup(serializeWorkspaceBackup(value));
			expect(restored).toEqual(value);
			expect([...workspaceFileBytes((restored!.files as WorkspaceFile[])[0])]).toEqual(bytes);
		}
	);

	it('keeps ordinary source text outside the binary decoder contract', () => {
		const files: WorkspaceFile[] = [
			{ path: 'payload.bin', content: 'not a data URL', encoding: 'utf-8' },
			{ path: 'source.txt', content: 'data:application/octet-stream;base64,A' }
		];
		expect(() => validateWorkspaceSnapshot(snapshot(files))).not.toThrow();
		expect(new TextDecoder().decode(workspaceFileBytes(files[0]))).toBe('not a data URL');
	});
});
