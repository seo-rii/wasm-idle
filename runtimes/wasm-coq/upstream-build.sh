#!/bin/sh
# Corresponding source build, following the pinned upstream docs/build.md.
# Requires the upstream 32-bit OCaml/OPAM toolchain and its native build dependencies.
# No source build is run during page builds; release artifacts are independently byte-pinned.
set -eu
task_source_dir="${1:?Usage: upstream-build.sh NEW_SOURCE_DIRECTORY}"
git clone --no-checkout https://github.com/jscoq/jscoq.git "$task_source_dir"
cd "$task_source_dir"
git checkout --detach 7ca41fe7432c1dd2951d4aa42f5216e7bdb11990
git submodule update --init --recursive
./etc/toolchain-setup.sh --32
# The original Makefile fetches Coq V8.17.1 and applies the three retained patches.
make coq
test "$(git -C _vendor+v8.17+32bit/coq rev-parse HEAD)" = 18722d285c34aee39f344c080ccfebe02fd974ba
make jscoq
