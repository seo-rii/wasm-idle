import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { finished, pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

function parseArgs(argv) {
	const options = {
		force: false,
		opamBin:
			process.env.WASM_OF_JS_OF_OCAML_OPAM_BIN ||
			path.join(projectRoot, '.cache', 'opam-2.2.1'),
		opamRoot:
			process.env.WASM_OF_JS_OF_OCAML_OPAM_ROOT ||
			path.join(process.env.HOME || process.cwd(), '.cache', 'wasm-of-js-of-ocaml', 'opam'),
		switchName: process.env.WASM_OF_JS_OF_OCAML_SWITCH_NAME || 'wasm-of-js-of-ocaml',
		switchPrefix: process.env.WASM_OF_JS_OF_OCAML_SWITCH_PREFIX || '',
		outDir: path.join(projectRoot, '.cache', 'browser-native-bundle')
	};

	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--force') {
			options.force = true;
			continue;
		}
		if (argument === '--opam-bin') {
			options.opamBin = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--opam-root') {
			options.opamRoot = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--switch-name') {
			options.switchName = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--switch-prefix') {
			options.switchPrefix = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--out-dir') {
			options.outDir = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--help') {
			process.stdout.write(`Usage: node scripts/prepare-browser-native.mjs [options]

Options:
  --force                  Rebuild tools and refresh copied libraries
  --opam-bin <path>        Custom opam executable
  --opam-root <path>       Custom opam root
  --switch-name <name>     Custom switch name
  --switch-prefix <path>   Skip opam var prefix lookup and use this switch prefix
  --out-dir <path>         Output directory for the browser-native bundle
`);
			process.exit(0);
		}
		throw new Error(`unsupported argument: ${argument}`);
	}

	return options;
}

async function pathExists(targetPath) {
	try {
		await stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function run(command, args, options = {}) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: 'inherit'
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve(undefined);
				return;
			}
			reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`));
		});
	});
}

async function getSwitchPrefix(options) {
	if (options.switchPrefix) {
		return path.resolve(options.switchPrefix);
	}

	return await new Promise((resolve, reject) => {
		const stdoutParts = [];
		const stderrParts = [];
		const child = spawn(
			options.opamBin,
			['var', 'prefix', '--root', options.opamRoot, '--switch', options.switchName],
			{
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		child.stdout.on('data', (chunk) => {
			stdoutParts.push(Buffer.from(chunk));
		});
		child.stderr.on('data', (chunk) => {
			stderrParts.push(Buffer.from(chunk));
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(
						Buffer.concat(stderrParts).toString('utf8') ||
							`${options.opamBin} var prefix failed with exit code ${code ?? 1}`
					)
				);
				return;
			}
			resolve(Buffer.concat(stdoutParts).toString('utf8').trim());
		});
	});
}

async function findExistingPath(candidates) {
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	throw new Error(`failed to locate a source directory from: ${candidates.join(', ')}`);
}

async function collectManifestFiles(rootPath, rootUrl, virtualRootPath, options = {}) {
	const allowedExtensions = new Set(['.cma', '.cmi', '.cmo']);
	const allowedFileNames = new Set(['ld.conf', 'runtime-launch-info']);
	const files = [];
	const pending = [rootPath];
	while (pending.length > 0) {
		const currentPath = pending.pop();
		if (!currentPath) {
			continue;
		}
		const entries = await readdir(currentPath, { withFileTypes: true });
		for (const entry of entries) {
			const absolutePath = path.join(currentPath, entry.name);
			if (entry.isDirectory()) {
				pending.push(absolutePath);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (
				!allowedExtensions.has(path.extname(entry.name)) &&
				!allowedFileNames.has(entry.name) &&
				entry.name !== 'META' &&
				!entry.name.startsWith('META.')
			) {
				continue;
			}
			const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/');
			const fileStat = await stat(absolutePath);
			files.push({
				path: `${virtualRootPath}/${relativePath}`.replace(/\/+/g, '/'),
				...(rootUrl ? { url: `${rootUrl}/${relativePath}`.replace(/\/+/g, '/') } : {}),
				size: fileStat.size,
				...(options.includeSourcePath ? { sourcePath: absolutePath } : {})
			});
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parseMetaField(metaSource, fieldName) {
	const matcher = new RegExp(`^${fieldName}\\s*=\\s*"([^"]*)"`, 'm');
	return metaSource.match(matcher)?.[1] || '';
}

function parseMetaRequires(metaSource) {
	return parseMetaField(metaSource, 'requires')
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

async function collectPackageManifest(packageName, packageRootPath, rootUrl, options = {}) {
	const files = await collectManifestFiles(
		packageRootPath,
		rootUrl,
		`/static/toolchain/lib/${packageName}`,
		options
	);
	const metaPath = path.join(packageRootPath, 'META');
	const metaSource = (await pathExists(metaPath)) ? await readFile(metaPath, 'utf8') : '';
	const archiveByteName = parseMetaField(metaSource, 'archive\\(byte\\)');
	return {
		name: packageName,
		rootPath: `/static/toolchain/lib/${packageName}`,
		...(metaSource ? { metaPath: `/static/toolchain/lib/${packageName}/META` } : {}),
		...(archiveByteName
			? { archiveBytePath: `/static/toolchain/lib/${packageName}/${archiveByteName}` }
			: {}),
		requires: parseMetaRequires(metaSource),
		files
	};
}

async function writeRuntimePack(packEntries, assetPath, indexPath) {
	const packPath = assetPath.replace(/\.gz$/, '');
	const writer = createWriteStream(packPath);
	const runtimePackEntries = [];
	let totalBytes = 0;
	for (const entry of packEntries) {
		const entryBytes = await readFile(entry.sourcePath);
		await new Promise((resolve, reject) => {
			const handleError = (error) => {
				writer.off('error', handleError);
				reject(error);
			};
			writer.once('error', handleError);
			writer.write(entryBytes, (error) => {
				writer.off('error', handleError);
				if (error) {
					reject(error);
					return;
				}
				resolve(undefined);
			});
		});
		runtimePackEntries.push({
			runtimePath: entry.path,
			offset: totalBytes,
			length: entryBytes.byteLength
		});
		totalBytes += entryBytes.byteLength;
	}
	writer.end();
	await finished(writer);
	await pipeline(
		createReadStream(packPath),
		createGzip({ level: 9 }),
		createWriteStream(assetPath)
	);
	await rm(packPath, { force: true });
	await writeFile(
		indexPath,
		`${JSON.stringify(
			{
				format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1',
				fileCount: runtimePackEntries.length,
				totalBytes,
				entries: runtimePackEntries
			},
			null,
			2
		)}\n`,
		'utf8'
	);
	return {
		format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1',
		asset: '/.cache/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz',
		index: '/.cache/browser-native-bundle/browser-native-runtime-pack.v1.index.json',
		fileCount: runtimePackEntries.length,
		totalBytes
	};
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function patchVersionDuneToAvoidGitProbe(sourceDir) {
	const versionDunePath = path.join(sourceDir, 'tools', 'version', 'dune');
	const versionDuneSource = await readFile(versionDunePath, 'utf8');
	const placeholderMatch = versionDuneSource.match(/let placeholder = "([^"]+)"/);
	const patchedVersionMatch = versionDuneSource.match(
		/\n\s*"([^"]+)"\s*\n\s*let \(\) = send dyn/
	);
	const placeholderVersion = placeholderMatch?.[1] || patchedVersionMatch?.[1];
	if (!placeholderVersion) {
		throw new Error(`failed to locate placeholder version in ${versionDunePath}`);
	}
	const patchedSource = `(* -*- tuareg -*- *)
(* patched by wasm-of-js-of-ocaml/scripts/prepare-browser-native.mjs *)
open StdLabels
open Jbuild_plugin.V1

let dyn =
  Printf.sprintf
    {|
(rule
  (target GIT-VERSION)
  (action (with-stdout-to %%{target} (echo "%s"))))
|}
    ${JSON.stringify(placeholderVersion)}

let () = send dyn
`;

	if (versionDuneSource === patchedSource) {
		return {
			path: versionDunePath,
			placeholderVersion,
			alreadyPatched: true,
			sourceSha256: sha256(versionDuneSource),
			patchedSha256: sha256(patchedSource)
		};
	}

	await writeFile(versionDunePath, patchedSource, 'utf8');
	return {
		path: versionDunePath,
		placeholderVersion,
		alreadyPatched: false,
		sourceSha256: sha256(versionDuneSource),
		patchedSha256: sha256(patchedSource)
	};
}

function detectWasmOfOcamlSystemStub(source) {
	const commandCallMatch = source.match(/([A-Za-z$_][\w$]*)\(d\+b\)!==0\?1:0/);
	if (!commandCallMatch || !commandCallMatch[1]) {
		throw new Error('failed to locate Binaryen system command call');
	}
	const systemFunctionName = commandCallMatch[1];
	const patchedPattern = new RegExp(
		`function\\s*\\n?${systemFunctionName}\\(([^)]*)\\)\\{if\\(globalThis\\.__wasm_of_js_system_command\\)return globalThis\\.__wasm_of_js_system_command\\(\\1\\);return ([A-Za-z$_][\\w$]*)\\}`
	);
	const patchedMatch = source.match(patchedPattern);
	if (patchedMatch && patchedMatch[1] && patchedMatch[2]) {
		return {
			systemFunctionName,
			argumentName: patchedMatch[1],
			fallbackValue: patchedMatch[2],
			alreadyPatched: true,
			pattern: patchedPattern
		};
	}
	const rawPattern = new RegExp(
		`function\\s*\\n?${systemFunctionName}\\(([^)]*)\\)\\{return ([A-Za-z$_][\\w$]*)\\}`
	);
	const rawMatch = source.match(rawPattern);
	if (rawMatch && rawMatch[1] && rawMatch[2]) {
		return {
			systemFunctionName,
			argumentName: rawMatch[1],
			fallbackValue: rawMatch[2],
			alreadyPatched: false,
			pattern: rawPattern
		};
	}
	throw new Error(`failed to locate Binaryen system stub ${systemFunctionName}`);
}

async function patchWasmOfOcamlBrowserTool(toolPath) {
	const original = await readFile(toolPath, 'utf8');
	const sourceSha256 = sha256(original);
	const detectedStub = detectWasmOfOcamlSystemStub(original);
	const patchedSystemFunction = `function
${detectedStub.systemFunctionName}(${detectedStub.argumentName}){if(globalThis.__wasm_of_js_system_command)return globalThis.__wasm_of_js_system_command(${detectedStub.argumentName});return ${detectedStub.fallbackValue}}`;
	const patched = detectedStub.alreadyPatched
		? original
		: original.replace(detectedStub.pattern, patchedSystemFunction);
	if (!patched.includes('globalThis.__wasm_of_js_system_command')) {
		throw new Error(`failed to inject Binaryen system bridge into ${toolPath}`);
	}
	if (patched !== original) {
		await writeFile(toolPath, patched, 'utf8');
	}
	return {
		tool: path.basename(toolPath),
		bridgeSymbol: 'globalThis.__wasm_of_js_system_command',
		systemFunctionName: detectedStub.systemFunctionName,
		alreadyPatched: detectedStub.alreadyPatched,
		sourceSha256,
		patchedSha256: sha256(patched)
	};
}

async function patchBinaryenBrowserTool(toolName, outPath) {
	const sourcePath = path.join(projectRoot, 'node_modules', 'binaryen', 'bin', toolName);
	if (!(await pathExists(sourcePath))) {
		throw new Error(
			`missing browser Binaryen tool ${toolName} at ${sourcePath}; run "npm install" first`
		);
	}
	const original = await readFile(sourcePath, 'utf8');
	const sourceSha256 = sha256(original);
	const withoutShebang = original.replace(/^#![^\n]*\n/, '');
	const withQuitHook = withoutShebang.replace(
		/var quit_=\(status,toThrow\)=>\{throw toThrow\};/,
		'var quit_=(status,toThrow)=>{if(globalThis.__binaryen_cli_quit)return globalThis.__binaryen_cli_quit(status,toThrow);throw toThrow};'
	);
	const nodeRawFsPattern =
		/FS\.createPreloadedFile=FS_createPreloadedFile;FS\.preloadFile=FS_preloadFile;FS\.staticInit\(\);if\(ENVIRONMENT_IS_NODE\)\{NODEFS\.staticInit\(\)\}if\(!ENVIRONMENT_IS_NODE\)\{throw new Error\("NODERAWFS is currently only supported on Node\.js environment\."\)\}var nodeTTY=require\("node:tty"\);function _wrapNodeError[\s\S]*?for\(const\[key,value\]of Object\.entries\(NODERAWFS_stream_funcs\)\)\{FS\[key\]=_wrapNodeStreamFunc\(value,FS\[key\]\)\}/;
	if (!nodeRawFsPattern.test(withQuitHook)) {
		throw new Error(`failed to locate Node raw fs block in ${sourcePath}`);
	}
	const withoutNodeRawFs = withQuitHook.replace(
		nodeRawFsPattern,
		'FS.createPreloadedFile=FS_createPreloadedFile;FS.preloadFile=FS_preloadFile;FS.staticInit();'
	);
	const syncInstantiatePattern =
		/async function getWasmBinary\(binaryFile\)\{return getBinarySync\(binaryFile\)\}async function instantiateArrayBuffer\(binaryFile,imports\)\{try\{var binary=await getWasmBinary\(binaryFile\);var instance=await WebAssembly\.instantiate\(binary,imports\);return instance\}catch\(reason\)\{err\(`failed to asynchronously prepare wasm: \$\{reason\}`\);abort\(reason\)\}\}async function instantiateAsync\(binary,binaryFile,imports\)\{return instantiateArrayBuffer\(binaryFile,imports\)\}function getWasmImports/;
	if (!syncInstantiatePattern.test(withoutNodeRawFs)) {
		throw new Error(`failed to locate async Binaryen wasm instantiate path in ${sourcePath}`);
	}
	const withSyncInstantiate = withoutNodeRawFs
		.replace(
			syncInstantiatePattern,
			'function getWasmBinary(binaryFile){return getBinarySync(binaryFile)}function instantiateArrayBuffer(binaryFile,imports){try{var binary=getWasmBinary(binaryFile);var module=new WebAssembly.Module(binary);var instance=new WebAssembly.Instance(module,imports);return{instance,module}}catch(reason){err(`failed to synchronously prepare wasm: ${reason}`);abort(reason)}}function instantiateAsync(binary,binaryFile,imports){return instantiateArrayBuffer(binaryFile,imports)}function getWasmImports'
		)
		.replace(/async function createWasm\(\)/, 'function createWasm()')
		.replace(
			/var result=await instantiateAsync\(wasmBinary,wasmBinaryFile,info\);/,
			'var result=instantiateAsync(wasmBinary,wasmBinaryFile,info);'
		);
	const runtimeBootstrapPattern = /createWasm\(\);run\(\);(?=\s*$)/;
	if (!runtimeBootstrapPattern.test(withSyncInstantiate)) {
		throw new Error(`failed to locate Binaryen runtime bootstrap in ${sourcePath}`);
	}
	const patched = withSyncInstantiate.replace(
		runtimeBootstrapPattern,
		'globalThis.__binaryen_cli_runtime={FS,Module,run,callMain};createWasm();'
	);
	if (
		!patched.includes(
			'globalThis.__binaryen_cli_runtime={FS,Module,run,callMain};createWasm();'
		)
	) {
		throw new Error(`failed to expose Binaryen CLI runtime for ${sourcePath}`);
	}
	if (patched !== original || !(await pathExists(outPath))) {
		await writeFile(outPath, patched, 'utf8');
	}
	return {
		tool: toolName,
		sourcePath,
		outPath,
		sourceSha256,
		patchedSha256: sha256(patched)
	};
}

const options = parseArgs(process.argv);
const switchPrefix = await getSwitchPrefix(options);
const switchRoot = switchPrefix;
const switchSourcesRoot = path.join(switchRoot, '.opam-switch', 'sources');
const sourceDir = await findExistingPath([
	path.join(switchSourcesRoot, 'wasm_of_ocaml-compiler.6.3.2'),
	path.join(switchSourcesRoot, 'js_of_ocaml-compiler.6.3.2')
]);
const versionDunePatch = await patchVersionDuneToAvoidGitProbe(sourceDir);

const outDir = path.resolve(options.outDir);
const toolsDir = path.join(outDir, 'tools');
const ocamlLibOutDir = path.join(outDir, 'lib', 'ocaml');
const packageLibOutDir = path.join(outDir, 'lib');
const findlibConfOutPath = path.join(outDir, 'findlib.conf');
const ocamlcOutPath = path.join(toolsDir, 'ocamlc.byte.browser.js');
const jsooOutPath = path.join(toolsDir, 'js_of_ocaml.bc.browser.js');
const wasmooOutPath = path.join(toolsDir, 'wasm_of_ocaml.bc.browser.js');
const wasmOptOutPath = path.join(toolsDir, 'wasm-opt.browser.js');
const wasmMergeOutPath = path.join(toolsDir, 'wasm-merge.browser.js');
const wasmMetadceOutPath = path.join(toolsDir, 'wasm-metadce.browser.js');
const runtimePackAssetPath = path.join(outDir, 'browser-native-runtime-pack.v1.bin.gz');
const runtimePackIndexPath = path.join(outDir, 'browser-native-runtime-pack.v1.index.json');
const manifestPath = path.join(outDir, 'browser-native-manifest.v1.json');

await mkdir(toolsDir, { recursive: true });
await mkdir(ocamlLibOutDir, { recursive: true });

const jsOfOcamlBytecodePath = path.join(
	sourceDir,
	'_build',
	'default',
	'compiler',
	'bin-js_of_ocaml',
	'js_of_ocaml.bc'
);
const wasmOfOcamlBytecodePath = path.join(
	sourceDir,
	'_build',
	'default',
	'compiler',
	'bin-wasm_of_ocaml',
	'wasm_of_ocaml.bc'
);
const jsOfOcamlNativePath = path.join(switchPrefix, 'bin', 'js_of_ocaml');
const ocamlcBytecodePath = path.join(switchPrefix, 'bin', 'ocamlc.byte');
const ocamlLibSourceDir = path.join(switchPrefix, 'lib', 'ocaml');
const switchLibDir = path.join(switchPrefix, 'lib');
const findlibConfSourcePath = path.join(switchPrefix, 'lib', 'findlib.conf');
const recipePath = path.join(projectRoot, 'toolchain', 'recipes', 'frozen-toolchain.browser.json');
const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
const browserPackageNames = [
	...new Set([...(recipe.packages || []).map((entry) => entry.name).filter(Boolean), 'yojson'])
].sort((left, right) => left.localeCompare(right));

if (options.force || !(await pathExists(jsOfOcamlBytecodePath))) {
	await run(
		options.opamBin,
		[
			'exec',
			'--root',
			options.opamRoot,
			'--switch',
			options.switchName,
			'--',
			'dune',
			'build',
			'compiler/bin-js_of_ocaml/js_of_ocaml.bc'
		],
		{
			cwd: sourceDir
		}
	);
}

if (options.force || !(await pathExists(wasmOfOcamlBytecodePath))) {
	await run(
		options.opamBin,
		[
			'exec',
			'--root',
			options.opamRoot,
			'--switch',
			options.switchName,
			'--',
			'dune',
			'build',
			'compiler/bin-wasm_of_ocaml/wasm_of_ocaml.bc'
		],
		{
			cwd: sourceDir,
			env: {
				PATH: `${path.join(projectRoot, '.cache', 'binaryen-version_129', 'bin')}:${process.env.PATH || ''}`
			}
		}
	);
}

if (options.force || !(await pathExists(ocamlcOutPath))) {
	await run(jsOfOcamlNativePath, [
		'--target-env',
		'browser',
		ocamlcBytecodePath,
		'-o',
		ocamlcOutPath
	]);
}

if (options.force || !(await pathExists(jsooOutPath))) {
	await run(jsOfOcamlNativePath, [
		'--target-env',
		'browser',
		jsOfOcamlBytecodePath,
		'-o',
		jsooOutPath
	]);
}

if (options.force || !(await pathExists(wasmooOutPath))) {
	await run(jsOfOcamlNativePath, [
		'--target-env',
		'browser',
		wasmOfOcamlBytecodePath,
		'-o',
		wasmooOutPath
	]);
}
const wasmOfOcamlPatch = await patchWasmOfOcamlBrowserTool(wasmooOutPath);
const wasmOptPatch = await patchBinaryenBrowserTool('wasm-opt', wasmOptOutPath);
const wasmMergePatch = await patchBinaryenBrowserTool('wasm-merge', wasmMergeOutPath);
const wasmMetadcePatch = await patchBinaryenBrowserTool('wasm-metadce', wasmMetadceOutPath);

if (options.force || !(await pathExists(path.join(ocamlLibOutDir, 'stdlib.cma')))) {
	await cp(ocamlLibSourceDir, ocamlLibOutDir, { recursive: true, force: true });
}

for (const packageName of browserPackageNames) {
	const packageSourceDir = path.join(switchLibDir, packageName);
	const packageOutPath = path.join(packageLibOutDir, packageName);
	if (!(await pathExists(packageSourceDir))) {
		continue;
	}
	if (options.force || !(await pathExists(packageOutPath))) {
		await cp(packageSourceDir, packageOutPath, { recursive: true, force: true });
	}
}

if (options.force || !(await pathExists(findlibConfOutPath))) {
	const findlibConf = await readFile(findlibConfSourcePath, 'utf8');
	const rewrittenFindlibConf = findlibConf.replaceAll(
		switchPrefix.replace(/\/+$/, ''),
		'/static/toolchain'
	);
	await writeFile(
		findlibConfOutPath,
		rewrittenFindlibConf.endsWith('\n') ? rewrittenFindlibConf : `${rewrittenFindlibConf}\n`,
		'utf8'
	);
}

const ocamlLibFiles = await collectManifestFiles(
	ocamlLibOutDir,
	'',
	'/static/toolchain/lib/ocaml',
	{ includeSourcePath: true }
);
const packages = (
	await Promise.all(
		browserPackageNames.map(async (packageName) => {
			const packageOutPath = path.join(packageLibOutDir, packageName);
			if (!(await pathExists(packageOutPath))) {
				return null;
			}
			return await collectPackageManifest(packageName, packageOutPath, '', {
				includeSourcePath: true
			});
		})
	)
).filter(Boolean);
const runtimePack = await writeRuntimePack(
	[
		...ocamlLibFiles.map((file) => ({
			path: file.path,
			sourcePath: file.sourcePath
		})),
		...packages.flatMap((manifestPackage) =>
			manifestPackage.files.map((file) => ({
				path: file.path,
				sourcePath: file.sourcePath
			}))
		)
	],
	runtimePackAssetPath,
	runtimePackIndexPath
);
const manifest = {
	version: 1,
	generatedAt: new Date().toISOString(),
	switchPrefix,
	findlibConf: '/.cache/browser-native-bundle/findlib.conf',
	tools: {
		ocamlc: '/.cache/browser-native-bundle/tools/ocamlc.byte.browser.js',
		js_of_ocaml: '/.cache/browser-native-bundle/tools/js_of_ocaml.bc.browser.js',
		wasm_of_ocaml: '/.cache/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js'
	},
	binaryenTools: {
		wasm_opt: '/.cache/browser-native-bundle/tools/wasm-opt.browser.js',
		wasm_merge: '/.cache/browser-native-bundle/tools/wasm-merge.browser.js',
		wasm_metadce: '/.cache/browser-native-bundle/tools/wasm-metadce.browser.js'
	},
	toolPatches: {
		version_dune_static_placeholder: versionDunePatch,
		wasm_of_ocaml_binaryen_bridge: wasmOfOcamlPatch,
		browser_binaryen_tools: [wasmOptPatch, wasmMergePatch, wasmMetadcePatch]
	},
	runtimePack,
	ocamlLibFiles: ocamlLibFiles.map(({ sourcePath, ...file }) => file),
	packages: packages.map(({ files, ...manifestPackage }) => ({
		...manifestPackage,
		files: files.map(({ sourcePath, ...file }) => file)
	}))
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await rm(path.join(outDir, 'lib'), { recursive: true, force: true });
process.stdout.write(`${manifestPath}\n`);
