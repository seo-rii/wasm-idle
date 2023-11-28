import * as zip from "@zip.js/zip.js";
import type {Writable} from "svelte/store";

const store: any = {}

export const readBuffer = async (name: string, progress?: Writable<number>) => {
    const response = await fetch(name);
    const r = response.body.getReader();
    const contentLength = +response.headers.get('Content-Length');

    let receivedLength = 0;
    let chunks = [];
    while (true) {
        const {done, value} = await r.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        progress?.set?.(receivedLength / contentLength);
    }
    progress?.set?.(1);
    const chunksAll = new Uint8Array(receivedLength); // (4.1)
    let position = 0;
    for (const chunk of chunks) {
        chunksAll.set(chunk, position);
        position += chunk.length;
    }

    const reader = new zip.ZipReader(new zip.Uint8ArrayReader(chunksAll));
    const entries = await reader.getEntries();
    for (const entry of entries) {
        const data = await entry.getData(new zip.Uint8ArrayWriter());
        return data;
    }
    throw new Error('No entry found');
}

export async function compile(filename: string, progress?: Writable<number>) {
    // TODO: make compileStreaming work. It needs the server to use the
    // application/wasm mimetype.
    if (store[filename]) return store[filename];
    return store[filename] = WebAssembly.compile(await readBuffer(filename, progress));
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
    return WebAssembly.instantiate(module, imports);
}
