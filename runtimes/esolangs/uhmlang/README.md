# 엄준식 언어 WASI interpreter

This runtime compiles the original [rycont/umjunsik-lang Go interpreter](https://github.com/rycont/umjunsik-lang/tree/e973f9d22b9803ee86b53d8e60f1b65ab08c7547/umjunsik-lang-go)
to WASI with Go **1.25.3**. The nine `.go` files, `go.mod`, and MIT `LICENSE`
are verbatim upstream files pinned to commit
`e973f9d22b9803ee86b53d8e60f1b65ab08c7547`. The language's lexer, parser,
AST, evaluator and command line run unchanged; no replacement parser or
instruction executor is used. There are no third-party Go module dependencies.

All original source and license URLs, sizes and SHA256 hashes are pinned in
`scripts/build-esolang-runtimes.mjs` and recorded in
`static/wasm-uhmlang/runtime-build.json`. The distribution's `LICENSE.txt`
contains both the interpreter's MIT license and the linked Go runtime/standard
library's BSD-3-Clause license. `GO-LICENSE` is the verbatim Go 1.25.3 license.

The playground mounts the active source file, normally `main.um`, and invokes
`argv = ["umjunsik", "/main.um"]`. Source is read from the filesystem and
program input remains on fd 0. Each run creates a new WebAssembly instance,
filesystem and upstream environment.

## Input and interpreter behavior

Source starts with `어떻게` and ends with `이 사람이름이냐ㅋㅋ`.
The upstream interpreter recognizes both newlines and `~` as line separators.
It implements variables, addition, multiplication, numeric and character output,
conditional execution, jumps, and the `화이팅!` exit instruction.

`식?` preserves the original `fmt.Scanln` behavior: provide **one integer per
input line**. Failed scans, including EOF, retain the initialized value zero;
the original evaluator ignores scan errors. Numeric input is signed decimal,
and the evaluator stores signed 64-bit integers. `식{value}!` prints the integer
without an added newline. `식{value}ㅋ` uses Go's `%c` conversion to output a
Unicode code point as UTF-8; `식ㅋ` outputs a newline. Character input is not
part of the original language, so text can be supplied as decimal code points
when a program wants to produce characters from input.

For example, this program reads and prints one integer:

```text
어떻게
엄식?
식어!
이 사람이름이냐ㅋㅋ
```

With stdin `42\n`, its output is `42`. Replacing `식어!` with `식어ㅋ` and
supplying `54620\n` prints `한`.

Original parse/evaluation behavior and diagnostics are preserved. Invalid or
truncated source can panic and exit with code 2; the adapter reports the exit
and does not reinterpret source. `화이팅!..` exits with code 2 deliberately.
The playground's existing execution timeout, output limit and cancellation
controls apply to this interpreter. Go's standard WASI imports are handled by
the existing browser WASI shim.

## Rebuild and verify

From the repository root, using Go 1.25.3:

```sh
GO_BINARY=/usr/local/go/bin/go TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language uhmlang --write

node scripts/build-esolang-runtimes.mjs --language uhmlang --check

GO_BINARY=/usr/local/go/bin/go TMPDIR=/data \
  node scripts/build-esolang-runtimes.mjs --language uhmlang
```

`GO_BINARY` defaults to `go` on PATH. The Go version must match exactly; this
runtime does not require wasi-sdk. `--write` updates the selected executable,
combined license, build receipt and shared interpreter profile. `--check`
verifies pins, artifact hashes, licensing and the profile without a compiler.
With neither flag, the script builds into a temporary directory and compares
the executable and receipt byte for byte. C-based interpreters continue to use
their existing wasi-sdk 33.0 toolchain.

The compiler runs in `runtimes/esolangs/uhmlang/vendor` with:

```sh
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 GOTOOLCHAIN=local GOENV=off \
  GOFLAGS= GOEXPERIMENT= \
  GOWORK=off GOPROXY=off GOSUMDB=off \
  "$GO_BINARY" build -trimpath -buildvcs=false '-ldflags=-s -w -buildid=' \
  -o /absolute/path/to/uhmlang.wasm .
```

The flags remove machine paths, VCS metadata, symbols and the varying build ID.
The receipt records the exact compiler, target environment, flags, original
source inputs, licenses and artifact hash without a timestamp or machine path.
The builder performs no network fetch and cannot download a different compiler
or dependency. The checked-in artifact was also compared with the unchanged
native Go interpreter and Node WASI, including the upstream Hello World sample,
signed input, EOF, Unicode/NUL output, variables, arithmetic, conditionals,
jumps, line separators and exit/panic behavior.
