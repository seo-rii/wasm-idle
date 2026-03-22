export function createModuleWorker(moduleUrl) {
    return new Worker(moduleUrl, { type: 'module' });
}
