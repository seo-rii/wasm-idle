import { instantiate } from '@assemblyscript/loader';

export { instantiate };

export async function loadCompiler() {
	const workerGlobal = globalThis as Record<string, unknown>;
	const hadProcess = Object.prototype.hasOwnProperty.call(workerGlobal, 'process');
	const previousProcess = workerGlobal.process;
	Reflect.deleteProperty(workerGlobal, 'process');
	try {
		return await import('assemblyscript/asc');
	} finally {
		if (hadProcess) workerGlobal.process = previousProcess;
	}
}
