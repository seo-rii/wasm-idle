import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const RUNTIME_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const ARTIFACTS_ROOT = path.join(RUNTIME_ROOT, 'artifacts');
const CACHE_ROOT = path.join(ARTIFACTS_ROOT, 'cache');
const BUILD_ROOT = path.join(ARTIFACTS_ROOT, 'build');
const DIST_ROOT = path.join(RUNTIME_ROOT, 'dist');

const CLOJURESCRIPT_VERSION = '1.12.134';
const CLOJURE_TOOLS_VERSION = '1.12.4.1618';
const JDK_VERSION = '21.0.11+10';
const INPUTS = {
	jdk: {
		filename: 'OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz',
		url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jdk_x64_linux_hotspot_21.0.11_10.tar.gz',
		sha256: '4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de'
	},
	clojureTools: {
		filename: `clojure-tools-${CLOJURE_TOOLS_VERSION}.tar.gz`,
		url: `https://download.clojure.org/install/clojure-tools-${CLOJURE_TOOLS_VERSION}.tar.gz`,
		sha256: '13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21'
	},
	license: {
		filename: `clojurescript-${CLOJURESCRIPT_VERSION}-epl-v10.html`,
		url: `https://raw.githubusercontent.com/clojure/clojurescript/r${CLOJURESCRIPT_VERSION}/epl-v10.html`,
		sha256: 'd0d35c5fb45696fcaa98858f6c1f1cf0d41400302f4adb966eb9a54fa9b9a226'
	}
};

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(filePath) {
	return sha256(await readFile(filePath));
}

async function assertFile(filePath, label) {
	const fileStats = await stat(filePath).catch(() => null);
	if (!fileStats?.isFile()) throw new Error(`${label} was not found at ${filePath}`);
	return fileStats;
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit', ...options });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`command failed (${code}): ${command} ${args.join(' ')}`));
		});
	});
}

async function downloadPinnedInputs() {
	const downloadsRoot = path.join(CACHE_ROOT, 'downloads');
	await mkdir(downloadsRoot, { recursive: true });
	const archives = {};
	for (const [name, input] of Object.entries(INPUTS)) {
		const archivePath = path.join(downloadsRoot, input.filename);
		const currentHash = await sha256File(archivePath).catch(() => '');
		if (currentHash !== input.sha256) {
			await rm(archivePath, { force: true });
			const response = await fetch(input.url);
			if (!response.ok)
				throw new Error(`failed to download ${input.url}: HTTP ${response.status}`);
			await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
		}
		const actualHash = await sha256File(archivePath);
		if (actualHash !== input.sha256) {
			throw new Error(`${name} archive SHA-256 mismatch: ${actualHash}`);
		}
		archives[name] = archivePath;
	}
	return archives;
}

async function installClojureTools(sourceRoot, installRoot) {
	await mkdir(path.join(installRoot, 'bin'), { recursive: true });
	await mkdir(path.join(installRoot, 'libexec'), { recursive: true });
	for (const fileName of ['deps.edn', 'example-deps.edn', 'tools.edn']) {
		await cp(path.join(sourceRoot, fileName), path.join(installRoot, fileName));
	}
	for (const fileName of [`clojure-tools-${CLOJURE_TOOLS_VERSION}.jar`, 'exec.jar']) {
		await cp(path.join(sourceRoot, fileName), path.join(installRoot, 'libexec', fileName));
	}
	const launcherSource = await readFile(path.join(sourceRoot, 'clojure'), 'utf8');
	const launcherPath = path.join(installRoot, 'bin', 'clojure');
	await writeFile(launcherPath, launcherSource.replaceAll('PREFIX', installRoot), 'utf8');
	await chmod(launcherPath, 0o755);
}

export async function verifyClojureScriptRuntime(outputRoot = DIST_ROOT) {
	const compilerPath = path.join(outputRoot, 'compiler.js');
	const compilerStats = await assertFile(compilerPath, 'compiler.js');
	await assertFile(path.join(outputRoot, 'LICENSE.txt'), 'ClojureScript license');
	const compilerSource = await readFile(compilerPath, 'utf8');
	if (!compilerSource.includes('wasm_idle.runner.execute')) {
		throw new Error('compiler.js does not export wasm_idle.runner.execute');
	}
	if (compilerSource.includes('clojure.browser.repl')) {
		throw new Error('compiler.js unexpectedly contains the browser REPL preload');
	}
	const metadata = JSON.parse(
		await readFile(path.join(outputRoot, 'runtime-build.json'), 'utf8')
	);
	const compilerSha256 = await sha256File(compilerPath);
	if (
		metadata.clojureScriptVersion !== CLOJURESCRIPT_VERSION ||
		metadata.compilerSha256 !== compilerSha256 ||
		metadata.compilerBytes !== compilerStats.size
	) {
		throw new Error(`${outputRoot}/runtime-build.json does not describe compiler.js`);
	}
	return metadata;
}

export async function prepareClojureScriptRuntime() {
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error(
			`wasm-clojurescript builds are pinned for linux-x64, received ${process.platform}-${process.arch}`
		);
	}
	const archives = await downloadPinnedInputs();
	await rm(BUILD_ROOT, { recursive: true, force: true });
	await rm(DIST_ROOT, { recursive: true, force: true });
	await mkdir(BUILD_ROOT, { recursive: true });
	await mkdir(DIST_ROOT, { recursive: true });

	const jdkRoot = path.join(BUILD_ROOT, 'jdk');
	const clojureSourceRoot = path.join(BUILD_ROOT, 'clojure-tools-source');
	const clojureInstallRoot = path.join(BUILD_ROOT, 'clojure-tools');
	await mkdir(jdkRoot, { recursive: true });
	await mkdir(clojureSourceRoot, { recursive: true });
	await run('tar', ['-xzf', archives.jdk, '-C', jdkRoot, '--strip-components=1']);
	await run('tar', [
		'-xzf',
		archives.clojureTools,
		'-C',
		clojureSourceRoot,
		'--strip-components=1'
	]);
	await installClojureTools(clojureSourceRoot, clojureInstallRoot);

	const clojure = path.join(clojureInstallRoot, 'bin', 'clojure');
	const java = path.join(jdkRoot, 'bin', 'java');
	const env = {
		...process.env,
		JAVA_HOME: jdkRoot,
		JAVA_CMD: java,
		LC_ALL: 'C',
		TZ: 'UTC'
	};
	await run(clojure, ['-J-Xmx4g', '-M', '-e', '(load-file "build.clj")'], {
		cwd: RUNTIME_ROOT,
		env
	});

	await cp(archives.license, path.join(DIST_ROOT, 'LICENSE.txt'));

	const compilerPath = path.join(DIST_ROOT, 'compiler.js');
	const compilerStats = await assertFile(compilerPath, 'compiler.js');
	const compilerSha256 = await sha256File(compilerPath);
	await writeFile(
		path.join(DIST_ROOT, 'runtime-build.json'),
		`${JSON.stringify(
			{
				format: 'wasm-clojurescript-runtime-build-v1',
				runtime: 'cljs.js',
				clojureScriptVersion: CLOJURESCRIPT_VERSION,
				clojureToolsVersion: CLOJURE_TOOLS_VERSION,
				jdkVersion: JDK_VERSION,
				jdkArchiveSha256: INPUTS.jdk.sha256,
				clojureToolsArchiveSha256: INPUTS.clojureTools.sha256,
				target: 'webworker',
				optimizations: 'simple',
				compilerSha256,
				compilerBytes: compilerStats.size
			},
			null,
			2
		)}\n`,
		'utf8'
	);
	return verifyClojureScriptRuntime();
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	if (process.argv.includes('--check')) {
		const metadata = await verifyClojureScriptRuntime();
		console.log(`Verified ClojureScript ${metadata.clojureScriptVersion} runtime.`);
	} else {
		const metadata = await prepareClojureScriptRuntime();
		console.log(
			`Built ClojureScript ${metadata.clojureScriptVersion} runtime (${metadata.compilerBytes} bytes).`
		);
	}
}
