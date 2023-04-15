const url = (url: string) => 'http://localhost:5174' + url

export async function compile(filename: string) {
    // TODO: make compileStreaming work. It needs the server to use the
    // application/wasm mimetype.
    if (false && WebAssembly.compileStreaming) {
        return WebAssembly.compileStreaming(fetch(url(filename)));
    } else {
        const response = await fetch(url(filename));
        return WebAssembly.compile(await response.arrayBuffer());
    }
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
    return WebAssembly.instantiate(module, imports);
}


export const readBuffer = (name: string) => fetch(url(name)).then(r => r.arrayBuffer());