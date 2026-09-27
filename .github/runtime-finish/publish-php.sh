set -euo pipefail
helper="$GITHUB_WORKSPACE/.github/runtime-finish"
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-finish/php.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='f98ba1331ba7d0fb49bf7a9e54b2fd91d1901e9c943abca8759ce89e7366ad7a'
Path('/tmp/php.patch').write_bytes(gzip.decompress(b))
PY
base=1b963d396b6587391a48688a577dd0ffa883727c
git fetch --depth=1 origin "$base"
git worktree add --detach /tmp/change "$base"
cd /tmp/change
git sparse-checkout set producers/wasm-php scripts src packages/core packages/lsp static/wasm-php
git apply /tmp/php.patch
git apply "$helper/php-review-fixes.patch"
cat >> producers/wasm-php/README.md <<'MD'

## Startup and isolation

`createPhp84()` automatically selects JSPI when supported, otherwise Asyncify. An explicit
`createPhp84({ asyncMode: 'asyncify' })` or `createPhp84({ asyncMode: 'jspi' })` selects a profile;
unsupported JSPI fails before requesting engine assets. Only the selected engine's large loader
and Wasm are fetched, in parallel. Build-pinned byte lengths and SHA-256 receipts are checked
before a compiled module can be instantiated. Loading failures are retryable and preparation
is bounded by a timeout.

The module keeps at most the two engines' immutable compiled code in its own realm. Each factory
call still creates a new PHP VM, memory and filesystem. This is not a cross-tab or persistent
cache and does not remove extensions from the distribution. To exercise both actual engines in
Chromium, run `node scripts/probe-wasm-php-startup.mjs producers/wasm-php/dist` from the repository
root after building; the probe also checks the parallel fetch dependency and VM isolation.
MD
mkdir -p /tmp/test-tools /tmp/producer-tools .svelte-kit
printf '{"private":true,"type":"module"}' > /tmp/test-tools/package.json
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node --input-type=module -e "import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('producers/wasm-php/package.json'));fs.writeFileSync('/tmp/producer-tools/package.json',JSON.stringify({private:true,type:'module',dependencies:{...p.dependencies,...p.devDependencies}}));"
cd /tmp/test-tools
npm install --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @playwright/test@1.59.1
cd /tmp/producer-tools
npm install --ignore-scripts --no-audit --no-fund
ln -s /tmp/test-tools/node_modules /tmp/change/node_modules
ln -s /tmp/producer-tools/node_modules /tmp/change/producers/wasm-php/node_modules
cd /tmp/change
node /tmp/test-tools/node_modules/typescript/bin/tsc --noEmit -p producers/wasm-php/tsconfig.json
node /tmp/test-tools/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/lib/wasm-php-startup.test.ts
printf 'export const env = {};' > /tmp/php-empty-env.mjs
printf 'globalThis.window={location:new URL("http://localhost:3000/")}; globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/php-test-setup.mjs
cat > /tmp/php-config.mjs <<'JS'
export default {resolve:{alias:{'$lib':'/tmp/change/src/lib','@wasm-idle/core':'/tmp/change/packages/core/src/index.ts','$env/dynamic/public':'/tmp/php-empty-env.mjs'}},test:{environment:'node',include:['src/lib/wasm-php-startup.test.ts','src/lib/wasm-php-producer.test.ts','src/lib/playground/php*.test.ts','src/lib/playground/worker/php*.test.ts','src/lib/sync-wasm-php.test.ts'],setupFiles:['/tmp/php-test-setup.mjs']}};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/php-config.mjs --reporter=verbose
node producers/wasm-php/scripts/build.mjs
node producers/wasm-php/scripts/verify.mjs
node scripts/probe-wasm-php-startup.mjs producers/wasm-php/dist
# Read only the other manifests needed for the existing shared cache-key contract.
for directory in wasm-assemblyscript wasm-bash/sdk wasm-duckdb wasm-sqlite; do
  mkdir -p "static/$directory"
  git show "$base:static/$directory/runtime-manifest.v1.json" > "static/$directory/runtime-manifest.v1.json"
done
node "$helper/publish-php-assets.mjs"
cat > /tmp/php-static-config.mjs <<'JS'
export default {test:{environment:'node',include:['src/lib/playground/static-runtime-assets.test.ts']}};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/php-static-config.mjs --testNamePattern 'synchronized with every manifest|checked-in PHP output' --reporter=verbose
git diff --check
# Publish only the feature, never the temporary helper workflow/patch transport.
git add producers/wasm-php/README.md producers/wasm-php/src producers/wasm-php/scripts/build.mjs producers/wasm-php/scripts/engine-assets.mjs scripts/probe-wasm-php-startup.mjs src/lib/wasm-php-startup.test.ts static/wasm-php static/compressed-runtime-assets.v1.json src/lib/playground/staticRuntimeModuleVersion.ts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(php): prepare and reuse the verified selected engine in parallel'
git push origin HEAD:refs/heads/perf/php-parallel-verified-startup
git show --stat --oneline HEAD
