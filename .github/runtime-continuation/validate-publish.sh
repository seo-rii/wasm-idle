set -euo pipefail
python3 - <<'PY'
import gzip, hashlib, os
from pathlib import Path
root=Path('.github/runtime-continuation')
if os.environ['LANGUAGE']=='php':
    files=[('php.patch.gz','0b5e4352cebcc02b5ad1f89120078babf2f12a643a0b97c64eaabd76739186f2')]
else:
    digests=['9af9306af99b412e45e3152ae0600442de87af93dcc1ecacb6f377c7c0e25f03','ab5ba0cbad33b4273a7e306ee398c38d2b808da8ffffa8e159c43f46c24600b7','093c49ed6f396d495e26da39e02a9cf8f9bc7d68e6e5b1eb16eaaf2e2ee9dcf5','bc483f30911199f1fb0fcae4fa0f9a10f87dabb2e5e2b5a4ecd32d5b5b5cf024','9645c5ff32147a22242b2a5932d007f987f6d052ae07853cd1d0eb15f0b9d814','82428564a99c74a62d6787a87c19e048d42c6db16a7f516482d28553f3da073f']
    files=[(f'ruby-{i}.patch.gz',h) for i,h in enumerate(digests)]
patch=b''
for name,digest in files:
    data=(root/name).read_bytes()
    assert hashlib.sha256(data).hexdigest()==digest, 'Patch transport checksum mismatch: '+name
    patch+=gzip.decompress(data)
Path('/tmp/runtime-change.patch').write_bytes(patch)
PY
mkdir -p /tmp/test-tools
printf '{"private":true,"type":"module"}' > /tmp/test-tools/package.json
(cd /tmp/test-tools && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 esbuild@0.27.3 @types/node@24.12.4 @bjorn3/browser_wasi_shim@0.4.2 playwright-core@1.59.1)
git fetch --depth=1 origin "$BASE"
git worktree add --detach /tmp/change "$BASE"
cd /tmp/change
if [ "$LANGUAGE" = ruby ]; then
    git sparse-checkout set src packages/core scripts static/wasm-ruby
else
    git sparse-checkout set src packages/core scripts producers/wasm-php static/wasm-php
fi
git apply /tmp/runtime-change.patch
ln -s /tmp/test-tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
printf 'export const env={};' > /tmp/empty-env.mjs
printf 'globalThis.window={location:new URL("http://localhost:3000/")};globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/setup.mjs
cat > /tmp/runtime-config.mjs <<'JS'
const ruby=process.env.LANGUAGE==='ruby';
export default {
 resolve:{alias:{'@wasm-idle/core':'/tmp/change/packages/core/src/index.ts','$lib':'/tmp/change/src/lib','$env/dynamic/public':'/tmp/empty-env.mjs'}},
 test:{environment:'node',include:ruby?['src/lib/playground/ruby*.test.ts','src/lib/playground/worker/ruby*.test.ts','src/lib/core-ruby*.test.ts','src/lib/*prewarm*.test.ts']:['src/lib/playground/php*.test.ts','src/lib/playground/worker/php*.test.ts','src/lib/php-startup-loader.test.ts'],exclude:['**/*.playwright.test.ts'],testTimeout:30000,setupFiles:['/tmp/setup.mjs']}
};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/runtime-config.mjs --reporter=verbose
if [ "$LANGUAGE" = ruby ]; then
    node /tmp/test-tools/node_modules/typescript/bin/tsc -p packages/core/tsconfig.json --noEmit
    node scripts/probe-ruby-prepared-worker.mjs
    git add src/lib/playground/ruby.ts src/lib/playground/ruby.test.ts src/lib/playground/worker/ruby.ts src/lib/playground/worker/ruby-preparation.test.ts src/lib/playground/worker/ruby-split.real.test.ts scripts/probe-ruby-prepared-worker.mjs
else
    node scripts/probe-php-startup-retry.mjs
    git add src/lib/playground/worker/php.ts src/lib/playground/worker/php-startup.test.ts scripts/probe-php-startup-retry.mjs
fi
# Only application worker code changes: no runtime payload or unrelated metadata regeneration.
test -z "$(git diff HEAD --name-only -- static)"
git diff --check
git diff --cached --check
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m "$MESSAGE"
git push origin "HEAD:refs/heads/$BRANCH"
git rev-parse HEAD | tee /tmp/published-head.txt
git show --stat --oneline HEAD
