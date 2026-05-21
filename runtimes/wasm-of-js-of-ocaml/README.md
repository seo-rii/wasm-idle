# wasm-of-js-of-ocaml

Browser-native frozen OCaml toolchain for compiling OCaml source to JavaScript or WebAssembly assets with `ocamlc`, `js_of_ocaml`, and `wasm_of_ocaml`.

> Status: experimental bring-up. The current target is a controlled frozen browser toolchain, not a full local opam or dune environment.

## What This Project Does

`wasm-of-js-of-ocaml` packages a host-built OCaml bytecode toolchain so it can run inside a browser worker. It exposes one compile API that accepts OCaml source files and returns generated artifacts, diagnostics, stdout, and stderr.

Supported paths today:

- OCaml source to bytecode through browser-native `ocamlc`.
- Bytecode to JavaScript through browser-native `js_of_ocaml`.
- Bytecode to JavaScript loader plus `.wasm` assets through browser-native `wasm_of_ocaml`.
- Static local Binaryen browser assets for `wasm_of_ocaml`; no runtime `/api/binaryen-command` service is required.
- A compressed browser-native runtime pack for stdlib and supported package files.
- Limited package support, currently including `yojson` fixture coverage.

## Non-Goals

This repository intentionally does not try to recreate a full native development environment in the browser.

- No dynamic opam install in the browser.
- No full `dune build` compatibility yet.
- No arbitrary C stubs.
- No dynlink or toplevel support yet.
- No unrestricted subprocess or shell emulation.

## Quick Start

Requirements:

- Node.js 22 or newer.
- Linux host for the full toolchain bootstrap path.
- System packages used by CI: `build-essential`, `bubblewrap`, `git`, `libgmp-dev`, `m4`, `pkg-config`, `rsync`, and `unzip`.

Install dependencies:

```sh
npm ci
```

Bootstrap host tools and the frozen opam switch:

```sh
npm run bootstrap:host-tools
PATH="$PWD/.cache/binaryen-version_129/bin:$PATH" npm run toolchain:bootstrap
```

Build TypeScript output and prepare the browser-native bundle:

```sh
npm run build
npm run prepare:browser-native -- --force
```

Run the browser-native validation:

```sh
npm run test:browser-native-bundle
npx playwright install --with-deps chromium
npm run test:browser-native
```

Start the standalone harness:

```sh
npm run serve:browser-harness
```

Open the printed `http://127.0.0.1:4174` URL. The page compiles hello, wasm, package, and diagnostic fixtures inside the browser-native path.

## API Example

```ts
import {
	compile,
	createBrowserWorkerSystemDispatcher,
	fetchBrowserNativeManifest
} from 'wasm-of-js-of-ocaml';

const manifest = await fetchBrowserNativeManifest();
const result = await compile(
	{
		files: {
			'hello.ml': 'let () = print_endline "hello from OCaml"'
		},
		entry: 'hello.ml',
		target: 'wasm',
		wasmBinaryenMode: 'fast'
	},
	{
		system: createBrowserWorkerSystemDispatcher({ manifest }),
		toolchainRoot: '/static/toolchain'
	}
);

if (!result.success) {
	console.error(result.diagnostics, result.stderr);
}
```

`wasmBinaryenMode` controls the browser `wasm_of_ocaml` Binaryen bridge:

| Mode | Behavior | Use Case |
| --- | --- | --- |
| `fast` | Default. Runs the required static `wasm-merge` bridge and skips high-memory `wasm-metadce` / `wasm-opt` passes by copying the wasm through. | Browser stability and lower memory use. |
| `full` | Runs the static local `wasm-merge`, `wasm-metadce`, and `wasm-opt` browser assets. | Smaller optimized wasm output when memory headroom is available. |

## Repository Layout

```text
src/                 Public compile API and worker protocol
runtime/             In-memory filesystem and browser/native dispatchers
browser-harness/     Standalone browser-native validation page
fixtures/            Compile fixtures for hello, diagnostics, modules, packages
scripts/             Host bootstrap, bundle collection, and validation scripts
tests/               Node and Playwright validation
toolchain/           Frozen toolchain recipe and draft upstream patch notes
docs/                Runtime contract and implementation notes
```

## Documentation

- [Runtime contract](docs/runtime-contract.md)
- [Browser-native architecture](docs/browser-native.md)
- [Testing guide](docs/testing.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Current Limitations

- Browser-native compilation is memory intensive. The default wasm backend uses `wasmBinaryenMode: "fast"` to reduce peak memory.
- `effectsMode: "cps"` is the stable browser default. `jspi` remains an explicit advanced option.
- Source maps are intentionally disabled during early browser bring-up.
- Package support is recipe-based and limited to pre-bundled pure OCaml packages.
- The npm package is still marked `private` while the toolchain contract stabilizes.

## License

MIT. See [LICENSE](LICENSE).
