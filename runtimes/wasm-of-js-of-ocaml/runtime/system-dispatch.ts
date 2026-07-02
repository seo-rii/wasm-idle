import type { MemoryFileSystem } from './fs/memory-fs.js';

export type SupportedSystemCommand = 'ocamlc' | 'ocamlfind' | 'js_of_ocaml' | 'wasm_of_ocaml';

export interface SystemDispatchInvocation {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	fs: MemoryFileSystem;
}

export interface SystemDispatchResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type BytecodeToolRunner = (
	toolPath: string,
	invocation: SystemDispatchInvocation
) => Promise<SystemDispatchResult>;

export type SystemDispatcher = (
	argv: string[],
	context: Omit<SystemDispatchInvocation, 'argv'>
) => Promise<SystemDispatchResult>;

const defaultCommandMap: Record<SupportedSystemCommand, string> = {
	ocamlc: 'bin/ocamlc.byte',
	ocamlfind: 'bin/ocamlfind.byte',
	js_of_ocaml: 'bin/js_of_ocaml.byte',
	wasm_of_ocaml: 'bin/wasm_of_ocaml.byte'
};

export interface CreateSystemDispatcherOptions {
	runBytecodeTool: BytecodeToolRunner;
	toolchainRoot?: string;
	commandMap?: Partial<Record<SupportedSystemCommand, string>>;
}

export function createSystemDispatcher(options: CreateSystemDispatcherOptions): SystemDispatcher {
	const toolchainRoot = (options.toolchainRoot || '/toolchain').replace(/\/+$/, '');
	const commandMap = { ...defaultCommandMap, ...(options.commandMap || {}) };
	return async (argv, context) => {
		if (argv.length === 0) {
			throw new Error('system dispatch requires at least one argv element');
		}
		const command = argv[0];
		if (
			command !== 'ocamlc' &&
			command !== 'ocamlfind' &&
			command !== 'js_of_ocaml' &&
			command !== 'wasm_of_ocaml'
		) {
			throw new Error(`unsupported subprocess: ${command}`);
		}
		const toolPath = `${toolchainRoot}/${commandMap[command].replace(/^\/+/, '')}`;
		return await options.runBytecodeTool(toolPath, {
			argv,
			cwd: context.cwd,
			env: context.env,
			fs: context.fs
		});
	};
}
