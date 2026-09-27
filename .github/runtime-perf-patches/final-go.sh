set -euo pipefail
npm install --prefix /tmp/test-tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @bjorn3/browser_wasi_shim@0.4.2 wabt@1.0.39
git fetch --depth=60 origin 4ee5d3ad5b685d8acd11fcaf545c5d533118119c e2a6d756d7ac6fce28c5231dcf48b5a636754ab8 0d6d72a36da2a38ef6ea98d2c0fb2a03535469ef
git worktree add --detach /tmp/change e2a6d756d7ac6fce28c5231dcf48b5a636754ab8
cd /tmp/change
git config user.name 'wasm-idle automation'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git sparse-checkout set runtimes/wasm-go scripts src/lib/playground static/wasm-go
if ! git merge --no-commit --no-ff 4ee5d3ad5b685d8acd11fcaf545c5d533118119c; then
  git diff --name-only --diff-filter=U
  git diff --cc
  exit 1
fi
# The base PR moved its controlled startup suite out of production src.
python3 - <<'PY'
from pathlib import Path
for p in Path('runtimes/wasm-go/test').glob('*.test.ts'):
    s=p.read_text(); t=s.replace("new URL('./tool-module.ts', import.meta.url)","new URL('../src/tool-module.ts', import.meta.url)")
    if s!=t:p.write_text(t)
PY
ln -s /tmp/test-tools/node_modules node_modules
ln -s /tmp/test-tools/node_modules runtimes/wasm-go/node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
build_validate() {
  cd /tmp/change/runtimes/wasm-go
  node /tmp/test-tools/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
  node /tmp/test-tools/node_modules/vitest/vitest.mjs run --reporter=verbose
  rm -rf dist
  node /tmp/test-tools/node_modules/typescript/bin/tsc -p tsconfig.build.json
  node scripts/finalize-browser-bundle.mjs
  cp -a /tmp/change/static/wasm-go/runtime dist/runtime
  node scripts/probe-runtime.mjs
  cd /tmp/change
  node scripts/sync-wasm-go.mjs
  test -z "$(git diff --name-only HEAD -- static/wasm-go/runtime)"
  git diff --check
}
build_validate
git add runtimes/wasm-go static/wasm-go src/lib/playground/wasmGoVersion.ts
git commit -m 'Merge current Go startup baseline and regenerate module-cache distribution'
git push origin HEAD:refs/heads/perf/go-content-addressed-module-cache
cache_head=$(git rev-parse HEAD)
git show --stat --oneline HEAD
git checkout --detach 0d6d72a36da2a38ef6ea98d2c0fb2a03535469ef
if ! git merge --no-commit --no-ff "$cache_head"; then
  git diff --name-only --diff-filter=U
  git diff --cc
  exit 1
fi
build_validate
git add runtimes/wasm-go static/wasm-go src/lib/playground/wasmGoVersion.ts
git commit -m 'Stack concurrent preloading on verified Go module caching and rebuild distribution'
git push origin HEAD:refs/heads/perf/go-parallel-preload
git show --stat --oneline HEAD
