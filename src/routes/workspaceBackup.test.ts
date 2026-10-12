import { describe, expect, it } from 'vitest';
import {
	WORKSPACE_BACKUP_FORMAT,
	parseWorkspaceBackup,
	parseWorkspaceBackupBytes,
	serializeWorkspaceBackup
} from './workspaceBackup';

const files = [
	{ path: '자료/main.cpp', content: 'printf("안녕🙂");\n', encoding: 'utf-8' as const },
	{
		path: '자료/module.wasm',
		content: 'data:application/wasm;base64,AGFzbQEAAAA=',
		encoding: 'data-url' as const
	}
];
const snapshot = {
	version: 6,
	language: 'CPP',
	activePath: files[0].path,
	workspaces: {
		CPP: { files, activePath: files[0].path, openTabs: files.map((file) => file.path) }
	}
};

describe('workspace backup format', () => {
	it('sniffs UTF-8 BOM/whitespace backups while leaving binary ZIP input alone', () => {
		const bytes = new TextEncoder().encode(' \n\t' + serializeWorkspaceBackup(snapshot));
		expect(parseWorkspaceBackupBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]))).toEqual(
			snapshot
		);
		expect(parseWorkspaceBackupBytes(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).toBeNull();
	});
	it('validates and round trips marked snapshots without rewriting Unicode or file encodings', () => {
		const before = JSON.stringify(snapshot);
		const text = serializeWorkspaceBackup(snapshot);
		expect(JSON.parse(text)).toEqual({ format: WORKSPACE_BACKUP_FORMAT, snapshot });
		expect(parseWorkspaceBackup(text)).toEqual(snapshot);
		expect(JSON.stringify(snapshot)).toBe(before);
	});

	it.each([
		'wasm-idle-workspace.json',
		'renamed.json',
		'wasm-idle-workspace (1).json',
		'backup.txt'
	])('accepts backup contents from file %j', async (name) => {
		const file = new File([serializeWorkspaceBackup(snapshot)], name);
		expect(parseWorkspaceBackup(await file.text())).toEqual(snapshot);
	});

	it.each([1, 2, 3, 4, 5, 6])('recognizes unmarked legacy snapshot version %i', (version) => {
		const legacy = {
			version,
			language: 'CPP',
			activePath: files[0].path,
			files,
			openTabs: [files[0].path]
		};
		expect(parseWorkspaceBackup(JSON.stringify(legacy))).toEqual(legacy);
		expect(parseWorkspaceBackup(serializeWorkspaceBackup(legacy))).toEqual(legacy);
	});

	it('recognizes current unmarked workspace maps with a complete snapshot identity', () => {
		expect(parseWorkspaceBackup(JSON.stringify(snapshot))).toEqual(snapshot);
	});

	it.each([
		'print("source")',
		'not JSON',
		'null',
		'3',
		'[]',
		'"source"',
		'{}',
		JSON.stringify({ version: 6, files }),
		JSON.stringify({ version: 6, language: 'CPP', files }),
		JSON.stringify({ version: 6, activePath: files[0].path, files }),
		JSON.stringify({ language: 'CPP', activePath: files[0].path, files }),
		JSON.stringify({ format: 'ordinary-document', snapshot }),
		JSON.stringify({ version: 6, language: 3, activePath: files[0].path, files })
	])('preserves ordinary JSON or source input %j', (text) => {
		expect(parseWorkspaceBackup(text)).toBeNull();
	});

	it.each([
		{ format: WORKSPACE_BACKUP_FORMAT },
		{ format: WORKSPACE_BACKUP_FORMAT, snapshot: null },
		{ format: WORKSPACE_BACKUP_FORMAT, snapshot: { ...snapshot, version: 7 } },
		{ format: WORKSPACE_BACKUP_FORMAT, snapshot: { ...snapshot, version: 0 } },
		{ format: WORKSPACE_BACKUP_FORMAT, snapshot: { ...snapshot, openTabs: 'main.cpp' } }
	])('rejects malformed marked backup %j', (backup) => {
		expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow(
			'Invalid workspace snapshot'
		);
	});

	it.each(['wasm-idle-workspace-backup-v2', 'wasm-idle-workspace-backup'])(
		'rejects unsupported format %j',
		(format) => {
			expect(() => parseWorkspaceBackup(JSON.stringify({ format, snapshot }))).toThrow(
				'Unsupported workspace backup format'
			);
		}
	);

	it('rejects malformed legacy tabs without mutating their source snapshot', () => {
		for (const malformed of [
			{ ...snapshot, workspaces: { CPP: { files, openTabs: 'main.cpp' } } },
			{ version: 4, language: 'CPP', activePath: files[0].path, files, openTabs: 'main.cpp' }
		]) {
			const before = JSON.stringify(malformed);
			expect(() => parseWorkspaceBackup(before)).toThrow('Invalid workspace snapshot');
			expect(() => serializeWorkspaceBackup(malformed)).toThrow('Invalid workspace snapshot');
			expect(JSON.stringify(malformed)).toBe(before);
		}
	});
});
