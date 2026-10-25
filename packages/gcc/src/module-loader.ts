export interface GccFileSystem {
	mkdirTree(path: string): void;
	writeFile(path: string, bytes: Uint8Array): void;
	readFile(path: string): Uint8Array;
	chdir(path: string): void;
}

export interface GccModule {
	FS: GccFileSystem;
	HEAPU8: Uint8Array;
	callMain(argv: string[]): number | void;
}

export type GccModuleFactory = (options: Record<string, unknown>) => Promise<GccModule>;

/** Only called after the loader's exact bytes have passed SHA-256 verification. */
export async function loadGccModuleFactory(bytes: Uint8Array): Promise<{
	factory: GccModuleFactory;
	revoke(): void;
}> {
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	try {
		const namespace: unknown = await import(/* @vite-ignore */ url);
		const factory = (namespace as { default?: unknown })?.default;
		if (typeof factory !== 'function')
			throw new Error('GCC loader has no default Emscripten factory');
		return { factory: factory as GccModuleFactory, revoke: () => URL.revokeObjectURL(url) };
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
}
