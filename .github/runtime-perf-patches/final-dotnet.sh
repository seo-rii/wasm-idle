set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-perf-patches/dotnet-prepare.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='91633e5ed0953ca1ce00049aef40806684bf14b496993fc46bc37cd6235cea96'
Path('/tmp/prepare.patch').write_bytes(gzip.decompress(b))
PY
npm install --prefix /tmp/test-tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4
git fetch --depth=1 origin 27a9131acbf5b01aecb208cfa0a860b5a85ba55a
git worktree add --detach /tmp/change 27a9131acbf5b01aecb208cfa0a860b5a85ba55a
cd /tmp/change
git sparse-checkout set runtimes/wasm-dotnet src packages/core scripts static/wasm-dotnet
git apply /tmp/prepare.patch
ln -s /tmp/test-tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
cd runtimes/wasm-dotnet
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --reporter=verbose
node scripts/clean-module-output.mjs
node /tmp/test-tools/node_modules/typescript/bin/tsc -p tsconfig.build.json
cd /tmp/change
cp -a static/wasm-dotnet/runtime /tmp/original-dotnet-runtime
cp -a static/wasm-dotnet/runtime runtimes/wasm-dotnet/dist/runtime
# Reuse the three genuine boot manifests from the published, checksummed layers.
python3 - <<'PY'
import gzip,hashlib,json
from pathlib import Path
m=json.loads(Path('static/layered-runtime-assets.v1.json').read_text())
for language in ['csharp','fsharp','vbnet']:
    key=f'wasm-dotnet/runtime/{language}/blazor.boot.json'
    entry=m['assets'][key]; layer=m['layers'][entry['layer']]
    raw=(Path('static')/entry['layer']).read_bytes()
    assert len(raw)==layer['compressedLength']
    assert hashlib.sha256(raw).hexdigest()==layer['sha256']
    decoded=gzip.decompress(raw)
    assert len(decoded)==layer['length']
    start=entry['offset']; end=start+entry['length']
    assert 0<=start<=end<=len(decoded)
    data=decoded[start:end]; json.loads(data)
    target=Path('runtimes/wasm-dotnet/dist')/key.removeprefix('wasm-dotnet/')
    target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
PY
node scripts/sync-wasm-dotnet.mjs
# Only the JS facade is being rebuilt. Preserve the original layered managed payload.
rm -rf static/wasm-dotnet/runtime
cp -a /tmp/original-dotnet-runtime static/wasm-dotnet/runtime
test -z "$(git diff --name-only -- static/wasm-dotnet/runtime)"
printf 'export const env={};' > /tmp/empty-env.mjs
printf 'globalThis.window={location:new URL("https://example.test/")}; globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/setup.mjs
cat > /tmp/config.mjs <<'JS'
export default {resolve:{alias:{'$lib':'/tmp/change/src/lib','@wasm-idle/core':'/tmp/change/packages/core/src/index.ts','$env/dynamic/public':'/tmp/empty-env.mjs'}},test:{environment:'node',include:['src/lib/playground/worker/dotnet-prepare.test.ts','src/lib/playground/dotnet.test.ts','src/lib/sync-wasm-dotnet.test.ts'],setupFiles:['/tmp/setup.mjs']}};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/config.mjs --reporter=verbose
git diff --check
git add runtimes/wasm-dotnet/src/compiler.ts runtimes/wasm-dotnet/src/index.ts runtimes/wasm-dotnet/src/types.ts runtimes/wasm-dotnet/test/prepare.test.ts src/lib/playground/dotnet.ts src/lib/playground/dotnet.test.ts src/lib/playground/worker/dotnet.ts src/lib/playground/worker/dotnet-prepare.test.ts src/lib/playground/wasmDotnetVersion.ts static/wasm-dotnet
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(dotnet): prepare the real compiler before acknowledging readiness'
git push origin HEAD:refs/heads/perf/dotnet-real-compiler-prepare
git show --stat --oneline HEAD
