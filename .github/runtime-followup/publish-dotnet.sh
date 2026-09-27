set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-followup/dotnet.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='83f852b6db4288312c4d47163a2122a5238037555fbb4e75c3de15301c7d54da'
Path('/tmp/dotnet.patch').write_bytes(gzip.decompress(b))
PY
npm install --prefix /tmp/tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 playwright-core@1.59.1
git fetch --depth=1 origin 8286647cd88275d5fb3a0dfbddd63f542771cedb
git worktree add --detach /tmp/change 8286647cd88275d5fb3a0dfbddd63f542771cedb
cd /tmp/change
git sparse-checkout set runtimes/wasm-dotnet scripts src/lib packages/core static/wasm-dotnet
git apply /tmp/dotnet.patch
ln -s /tmp/tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
python3 - <<'PY'
from pathlib import Path
p=Path('runtimes/wasm-dotnet/scripts/build-runtime.mjs');s=p.read_text()
old='const referencePackVersions = (await readdir(frameworkReferencePackRoot)).sort((left, right) =>'
new="const referencePackVersions = (await readdir(frameworkReferencePackRoot)).filter(version => version.startsWith('9.0.') && (!process.env.DOTNET_REFERENCE_PACK_VERSION || version === process.env.DOTNET_REFERENCE_PACK_VERSION)).sort((left, right) =>"
assert old in s;p.write_text(s.replace(old,new))
PY
cd runtimes/wasm-dotnet
tar -xzf /tmp/built-runtime/dotnet-registered-runtime.tar.gz
node /tmp/tools/node_modules/vitest/vitest.mjs run --reporter=verbose
node /tmp/tools/node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit
cp "$GITHUB_WORKSPACE/.github/runtime-followup/probe-dotnet.mjs" scripts/probe-reference-runtime.mjs
node scripts/probe-reference-runtime.mjs dist
cd /tmp/change
node --input-type=module <<'JS'
import {readFile,writeFile,mkdir,cp,rm}from'node:fs/promises';
import{syncWasmDotnetDist}from'./scripts/sync-wasm-dotnet.mjs';
import{compressStaticRuntimeAssets}from'./scripts/compress-static-runtime-assets.mjs';
import{buildLayeredRuntimeAssets}from'./scripts/build-layered-runtime-assets.mjs';
const rootDir='/tmp/dotnet-static';await mkdir(rootDir,{recursive:true});
await syncWasmDotnetDist({sourceDir:'runtimes/wasm-dotnet/dist',targetDir:rootDir+'/wasm-dotnet'});
await compressStaticRuntimeAssets({rootDir});await buildLayeredRuntimeAssets({rootDir});
const prefix='wasm-dotnet/';
for(const name of ['compressed-runtime-assets.v1.json','layered-runtime-assets.v1.json']){
 const old=JSON.parse(await readFile('static/'+name,'utf8'));const next=JSON.parse(await readFile(rootDir+'/'+name,'utf8'));
 for(const[key,value]of Object.entries(next)){
  if(Array.isArray(value))old[key]=[...old[key].filter(p=>!p.startsWith(prefix)),...value.filter(p=>p.startsWith(prefix))].sort();
  else if(value&&typeof value==='object'){
   const before=old[key];old[key]=Object.fromEntries([...Object.entries(before).filter(([p])=>!p.startsWith(prefix)),...Object.entries(value).filter(([p])=>p.startsWith(prefix))].sort(([a],[b])=>a<b?-1:a>b?1:0));
   for(const[p,v]of Object.entries(before))if(!p.startsWith(prefix)&&JSON.stringify(old[key][p])!==JSON.stringify(v))throw Error('Unrelated manifest modified');
  }else if(old[key]!==value)throw Error('Manifest schema mismatch: '+key);
 }
 await writeFile('static/'+name,JSON.stringify(old,null,2)+'\n');
}
await rm('static/wasm-dotnet',{recursive:true,force:true});await cp(rootDir+'/wasm-dotnet','static/wasm-dotnet',{recursive:true});
JS
git diff --check
git add runtimes/wasm-dotnet/src runtimes/wasm-dotnet/dotnet/WasmDotnet.Compiler/Program.cs runtimes/wasm-dotnet/dotnet/ReferenceTests runtimes/wasm-dotnet/test/reference-sets.test.ts runtimes/wasm-dotnet/scripts/build-runtime.mjs runtimes/wasm-dotnet/scripts/probe-reference-runtime.mjs src/lib/playground/wasmDotnetVersion.ts static/wasm-dotnet static/compressed-runtime-assets.v1.json static/layered-runtime-assets.v1.json
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(dotnet): register reference assemblies once per compiler runtime'
git push origin HEAD:refs/heads/perf/dotnet-reference-sets
git show --stat --oneline HEAD
