import * as zip from "@zip.js/zip.js";

const store: any = {}

export const readBuffer = async (name: string) => {
    const response = await fetch(name);
    const blob = await response.blob();
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = await reader.getEntries();
    for (const entry of entries) {
        const data = await entry.getData(new zip.Uint8ArrayWriter());
        return data;
    }
}

export async function compile(filename: string) {
    // TODO: make compileStreaming work. It needs the server to use the
    // application/wasm mimetype.
    if (store[filename]) return store[filename];
    return store[filename] = WebAssembly.compile(await readBuffer(filename));
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
    return WebAssembly.instantiate(module, imports);
}
