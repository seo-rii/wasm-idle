declare module 'coffeescript/lib/coffeescript-browser-compiler-modern/coffeescript.js' {
	export function compile(
		source: string,
		options: { bare: boolean; filename: string; literate: boolean }
	): string;
}
