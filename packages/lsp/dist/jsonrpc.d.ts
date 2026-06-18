import type { BrowserMessageReader as BrowserMessageReaderInstance, BrowserMessageWriter as BrowserMessageWriterInstance } from 'vscode-jsonrpc/lib/browser/main.js';
export declare const BrowserMessageReader: new (port: MessagePort | Worker | unknown) => BrowserMessageReaderInstance;
export declare const BrowserMessageWriter: new (port: MessagePort | Worker | unknown) => BrowserMessageWriterInstance;
export type BrowserMessageReader = BrowserMessageReaderInstance;
export type BrowserMessageWriter = BrowserMessageWriterInstance;
//# sourceMappingURL=jsonrpc.d.ts.map