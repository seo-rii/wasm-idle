set -euo pipefail
base=b45847d10f059463aa313dd61a7c12f4abec19bd
main=1b963d396b6587391a48688a577dd0ffa883727c
head=3abecc50d260ceadd00e9626323b5cca5b7b93a1
git fetch --depth=1 origin "$base" "$main" "$head"
git worktree add --detach /tmp/ruby-integrated "$main"
cd /tmp/ruby-integrated
git sparse-checkout set src/lib packages/core scripts static/wasm-ruby
# Apply only the reviewed Ruby delta onto current main. No old unrelated trees are restored.
git diff --binary "$base" "$head" > /tmp/ruby-only.patch
if ! git apply --3way /tmp/ruby-only.patch; then
  git diff --cc
  python3 - <<'PY'
import subprocess
from pathlib import Path
paths=subprocess.check_output(['git','diff','--name-only','--diff-filter=U']).decode().splitlines()
assert paths==['README.md'], 'Unexpected integration conflicts: '+str(paths)
base=subprocess.check_output(['git','show','b45847d10f059463aa313dd61a7c12f4abec19bd:README.md'])
ruby=subprocess.check_output(['git','show','3abecc50d260ceadd00e9626323b5cca5b7b93a1:README.md'])
main=subprocess.check_output(['git','show','1b963d396b6587391a48688a577dd0ffa883727c:README.md'])
assert ruby.startswith(base) and main.startswith(base), 'Documentation changes are not append-only'
Path('README.md').write_bytes(main+ruby[len(base):])
PY
  git add README.md
fi
test -z "$(git diff --name-only --diff-filter=U)"
mkdir -p /tmp/test-tools
printf '{"private":true,"type":"module"}' > /tmp/test-tools/package.json
(cd /tmp/test-tools && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 @types/node@24.12.4 @ruby/3.4-wasm-wasi@2.9.3-2.9.4 @ruby/wasm-wasi@2.9.3-2.9.4 @bjorn3/browser_wasi_shim@0.4.2 vite@8.0.8 esbuild@0.28.0)
ln -s /tmp/test-tools/node_modules node_modules
mkdir -p .svelte-kit
printf '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}' > .svelte-kit/tsconfig.json
node scripts/sync-wasm-ruby-split.mjs --verify
node /tmp/test-tools/node_modules/typescript/bin/tsc -p packages/core/tsconfig.json --noEmit
printf 'export const env={};' > /tmp/empty-env.mjs
printf 'globalThis.window={location:new URL("http://localhost:3000/")};globalThis.history={replaceState(_a,_b,url){window.location=new URL(url,window.location);}};' > /tmp/setup.mjs
cat > /tmp/config.mjs <<'JS'
export default {resolve:{alias:{'@wasm-idle/core':'/tmp/ruby-integrated/packages/core/src/index.ts','$lib':'/tmp/ruby-integrated/src/lib','$env/dynamic/public':'/tmp/empty-env.mjs'}},test:{environment:'node',include:['src/lib/core-ruby-split.test.ts','src/lib/core-ruby-runtime.test.ts','src/lib/playground/ruby*.test.ts','src/lib/playground/worker/ruby*.test.ts','src/lib/*prewarm*.test.ts'],testTimeout:20000,exclude:['**/*.playwright.test.ts'],setupFiles:['/tmp/setup.mjs']}};
JS
node /tmp/test-tools/node_modules/vitest/vitest.mjs run --config /tmp/config.mjs --reporter=verbose
git diff --check
git diff --cached --check
# The staged tree is main plus the Ruby change. The new commit is a fast-forward of the PR branch.
tree=$(git write-tree)
commit=$(printf 'Merge current main prewarm policy while preserving the Ruby split runtime\n' | git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit-tree "$tree" -p "$head" -p "$main")
git push origin "$commit:refs/heads/perf/ruby-split-stdlib"
git show --stat --oneline "$commit"
