#!/usr/bin/env bash
set -euo pipefail

variant=${1:?expected mvp or eh}
case "$variant" in mvp|eh) ;; *) exit 2 ;; esac
upstream=$(realpath "${2:?expected a DuckDB-Wasm checkout}")
out=$(realpath -m "${3:?expected an output directory}")
recipe=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
duckdb_wasm_commit=ef8a4f8912b6e7f62bc0cc490145ebd391b79e1f
duckdb_commit=08e34c447bae34eaee3723cac61f2878b6bdf787
arrow_commit=6a2e19a852b367c72d7b12da4d104456491ed8b7
patch_commit=152e878a2e79877ec461f96cefc97663f0bc581f
patch_hash=a10f7fbfaf1d354a4195ed29e80c303f6cc1146500408007ef92fc5dfefaf39b

test "$(git -C "$upstream" rev-parse HEAD)" = "$duckdb_wasm_commit"
test "$(git -C "$upstream/submodules/duckdb" rev-parse HEAD)" = "$duckdb_commit"
test "$(git -C "$upstream/submodules/arrow" rev-parse HEAD)" = "$arrow_commit"
echo "$patch_hash  $recipe/apache-arrow-44715.patch" | sha256sum --check
emcc --version | grep -F ' 3.1.71'
mkdir -p "$out"

# Release builds get the database version from git describe. Shallow submodules
# do not always have the tag even when the checked-out commit is that release.
git -C "$upstream/submodules/duckdb" fetch --depth=1 origin refs/tags/v1.5.4:refs/tags/v1.5.4
test "$(git -C "$upstream/submodules/duckdb" rev-parse 'v1.5.4^{commit}')" = "$duckdb_commit"
cd "$upstream"
make apply_patches
git -C submodules/arrow apply --check "$recipe/apache-arrow-44715.patch"
git -C submodules/arrow apply "$recipe/apache-arrow-44715.patch"

# Upstream publishes these loadable relsize builds to npm. Each matrix job
# owns a fresh checkout because the Arrow build edits its source tree.
export GEN=ninja USE_GENERATED_EXPORTED_LIST=no DUCKDB_WASM_LOADABLE_EXTENSIONS=1
export DUCKDB_PLATFORM="wasm_$variant"
./scripts/wasm_build_lib.sh relsize "$variant"
cp "packages/duckdb-wasm/src/bindings/duckdb-$variant."{js,wasm} "$out/"

# Use the upstream yarn.lock for the worker's runtime dependencies and esbuild.
# Building this one target does not require the shell, benchmarks or COI glue.
package=packages/duckdb-wasm/package.json
deps=$(mktemp -d)
trap 'rm -rf "$deps"' EXIT
cp yarn.lock "$deps/yarn.lock"
node - "$package" "$deps/package.json" <<'JS'
const fs = require('node:fs');
const [source, dest] = process.argv.slice(2);
const { dependencies, devDependencies } = JSON.parse(fs.readFileSync(source));
fs.writeFileSync(dest, JSON.stringify({
    private: true,
    dependencies: {
        ...dependencies,
        esbuild: devDependencies.esbuild,
        'js-sha256': devDependencies['js-sha256'],
        // The published Emscripten glue resolves this upstream hoisted dependency.
        ws: '^7.3.1'
    }
}));
JS
yarn --cwd "$deps" install --frozen-lockfile --non-interactive --modules-folder "$upstream/node_modules"
node "$recipe/bundle-worker.mjs" "$upstream" "$variant" "$out"

# Keep the inputs with each independently downloadable variant. The checksum
# list also covers the glue and source map so that consumers can verify pairs.
python3 - "$out" "$variant" "$duckdb_wasm_commit" "$duckdb_commit" "$arrow_commit" "$patch_commit" "$patch_hash" <<'PY'
import json
import sys
from pathlib import Path

out, variant, wasm, duckdb, arrow, patch, digest = sys.argv[1:]
record = {
    'schemaVersion': 1, 'variant': variant, 'packageVersion': '1.33.1-dev57.0',
    'duckdbWasmCommit': wasm, 'duckdbCommit': duckdb, 'arrowCommit': arrow,
    'arrowPatchCommit': patch, 'arrowPatchSha256': digest, 'emscriptenVersion': '3.1.71'
}
(Path(out) / 'provenance.json').write_text(json.dumps(record, indent=2) + '\n')
PY
cd "$out"
sha256sum "duckdb-$variant.wasm" "duckdb-$variant.js" "duckdb-browser-$variant.worker.js" \
    "duckdb-browser-$variant.worker.js.map" provenance.json > SHA256SUMS
sha256sum --check SHA256SUMS
