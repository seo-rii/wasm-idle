set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-followup/rust.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='771a4d7c165ef042805994c0eae0e28bf6f2824230993c02601d73dbf54bec0a'
Path('/tmp/rust.patch').write_bytes(gzip.decompress(b))
PY
npm install --prefix /tmp/tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @bjorn3/browser_wasi_shim@0.4.2 wabt@1.0.39
git fetch --depth=1 origin 15d609cf3642a9cd7bd8ff42465468f01a40e629
git worktree add --detach /tmp/change 15d609cf3642a9cd7bd8ff42465468f01a40e629
cd /tmp/change
git sparse-checkout set runtimes/wasm-rust scripts src/lib static/wasm-rust static/shared/emscripten-lld
git apply /tmp/rust.patch
ln -s /tmp/tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node "$GITHUB_WORKSPACE/.github/runtime-followup/rust-graph.mjs"
cd runtimes/wasm-rust
node /tmp/tools/node_modules/vitest/vitest.mjs run test/rustc-module-service.test.ts test/rustc-module.test.ts test/compiler-worker.test.ts test/runtime-pack.test.ts test/runtime-manifest-edge.test.ts test/ci-script-contract.test.ts --reporter=verbose
node /tmp/tools/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/rustc-module-service.ts
cd /tmp/change
printf 'export default {test:{environment:"node",include:["src/lib/sync-wasm-rust.test.ts"]}};' > /tmp/rust-sync-config.mjs
node /tmp/tools/node_modules/vitest/vitest.mjs run --config /tmp/rust-sync-config.mjs --reporter=verbose
test -z "$(git diff --name-only -- static/shared)"
git diff --check
git add runtimes/wasm-rust/src/compiler.ts runtimes/wasm-rust/src/compiler-worker.ts runtimes/wasm-rust/src/rustc-module-service.ts runtimes/wasm-rust/src/worker-protocol.ts runtimes/wasm-rust/test/rustc-module-service.test.ts runtimes/wasm-rust/package.json scripts/wasm-rust-assets.lock.json static/wasm-rust/compiler.js.bin static/wasm-rust/compiler-worker.js.bin static/wasm-rust/rustc-module-service.js.bin static/wasm-rust/runtime-executable-graph.v1.json src/lib/playground/wasmRustVersion.ts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(rust): reuse verified compiler modules across isolated workers'
git push origin HEAD:refs/heads/perf/rust-compiler-module-reuse
git show --stat --oneline HEAD
