import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function readPhpWasmAsset(webPackageDir, mode) {
	const loader = path.join(webPackageDir, mode, 'php_8_4.js');
	const source = await readFile(loader, 'utf8');
	const match =
		source.match(/^import dependencyFilename from (['"])(.+\.wasm)\1;$/m) ??
		source.match(
			/^const dependencyFilename = new URL\((['"])(.+\.wasm)\1,\s*import\.meta\.url\)\s*\.href;$/m
		);
	const size = source.match(/^export const dependenciesTotalSize = (\d+);$/m);
	if (!match || !size) throw new Error(`Unknown pinned PHP ${mode} loader format`);
	const wasm = path.resolve(path.dirname(loader), match[2]);
	if (!wasm.startsWith(path.join(webPackageDir, mode) + path.sep))
		throw new Error('Unsafe PHP Wasm package path');
	const bytes = await readFile(wasm);
	if (bytes.length !== Number(size[1]))
		throw new Error('PHP loader dependency size differs from package');
	return {
		mode,
		loader,
		wasm,
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
}

/** Derive loader paths, Vite URLs and receipts from the exactly pinned package. */
export async function phpStartupAssetsPlugin(webPackageDir) {
	const id = 'virtual:php-startup-assets',
		resolved = '\0' + id;
	const records = [];
	for (const mode of ['jspi', 'asyncify']) {
		records.push(await readPhpWasmAsset(webPackageDir, mode));
	}
	const code =
		records
			.map((r) => `import ${r.mode}Url from ${JSON.stringify(r.wasm + '?url')};`)
			.join('\n') +
		'\nexport const assets={' +
		records
			.map(
				(r) =>
					`${r.mode}:{url:${r.mode}Url,bytes:${r.bytes},sha256:${JSON.stringify(r.sha256)}}`
			)
			.join(',') +
		'};\n' +
		`export function loadLoader(mode){switch(mode){${records.map((r) => `case ${JSON.stringify(r.mode)}:return import(${JSON.stringify(r.loader)});`).join('')}default:throw new Error('Unknown PHP loader mode');}}`;
	return {
		name: 'pinned-php-startup-assets',
		resolveId(value) {
			if (value === id) return resolved;
		},
		load(value) {
			if (value === resolved) return code;
		}
	};
}
