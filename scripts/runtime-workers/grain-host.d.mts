export const GRAIN_STDLIB_ROOT: string;
export const GRAIN_WORK_ROOT: string;
export const GRAIN_STDLIB_PACK_FORMAT: string;
export const GRAIN_STDLIB_SOURCE_MTIME_MS: number;
export const GRAIN_STDLIB_OBJECT_MTIME_MS: number;

export interface GrainHostFile {
	path: string;
	data: Uint8Array<ArrayBuffer>;
	mtimeMs?: number;
}

export interface GrainDiagnostic {
	fileName: string;
	lineNumber: number;
	columnNumber: number;
	endLineNumber: number;
	endColumnNumber: number;
	severity: 'error' | 'warning';
	message: string;
}

export function readGrainStdlibPack(
	bytes: Uint8Array
): { path: string; data: Uint8Array<ArrayBuffer> }[];

export function createGrainCompilerHost(options: {
	files: readonly GrainHostFile[];
	argv: readonly string[];
	onStdout: (chunk: Uint8Array) => void;
	onStderr: (chunk: Uint8Array) => void;
}): {
	process: unknown;
	require: (name: string) => unknown;
	exitCode: () => number | null;
	isExit: (error: unknown) => boolean;
	readFile: (path: string) => Uint8Array<ArrayBuffer> | undefined;
	files: () => Required<GrainHostFile>[];
};

export function parseGrainDiagnostics(text: string): GrainDiagnostic[];

export function createGrainWasi(options: {
	args: readonly string[];
	readStdin: (maxLength: number) => Uint8Array;
	onStdout: (chunk: Uint8Array) => void;
	onStderr: (chunk: Uint8Array) => void;
}): {
	imports: (module: WebAssembly.Module) => WebAssembly.Imports;
	setMemory: (memory: WebAssembly.Memory) => void;
	exitStatus: (error: unknown) => number | null;
};
