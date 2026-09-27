set -euo pipefail
npm install --prefix /tmp/test-tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 prettier@3.6.2 @bjorn3/browser_wasi_shim@0.4.2 wabt@1.0.39
script="$GITHUB_WORKSPACE/.github/runtime-perf-patches/final-rust.mjs"
git fetch --depth=3 origin 3481c7ba4f1decd02bdee46f4e65818e52cf8463
git worktree add --detach /tmp/change 3481c7ba4f1decd02bdee46f4e65818e52cf8463
cd /tmp/change
git sparse-checkout set runtimes/wasm-rust scripts src/lib static/wasm-rust static/shared/emscripten-lld
ln -s /tmp/test-tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node "$script"
test -z "$(git diff --name-only -- static/shared)"
# No Rust toolchain Wasm, sysroot or other binary payload may change here.
python3 - <<'PY'
import subprocess
names=subprocess.check_output(['git','diff','--name-only','--','static/wasm-rust']).decode().splitlines()
allowed={'static/wasm-rust/compiler-worker.js.bin','static/wasm-rust/runtime-executable-graph.v1.json'}
assert set(names)<=allowed, names
PY
cd runtimes/wasm-rust
node /tmp/test-tools/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/rustc-module.ts
node /tmp/test-tools/node_modules/vitest/vitest.mjs run test/rustc-module.test.ts test/compiler-worker.test.ts test/runtime-pack.test.ts test/runtime-manifest-edge.test.ts test/ci-script-contract.test.ts --reporter=verbose
cd /tmp/change
printf 'export default {test:{environment:"node",include:["src/lib/sync-wasm-rust.test.ts"]}};' > /tmp/rust-sync-config.mjs
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/rust-sync-config.mjs --reporter=verbose
git diff --check
git add runtimes/wasm-rust/package.json scripts/wasm-rust-assets.lock.json static/wasm-rust/compiler-worker.js.bin static/wasm-rust/rustc-module.js.bin static/wasm-rust/runtime-executable-graph.v1.json src/lib/playground/wasmRustVersion.ts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'build(rust): publish the optimized compiler wrapper with its verified graph'
git push origin HEAD:refs/heads/perf/rust-owned-wasm-view
git show --stat --oneline HEAD
