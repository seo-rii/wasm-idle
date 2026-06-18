import jsonrpc from 'vscode-jsonrpc';
import type {
	BrowserMessageReader as BrowserMessageReaderInstance,
	BrowserMessageWriter as BrowserMessageWriterInstance
} from 'vscode-jsonrpc/lib/browser/main.js';

const browserJsonrpc = jsonrpc as unknown as {
	BrowserMessageReader: new (port: MessagePort | Worker | unknown) => BrowserMessageReaderInstance;
	BrowserMessageWriter: new (port: MessagePort | Worker | unknown) => BrowserMessageWriterInstance;
};

export const BrowserMessageReader = browserJsonrpc.BrowserMessageReader;
export const BrowserMessageWriter = browserJsonrpc.BrowserMessageWriter;

export type BrowserMessageReader = BrowserMessageReaderInstance;
export type BrowserMessageWriter = BrowserMessageWriterInstance;
