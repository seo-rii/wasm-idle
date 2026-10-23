import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const require = createRequire(import.meta.url);
const sourceRoot = path.dirname(require.resolve('bash-language-server/package.json'));
const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
const treeRoot = path.dirname(sourceRequire.resolve('web-tree-sitter'));
const editorconfigRequire = createRequire(sourceRequire.resolve('editorconfig'));
const iniRoot = path.dirname(editorconfigRequire.resolve('@one-ini/wasm'));
const lock = JSON.parse(
	await readFile(new URL('../../scripts/bash-lsp-assets.lock.json', import.meta.url), 'utf8')
);

const receipt = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

async function writeNotices(inputs, targetDir) {
	const roots = new Set();
	for (const key of Object.keys(inputs)) {
		const input = key.replace(/^\(disabled\):/, '');
		const index = input.lastIndexOf('node_modules/');
		if (index < 0) continue;
		const tail = input.slice(index + 'node_modules/'.length).split('/');
		const count = tail[0].startsWith('@') ? 2 : 1;
		roots.add(
			path.resolve(
				ROOT,
				input.slice(0, index) + 'node_modules/' + tail.slice(0, count).join('/')
			)
		);
	}
	const notices = [];
	for (const directory of [...roots].sort()) {
		const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
		const names = (await readdir(directory, { withFileTypes: true }))
			.filter(
				(entry) =>
					entry.isFile() &&
					/^(license|licence|copying|notice)(?:[.\-]|$)/i.test(entry.name)
			)
			.map((entry) => entry.name)
			.sort();
		let text = `## ${pkg.name}@${pkg.version}\nLicense: ${pkg.license || 'See upstream sources'}\n`;
		for (const name of names)
			text += `\n${await readFile(path.join(directory, name), 'utf8')}\n`;
		if (pkg.name === 'bash-language-server')
			text += await readFile(path.join(ROOT, 'LICENSE.upstream'), 'utf8');
		notices.push([`${pkg.name}@${pkg.version}`, text]);
	}
	notices.push([
		'tree-sitter-bash',
		`## tree-sitter-bash ${lock.grammar.revision}\n${await readFile(path.join(ROOT, 'LICENSE.tree-sitter-bash'), 'utf8')}`
	]);
	notices.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	await writeFile(
		path.join(targetDir, 'THIRD_PARTY_NOTICES.txt'),
		notices.map(([, text]) => text).join('\n\n')
	);
}

export async function buildBashLanguageServer({
	targetDir = path.resolve(ROOT, '../../static/wasm-bash-lsp')
} = {}) {
	const packageJson = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
	if (packageJson.version !== lock.version) throw new Error('Bash LSP upstream version mismatch');
	for (const [name, expected] of Object.entries(lock.files)) {
		const actual = receipt(await readFile(path.join(sourceRoot, name)));
		if (JSON.stringify(actual) !== JSON.stringify(expected))
			throw new Error(`Bash LSP source receipt mismatch: ${name}`);
	}
	for (const [name, expected] of [
		['LICENSE.upstream', lock.license],
		['LICENSE.tree-sitter-bash', lock.grammar.license]
	]) {
		const actual = receipt(await readFile(path.join(ROOT, name)));
		if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
			throw new Error(`Bash LSP license receipt mismatch: ${name}`);
	}
	await mkdir(targetDir, { recursive: true });
	const platform = (name) => path.join(ROOT, 'src/platform', name);
	const aliases = {
		fs: platform('fs.js'),
		'fs/promises': platform('fs-promises.js'),
		path: require.resolve('path-browserify'),
		util: platform('util.js'),
		url: platform('url.js'),
		os: platform('os.js'),
		child_process: platform('child-process.js'),
		module: platform('module.js'),
		stream: require.resolve('stream-browserify'),
		events: require.resolve('events/'),
		buffer: require.resolve('buffer/'),
		process: require.resolve('process/browser.js'),
		assert: require.resolve('assert/')
	};
	const output = path.join(targetDir, 'runtime.mjs');
	const built = await build({
		absWorkingDir: ROOT,
		entryPoints: ['src/browser.js'],
		outfile: output,
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		minify: true,
		metafile: true,
		tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
		define: { __dirname: '"/upstream/out"', global: 'globalThis' },
		inject: [platform('globals.js')],
		plugins: [
			{
				name: 'bash-lsp-browser-platform',
				setup(builder) {
					builder.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
						path: path.join(treeRoot, 'web-tree-sitter.js')
					}));
					builder.onResolve({ filter: /^vscode-languageserver(?:\/node)?$/ }, () => ({
						path: path.resolve(
							path.dirname(require.resolve('vscode-languageserver')),
							'../browser/main.js'
						)
					}));
					builder.onResolve(
						{
							filter: /^(?:node:)?(?:fs(?:\/promises)?|path|util|url|os|child_process|module|stream|events|buffer|process|assert)$/
						},
						({ path: requested }) => ({
							path: aliases[requested.replace(/^node:/, '')]
						})
					);
				}
			}
		]
	});
	await copyFile(
		path.join(sourceRoot, 'tree-sitter-bash.wasm'),
		path.join(targetDir, 'tree-sitter-bash.wasm')
	);
	await copyFile(
		path.join(treeRoot, 'web-tree-sitter.wasm'),
		path.join(targetDir, 'web-tree-sitter.wasm')
	);
	await copyFile(path.join(iniRoot, 'one_ini_bg.wasm'), path.join(targetDir, 'one_ini_bg.wasm'));
	await writeNotices(built.metafile.inputs, targetDir);
	const assets = {};
	for (const name of [
		'runtime.mjs',
		'tree-sitter-bash.wasm',
		'web-tree-sitter.wasm',
		'one_ini_bg.wasm',
		'THIRD_PARTY_NOTICES.txt'
	]) {
		assets[name] = receipt(await readFile(path.join(targetDir, name)));
	}
	await writeFile(
		path.join(targetDir, 'runtime-manifest.json'),
		JSON.stringify(
			{
				format: 'wasm-idle-bash-lsp-v1',
				upstreamVersion: lock.version,
				upstreamRevision: lock.revision,
				assets
			},
			null,
			'\t'
		) + '\n'
	);
	return { upstreamVersion: lock.version, assets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(await buildBashLanguageServer());
}
