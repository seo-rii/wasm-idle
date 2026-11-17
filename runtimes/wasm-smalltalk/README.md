# Amber Smalltalk browser producer

`python3 runtimes/wasm-smalltalk/build.py` verifies both vendored npm archive
sizes and SHA-256 hashes before reading them. It emits original AMD source strings
as `amber-modules.json.gz.bin`, the original `require.js`, and both original MIT notices.
It never rewrites or translates Smalltalk or Amber compiler code. Browser/Node/DOM
platform packages and test/development runners are omitted from this text profile;
the complete production compiler, importer and kernel modules are retained.

`node scripts/sync-wasm-smalltalk.mjs` invokes that offline producer, embeds only
host I/O and asset pins in `runner-worker.js`, and emits `runtime-build.json` and
the frontend receipt module. `--check` verifies all outputs without mutation.
The manifest identifies the original implementation and loader, each archive,
the generated engine payloads, and all producer/host source inputs. The global
runtime lock additionally pins every delivered executable and manifest.

Amber is `@ambers/lang` 0.32.0, MIT, from the official registry archive recorded
in `upstream.json`; corresponding Smalltalk and generated JavaScript sources are
included in that archive. RequireJS is 2.3.8, MIT. Its registry archive contains
the loader and original license pointer; the complete notice is retained from
the exact upstream 2.3.8 tag with its own hash. These are original dependencies,
not new npm install requirements. No network is needed to regenerate the runtime.

The Worker evaluates unchanged AMD JavaScript through the original RequireJS
dependency resolver. Its transport reads only verified, pinned module strings.
It invokes Amber `Importer>>import:` on whole source files. The only application
additions are `Stdin`, `Stdout`, `Stderr`, `Arguments`, and read-only `Files`
globals implemented with the upstream `JSObjectProxy`. See `docs/smalltalk.md`
for their exact contract and JavaScript-heap limitations.

The module source map is delivered as deterministic gzip with both compressed and
uncompressed sizes and SHA-256 receipts. The bounded preflight decodes and verifies
it before loading the compiler; it works without a service worker.
