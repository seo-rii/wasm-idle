import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchRuntime } from './patch-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, 'dotnet/WasmDotnet.Compiler');
const project = resolve(projectRoot, 'WasmDotnet.Compiler.csproj');
const projectAssets = resolve(projectRoot, 'obj/project.assets.json');
const publishSource = resolve(projectRoot, 'bin/Release/net9.0/browser-wasm/publish');
const buildSource = resolve(projectRoot, 'bin/Release/net9.0/browser-wasm');
const runtimeSource = resolve(buildSource, 'AppBundle/_framework');
const dotnetRoot = process.env.DOTNET_ROOT || '/home/seorii/.dotnet';
const dotnetExecutable = process.env.DOTNET || resolve(dotnetRoot, 'dotnet');
const frameworkReferencePackRoot = resolve(dotnetRoot, 'packs/Microsoft.NETCore.App.Ref');
const runtimeTarget = resolve(root, 'dist/runtime');
const referenceTarget = resolve(runtimeTarget, 'ref');
const languages = [
	{
		id: 'csharp',
		compilerAssemblies: [
			'Microsoft.CodeAnalysis.wasm',
			'Microsoft.CodeAnalysis.CSharp.wasm'
		]
	},
	{
		id: 'fsharp',
		compilerAssemblies: ['FSharp.Compiler.Service.wasm', 'FSharp.Core.wasm']
	},
	{
		id: 'vbnet',
		compilerAssemblies: [
			'Microsoft.CodeAnalysis.wasm',
			'Microsoft.CodeAnalysis.VisualBasic.wasm'
		]
	}
];

async function resolvePackageCompileAssembly(packageId, assemblyName) {
	const assets = JSON.parse(await readFile(projectAssets, 'utf8'));
	const packageKeyPrefix = `${packageId.toLowerCase()}/`;
	const target = Object.values(assets.targets ?? {}).find((targetValue) =>
		Object.keys(targetValue).some((key) => key.toLowerCase().startsWith(packageKeyPrefix))
	);
	if (!target) {
		throw new Error(`Could not find ${packageId} in ${projectAssets}.`);
	}

	const packageKey = Object.keys(target).find((key) =>
		key.toLowerCase().startsWith(packageKeyPrefix)
	);
	const library = packageKey ? assets.libraries?.[packageKey] : undefined;
	const compilePath = packageKey
		? Object.keys(target[packageKey].compile ?? {}).find((candidate) =>
				candidate.endsWith(`/${assemblyName}`)
			)
		: undefined;
	if (!library?.path || !compilePath) {
		throw new Error(`Could not find ${assemblyName} compile asset for ${packageId}.`);
	}

	const packagesRoot =
		process.env.NUGET_PACKAGES ||
		resolve(process.env.HOME || process.env.USERPROFILE || '', '.nuget/packages');
	return resolve(packagesRoot, library.path, compilePath);
}

function publishRuntime(language) {
	const result = spawnSync(
		dotnetExecutable,
		[
			'publish',
			project,
			'-c',
			'Release',
			`-p:WasmDotnetLanguage=${language}`
		],
		{
			cwd: root,
			stdio: 'inherit'
		}
	);

	if (result.error) {
		throw new Error(
			`Failed to run dotnet publish with ${dotnetExecutable}: ${result.error.message}`
		);
	}
	if (result.status !== 0) {
		throw new Error(`dotnet publish for ${language} exited with status ${result.status}.`);
	}
}

await rm(runtimeTarget, { recursive: true, force: true });
await mkdir(runtimeTarget, { recursive: true });

let fsharpCoreReference;
let stdinReference;
for (const language of languages) {
	await rm(resolve(projectRoot, 'bin'), { recursive: true, force: true });
	await rm(resolve(projectRoot, 'obj'), { recursive: true, force: true });
	publishRuntime(language.id);

	const target = resolve(runtimeTarget, language.id);
	await cp(runtimeSource, target, { recursive: true });
	await patchRuntime({
		runtimeDir: target,
		compilerAssemblies: language.compilerAssemblies
	});
	if (language.id === 'fsharp') {
		fsharpCoreReference = await resolvePackageCompileAssembly('FSharp.Core', 'FSharp.Core.dll');
	}
	stdinReference = resolve(buildSource, 'WasmDotnet.Stdin.dll');
	console.log(`Copied ${language.id} browser-wasm runtime from ${runtimeSource} to ${target}`);
}

if (!fsharpCoreReference || !stdinReference) {
	throw new Error('The language-specific .NET builds did not produce their shared references.');
}

await mkdir(referenceTarget, { recursive: true });
const referencePackVersions = (await readdir(frameworkReferencePackRoot)).sort((left, right) =>
	left.localeCompare(right, undefined, { numeric: true })
);
const frameworkReferenceSource = resolve(
	frameworkReferencePackRoot,
	referencePackVersions.at(-1) ?? '',
	'ref/net9.0'
);
const referenceAssemblies = (await readdir(frameworkReferenceSource, { withFileTypes: true }))
	.filter((entry) => entry.isFile() && entry.name.endsWith('.dll'))
	.map((entry) => entry.name)
	.sort();

for (const name of referenceAssemblies) {
	await cp(resolve(frameworkReferenceSource, name), resolve(referenceTarget, name));
}

const extraReferenceAssemblies = [
	{ name: 'FSharp.Core.dll', path: fsharpCoreReference },
	{ name: 'WasmDotnet.Stdin.dll', path: stdinReference }
];
for (const { name, path } of extraReferenceAssemblies) {
	await cp(path, resolve(referenceTarget, name));
	if (!referenceAssemblies.includes(name)) {
		referenceAssemblies.push(name);
	}
}
referenceAssemblies.sort();
await writeFile(
	resolve(referenceTarget, 'manifest.json'),
	`${JSON.stringify({ assemblies: referenceAssemblies }, null, 2)}\n`
);
await writeFile(
	resolve(runtimeTarget, 'manifest.json'),
	`${JSON.stringify(
		{
			languages: Object.fromEntries(
				languages.map(({ id, compilerAssemblies }) => [id, { compilerAssemblies }])
			),
			references: 'ref/manifest.json'
		},
		null,
		2
	)}\n`
);
console.log(`Copied ${referenceAssemblies.length} shared reference assemblies to ${referenceTarget}`);
