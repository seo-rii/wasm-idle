export function capVerilogWasmMemory(bytes: Uint8Array, maxBytes: number): Uint8Array<ArrayBuffer>;
export function createVerilogStdin(
	source: string | undefined,
	channel: unknown,
	notify: () => void
): () => number | null;
export function verilogWorkspacePath(name: string): string;
export function guardVerilogFilesystem(fs: any, maxBytes: number): () => void;
