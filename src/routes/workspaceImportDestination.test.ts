import { describe, expect, it } from 'vitest';
import {
	captureWorkspaceImportDestination,
	WorkspaceImportCancelled
} from './workspaceImportDestination';

describe('asynchronous workspace import destination', () => {
	it('cancels after a save lock wait if execution started without changing the files', async () => {
		const files = [{ path: 'main.py', content: 'running source' }];
		let running = false;
		const destination = captureWorkspaceImportDestination(() => ({
			language: 'PYTHON',
			files,
			running
		}));
		let release!: () => void;
		const saving = new Promise<void>((resolve) => {
			release = resolve;
		});
		const importing = (async () => {
			await saving;
			destination.assertCurrent();
			files[0].content = 'imported replacement';
		})();
		running = true;
		release();
		await expect(importing).rejects.toThrow('Stop the running program');
		expect(files[0].content).toBe('running source');
	});
	it('cancels a delayed import after a language switch and leaves both workspaces untouched', async () => {
		const cpp = [{ path: 'main.cpp', content: 'original C++' }];
		const python = [{ path: 'main.py', content: 'original Python' }];
		let target = { language: 'CPP', files: cpp };
		const destination = captureWorkspaceImportDestination(() => target);
		let release!: () => void;
		const reading = new Promise<void>((resolve) => {
			release = resolve;
		});
		const importing = (async () => {
			await reading;
			destination.assertCurrent();
			target.files.push({ path: 'util.h', content: 'imported' });
		})();
		target = { language: 'PYTHON', files: python };
		release();
		await expect(importing).rejects.toBeInstanceOf(WorkspaceImportCancelled);
		expect(cpp.map((file) => file.path)).toEqual(['main.cpp']);
		expect(python.map((file) => file.path)).toEqual(['main.py']);
	});

	it('cancels when the same language is restored into a different workspace array', () => {
		let files = [{ path: 'main.py', content: 'old' }];
		const destination = captureWorkspaceImportDestination(() => ({
			language: 'PYTHON',
			files
		}));
		files = [{ path: 'main.py', content: 'restored' }];
		expect(() => destination.assertCurrent()).toThrow('workspace changed');
	});
});
