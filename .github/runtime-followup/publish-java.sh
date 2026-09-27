set -euo pipefail
python3 - <<'PY'
import gzip,hashlib
from pathlib import Path
b=Path('.github/runtime-followup/java.patch.gz').read_bytes()
assert hashlib.sha256(b).hexdigest()=='96e00b8940c7ddad289ab36456795e3501c6938f3ae9b3717e6ce5f91f9e8554'
Path('/tmp/java.patch').write_bytes(gzip.decompress(b))
PY
npm install --prefix /tmp/tools --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4
git fetch --depth=1 origin eabdde1ef21e9abcaee243716632b654c9748e70
git worktree add --detach /tmp/change eabdde1ef21e9abcaee243716632b654c9748e70
cd /tmp/change
git sparse-checkout set src/lib packages/core static/teavm
git apply /tmp/java.patch
ln -s /tmp/tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
cat > /tmp/java-config.mjs <<'JS'
export default {resolve:{alias:{'$lib':'/tmp/change/src/lib','@wasm-idle/core':'/tmp/change/packages/core/src/index.ts'}},test:{environment:'node',include:['src/lib/playground/worker/javaStreaming*.test.ts','src/lib/playground/worker/java.startup.test.ts']}};
JS
WASM_IDLE_RUN_REAL_JAVA_STREAMING=1 node /tmp/tools/node_modules/vitest/vitest.mjs run --config /tmp/java-config.mjs --reporter=verbose
node /tmp/tools/node_modules/typescript/bin/tsc -p packages/core/tsconfig.json --noEmit
git diff --check
git add src/lib/playground/java.ts src/lib/playground/worker/java.ts src/lib/playground/worker/javaStreaming.ts src/lib/playground/worker/javaStreaming.test.ts src/lib/playground/worker/javaStreaming.real.test.ts
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m 'perf(java): stream compiler preparation behind verified byte receipts'
git push origin HEAD:refs/heads/perf/java-verified-streaming
git show --stat --oneline HEAD
