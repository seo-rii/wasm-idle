# PARI/GP

`PARIGP` (aliases `PARI/GP` and `GP`) runs the real PARI/GP 2.19.0 interpreter in a
fresh browser Worker for each execution. The playground sends unchanged source to
upstream GP's `gp_embedded` multiline reader and also mounts the source as
`main.gp` in the workspace. Use `print()` for script output and `input()` for a GP
expression from standard input. For example:

```gp
n = input();
print(sum(i = 1, n, i));
```

The adapter supports delayed terminal input, explicit buffered input, EOF,
workspace files, cancellation and the shared execution limits. `readstr("/dev/stdin")`
reads lines through EOF. As in upstream GP, `input()` expects a valid expression;
cancel the execution if its input closes before an expression is provided.
Paths are relative to `/workspace`; `read("lib/helpers.gp")` loads a workspace file. Definitions do
not persist between runs. GP displays the usual numbered history output for
expressions without a trailing semicolon. Script arguments are unavailable.
`input()` reads terminal input while evaluating the entry source; inside an
explicit `read("file.gp")`, native GP instead reads from that current input file.

The browser uses the official wasm32 build, with 32-bit machine words and PARI's
arbitrary-precision integers. At least 393 Wasm pages (25,755,648 bytes) are
required. The original module declares its own 2 GiB maximum; the Worker verifies
that exact declaration and lowers only its memory maximum to the requested
execution budget before instantiation. Its instructions and data remain
unchanged. PARI starts with a 4,000,000-byte calculation stack and can grow it
within the Wasm ceiling. Memory allocation errors are reported by the upstream runtime.

The initial scope is text-mode GP scripts. Browser plots, popup help, native
extensions, external commands, parallel workers and optional mathematical database
downloads are unavailable. Add data files explicitly to the workspace when an
algorithm requires them. Ordinary GP functions and error recovery use the original
interpreter; the host provides no replacement parser or mathematical engine.

Run `pnpm run sync:wasm-parigp` to fetch the pinned official JavaScript and Wasm.
`scripts/wasm-parigp-assets.lock.json` records their byte counts and SHA-256 hashes,
source release and license. The sync adds a small module factory around the
unchanged non-modular JavaScript, stores the Wasm as `gp.wasm.gz.bin`, and generates
the Worker and TypeScript receipt profile. Downloads and decoded Wasm are verified
again before execution. The bundle is ignored locally and reconstructed for page
builds and browser CI.

The official binaries do not publish an exact compiler revision or complete build
recipe; this provenance limitation is recorded in the lock. The corresponding
PARI/GP source release is available at the URL recorded there. PARI/GP is licensed
under GPL-2.0-or-later; its complete license is distributed as `COPYING`. The GPL
runtime remains a separate downloaded asset.

Validation:

```sh
pnpm run sync:wasm-parigp
pnpm run test:browser:parigp
```
