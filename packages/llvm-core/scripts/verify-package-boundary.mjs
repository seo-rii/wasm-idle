#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
	encoding: 'utf8'
});
if (result.status !== 0) {
	process.stderr.write(result.stderr);
	process.exit(result.status ?? 1);
}

const packed = JSON.parse(result.stdout)[0];
const forbiddenPath =
	/(^|\/)(?:assets?|artifacts?|producer|static)(\/|$)|\.(?:a|bc|br|data|gz|o|pack|so|tar|tgz|wasm|zip|zst)$/iu;
const forbiddenFiles = packed.files
	.map(({ path }) => path)
	.filter((path) => forbiddenPath.test(path));
const embeddedPayloads = [];

for (const { path } of packed.files) {
	if (!/\.(?:cjs|js|json|mjs)$/iu.test(path)) continue;
	const source = readFileSync(path, 'utf8');
	if (
		/data:(?:application\/(?:octet-stream|wasm)|[^,]{0,100};base64),/iu.test(source) ||
		/(?:AGFzbQ|f0VMRg)[A-Za-z0-9+/]{128}/u.test(source)
	) {
		embeddedPayloads.push(path);
	}
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.dependencies?.['@seo-rii/wasm-llvm']) {
	throw new Error('@wasm-idle/llvm-core must not depend on the compiler producer repository');
}
if (forbiddenFiles.length > 0 || embeddedPayloads.length > 0) {
	throw new Error(
		`runtime package contains forbidden assets: ${[...forbiddenFiles, ...embeddedPayloads].join(', ')}`
	);
}

console.log(
	`Verified code-only LLVM runtime package (${packed.entryCount} files, ${packed.size} packed bytes).`
);
