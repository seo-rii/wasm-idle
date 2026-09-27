set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-followup/dotnet.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='83f852b6db4288312c4d47163a2122a5238037555fbb4e75c3de15301c7d54da'
Path('/tmp/dotnet.patch').write_bytes(gzip.decompress(b))
PY
git fetch --depth=1 origin 8286647cd88275d5fb3a0dfbddd63f542771cedb
git worktree add --detach /tmp/change 8286647cd88275d5fb3a0dfbddd63f542771cedb
cd /tmp/change
git sparse-checkout set runtimes/wasm-dotnet scripts src/lib static/wasm-dotnet
git apply /tmp/dotnet.patch
# Match the existing 9.0.16 runtime instead of silently choosing the runner's .NET 10 SDK.
printf '{"sdk":{"version":"9.0.314","rollForward":"disable"}}' > global.json
dotnet --version
dotnet workload install wasm-tools --skip-manifest-update
npm install --prefix /tmp/tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4
ln -s /tmp/tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
python3 - <<'PY'
from pathlib import Path
p=Path('runtimes/wasm-dotnet/scripts/build-runtime.mjs');s=p.read_text()
s=s.replace("const referencePackVersions = (await readdir(frameworkReferencePackRoot)).sort((left, right) =>", "const referencePackVersions = (await readdir(frameworkReferencePackRoot)).filter(version => version.startsWith('9.0.') && (!process.env.DOTNET_REFERENCE_PACK_VERSION || version === process.env.DOTNET_REFERENCE_PACK_VERSION)).sort((left, right) =>")
p.write_text(s)
PY
cd runtimes/wasm-dotnet
node /tmp/tools/node_modules/vitest/vitest.mjs run --reporter=verbose
node scripts/clean-module-output.mjs
node /tmp/tools/node_modules/typescript/bin/tsc -p tsconfig.build.json
refs="$DOTNET_ROOT/packs/Microsoft.NETCore.App.Ref/9.0.16/ref/net9.0"
for lang in csharp fsharp vbnet; do
  rm -rf dotnet/ReferenceTests/bin dotnet/ReferenceTests/obj
  dotnet run --project dotnet/ReferenceTests/ReferenceTests.csproj -c Release -p:WasmDotnetLanguage="$lang" -- "$refs"
done
DOTNET=$(command -v dotnet) DOTNET_REFERENCE_PACK_VERSION=9.0.16 node scripts/build-runtime.mjs
# Preserve complete managed output for browser smoke tests and publishing.
tar -czf /tmp/dotnet-registered-runtime.tar.gz dist
cd /tmp/change
git diff --binary > /tmp/dotnet-followup-tracked.patch
