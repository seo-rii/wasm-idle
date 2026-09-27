declare module 'virtual:php-startup-assets' {
	export const assets: Record<
		'jspi' | 'asyncify',
		{ url: string; bytes: number; sha256: string }
	>;
	export function loadLoader(
		mode: 'jspi' | 'asyncify'
	): Promise<import('@php-wasm/universal').PHPLoaderModule>;
}
