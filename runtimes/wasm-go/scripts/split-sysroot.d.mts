export function splitGoSysrootPacks(
	runtimeDir: string
): Promise<
	| { changed: false }
	| { changed: true; chunks: { wasi: number; js: number }; deliveryBytes: number }
>;
