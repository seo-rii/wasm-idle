// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	const __WASM_IDLE_BUILD__: {
		commit: string;
		builtAt: string;
		runtimeAssets: Record<string, string>;
	};
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
