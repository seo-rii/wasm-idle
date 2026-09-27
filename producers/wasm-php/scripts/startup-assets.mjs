import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Derive loader paths, Vite URLs and receipts from the exactly pinned package. */
export async function phpStartupAssetsPlugin(webPackageDir) {
	const id = 'virtual:php-startup-assets',
		resolved = '\0' + id;
	const records = [];
	for (const mode of ['jspi', 'asyncify']) {
		const loader = path.join(webPackageDir, mode, 'php_8_4.js');
		const source = await readFile(loader, 'utf8');
		const match = source.match(/^import dependencyFilename from ['"](.+\.wasm)['"];$/m);
		const size = source.match(/^export const dependenciesTotalSize = (\d+);$/m);
		if (!match || !size) throw new Error(`Unknown pinned PHP ${mode} loader format`);
		const wasm = path.resolve(path.dirname(loader), match[1]);
		if (!wasm.startsWith(path.join(webPackageDir, mode) + path.sep))
			throw new Error('Unsafe PHP Wasm package path');
		const bytes = await readFile(wasm);
		if (bytes.length !== Number(size[1]))
			throw new Error('PHP loader dependency size differs from package');
		records.push({
			mode,
			loader,
			wasm,
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
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
