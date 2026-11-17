import { compile } from 'coffeescript/lib/coffeescript-browser-compiler-modern/coffeescript.js';

// Use the upstream browser compiler unchanged. Native JavaScript execution and
// the existing console/filesystem builtins are shared with the JS/TS runner.
export function compileCoffeeScript(source: string, fileName: string): string {
	return compile(source, {
		bare: true,
		filename: fileName,
		literate: /\.litcoffee$/iu.test(fileName)
	});
}
