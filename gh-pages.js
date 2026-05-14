import { publish } from 'gh-pages';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(repoRoot, 'build');

const requiredBuildFiles = [
	'wasm-of-js-of-ocaml/browser-native/src/index.js',
	'wasm-of-js-of-ocaml/browser-native/src/compiler-worker.js',
	'wasm-of-js-of-ocaml/browser-native/runtime/fs/memory-fs.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
	'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz',
	'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.index.json',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/ocamlc.byte.browser.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/js_of_ocaml.bc.browser.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-merge.browser.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-metadce.browser.js',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-opt.browser.js'
];

const missingBuildFiles = requiredBuildFiles.filter(
	(file) => !existsSync(path.join(buildDir, file))
);

if (missingBuildFiles.length > 0) {
	console.error(
		[
			'Refusing to deploy: the OCaml wasm_of_ocaml runtime bundle is missing from build/.',
			'Run npm run sync:wasm-of-js-of-ocaml before building, then retry npm run page.',
			'Missing files:',
			...missingBuildFiles.map((file) => `- ${file}`)
		].join('\n')
	);
	process.exit(1);
}

publish(
	buildDir,
	{
		branch: 'gh-pages',
		repo: 'https://github.com/seo-rii/wasm-idle.git',
		nojekyll: true,
		user: {
			name: 'seo-rii',
			email: 'me@seorii.page'
		},
		dotfiles: true
	},
	(error) => {
		if (error) {
			console.error(error);
			process.exitCode = 1;
			return;
		}
		console.log('Deploy Complete!');
	}
);
