import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareJavacs } from './probe-java-javacs-browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JAVA_JDK_COMPILER_SHA256 =
	'12ce7dcffc762642ca081add644fd2241e473c36ce1f05337624ee13f1c64c73';

export async function prepareJavaLspAssets(options) {
	assert.ok(options.jdkCompilerModule, 'Supply an original OpenJDK17 jdk.compiler.jmod');
	const assets = await prepareJavacs(
		options.assetsDirectory,
		options.jdkCompilerModule,
		options.jdkCompilerSha256 || JAVA_JDK_COMPILER_SHA256
	);
	await mkdir(path.join(options.outputDirectory, 'server'), { recursive: true });
	const files = ['browser-streams.jar', ...assets.files.map((name) => `server/${name}`)];
	const receipts = [];
	for (const file of files) {
		const source = path.join(assets.directory, file);
		const bytes = await readFile(source);
		receipts.push({
			path: file,
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
		await cp(source, path.join(options.outputDirectory, file));
	}
	await cp(
		path.join(ROOT, 'packages/lsp/src/java/host.mjs'),
		path.join(options.outputDirectory, 'host.mjs')
	);
	await writeFile(
		path.join(options.outputDirectory, 'host.html'),
		'<!doctype html><html data-wasm-idle-java-host="true"><head><meta charset="utf-8"><title>Java language server</title><script type="module" src="./host.mjs"></script></head><body></body></html>\n'
	);
	await cp(
		path.join(assets.directory, 'original.tar.gz'),
		path.join(options.outputDirectory, 'original-javacs-source.tar.gz')
	);
	await writeFile(
		path.join(options.outputDirectory, 'runtime-manifest.v1.json'),
		`${JSON.stringify({ format: 'wasm-idle-javacs-browser-v1', upstream: assets.receipt, assets: receipts }, null, 2)}\n`
	);
	await writeFile(
		path.join(options.outputDirectory, 'THIRD_PARTY_NOTICES.md'),
		`# Java LSP inputs

Powered by [javacs](https://github.com/georgewfraser/java-language-server),
[OpenJDK](https://openjdk.org/) and
[CheerpJ by Leaning Technologies](https://cheerpj.com/).

Unmodified javacs source commit ${assets.receipt.commit}:
https://github.com/georgewfraser/java-language-server/tree/${assets.receipt.commit}.
The exact original source archive is included. The upstream MIT license and copied
OpenJDK GPL-2.0 with Classpath exception headers apply.

The original JDK compiler module classes and legal notices are included in
server/jdk-compiler.jar. The original module identity and classpath SPI conversion
are recorded in runtime-manifest.v1.json. OpenJDK source:
https://github.com/openjdk/jdk17u. Before publishing this separately supplied JDK
module, provide corresponding source and satisfy all applicable license obligations
for the exact JDK build used. This preparation does not publish any assets.

Gson and Protobuf JARs retain their upstream META-INF license notices.

CheerpJ 4.3 is loaded directly from the official cjrtnc.leaningtech.com CDN;
no CheerpJ runtime files are bundled. The Community License permits qualifying
personal, one-person company and FOSS projects, including wasm-idle, to use that
CDN with appropriate credit. Other business use, self-hosting CheerpJ Core,
redistribution and OEM use require the applicable commercial terms.
Licensing: https://cheerpj.com/docs/licensing.html.
`
	);
	return { outputDirectory: options.outputDirectory, assets: receipts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			'assets-directory': { type: 'string', default: '.cache/java-javacs-assets' },
			'output-directory': { type: 'string', default: 'static/java-lsp' },
			'jdk-compiler-module': { type: 'string' },
			'jdk-compiler-sha256': { type: 'string' }
		}
	});
	const result = await prepareJavaLspAssets({
		assetsDirectory: path.resolve(values['assets-directory']),
		outputDirectory: path.resolve(values['output-directory']),
		jdkCompilerModule: values['jdk-compiler-module']
			? path.resolve(values['jdk-compiler-module'])
			: undefined,
		jdkCompilerSha256: values['jdk-compiler-sha256']
	});
	console.log(JSON.stringify(result, null, 2));
}
