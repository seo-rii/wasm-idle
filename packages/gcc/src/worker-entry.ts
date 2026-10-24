import { createCrossGccCompiler } from './compiler.js';
import type {
	CreateCrossGccCompilerOptions,
	CrossGccCompileRequest,
	CrossGccCompiler
} from './types.js';

const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};
let compiler: CrossGccCompiler | undefined;
let initializing = false;

scope.onmessage = async ({
	data
}: MessageEvent<{
	id: number;
	type: 'initialize' | 'compile';
	options?: CreateCrossGccCompilerOptions;
	request?: CrossGccCompileRequest;
}>) => {
	try {
		if (data.type === 'initialize') {
			if (compiler || initializing || !data.options)
				throw new Error('GCC Worker already initialized');
			initializing = true;
			compiler = await createCrossGccCompiler(data.options);
			scope.postMessage({
				id: data.id,
				type: 'ready',
				manifest: compiler.manifest,
				identity: compiler.identity
			});
		} else if (data.type === 'compile') {
			if (!compiler || !data.request) throw new Error('GCC Worker is not ready');
			const result = await compiler.compile(data.request);
			scope.postMessage(
				{ id: data.id, type: 'result', result },
				result.artifact ? [result.artifact.bytes.buffer as ArrayBuffer] : []
			);
		} else throw new Error('Unknown GCC Worker message');
	} catch (error) {
		scope.postMessage({
			id: data.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
