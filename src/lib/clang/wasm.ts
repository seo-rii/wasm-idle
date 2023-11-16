import * as zip from "@zip.js/zip.js";

const url = (url: string) => url
const store: any = {}

export async function compile(filename: string) {
    // TODO: make compileStreaming work. It needs the server to use the
    // application/wasm mimetype.
    if (store[filename]) return store[filename];
    const response = await fetch(url(filename));
    const blob = await response.blob();
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = await reader.getEntries();
    for (const entry of entries) {
        console.log(`Found WASM file: ${entry.filename}`);
        const data = await entry.getData(new zip.Uint8ArrayWriter());
        return store[filename] = WebAssembly.compile(data);
    }
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
    return WebAssembly.instantiate(module, imports);
}


export const readBuffer = (name: string) => fetch(url(name)).then(r => r.arrayBuffer());