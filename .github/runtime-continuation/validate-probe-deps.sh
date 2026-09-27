set -euo pipefail
transform="$GITHUB_WORKSPACE/.github/runtime-continuation/use-declared-bundler.py"
mkdir -p /tmp/test-tools
printf '{"private":true,"type":"module"}' > /tmp/test-tools/package.json
(cd /tmp/test-tools && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund typescript@5.9.3 vitest@4.1.4 vite@8.0.8 @types/node@24.12.4 @bjorn3/browser_wasi_shim@0.4.2 playwright-core@1.59.1)
git fetch --depth=1 origin "$BASE"
git worktree add --detach /tmp/change "$BASE"
cd /tmp/change
if [ "$LANGUAGE" = ruby ]; then
    git sparse-checkout set src packages/core scripts static/wasm-ruby
    probe=scripts/probe-ruby-prepared-worker.mjs
else
    git sparse-checkout set src packages/core scripts producers/wasm-php static/wasm-php
    probe=scripts/probe-php-startup-retry.mjs
fi
python3 "$transform"
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
fi
node --check "$probe"
node "$probe"
test "$(git diff --name-only)" = "$probe"
git diff --check
git add "$probe"
git -c user.name='wasm-idle automation' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -m "test($LANGUAGE): build browser probes with the declared Vite dependency"
git push origin "HEAD:refs/heads/$BRANCH"
git rev-parse HEAD | tee /tmp/published-head.txt
