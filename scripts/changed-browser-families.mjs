import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** @param {string[]} files */
export function changedBrowserFamilies(files) {
	const families = new Set();
	for (const file of files) {
		if (/(?:packages\/debug\/|lldbSession|wasm-debug|debug\.playwright)/.test(file))
			families.add('debug');
		if (/(?:dotnet|runtime-recovery)/.test(file)) families.add('dotnet');
		if (/(?:nim|runtime-recovery)/.test(file)) families.add('nim');
		if (/(?:clang|objectivec|packages\/llvm-core)/.test(file)) families.add('clang');
		if (
			/^(src\/routes\/|packages\/(core|terminal)\/|scripts\/(stdin-browser|run-all-language|changed-browser|browser-preview|required-browser)|\.github\/workflows\/|(?:package\.json|pnpm-lock\.yaml|vite\.config\.ts)$)/.test(
				file
			)
		) {
			for (const family of ['clang', 'debug', 'dotnet', 'nim']) families.add(family);
		}
	}
	return [...families].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const base = process.argv[2];
	const files =
		!base || /^0+$/.test(base)
			? ['package.json']
			: execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
					.trim()
					.split('\n');
	const families = changedBrowserFamilies(files);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `families=${JSON.stringify(families)}\n`);
	console.log(JSON.stringify(families));
}
