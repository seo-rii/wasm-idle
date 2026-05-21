# wasm-idle Migration Notes

`dool` is the migrated server-side judge/toolchain project. It is kept under `tools/` instead of
`runtimes/` so the workspace runtime build command does not accidentally run Docker image builds.

The imported working tree includes:

- all tracked source, Dockerfiles, scripts, manifests, lockfiles, CI workflows, tests, and language
  modules from the sibling `../dool` checkout
- the untracked `dool-deploy.sh` helper present in that checkout
- the current working-tree version of `include/PYTHON/jungol_robot/pillow_drawer.py`

Generated output directories such as `build/`, `node_modules/`, and Python `__pycache__/` are not
part of the migration.
