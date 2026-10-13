import type { WorkspaceFile } from './workspaceCodec';

export type WorkspaceArchiveRequest =
	{ type: 'create'; files: WorkspaceFile[] } | { type: 'extract'; archive: ArrayBuffer };

export type WorkspaceArchiveResponse =
	| { type: 'created'; archive: ArrayBuffer }
	| { type: 'extracted'; files: WorkspaceFile[] }
	| { type: 'error'; message: string };

export interface WorkspaceArchiveWorker {
	onmessage: ((event: MessageEvent<WorkspaceArchiveResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	postMessage(request: WorkspaceArchiveRequest, transfer: Transferable[]): void;
	terminate(): void;
}

/** Each archive operation owns a worker until its response or failure settles. */
export async function requestWorkspaceArchive(
	worker: WorkspaceArchiveWorker,
	request: WorkspaceArchiveRequest,
	transfer: Transferable[] = []
) {
	try {
		return await new Promise<WorkspaceArchiveResponse>((resolve, reject) => {
			worker.onmessage = ({ data }) => {
				if (data.type === 'error') reject(new Error(data.message));
				else resolve(data);
			};
			worker.onerror = (event) => reject(new Error(event.message || 'ZIP worker failed'));
			worker.onmessageerror = () =>
				reject(new Error('ZIP worker response could not be decoded'));
			worker.postMessage(request, transfer);
		});
	} finally {
		worker.terminate();
	}
}
