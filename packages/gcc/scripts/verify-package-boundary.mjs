#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
	cwd: fileURLToPath(root),
	encoding: 'utf8'
});
if (result.status !== 0) {
	process.stderr.write(result.stderr || String(result.error ?? 'npm pack failed'));
	process.exit(result.status ?? 1);
}

const packed = JSON.parse(result.stdout)[0];
const paths = new Set(packed.files.map(({ path }) => path));
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
assert.equal(manifest.name, '@wasm-idle/gcc');
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
	for (const dependency of Object.keys(manifest[field] ?? {})) {
		assert.equal(
			dependency,
			'@wasm-idle/core',
			`GCC must use neutral core helpers rather than another compiler package: ${dependency}`
		);
	}
}

// A package import alone does not exercise the Worker URL. Check its complete
// emitted module closure so npm packaging cannot silently omit the entry script.
for (const path of ['dist/index.js', 'dist/index.d.ts', 'dist/worker.js', 'dist/worker-entry.js']) {
	assert.ok(paths.has(path), `GCC package is missing ${path}`);
}
for (const target of Object.values(manifest.exports).flatMap((entry) =>
	typeof entry === 'string' ? [entry] : Object.values(entry)
)) {
	assert.ok(paths.has(target.replace(/^\.\//u, '')), `Unpacked export target: ${target}`);
}

const forbiddenPath =
	/(^|\/)(?:assets?|artifacts?|producer|static)(\/|$)|\.(?:a|bc|br|data|gz|map|o|pack|so|tar|tgz|wasm|zip|zst)$/iu;
for (const path of paths) {
	assert.ok(!forbiddenPath.test(path), `GCC host package contains a compiler asset: ${path}`);
	if (!/\.(?:cjs|js|json|mjs|d\.ts)$/iu.test(path)) continue;
	const source = readFileSync(new URL(path, root), 'utf8');
	assert.ok(
		!/@(?:wasm-idle\/llvm-core|seo-rii\/wasm-llvm)\b/u.test(source),
		`GCC package depends on LLVM or a compiler producer: ${path}`
	);
	assert.ok(
		!/data:(?:application\/(?:octet-stream|wasm)|[^,]{0,100};base64),/iu.test(source) &&
			!/(?:AGFzbQ|f0VMRg)[A-Za-z0-9+/]{128}/u.test(source),
		`GCC package contains an embedded compiler payload: ${path}`
	);
	if (path === 'package.json') continue;
	const references = [
		...source.matchAll(/\b(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/gu),
		...source.matchAll(/\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/gu)
	];
	for (const [, reference] of references) {
		if (!reference.startsWith('.')) {
			assert.ok(
				reference === '@wasm-idle/core' || reference.startsWith('@wasm-idle/core/'),
				`Unexpected GCC dependency in ${path}: ${reference}`
			);
			continue;
		}
		const resolved = posix.normalize(posix.join(posix.dirname(path), reference));
		assert.ok(paths.has(resolved), `GCC package omits ${reference} referenced by ${path}`);
	}
}

const worker = readFileSync(new URL('dist/worker.js', root), 'utf8');
assert.match(worker, /new URL\(['"]\.\/worker-entry\.js['"],\s*import\.meta\.url\)/u);
console.log(
	`Verified standalone GCC host package (${packed.entryCount} files, ${packed.size} packed bytes).`
);
