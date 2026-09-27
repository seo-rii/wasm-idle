set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-followup/php.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='4578fb7cad27451a2d0aae6e7f14bfb26243bb6fea9d3baefd999bc788995c83', 'Patch transport checksum mismatch'
Path('/tmp/php.patch').write_bytes(gzip.decompress(b))
PY
mkdir -p /tmp/test-tools
printf '{"private":true,"type":"module"}' > /tmp/test-tools/package.json
(cd /tmp/test-tools && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @bjorn3/browser_wasi_shim@0.4.2 playwright-core@1.59.1 pnpm@10.30.0)
git fetch --depth=1 origin 1b963d396b6587391a48688a577dd0ffa883727c
git worktree add --detach /tmp/php-change 1b963d396b6587391a48688a577dd0ffa883727c
cd /tmp/php-change
git sparse-checkout set src packages/core scripts producers/wasm-php static/wasm-php
git apply /tmp/php.patch
ln -s /tmp/test-tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node /tmp/test-tools/node_modules/pnpm/bin/pnpm.cjs --dir producers/wasm-php install --frozen-lockfile
cd producers/wasm-php
node scripts/build.mjs
node scripts/verify.mjs
cd /tmp/php-change
node /tmp/test-tools/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM producers/wasm-php/src/startup-assets.d.ts producers/wasm-php/src/startup.ts producers/wasm-php/src/startup-loader.ts producers/wasm-php/src/startup-runtime-api.ts
printf 'export const env={};' > /tmp/empty-env.mjs
printf 'globalThis.window={location:new URL("http://localhost:3000/")};globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/php-setup.mjs
cat > /tmp/php-config.mjs <<'JS'
export default {resolve:{alias:{'@wasm-idle/core':'/tmp/php-change/packages/core/src/index.ts','$lib':'/tmp/php-change/src/lib','$env/dynamic/public':'/tmp/empty-env.mjs'}},test:{environment:'node',setupFiles:['/tmp/php-setup.mjs'],include:['src/lib/php-startup-loader.test.ts','src/lib/playground/php*.test.ts','src/lib/playground/worker/php.test.ts','src/lib/playground/applicationAssets.test.ts','src/lib/sync-wasm-php.test.ts']}};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/php-config.mjs --reporter=verbose
node producers/wasm-php/scripts/probe-startup.mjs producers/wasm-php/dist
# The aggregate asset version covers five manifests; recover the unchanged four.
for dir in wasm-assemblyscript wasm-bash/sdk wasm-duckdb wasm-sqlite; do
  mkdir -p "static/$dir"
  git show "1b963d396b6587391a48688a577dd0ffa883727c:static/$dir/runtime-manifest.v1.json" > "static/$dir/runtime-manifest.v1.json"
done
node --input-type=module <<'JS'
import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syncWasmPhpAssets,validatePhpRuntimeAssets} from './scripts/sync-wasm-php.mjs';
import {compressStaticRuntimeAssets} from './scripts/compress-static-runtime-assets.mjs';
const original=JSON.parse(await readFile('static/wasm-php/runtime-manifest.v1.json'));
const next=JSON.parse(await readFile('producers/wasm-php/dist/runtime-manifest.v1.json'));
for(const file of original.files.filter(f=>/\.(wasm|so)$/.test(f.path))){
 const found=next.files.find(f=>f.path===file.path);
 if(!found||found.bytes!==file.bytes||found.sha256!==file.sha256)throw Error('Unexpected PHP binary payload change: '+file.path);
}
const rootDir='/tmp/php-static';await mkdir(rootDir,{recursive:true});
await syncWasmPhpAssets({sourceDir:'producers/wasm-php/dist',targetDir:rootDir+'/wasm-php'});
await compressStaticRuntimeAssets({rootDir});
await validatePhpRuntimeAssets(rootDir+'/wasm-php',{allowCompressed:true});
const file='compressed-runtime-assets.v1.json',prefix='wasm-php/';
const old=JSON.parse(await readFile('static/'+file));const generated=JSON.parse(await readFile(rootDir+'/'+file));
for(const[key,value]of Object.entries(generated)){
 if(Array.isArray(value))old[key]=[...old[key].filter(p=>!p.startsWith(prefix)),...value.filter(p=>p.startsWith(prefix))].sort();
 else if(value&&typeof value==='object'){
  const previous=old[key];old[key]=Object.fromEntries([...Object.entries(previous).filter(([p])=>!p.startsWith(prefix)),...Object.entries(value).filter(([p])=>p.startsWith(prefix))].sort(([a],[b])=>a<b?-1:a>b?1:0));
  for(const[p,v]of Object.entries(previous))if(!p.startsWith(prefix)&&JSON.stringify(old[key][p])!==JSON.stringify(v))throw Error('Unrelated compressed manifest changed');
 }else if(old[key]!==value)throw Error('Manifest schema changed: '+key);
}
await writeFile('static/'+file,JSON.stringify(old,null,2)+'\n');
await rm('static/wasm-php',{recursive:true,force:true});await cp(rootDir+'/wasm-php','static/wasm-php',{recursive:true});
const hash=createHash('sha256');
for(const dir of ['wasm-assemblyscript','wasm-bash/sdk','wasm-duckdb','wasm-php','wasm-sqlite'].sort()){
 hash.update(dir);hash.update(await readFile('static/'+dir+'/runtime-manifest.v1.json'));
}
await writeFile('src/lib/playground/staticRuntimeModuleVersion.ts',`// Generated by scripts/build-static-runtime-modules.mjs.\nexport const STATIC_RUNTIME_MODULE_VERSION = '${hash.digest('hex').slice(0,16)}';\n`);
console.log('PHP bootstrap decoded bytes:', next.files.find(f=>f.path==='startup.mjs').bytes);
JS
node --input-type=module -e "import{validatePhpRuntimeAssets}from'./scripts/sync-wasm-php.mjs';await validatePhpRuntimeAssets('static/wasm-php',{allowCompressed:true});console.log('Published PHP manifest verified')"
git diff --check
git add producers/wasm-php/README.md producers/wasm-php/scripts/build.mjs producers/wasm-php/scripts/probe-startup.mjs producers/wasm-php/scripts/startup-assets.mjs producers/wasm-php/scripts/verify.mjs producers/wasm-php/src/startup.ts producers/wasm-php/src/startup-loader.ts producers/wasm-php/src/startup-runtime-api.ts src/lib/php-startup-loader.test.ts src/lib/playground/applicationAssets.ts src/lib/playground/applicationAssets.test.ts src/lib/playground/staticRuntimeModuleVersion.ts static/wasm-php static/compressed-runtime-assets.v1.json
git add -f producers/wasm-php/src/startup-assets.d.ts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(php): overlap verified Wasm startup with deferred JavaScript loaders'
git push origin HEAD:refs/heads/perf/php-verified-parallel-startup
git show --stat --oneline HEAD
