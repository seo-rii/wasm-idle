import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(
  root,
  "dotnet/WasmDotnet.Compiler/WasmDotnet.Compiler.csproj",
);
const projectAssets = resolve(
  root,
  "dotnet/WasmDotnet.Compiler/obj/project.assets.json",
);
const publishSource = resolve(
  root,
  "dotnet/WasmDotnet.Compiler/bin/Release/net9.0/browser-wasm/publish",
);
const buildSource = resolve(
  root,
  "dotnet/WasmDotnet.Compiler/bin/Release/net9.0/browser-wasm",
);
const dotnetRoot = process.env.DOTNET_ROOT || "/home/seorii/.dotnet";
const frameworkReferencePackRoot = resolve(
  dotnetRoot,
  "packs/Microsoft.NETCore.App.Ref",
);
const runtimeSource = resolve(
  root,
  "dotnet/WasmDotnet.Compiler/bin/Release/net9.0/browser-wasm/AppBundle/_framework",
);
const runtimeTarget = resolve(root, "dist/runtime");
const referenceTarget = resolve(runtimeTarget, "ref");

async function resolvePackageCompileAssembly(packageId, assemblyName) {
  const assets = JSON.parse(await readFile(projectAssets, "utf8"));
  const packageKeyPrefix = `${packageId.toLowerCase()}/`;
  const target = Object.values(assets.targets ?? {}).find((targetValue) =>
    Object.keys(targetValue).some((key) =>
      key.toLowerCase().startsWith(packageKeyPrefix),
    ),
  );
  if (!target) {
    throw new Error(`Could not find ${packageId} in ${projectAssets}.`);
  }

  const packageKey = Object.keys(target).find((key) =>
    key.toLowerCase().startsWith(packageKeyPrefix),
  );
  const library = packageKey ? assets.libraries?.[packageKey] : undefined;
  const compilePath = packageKey
    ? Object.keys(target[packageKey].compile ?? {}).find((candidate) =>
        candidate.endsWith(`/${assemblyName}`),
      )
    : undefined;
  if (!library?.path || !compilePath) {
    throw new Error(
      `Could not find ${assemblyName} compile asset for ${packageId}.`,
    );
  }

  const packagesRoot =
    process.env.NUGET_PACKAGES ||
    resolve(
      process.env.HOME || process.env.USERPROFILE || "",
      ".nuget/packages",
    );
  return resolve(packagesRoot, library.path, compilePath);
}

const result = spawnSync("dotnet", ["publish", project, "-c", "Release"], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await rm(runtimeTarget, { recursive: true, force: true });
await cp(runtimeSource, runtimeTarget, { recursive: true });
await mkdir(referenceTarget, { recursive: true });

const referencePackVersions = (await readdir(frameworkReferencePackRoot)).sort(
  (left, right) => left.localeCompare(right, undefined, { numeric: true }),
);
const frameworkReferenceSource = resolve(
  frameworkReferencePackRoot,
  referencePackVersions.at(-1) ?? "",
  "ref/net9.0",
);
const referenceAssemblies = (
  await readdir(frameworkReferenceSource, { withFileTypes: true })
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".dll"))
  .map((entry) => entry.name)
  .sort();

for (const name of referenceAssemblies) {
  await cp(
    resolve(frameworkReferenceSource, name),
    resolve(referenceTarget, name),
  );
}

const extraReferenceAssemblies = [
  {
    name: "FSharp.Core.dll",
    path: await resolvePackageCompileAssembly("FSharp.Core", "FSharp.Core.dll"),
  },
  {
    name: "WasmDotnet.Compiler.dll",
    path: resolve(buildSource, "WasmDotnet.Compiler.dll"),
  },
];
for (const { name, path } of extraReferenceAssemblies) {
  await cp(path, resolve(referenceTarget, name));
  if (!referenceAssemblies.includes(name)) {
    referenceAssemblies.push(name);
  }
}
referenceAssemblies.sort();
await writeFile(
  resolve(referenceTarget, "manifest.json"),
  `${JSON.stringify({ assemblies: referenceAssemblies }, null, 2)}\n`,
);
console.log(
  `Copied browser-wasm runtime from ${runtimeSource} to ${runtimeTarget}`,
);
console.log(
  `Copied ${referenceAssemblies.length} reference assemblies to ${referenceTarget}`,
);
