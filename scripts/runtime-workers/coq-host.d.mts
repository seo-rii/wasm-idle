export function coqWorkspacePath(value: string): string;
export function coqPpText(message: unknown, state?: { vertical: boolean }): string;
export function readCoqCommandInput(
	channel: unknown,
	maxBytes: number,
	notify: () => void
): Uint8Array;
export function guardCoqFilesystem(
	runtime: any,
	maxBytes: number
): { check(actual?: number): void; usage(): number };
