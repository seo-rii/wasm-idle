import * as jsonrpc from 'vscode-jsonrpc/browser';
import type {
	BrowserMessageReader as BrowserMessageReaderInstance,
	BrowserMessageWriter as BrowserMessageWriterInstance
} from 'vscode-jsonrpc/browser';

const browserJsonrpc = jsonrpc as unknown as {
	BrowserMessageReader: new (
		port: MessagePort | Worker | unknown
	) => BrowserMessageReaderInstance;
	BrowserMessageWriter: new (
		port: MessagePort | Worker | unknown
	) => BrowserMessageWriterInstance;
	ReadableStreamMessageReader: typeof jsonrpc.ReadableStreamMessageReader;
	WriteableStreamMessageWriter: typeof jsonrpc.WriteableStreamMessageWriter;
	Emitter: typeof jsonrpc.Emitter;
};

export const BrowserMessageReader = browserJsonrpc.BrowserMessageReader;
export const BrowserMessageWriter = browserJsonrpc.BrowserMessageWriter;
export const ReadableStreamMessageReader = browserJsonrpc.ReadableStreamMessageReader;
export const WriteableStreamMessageWriter = browserJsonrpc.WriteableStreamMessageWriter;
export const Emitter = browserJsonrpc.Emitter;

export type BrowserMessageReader = BrowserMessageReaderInstance;
export type BrowserMessageWriter = BrowserMessageWriterInstance;

export type ReadableStreamMessageReader = jsonrpc.ReadableStreamMessageReader;
export type WriteableStreamMessageWriter = jsonrpc.WriteableStreamMessageWriter;
