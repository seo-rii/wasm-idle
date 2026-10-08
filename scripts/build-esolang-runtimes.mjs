import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_PATH = 'src/lib/playground/wasiInterpreters.ts';
const BUILD_FLAGS = [
	'--target=wasm32-wasip1',
	'-std=c99',
	'-O2',
	'-fno-ident',
	'-Wl,--strip-all',
	'-Wl,-z,stack-size=131072',
	'-Wl,--initial-memory=262144',
	'-Wl,--max-memory=67108864'
];

const RUNTIMES = [
	{
		language: 'brainfuck',
		id: 'BRAINFUCK',
		folder: 'wasm-brainfuck',
		fileName: 'brainfuck.wasm',
		sourcePath: 'main.bf',
		command: 'bfi',
		args: [],
		repository: 'https://github.com/susam/bfc',
		commit: 'b1b92fc552707bbea50b396f6f6a3e3c1e51cb55',
		license: 'MIT',
		source: {
			path: 'runtimes/esolangs/brainfuck/vendor/bfc.c',
			url: 'https://raw.githubusercontent.com/susam/bfc/b1b92fc552707bbea50b396f6f6a3e3c1e51cb55/bfc.c',
			sha256: '6a5286882cd7692700d66b276e6b10ab3bc9f3c6083fe598e5c595a6fd292deb'
		},
		licenseFile: {
			path: 'runtimes/esolangs/brainfuck/LICENSE.md',
			url: 'https://raw.githubusercontent.com/susam/bfc/b1b92fc552707bbea50b396f6f6a3e3c1e51cb55/LICENSE.md',
			sha256: '3dc731e5f3b4ec786824dacf2052bda86ff6e603da4a79f56344d7756f7371a8'
		},
		glue: ['runtimes/esolangs/brainfuck/wasi-process.c']
	},
	{
		language: 'befunge93',
		id: 'BEFUNGE93',
		folder: 'wasm-befunge93',
		fileName: 'befunge93.wasm',
		sourcePath: 'main.b93',
		sourcePathPrefix: './',
		maxSourcePathBytes: 125,
		command: 'bef',
		args: ['-q'],
		repository: 'https://github.com/catseye/Befunge-93',
		commit: '8fe4065c0415b6f6fa6f699798fa9b64737aadc1',
		license: 'BSD-3-Clause',
		source: {
			path: 'runtimes/esolangs/befunge93/vendor/bef.c',
			url: 'https://raw.githubusercontent.com/catseye/Befunge-93/8fe4065c0415b6f6fa6f699798fa9b64737aadc1/src/bef.c',
			sha256: '2351c988739bfb15b6bed5b27b1a982f2d0ddbc7350ef639ecdab4e7a3f9380c'
		},
		licenseFile: {
			path: 'runtimes/esolangs/befunge93/LICENSE',
			url: 'https://raw.githubusercontent.com/catseye/Befunge-93/8fe4065c0415b6f6fa6f699798fa9b64737aadc1/LICENSE',
			sha256: 'e358fdee1a027014a0d103efd34ec4c9d7f60545204410beec3107a91c37a2d1'
		},
		flags: ['-D_POSIX_C_SOURCE=200809L'],
		glue: []
	}
];

function assertEqual(actual, expected, label) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} is stale or does not match its pinned inputs.`);
	}
}

async function describeFile(filePath, absolutePath = path.join(REPO_ROOT, filePath)) {
	const data = await readFile(absolutePath);
	return {
		path: filePath,
		bytes: data.byteLength,
		sha256: createHash('sha256').update(data).digest('hex')
	};
}

async function readInputs(runtime) {
	const source = await describeFile(runtime.source.path);
	const license = await describeFile(runtime.licenseFile.path);
	assertEqual(source.sha256, runtime.source.sha256, runtime.source.path);
	assertEqual(license.sha256, runtime.licenseFile.sha256, runtime.licenseFile.path);
	return {
		upstream: {
			repository: runtime.repository,
			commit: runtime.commit,
			source: { ...source, url: runtime.source.url },
			license: { ...license, url: runtime.licenseFile.url, spdx: runtime.license }
		},
		inputs: [source, ...(await Promise.all(runtime.glue.map((file) => describeFile(file))))],
		license: { ...license, path: 'LICENSE.txt', spdx: runtime.license }
	};
}

async function describeWasm(runtime, wasmPath) {
	const data = await readFile(wasmPath);
	const module = new WebAssembly.Module(data);
	if (
		WebAssembly.Module.imports(module).some(
			(entry) => entry.module !== 'wasi_snapshot_preview1'
		)
	) {
		throw new Error(`${runtime.fileName} imports a non-WASI runtime.`);
	}
	const exports = WebAssembly.Module.exports(module);
	for (const [name, kind] of [
		['_start', 'function'],
		['memory', 'memory']
	]) {
		if (!exports.some((entry) => entry.name === name && entry.kind === kind)) {
			throw new Error(`${runtime.fileName} does not export ${name}.`);
		}
	}
	return describeFile(runtime.fileName, wasmPath);
}

function buildArgs(runtime, outputPath) {
	return [
		...BUILD_FLAGS,
		...(runtime.flags ?? []),
		runtime.source.path,
		...runtime.glue,
		'-o',
		outputPath
	];
}

function receiptFor(runtime, inputs, toolchain, wasm) {
	return {
		formatVersion: 1,
		language: runtime.id,
		upstream: inputs.upstream,
		inputs: inputs.inputs,
		license: inputs.license,
		build: {
			toolchain,
			command: 'WASI_SDK_PATH/bin/clang',
			args: buildArgs(runtime, `static/${runtime.folder}/${runtime.fileName}`)
		},
		wasm
	};
}

async function readToolchain(sdkPath) {
	const version = (await readFile(path.join(sdkPath, 'VERSION'), 'utf8')).trim();
	if (!/^33\.0(?:\+[^\n]*)?\n/.test(`${version}\n`)) {
		throw new Error('This build requires wasi-sdk 33.0. Set WASI_SDK_PATH to that SDK.');
	}
	const result = spawnSync(path.join(sdkPath, 'bin/clang'), ['--version'], {
		encoding: 'utf8',
		env: { ...process.env, LC_ALL: 'C' }
	});
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(result.stderr || 'Could not read the WASI clang version.');
	}
	return { name: 'wasi-sdk', version, compiler: result.stdout.split('\n')[0] };
}

async function checkRuntime(runtime) {
	const directory = path.join(REPO_ROOT, 'static', runtime.folder);
	const inputs = await readInputs(runtime);
	const receipt = JSON.parse(await readFile(path.join(directory, 'runtime-build.json'), 'utf8'));
	if (
		receipt.build?.toolchain?.name !== 'wasi-sdk' ||
		!/^33\.0(?:\+[^\n]*)?\n/.test(`${receipt.build?.toolchain?.version}\n`) ||
		!/^clang version 22\.1\.0-wasi-sdk /.test(receipt.build?.toolchain?.compiler ?? '')
	) {
		throw new Error(`${runtime.folder} does not record the required wasi-sdk 33.0 toolchain.`);
	}
	const wasm = await describeWasm(runtime, path.join(directory, runtime.fileName));
	assertEqual(
		receipt,
		receiptFor(runtime, inputs, receipt.build.toolchain, wasm),
		runtime.folder
	);
	const license = await describeFile('LICENSE.txt', path.join(directory, 'LICENSE.txt'));
	assertEqual(
		license,
		{ path: 'LICENSE.txt', bytes: inputs.license.bytes, sha256: inputs.license.sha256 },
		`${runtime.folder}/LICENSE.txt`
	);
	return receipt;
}

function renderProfiles(receipts) {
	const profiles = RUNTIMES.map((runtime, index) => {
		const wasm = receipts[index].wasm;
		const args = runtime.args.map((argument) => `'${argument}'`).join(', ');
		const pathPrefix =
			runtime.sourcePathPrefix === undefined
				? ''
				: `\n\t\tsourcePathPrefix: '${runtime.sourcePathPrefix}',`;
		const pathLimit =
			runtime.maxSourcePathBytes === undefined
				? ''
				: `\n\t\tmaxSourcePathBytes: ${runtime.maxSourcePathBytes},`;
		return `\t${runtime.id}: {\n\t\tid: '${runtime.id}',\n\t\tfolder: '${runtime.folder}',\n\t\tfileName: '${runtime.fileName}',\n\t\tsourcePath: '${runtime.sourcePath}',${pathPrefix}${pathLimit}\n\t\tcommand: '${runtime.command}',\n\t\targs: [${args}],\n\t\tsha256: '${wasm.sha256}',\n\t\tbytes: ${wasm.bytes}\n\t}`;
	}).join(',\n');
	return `// Generated by scripts/build-esolang-runtimes.mjs --write.\nexport type WasiInterpreterProfile = {\n\treadonly id: string;\n\treadonly folder: string;\n\treadonly fileName: string;\n\treadonly sourcePath: string;\n\treadonly sourcePathPrefix?: string;\n\treadonly maxSourcePathBytes?: number;\n\treadonly command: string;\n\treadonly args: readonly string[];\n\treadonly sha256: string;\n\treadonly bytes: number;\n};\n\nexport const WASI_INTERPRETERS: Readonly<Record<string, WasiInterpreterProfile>> = {\n${profiles}\n};\n`;
}

async function main() {
	const options = process.argv.slice(2);
	let language;
	let check = false;
	let write = false;
	for (let index = 0; index < options.length; index++) {
		const option = options[index];
		if (option === '--check') check = true;
		else if (option === '--write') write = true;
		else if (option === '--language') {
			language = options[++index];
			if (!language || language.startsWith('--'))
				throw new Error('--language requires a name.');
		} else throw new Error(`Unknown argument: ${option}`);
	}
	if (check && write) throw new Error('--check and --write cannot be combined.');
	const selected = RUNTIMES.filter((runtime) => !language || runtime.language === language);
	if (selected.length === 0) throw new Error(`Unsupported interpreter: ${language}`);
	if (!check) {
		const sdkPath =
			process.env.WASI_SDK_PATH ?? path.join(homedir(), '.local/share/wasi-sdk-33');
		const toolchain = await readToolchain(sdkPath);
		const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-esolangs-'));
		try {
			for (const runtime of selected) {
				const inputs = await readInputs(runtime);
				const wasmPath = path.join(temporaryDirectory, runtime.fileName);
				const result = spawnSync(
					path.join(sdkPath, 'bin/clang'),
					buildArgs(runtime, wasmPath),
					{
						cwd: REPO_ROOT,
						encoding: 'utf8',
						env: { ...process.env, LC_ALL: 'C', SOURCE_DATE_EPOCH: '0' },
						timeout: 60000
					}
				);
				if (result.error || result.status !== 0) {
					throw (
						result.error ??
						new Error(result.stderr || `clang exited with ${result.status}.`)
					);
				}
				const wasm = await describeWasm(runtime, wasmPath);
				const receipt = receiptFor(runtime, inputs, toolchain, wasm);
				const targetDirectory = path.join(REPO_ROOT, 'static', runtime.folder);
				if (write) {
					await mkdir(targetDirectory, { recursive: true });
					await cp(wasmPath, path.join(targetDirectory, runtime.fileName));
					await cp(
						path.join(REPO_ROOT, runtime.licenseFile.path),
						path.join(targetDirectory, 'LICENSE.txt')
					);
					await writeFile(
						path.join(targetDirectory, 'runtime-build.json'),
						`${JSON.stringify(receipt, null, 2)}\n`
					);
				} else {
					assertEqual(
						await checkRuntime(runtime),
						receipt,
						`${runtime.folder} reproducible build`
					);
				}
				console.log(
					`${write ? 'Built' : 'Reproduced'} ${runtime.id}: ${wasm.bytes} bytes, SHA256 ${wasm.sha256}`
				);
			}
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	}
	const receipts = await Promise.all(RUNTIMES.map(checkRuntime));
	const profiles = renderProfiles(receipts);
	if (write) await writeFile(path.join(REPO_ROOT, PROFILE_PATH), profiles);
	else
		assertEqual(
			await readFile(path.join(REPO_ROOT, PROFILE_PATH), 'utf8'),
			profiles,
			PROFILE_PATH
		);
	if (check)
		console.log(
			`Verified ${selected.map((runtime) => runtime.id).join(', ')} source, license, pin, WASM and profile.`
		);
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
