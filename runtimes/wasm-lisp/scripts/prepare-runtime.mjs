import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build as esbuild } from 'esbuild';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(THIS_FILE), '..');
const distRoot = path.join(projectRoot, 'dist');
const compilerComponentPath = path.join(projectRoot, 'vendor', 'puppy-scheme', 'puppyc.wasm');
const puppyLicensePath = path.join(projectRoot, 'vendor', 'puppy-scheme', 'LICENSE');
const preview2ShimRoot = path.join(
	projectRoot,
	'node_modules',
	'@bytecodealliance',
	'preview2-shim'
);
const jcoRoot = path.join(projectRoot, 'node_modules', '@bytecodealliance', 'jco');
const typescriptRoot = path.join(projectRoot, 'node_modules', 'typescript');
const esbuildRoot = path.join(projectRoot, 'node_modules', 'esbuild');
const jcoCliPath = path.join(jcoRoot, 'src', 'jco.js');

const PROFILE_ID = 'puppy-scheme-0.0.7-jco-1.19.0-preview2-shim-0.17.9';
const LICENSE_EXPRESSION = 'BSD-3-Clause AND Apache-2.0 WITH LLVM-exception';
const PUPPY_RELEASE = Object.freeze({
	repository: 'https://github.com/matthewp/puppy-scheme',
	release: 'v0.0.7',
	revision: '315dcebacea3af8dbfa87285598210c71a4dca47',
	asset: 'puppyc.wasm',
	assetUrl: 'https://github.com/matthewp/puppy-scheme/releases/download/v0.0.7/puppyc.wasm',
	bytes: 568_077,
	sha256: '5a1429982560c20d808def1c7b546ba846063c780db8c1f7249488a688b7964d'
});
const PUPPY_LICENSE_RECEIPT = Object.freeze({
	bytes: 1_503,
	sha256: 'b49405295eaaa10e64a639611bbde1f5549233efbcb26dfac7ef773a8cb08139'
});
const BYTECODE_LICENSE_RECEIPT = Object.freeze({
	bytes: 12_243,
	sha256: '268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5'
});
const COMPONENTS = Object.freeze({
	jco: Object.freeze({
		name: '@bytecodealliance/jco',
		version: '1.19.0',
		packageManagerIntegrity:
			'sha512-I57cVbL24/u/zCBwHq7D9PyIMP81hFFYF4hL/pW5biRGVLQAZuwEAUaEmghOouyt77bU2ExqscP2wkLvr3nfDw=='
	}),
	preview2Shim: Object.freeze({
		name: '@bytecodealliance/preview2-shim',
		version: '0.17.9',
		packageManagerIntegrity:
			'sha512-i0R3eQBe6PA/o/1EFE3Owe4In2rcccb6QxnjpntM/lPe3/duJ0bRQTVZM2Ufpo99X4eofGeltQUkape1C91FFA=='
	}),
	typescript: Object.freeze({
		name: 'typescript',
		version: '5.9.3',
		packageManagerIntegrity:
			'sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw=='
	}),
	esbuild: Object.freeze({
		name: 'esbuild',
		version: '0.28.0',
		packageManagerIntegrity:
			'sha512-sNR9MHpXSUV/XB4zmsFKN+QgVG82Cc7+/aaxJ8Adi8hyOac+EXptIp45QBPaVyX3N70664wRbTcLTOemCAnyqw=='
	})
});
const PREVIEW2_BROWSER_FILES = Object.freeze([
	'cli.js',
	'clocks.js',
	'config.js',
	'environment.js',
	'filesystem.js',
	'io.js',
	'random.js'
]);
const EXPECTED_DIST_FILES = Object.freeze(
	[
		'LICENSE',
		'THIRD_PARTY_NOTICES.md',
		'index.d.ts',
		'index.js',
		'puppyc.core.wasm',
		'puppyc.core2.wasm',
		'puppyc.js',
		'runtime-build.json'
	].sort()
);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function requireRegularFile(filePath, label) {
	const stats = await fs.lstat(filePath).catch(() => null);
	if (!stats?.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`);
	return stats;
}

async function readVerifiedFile(filePath, receipt, label) {
	const stats = await requireRegularFile(filePath, label);
	if (stats.size !== receipt.bytes) throw new Error(`${label} byte size does not match its pin`);
	const bytes = await fs.readFile(filePath);
	if (sha256(bytes) !== receipt.sha256)
		throw new Error(`${label} SHA-256 does not match its pin`);
	return bytes;
}

async function requirePackage(root, expected) {
	const packagePath = path.join(root, 'package.json');
	await requireRegularFile(packagePath, `${expected.name} package metadata`);
	let manifest;
	try {
		manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'));
	} catch (error) {
		throw new Error(`${expected.name} package metadata is invalid`, { cause: error });
	}
	if (manifest.name !== expected.name || manifest.version !== expected.version) {
		throw new Error(
			`${expected.name} must resolve to the pinned ${expected.version} package version`
		);
	}
}

async function listFiles(rootDir) {
	const entries = await fs.readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

function replaceExactlyOnce(source, needle, replacement, label) {
	const first = source.indexOf(needle);
	if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
		throw new Error(`${label} contract mismatch`);
	}
	return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

async function bundleBrowserRuntime() {
	const bindingPath = await fs.realpath(
		path.join(jcoRoot, 'obj', 'js-component-bindgen-component.js')
	);
	const fetchBlock = `const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
let _fs;
async function fetchCompile (url) {
  if (isNode) {
    _fs = _fs || await import('node:fs/promises');
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}
`;
	const load0 =
		"const module0 = fetchCompile(new URL('./js-component-bindgen-component.core.wasm', import.meta.url));";
	const load1 =
		"const module1 = fetchCompile(new URL('./js-component-bindgen-component.core2.wasm', import.meta.url));";
	let transformed = false;
	const inlineJcoComponentCoresPlugin = {
		name: 'inline-jco-component-cores',
		setup(build) {
			build.onLoad({ filter: /js-component-bindgen-component\.js$/ }, async (args) => {
				if ((await fs.realpath(args.path)) !== bindingPath) return undefined;
				if (transformed) throw new Error('JCO binding was transformed more than once');
				transformed = true;
				let source = await fs.readFile(args.path, 'utf8');
				source = replaceExactlyOnce(source, fetchBlock, '', 'JCO fetchCompile helper');
				source = replaceExactlyOnce(
					source,
					load0,
					'const module0 = WebAssembly.compile(wasmIdleJcoCore0);',
					'JCO core 0 loader'
				);
				source = replaceExactlyOnce(
					source,
					load1,
					'const module1 = WebAssembly.compile(wasmIdleJcoCore1);',
					'JCO core 1 loader'
				);
				source = `import wasmIdleJcoCore0 from './js-component-bindgen-component.core.wasm';\nimport wasmIdleJcoCore1 from './js-component-bindgen-component.core2.wasm';\n${source}`;
				return { contents: source, loader: 'js', resolveDir: path.dirname(args.path) };
			});
		}
	};
	const result = await esbuild({
		absWorkingDir: projectRoot,
		entryPoints: [path.join(projectRoot, 'src', 'index.ts')],
		outfile: path.join(distRoot, 'index.js'),
		bundle: true,
		charset: 'utf8',
		format: 'esm',
		legalComments: 'none',
		loader: { '.wasm': 'binary' },
		logLevel: 'silent',
		metafile: true,
		minify: true,
		packages: 'bundle',
		platform: 'browser',
		plugins: [inlineJcoComponentCoresPlugin],
		sourcemap: false,
		target: ['es2022'],
		treeShaking: true,
		write: false
	});
	if (!transformed || result.outputFiles.length !== 1) {
		throw new Error('wasm-lisp browser bundle must contain exactly one JavaScript output');
	}
	const output = result.outputFiles[0].contents;
	const outputMetadata = Object.values(result.metafile.outputs);
	const expectedInputs = await Promise.all(
		[
			path.join(projectRoot, 'src', 'index.ts'),
			path.join(jcoRoot, 'src', 'browser.js'),
			bindingPath,
			path.join(jcoRoot, 'obj', 'js-component-bindgen-component.core.wasm'),
			path.join(jcoRoot, 'obj', 'js-component-bindgen-component.core2.wasm'),
			...PREVIEW2_BROWSER_FILES.map((file) =>
				path.join(preview2ShimRoot, 'lib', 'browser', file)
			)
		].map((filePath) => fs.realpath(filePath))
	);
	const actualInputs = await Promise.all(
		Object.keys(result.metafile.inputs).map((filePath) =>
			fs.realpath(path.resolve(projectRoot, filePath))
		)
	);
	if (
		outputMetadata.length !== 1 ||
		outputMetadata[0].imports.length !== 0 ||
		JSON.stringify(actualInputs.sort()) !== JSON.stringify(expectedInputs.sort()) ||
		output.includes(Buffer.from('node:fs/promises')) ||
		output.includes(Buffer.from('fetchCompile')) ||
		output.includes(Buffer.from('@bytecodealliance/')) ||
		output.includes(Buffer.from('js-component-bindgen-component.core.wasm')) ||
		output.includes(Buffer.from('js-component-bindgen-component.core2.wasm'))
	) {
		throw new Error('wasm-lisp browser bundle retains an external executable dependency');
	}
	await fs.writeFile(path.join(distRoot, 'index.js'), output);
}

async function writeThirdPartyNotices(puppyLicenseBytes, bytecodeLicenseBytes) {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const puppyLicense = decoder.decode(puppyLicenseBytes).trimEnd();
	const bytecodeLicense = decoder.decode(bytecodeLicenseBytes).trimEnd();
	const notices = `# wasm-idle Puppy Scheme Runtime Third-Party Notices

This browser runtime contains the exact Puppy Scheme v0.0.7 release compiler
asset and selected browser modules from @bytecodealliance/jco 1.19.0 and
@bytecodealliance/preview2-shim 0.17.9.

## wasm-idle modification notice

wasm-idle transpiles the Puppy Scheme component with the pinned JCO package,
rewrites package imports to the published browser module graph, packages large
assets with deterministic gzip storage, and requires the browser consumer to
verify the receipt manifest before evaluating JavaScript or compiling Wasm.

## Puppy Scheme v0.0.7 — BSD-3-Clause

Source: ${PUPPY_RELEASE.repository}/tree/${PUPPY_RELEASE.revision}

${puppyLicense}

## Bytecode Alliance JCO and preview2-shim — Apache-2.0 WITH LLVM-exception

Source: https://github.com/bytecodealliance/jco

${bytecodeLicense}
`;
	await fs.writeFile(path.join(distRoot, 'THIRD_PARTY_NOTICES.md'), notices, 'utf8');
}

async function writeBuildMetadata() {
	const metadata = {
		format: 'wasm-lisp-runtime-build-v2',
		runtime: 'puppy-scheme',
		profileId: PROFILE_ID,
		provenanceLevel: 'pinned-release-artifact-and-receipted-derived-output',
		licenseExpression: LICENSE_EXPRESSION,
		artifact: {
			kind: 'github-release-asset',
			...PUPPY_RELEASE,
			verifiedBuildInput: false,
			evidence:
				'release asset digest matches GitHub release metadata; binary-to-source attestation is unavailable'
		},
		components: {
			jco: {
				...COMPONENTS.jco,
				repository: 'https://github.com/bytecodealliance/jco',
				verifiedBuildInput: false,
				evidence:
					'package name, version, and pnpm-lock integrity are pinned; the installed package tree is not independently re-attested'
			},
			preview2Shim: {
				...COMPONENTS.preview2Shim,
				repository: 'https://github.com/bytecodealliance/jco',
				verifiedBuildInput: false,
				evidence:
					'package name, version, and pnpm-lock integrity are pinned; the installed package tree is not independently re-attested'
			},
			typescript: {
				...COMPONENTS.typescript,
				repository: 'https://github.com/microsoft/TypeScript',
				verifiedBuildInput: false,
				evidence:
					'package name, version, and pnpm-lock integrity are pinned; the installed package tree is not independently re-attested'
			},
			esbuild: {
				...COMPONENTS.esbuild,
				repository: 'https://github.com/evanw/esbuild',
				verifiedBuildInput: false,
				evidence:
					'package name, version, and pnpm-lock integrity are pinned; the installed package tree is not independently re-attested'
			}
		},
		transformations: [
			{
				id: 'jco-transpile-async-browser',
				tool: '@bytecodealliance/jco',
				version: COMPONENTS.jco.version,
				arguments: [
					'--name=puppyc',
					'--instantiation=async',
					'--no-typescript',
					'--no-nodejs-compat'
				]
			},
			{
				id: 'bundle-browser-runtime-and-inline-jco-core-modules',
				tool: 'esbuild',
				version: COMPONENTS.esbuild.version,
				arguments: [
					'bundle',
					'platform=browser',
					'format=esm',
					'minify',
					'loader:.wasm=binary'
				]
			}
		],
		legalInputs: {
			puppyScheme: { path: 'LICENSE', spdx: 'BSD-3-Clause', ...PUPPY_LICENSE_RECEIPT },
			bytecodeAlliance: {
				path: '@bytecodealliance/preview2-shim/LICENSE',
				spdx: 'Apache-2.0 WITH LLVM-exception',
				...BYTECODE_LICENSE_RECEIPT
			}
		}
	};
	await fs.writeFile(
		path.join(distRoot, 'runtime-build.json'),
		`${JSON.stringify(metadata, null, 2)}\n`,
		'utf8'
	);
}

async function assertExactDist() {
	const files = (await listFiles(distRoot))
		.map((filePath) => path.relative(distRoot, filePath).split(path.sep).join('/'))
		.sort();
	if (
		files.length !== EXPECTED_DIST_FILES.length ||
		files.some((file, index) => file !== EXPECTED_DIST_FILES[index])
	) {
		throw new Error(`wasm-lisp build emitted an unexpected file set: ${files.join(', ')}`);
	}
}

await Promise.all([
	requirePackage(jcoRoot, COMPONENTS.jco),
	requirePackage(preview2ShimRoot, COMPONENTS.preview2Shim),
	requirePackage(typescriptRoot, COMPONENTS.typescript),
	requirePackage(esbuildRoot, COMPONENTS.esbuild)
]);
const [, puppyLicenseBytes, bytecodeLicenseBytes] = await Promise.all([
	readVerifiedFile(compilerComponentPath, PUPPY_RELEASE, 'Puppy Scheme release compiler'),
	readVerifiedFile(puppyLicensePath, PUPPY_LICENSE_RECEIPT, 'Puppy Scheme license'),
	readVerifiedFile(
		path.join(preview2ShimRoot, 'LICENSE'),
		BYTECODE_LICENSE_RECEIPT,
		'Bytecode Alliance license'
	)
]);

await requireRegularFile(jcoCliPath, 'pinned JCO CLI');
await execFileAsync(process.execPath, [
	jcoCliPath,
	'transpile',
	compilerComponentPath,
	'--name',
	'puppyc',
	'--instantiation',
	'async',
	'--no-typescript',
	'--no-nodejs-compat',
	'--out-dir',
	distRoot
]);

await fs.writeFile(path.join(distRoot, 'LICENSE'), puppyLicenseBytes);
await bundleBrowserRuntime();
await writeThirdPartyNotices(puppyLicenseBytes, bytecodeLicenseBytes);
await writeBuildMetadata();
await assertExactDist();
