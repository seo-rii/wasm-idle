set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=b''.join(Path(f'.github/runtime-followup/ruby.part{i}').read_bytes() for i in range(4))
assert hashlib.sha256(b).hexdigest()=='fa7156e2e94639061687b125eb5d5f7e1a3c4c9989208006b597be2972f88417'
Path('/tmp/ruby.patch').write_bytes(gzip.decompress(b))
PY
npm install --prefix /tmp/tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @ruby/3.4-wasm-wasi@2.9.3-2.9.4 @ruby/wasm-wasi@2.9.3-2.9.4 @bjorn3/browser_wasi_shim@0.4.2 vite@8.0.8 esbuild@0.28.0
git fetch --depth=1 origin b45847d10f059463aa313dd61a7c12f4abec19bd
git worktree add --detach /tmp/change b45847d10f059463aa313dd61a7c12f4abec19bd
cd /tmp/change
git sparse-checkout set src/lib packages/core scripts static/wasm-ruby
git apply /tmp/ruby.patch
ln -s /tmp/tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node scripts/sync-wasm-ruby-split.mjs
node scripts/sync-wasm-ruby-split.mjs --verify
node /tmp/tools/node_modules/typescript/bin/tsc -p packages/core/tsconfig.json --noEmit
printf 'export const env={};' > /tmp/empty-env.mjs
printf 'globalThis.window={location:new URL("http://localhost:3000/")};globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/setup.mjs
cat > /tmp/ruby-config.mjs <<'JS'
export default {resolve:{alias:{'@wasm-idle/core':'/tmp/change/packages/core/src/index.ts','$lib':'/tmp/change/src/lib','$env/dynamic/public':'/tmp/empty-env.mjs'}},test:{environment:'node',include:['src/lib/core-ruby-split.test.ts','src/lib/core-ruby-runtime.test.ts','src/lib/playground/ruby*.test.ts','src/lib/playground/worker/ruby*.test.ts'],testTimeout:20000,exclude:['**/*.playwright.test.ts'],setupFiles:['/tmp/setup.mjs']}};
JS
node /tmp/tools/node_modules/vitest/vitest.mjs run --config /tmp/ruby-config.mjs --reporter=verbose
# The existing embedded profile and its attested producer are not replaced.
test -z "$(git diff --name-only -- static/wasm-ruby/runtime.mjs.bin static/wasm-ruby/ruby.wasm.gz.bin static/wasm-ruby/runtime-manifest.v2.json scripts/sync-wasm-ruby.mjs scripts/wasm-ruby-assets.lock.json)"
git diff --check
git add README.md packages/core/src/index.ts packages/core/src/runtime-assets.ts packages/core/src/ruby-split.ts packages/core/src/ruby-split.generated.ts scripts/sync-runtime.mjs scripts/sync-wasm-ruby-split.mjs src/lib/core-ruby-split.test.ts src/lib/playground/applicationAssets.ts src/lib/playground/assets.ts src/lib/playground/ruby.ts src/lib/playground/rubyAssets.ts src/lib/playground/worker/ruby.ts src/lib/playground/worker/ruby-split.real.test.ts static/wasm-ruby/split
git add -f scripts/sync-wasm-ruby-split.d.mts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(ruby): split verified core Wasm from the complete standard library'
git push origin HEAD:refs/heads/perf/ruby-split-stdlib
git show --stat --oneline HEAD
