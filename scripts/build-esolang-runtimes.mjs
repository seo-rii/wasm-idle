import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_PATH = 'src/lib/playground/wasiInterpreters.ts';
const GO_VERSION = '1.25.3';
const GO_BUILD_FLAGS = ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid='];
const GO_BUILD_ENV = {
	GOOS: 'wasip1',
	GOARCH: 'wasm',
	CGO_ENABLED: '0',
	GOTOOLCHAIN: 'local',
	GOENV: 'off',
	GOFLAGS: '',
	GOEXPERIMENT: '',
	GOWORK: 'off',
	GOPROXY: 'off',
	GOSUMDB: 'off'
};
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
		maxSourcePathBytes: 62,
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
	},
	{
		language: 'whitespace',
		id: 'WHITESPACE',
		folder: 'wasm-whitespace',
		fileName: 'whitespace.wasm',
		sourcePath: 'main.ws',
		maxSourceBytes: 65535,
		command: 'whitespace',
		args: [],
		initialMemoryBytes: 3145728,
		patches: [
			{
				path: 'runtimes/esolangs/whitespace/fix-zero-dividend.patch',
				sha256: '4b98a9f9c66926a62bd9994f6585ecc691f665322d8cf220c33ff10894c7fa81'
			}
		],
		repository: 'https://github.com/koturn/Whitespace',
		commit: '22a57aab21ff4a0307642383b0eb3660e1bb412d',
		license: 'MIT',
		source: {
			path: 'runtimes/esolangs/whitespace/vendor/whitespace.c',
			url: 'https://raw.githubusercontent.com/koturn/Whitespace/22a57aab21ff4a0307642383b0eb3660e1bb412d/whitespace.c',
			sha256: '22335d868995c910d6a0bed727e4f8bde3a8a23976a2fb7846bb7e90ec5f4556'
		},
		licenseFile: {
			path: 'runtimes/esolangs/whitespace/LICENSE',
			url: 'https://raw.githubusercontent.com/koturn/Whitespace/22a57aab21ff4a0307642383b0eb3660e1bb412d/LICENSE',
			sha256: '90e9ef883686ffb3e388e26a52c0c4a612db85491cddefc774034ee3aefabcd4'
		},
		glue: []
	},
	{
		language: 'malbolge',
		id: 'MALBOLGE',
		folder: 'wasm-malbolge',
		fileName: 'malbolge.wasm',
		sourcePath: 'main.mal',
		minSourceCharacters: 2,
		command: 'malbolge',
		args: [],
		repository: 'https://github.com/TryItOnline/malbolge',
		commit: 'b08698709872be370c050a825f4f3c0b224e0be8',
		license: 'LicenseRef-Public-Domain',
		source: {
			path: 'runtimes/esolangs/malbolge/vendor/malbolge.c',
			url: 'https://raw.githubusercontent.com/TryItOnline/malbolge/b08698709872be370c050a825f4f3c0b224e0be8/malbolge.c',
			sha256: 'fe29a717f9f684d6cc81d5c63273d446d9c65fec73e62164538514d5737b07a6'
		},
		licenseFile: {
			path: 'runtimes/esolangs/malbolge/LICENSE',
			url: 'https://raw.githubusercontent.com/TryItOnline/malbolge/b08698709872be370c050a825f4f3c0b224e0be8/malbolge.c',
			sha256: '6af5019015f2f9541fa1e417727c54bb677b23bde84e9e444862b7ece3200329',
			sourceHeader: true
		},
		glue: []
	},
	{
		language: 'uhmlang',
		id: 'UHMLANG',
		folder: 'wasm-uhmlang',
		fileName: 'uhmlang.wasm',
		sourcePath: 'main.um',
		command: 'umjunsik',
		args: [],
		backend: 'go',
		sourceRoot: 'runtimes/esolangs/uhmlang/vendor',
		repository: 'https://github.com/rycont/umjunsik-lang',
		commit: 'e973f9d22b9803ee86b53d8e60f1b65ab08c7547',
		license: 'MIT',
		source: {
			path: 'runtimes/esolangs/uhmlang/vendor/main.go',
			url: 'https://raw.githubusercontent.com/rycont/umjunsik-lang/e973f9d22b9803ee86b53d8e60f1b65ab08c7547/umjunsik-lang-go/main.go',
			sha256: 'a28612201b0002b0437a228e1145490459de62fbaa490c74f5f88de1c72bdf94'
		},
		additionalSources: [
			['ast/ast.go', '0349b09911d80c3a0eb878d7b3beae87c6edd29617f4a12b3c1b132183709ae4'],
			['eval/eval.go', '33992d30b12727576c51d3b9ab6ef469d46676b38279b23c4a29b7219190b839'],
			['eval/util.go', '25227fe69086f99a11b72be4d1b163a757146a73495cb3c9692aa41ba405c15a'],
			['go.mod', '9928e259f7d60c700eb942e933096b7ccaa5d8b5bc4ce719505ab4ba2796b06b'],
			['lexer/lexer.go', '96b088ba20249046c6f5308cfc17fbedab3e155adce91209c874b34e8fe22643'],
			[
				'object/object.go',
				'2cb7cb75f3de06aa432da5e04db6418259a797e7ed4dc339ee7523dee0ae5111'
			],
			[
				'parser/parser.go',
				'a1b4c53ad1f5e50de0270134beb61dcf99d8f4522f5959c3e7c0bb0a59a95bdd'
			],
			['parser/util.go', '1578d9209003d774b5c7a0319764ee1cca4d6b06e319a8c881a1bb1bf02fc599'],
			['token/token.go', 'f251d827653cb0dd3f0e9714e9a956415dcdfb35584f7ec65357a8494e91d094']
		].map(([relativePath, sha256]) => ({
			path: `runtimes/esolangs/uhmlang/vendor/${relativePath}`,
			url: `https://raw.githubusercontent.com/rycont/umjunsik-lang/e973f9d22b9803ee86b53d8e60f1b65ab08c7547/umjunsik-lang-go/${relativePath}`,
			sha256
		})),
		licenseFile: {
			path: 'runtimes/esolangs/uhmlang/LICENSE',
			url: 'https://raw.githubusercontent.com/rycont/umjunsik-lang/e973f9d22b9803ee86b53d8e60f1b65ab08c7547/LICENSE',
			sha256: 'ca6ca5d8e587b5c8a3f8308214ecb7257c7d29c4d90b958cfeaaa4ac7b9e5321'
		},
		additionalLicenses: [
			{
				path: 'runtimes/esolangs/uhmlang/GO-LICENSE',
				url: 'https://raw.githubusercontent.com/golang/go/go1.25.3/LICENSE',
				sha256: '911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad',
				spdx: 'BSD-3-Clause',
				label: 'Go runtime and standard library (Go 1.25.3)'
			}
		],
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
	const additionalSources = await Promise.all(
		(runtime.additionalSources ?? []).map(async (input) => {
			const description = await describeFile(input.path);
			assertEqual(description.sha256, input.sha256, input.path);
			return { ...description, url: input.url };
		})
	);
	const license = await describeFile(runtime.licenseFile.path);
	let licenseData = await readFile(path.join(REPO_ROOT, runtime.licenseFile.path));
	const additionalLicenses = [];
	for (const input of runtime.additionalLicenses ?? []) {
		const description = await describeFile(input.path);
		assertEqual(description.sha256, input.sha256, input.path);
		additionalLicenses.push({ ...description, url: input.url, spdx: input.spdx });
		licenseData = Buffer.concat([
			licenseData,
			Buffer.from(`\n\n${input.label}\n\n`),
			await readFile(path.join(REPO_ROOT, input.path))
		]);
	}
	assertEqual(source.sha256, runtime.source.sha256, runtime.source.path);
	assertEqual(license.sha256, runtime.licenseFile.sha256, runtime.licenseFile.path);
	if (runtime.licenseFile.sourceHeader) {
		const sourceText = await readFile(path.join(REPO_ROOT, runtime.source.path), 'utf8');
		const header = sourceText.slice(0, sourceText.indexOf('#include <stdio.h>'));
		assertEqual(
			createHash('sha256').update(header).digest('hex'),
			license.sha256,
			`${runtime.licenseFile.path} source header extraction`
		);
	}
	const patches = await Promise.all(
		(runtime.patches ?? []).map(async (patch) => {
			const input = await describeFile(patch.path);
			assertEqual(input.sha256, patch.sha256, patch.path);
			return input;
		})
	);
	let patchedSource;
	let compiledSource;
	if (patches.length > 0) {
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-esolang-patch-'));
		try {
			const temporarySource = path.join(directory, path.basename(runtime.source.path));
			await cp(path.join(REPO_ROOT, runtime.source.path), temporarySource);
			for (const patch of patches) {
				const result = spawnSync(
					'patch',
					[
						'--batch',
						'--fuzz=0',
						'--silent',
						temporarySource,
						path.join(REPO_ROOT, patch.path)
					],
					{ encoding: 'utf8', timeout: 10000 }
				);
				if (result.error || result.status !== 0)
					throw (
						result.error ??
						new Error(result.stderr || `patch exited with ${result.status}.`)
					);
			}
			patchedSource = await readFile(temporarySource, 'utf8');
			compiledSource = await describeFile('<stdin>', temporarySource);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
	return {
		upstream: {
			repository: runtime.repository,
			commit: runtime.commit,
			source: { ...source, url: runtime.source.url },
			...(additionalSources.length ? { additionalSources } : {}),
			license: {
				...license,
				url: runtime.licenseFile.url,
				spdx: runtime.license,
				...(runtime.licenseFile.sourceHeader
					? { extraction: 'Opening source comment before #include <stdio.h>' }
					: {})
			}
		},
		inputs: [
			source,
			...additionalSources.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
			...(await Promise.all(runtime.glue.map((file) => describeFile(file)))),
			...patches
		],
		...(additionalLicenses.length ? { additionalLicenses } : {}),
		...(compiledSource ? { patchedSource, compiledSource } : {}),
		license: {
			path: 'LICENSE.txt',
			bytes: licenseData.byteLength,
			sha256: createHash('sha256').update(licenseData).digest('hex'),
			spdx: [runtime.license, ...additionalLicenses.map((input) => input.spdx)].join(' AND ')
		},
		licenseData
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
	if (runtime.backend === 'go') return [...GO_BUILD_FLAGS, '-o', outputPath, '.'];
	return [
		...BUILD_FLAGS.map((flag) =>
			runtime.initialMemoryBytes !== undefined && flag.startsWith('-Wl,--initial-memory=')
				? `-Wl,--initial-memory=${runtime.initialMemoryBytes}`
				: flag
		),
		...(runtime.flags ?? []),
		...(runtime.patches?.length ? ['-x', 'c', '-'] : [runtime.source.path]),
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
		...(inputs.additionalLicenses ? { additionalLicenses: inputs.additionalLicenses } : {}),
		build: {
			toolchain,
			command: runtime.backend === 'go' ? 'GO_BINARY' : 'WASI_SDK_PATH/bin/clang',
			...(runtime.backend === 'go' ? { cwd: runtime.sourceRoot, env: GO_BUILD_ENV } : {}),
			args: buildArgs(
				runtime,
				runtime.backend === 'go'
					? path.posix.relative(
							runtime.sourceRoot,
							`static/${runtime.folder}/${runtime.fileName}`
						)
					: `static/${runtime.folder}/${runtime.fileName}`
			),
			...(inputs.compiledSource ? { source: inputs.compiledSource } : {})
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

function readGoToolchain(goBinary) {
	const result = spawnSync(goBinary, ['version'], {
		encoding: 'utf8',
		env: { ...process.env, ...GO_BUILD_ENV, LC_ALL: 'C' }
	});
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(result.stderr || 'Could not read the Go version.');
	}
	if (!result.stdout.startsWith(`go version go${GO_VERSION} `)) {
		throw new Error(`This build requires Go ${GO_VERSION}. Set GO_BINARY to that compiler.`);
	}
	return { name: 'Go', version: GO_VERSION, compiler: `go version go${GO_VERSION}` };
}

async function checkRuntime(runtime) {
	const directory = path.join(REPO_ROOT, 'static', runtime.folder);
	const inputs = await readInputs(runtime);
	const receipt = JSON.parse(await readFile(path.join(directory, 'runtime-build.json'), 'utf8'));
	if (runtime.backend === 'go') {
		assertEqual(
			receipt.build?.toolchain,
			{ name: 'Go', version: GO_VERSION, compiler: `go version go${GO_VERSION}` },
			`${runtime.folder} Go toolchain`
		);
	} else if (
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
		const sourceLimit =
			runtime.maxSourceBytes === undefined
				? ''
				: `\n\t\tmaxSourceBytes: ${runtime.maxSourceBytes},`;
		const sourceMinimum =
			runtime.minSourceCharacters === undefined
				? ''
				: `\n\t\tminSourceCharacters: ${runtime.minSourceCharacters},`;
		return `\t${runtime.id}: {\n\t\tid: '${runtime.id}',\n\t\tfolder: '${runtime.folder}',\n\t\tfileName: '${runtime.fileName}',\n\t\tsourcePath: '${runtime.sourcePath}',${pathPrefix}${pathLimit}${sourceLimit}${sourceMinimum}\n\t\tcommand: '${runtime.command}',\n\t\targs: [${args}],\n\t\tsha256: '${wasm.sha256}',\n\t\tbytes: ${wasm.bytes}\n\t}`;
	}).join(',\n');
	return `// Generated by scripts/build-esolang-runtimes.mjs --write.\nexport type WasiInterpreterProfile = {\n\treadonly id: string;\n\treadonly folder: string;\n\treadonly fileName: string;\n\treadonly sourcePath: string;\n\treadonly sourcePathPrefix?: string;\n\treadonly maxSourcePathBytes?: number;\n\treadonly maxSourceBytes?: number;\n\treadonly minSourceCharacters?: number;\n\treadonly command: string;\n\treadonly args: readonly string[];\n\treadonly sha256: string;\n\treadonly bytes: number;\n};\n\nexport const WASI_INTERPRETERS: Readonly<Record<string, WasiInterpreterProfile>> = {\n${profiles}\n};\n`;
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
		const goBinary = process.env.GO_BINARY ?? 'go';
		const toolchains = {};
		if (selected.some((runtime) => runtime.backend !== 'go'))
			toolchains.c = await readToolchain(sdkPath);
		if (selected.some((runtime) => runtime.backend === 'go'))
			toolchains.go = readGoToolchain(goBinary);
		const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-esolangs-'));
		try {
			for (const runtime of selected) {
				const isGo = runtime.backend === 'go';
				const inputs = await readInputs(runtime);
				const wasmPath = path.join(temporaryDirectory, runtime.fileName);
				const result = spawnSync(
					isGo ? goBinary : path.join(sdkPath, 'bin/clang'),
					buildArgs(runtime, wasmPath),
					{
						cwd: isGo ? path.join(REPO_ROOT, runtime.sourceRoot) : REPO_ROOT,
						encoding: 'utf8',
						...(inputs.patchedSource !== undefined
							? { input: inputs.patchedSource }
							: {}),
						env: {
							...process.env,
							...(isGo ? GO_BUILD_ENV : {}),
							LC_ALL: 'C',
							SOURCE_DATE_EPOCH: '0'
						},
						timeout: isGo ? 180000 : 60000
					}
				);
				if (result.error || result.status !== 0) {
					throw (
						result.error ??
						new Error(
							result.stderr ||
								`${isGo ? 'Go' : 'clang'} exited with ${result.status}.`
						)
					);
				}
				const wasm = await describeWasm(runtime, wasmPath);
				const receipt = receiptFor(runtime, inputs, toolchains[isGo ? 'go' : 'c'], wasm);
				const targetDirectory = path.join(REPO_ROOT, 'static', runtime.folder);
				if (write) {
					await mkdir(targetDirectory, { recursive: true });
					await cp(wasmPath, path.join(targetDirectory, runtime.fileName));
					await writeFile(path.join(targetDirectory, 'LICENSE.txt'), inputs.licenseData);
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
