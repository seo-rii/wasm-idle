export function createModuleWorker(moduleUrl: URL) {
	return new Worker(moduleUrl, { type: 'module' });
}
