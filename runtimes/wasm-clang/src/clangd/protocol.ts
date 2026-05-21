export interface ClangdWorkerInitMessage {
	type: 'init';
	baseUrl: string;
}

export interface ClangdWorkerSyncFileMessage {
	type: 'sync-file';
	name: string;
}

export type ClangdWorkerInboundMessage = ClangdWorkerInitMessage | ClangdWorkerSyncFileMessage;

export type ClangdWorkerOutboundMessage =
	| { type: 'progress'; value: number; max?: number }
	| { type: 'ready'; value: number }
	| { type: 'error'; message: string };
