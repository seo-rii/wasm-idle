import { createCrossGccCompiler, createGccCompiler } from './compiler.js';
import type {
	CreateCrossGccCompilerOptions,
	CreateGccCompilerOptions,
	CrossGccCompileRequest,
	CrossGccCompiler,
	CrossGccPrecompileRequest,
	WasiGccArtifact,
	WasiGccCompileRequest,
	WasiGccCompiler,
	WasiGccRunOptions
} from './types.js';

const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};
let compiler: CrossGccCompiler | WasiGccCompiler | undefined;
let initializing = false;

scope.onmessage = async ({
	data
}: MessageEvent<{
	id: number;
	type: 'initialize' | 'compile' | 'run' | 'precompileHeader';
	options?: CreateCrossGccCompilerOptions | CreateGccCompilerOptions | WasiGccRunOptions;
	request?: CrossGccCompileRequest | WasiGccCompileRequest | CrossGccPrecompileRequest;
	artifact?: WasiGccArtifact;
}>) => {
	try {
		if (data.type === 'initialize') {
			if (compiler || initializing || !data.options)
				throw new Error('GCC Worker already initialized');
			initializing = true;
			compiler =
				'target' in data.options
					? await createGccCompiler(data.options as CreateGccCompilerOptions)
					: await createCrossGccCompiler(data.options as CreateCrossGccCompilerOptions);
			scope.postMessage({
				id: data.id,
				type: 'ready',
				manifest: compiler.manifest,
				identity: compiler.identity
			});
		} else if (data.type === 'compile') {
			if (!compiler || !data.request) throw new Error('GCC Worker is not ready');
			const result =
				'run' in compiler
					? await compiler.compile(data.request as WasiGccCompileRequest)
					: await compiler.compile(data.request as CrossGccCompileRequest);
			scope.postMessage(
				{ id: data.id, type: 'result', result },
				result.artifact ? [result.artifact.bytes.buffer as ArrayBuffer] : []
			);
		} else if (data.type === 'precompileHeader') {
			if (!compiler || !('precompileHeader' in compiler))
				throw new Error('GCC Worker requires an x86 compiler to precompile headers');
			const result = await compiler.precompileHeader(
				data.request as CrossGccPrecompileRequest | undefined
			);
			scope.postMessage({ id: data.id, type: 'precompiled', result });
		} else if (data.type === 'run') {
			if (!compiler || !('run' in compiler) || !data.artifact)
				throw new Error('GCC Worker requires a wasm32-wasi executable to run');
			const result = await compiler.run(
				data.artifact,
				data.options as WasiGccRunOptions | undefined
			);
			scope.postMessage({ id: data.id, type: 'run-result', result });
		} else throw new Error('Unknown GCC Worker message');
	} catch (error) {
		scope.postMessage({
			id: data.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
