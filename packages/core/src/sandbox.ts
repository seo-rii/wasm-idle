import type { ProgressLike } from './progress.js';
import type { RuntimeAssetKeySource } from './runtime-assets.js';

export type SandboxRuntimeAssets = string | RuntimeAssetKeySource;
export type SandboxProgress = ProgressLike;

export interface SandboxExecutionOptions {
	[key: string]: unknown;
}

export interface Sandbox {
	constructor: unknown;
	eof: () => void;
	load: (
		runtimeAssets?: SandboxRuntimeAssets,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	run: (
		code: string,
		prepare: boolean,
		log?: boolean,
		prog?: SandboxProgress,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	terminate: () => void;
	clear: () => Promise<void>;
	kill?: () => void;
	write?: (data: string) => void;
	output?: (data: string) => void;
	ondebug?: (event: unknown) => void;
	oncompilerdiagnostic?: (diagnostic: unknown) => void;
	debugCommand?: (command: unknown) => void;
	setBreakpoints?: (lines: number[]) => void;
	debugEvaluate?: (expression: string) => Promise<string>;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	elapse?: number;
}

export interface BoundSandbox extends Omit<Sandbox, 'load'> {
	load: (
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundTerminalProps {
	playground: PlaygroundBinding;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundBinding {
	runtimeAssets: SandboxRuntimeAssets;
	terminalProps: PlaygroundTerminalProps;
	load: (language: string) => Promise<BoundSandbox>;
}

export type SandboxLoader = (language: string) => Promise<Sandbox>;

function bindRuntimeAssets(sandbox: Sandbox, runtimeAssets: SandboxRuntimeAssets): BoundSandbox {
	return new Proxy(sandbox, {
		get(target, prop, receiver) {
			if (prop === 'runtimeAssets') return runtimeAssets;
			if (prop === 'load') {
				return (
					code = '',
					log = true,
					args: string[] = [],
					options: SandboxExecutionOptions = {},
					progress?: SandboxProgress
				) => target.load(runtimeAssets, code, log, args, options, progress);
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value, receiver) {
			return Reflect.set(target, prop, value, receiver);
		}
	}) as BoundSandbox;
}

export function createPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): PlaygroundBinding {
	const binding = {
		runtimeAssets,
		terminalProps: {} as PlaygroundBinding['terminalProps'],
		async load(language: string) {
			return bindRuntimeAssets(await loadSandbox(language), runtimeAssets);
		}
	} as PlaygroundBinding;
	binding.terminalProps = {
		playground: binding,
		runtimeAssets
	};
	return binding;
}
