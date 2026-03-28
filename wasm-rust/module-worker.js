export function createModuleWorker(moduleUrl) {
    if (typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') {
        return new Worker(moduleUrl, { type: 'module' });
    }
    const bootstrapUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(moduleUrl.toString())};\n`], {
        type: 'text/javascript'
    }));
    const worker = new Worker(bootstrapUrl, { type: 'module' });
    setTimeout(() => URL.revokeObjectURL(bootstrapUrl), 0);
    return worker;
}
