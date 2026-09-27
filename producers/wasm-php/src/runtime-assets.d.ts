declare module 'virtual:wasm-idle-php-engines' {
	export const phpEngineAssets: Readonly<
		Record<'jspi' | 'asyncify', import('./startup').PhpEngineAsset>
	>;
}

// The upstream package has declaration files but its exports map omits them.
declare module '@php-wasm/web-8-4' {
	export function jspi(): Promise<boolean>;
}
