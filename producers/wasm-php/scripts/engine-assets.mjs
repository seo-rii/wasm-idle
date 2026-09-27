import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Resolve through the pinned package root rather than bypassing its exports at runtime.
export function phpEngineAssetsPlugin(packageRoot) {
	const id = 'virtual:wasm-idle-php-engines';
	return {
		name: 'wasm-idle-php-engine-assets',
		resolveId(source) {
			if (source === id) return '\0' + id;
		},
		async load(source) {
			if (source !== '\0' + id) return;
			const imports = [],
				entries = [];
			for (const mode of ['jspi', 'asyncify']) {
				const loader = path.join(packageRoot, mode, 'php_8_4.js');
				const code = await readFile(loader, 'utf8');
				const matches = [
					...code.matchAll(/import\s+dependencyFilename\s+from\s+['"]([^'"]+\.wasm)['"]/g)
				];
				if (matches.length !== 1)
					throw new Error(`Unexpected pinned PHP ${mode} loader layout`);
				const wasm = path.resolve(path.dirname(loader), matches[0][1]);
				if (!wasm.startsWith(path.resolve(packageRoot) + path.sep))
					throw new Error('PHP Wasm path escapes its package');
				const bytes = await readFile(wasm);
				const hash = createHash('sha256').update(bytes).digest('hex');
				const url = JSON.stringify(wasm.split(path.sep).join('/') + '?url');
				imports.push(`import ${mode}Url from ${url};`);
				entries.push(
					`${mode}: Object.freeze({url:${mode}Url,bytes:${bytes.length},sha256:${JSON.stringify(hash)},load:()=>import(${JSON.stringify(loader.split(path.sep).join('/'))})})`
				);
				this.addWatchFile(loader);
				this.addWatchFile(wasm);
			}
			return (
				imports.join('\n') +
				`\nexport const phpEngineAssets = Object.freeze({${entries.join(',')}});`
			);
		}
	};
}
