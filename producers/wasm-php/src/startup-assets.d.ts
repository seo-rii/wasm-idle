// The pinned web build publishes these exports without its declared index.d.ts.
declare module '@php-wasm/web-8-4' {
	export function jspi(): Promise<boolean>;
	export function getPHPLoaderModule(): Promise<import('@php-wasm/universal').PHPLoaderModule>;
}

declare module 'virtual:php-startup-assets' {
	export const assets: Record<
		'jspi' | 'asyncify',
		{ url: string; bytes: number; sha256: string }
	>;
	export function loadLoader(
		mode: 'jspi' | 'asyncify'
	): Promise<import('@php-wasm/universal').PHPLoaderModule>;
}
