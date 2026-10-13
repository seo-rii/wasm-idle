// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
	requestWorkspaceArchive,
	type WorkspaceArchiveRequest,
	type WorkspaceArchiveResponse,
	type WorkspaceArchiveWorker
} from './workspaceArchive';

function workerFixture() {
	const worker: WorkspaceArchiveWorker = {
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage: vi.fn(),
		terminate: vi.fn()
	};
	return worker;
}

describe('workspace archive request lifecycle', () => {
	it('returns a normal response, forwards transferred buffers and terminates once', async () => {
		const worker = workerFixture();
		const archive = new ArrayBuffer(8);
		const request: WorkspaceArchiveRequest = { type: 'extract', archive };
		const response: WorkspaceArchiveResponse = {
			type: 'extracted',
			files: [{ path: 'main.py', content: 'print("archive")' }]
		};
		const pending = requestWorkspaceArchive(worker, request, [archive]);
		expect(worker.postMessage).toHaveBeenCalledWith(request, [archive]);
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.onmessage?.(new MessageEvent('message', { data: response }));
		await expect(pending).resolves.toBe(response);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('rejects a worker-reported archive error and terminates once', async () => {
		const worker = workerFixture();
		const pending = requestWorkspaceArchive(worker, { type: 'create', files: [] });
		worker.onmessage?.(
			new MessageEvent('message', { data: { type: 'error', message: 'ZIP data is corrupt' } })
		);
		await expect(pending).rejects.toThrow('ZIP data is corrupt');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it.each(['worker runtime failed', ''])(
		'rejects a runtime error (%j) and terminates once',
		async (message) => {
			const worker = workerFixture();
			const pending = requestWorkspaceArchive(worker, { type: 'create', files: [] });
			worker.onerror?.({ message } as ErrorEvent);
			await expect(pending).rejects.toThrow(message || 'ZIP worker failed');
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		}
	);

	it('rejects message decoding failure promptly and terminates once', async () => {
		const worker = workerFixture();
		const pending = requestWorkspaceArchive(worker, { type: 'create', files: [] });
		worker.onmessageerror?.(new MessageEvent('messageerror'));
		let timer: ReturnType<typeof setTimeout>;
		const guard = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Archive request did not settle')), 500);
		});
		try {
			await expect(Promise.race([pending, guard])).rejects.toThrow(
				'ZIP worker response could not be decoded'
			);
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		} finally {
			clearTimeout(timer!);
		}
	});

	it('rejects synchronous posting errors and still terminates once', async () => {
		const worker = workerFixture();
		vi.mocked(worker.postMessage).mockImplementation(() => {
			throw new DOMException('Request could not be cloned', 'DataCloneError');
		});
		await expect(
			requestWorkspaceArchive(worker, { type: 'create', files: [] })
		).rejects.toThrow('Request could not be cloned');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});
});
