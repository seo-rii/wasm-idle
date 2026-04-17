import jsonrpc from 'vscode-jsonrpc';
import type {
	BrowserMessageReader as BrowserMessageReaderInstance,
	BrowserMessageWriter as BrowserMessageWriterInstance
} from 'vscode-jsonrpc/lib/browser/main';

const browserJsonrpc = jsonrpc as unknown as {
	BrowserMessageReader: new (
		port: MessagePort | Worker | DedicatedWorkerGlobalScope
	) => BrowserMessageReaderInstance;
	BrowserMessageWriter: new (
		port: MessagePort | Worker | DedicatedWorkerGlobalScope
	) => BrowserMessageWriterInstance;
};

export const BrowserMessageReader = browserJsonrpc.BrowserMessageReader;
export const BrowserMessageWriter = browserJsonrpc.BrowserMessageWriter;

export type BrowserMessageReader = BrowserMessageReaderInstance;
export type BrowserMessageWriter = BrowserMessageWriterInstance;
