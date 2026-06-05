# Tool Projects

This directory holds local projects that are part of the language/toolchain story but should not run
as normal pnpm runtime packages.

- `dool`: the Docker-based judge/toolchain backend covering C/C++, C#, Elixir, Go, Haskell, Java,
  Kotlin, Lua, OCaml, Perl, PHP, Python/PyPy, Ruby, Rust, TypeScript, and UHM language execution.

This project is intentionally outside `runtimes/*` because its `build` commands may start
Docker image builds or operate on non-library infrastructure.
