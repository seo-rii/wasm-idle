declare module '@bytecodealliance/jco/component' {
	export function generate(
		component: Uint8Array,
		options: {
			name: string;
			instantiation: { tag: 'async' };
			noTypescript: boolean;
			noNodejsCompat: boolean;
			map: string[][];
		}
	): Promise<{
		files: Array<[string, Uint8Array]>;
		imports: string[];
		exports: Array<[string, 'function' | 'instance']>;
	}>;
}

declare module '@bytecodealliance/preview2-shim/cli' {
	export const environment: unknown;
	export const exit: unknown;
	export const stderr: unknown;
	export const stdin: unknown;
	export const stdout: unknown;
	export function _setArgs(args: string[]): void;
	export function _setCwd(cwd: string): void;
	export function _setEnv(env: Record<string, string>): void;
	export function _setStderr(handler: unknown): void;
	export function _setStdin(handler: unknown): void;
	export function _setStdout(handler: unknown): void;
}

declare module '@bytecodealliance/preview2-shim/clocks' {
	export const monotonicClock: unknown;
	export const wallClock: unknown;
}

declare module '@bytecodealliance/preview2-shim/filesystem' {
	export const preopens: unknown;
	export const types: unknown;
	export function _setFileData(fileData: unknown): void;
}

declare module '@bytecodealliance/preview2-shim/io' {
	export const error: unknown;
	export const poll: unknown;
	export const streams: unknown;
}

declare module '@bytecodealliance/preview2-shim/random' {
	export const insecure: unknown;
	export const insecureSeed: unknown;
	export const random: unknown;
}
