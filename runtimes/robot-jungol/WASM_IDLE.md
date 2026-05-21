# wasm-idle Migration Notes

`robot-jungol` is the Python package source for the vendored browser zip assets:

- `static/jungol-robot/jungol_robot.zip`
- `static/robot-jungol/robot_jungol.zip`

The two archives contain the same source files with different top-level package names for
compatibility with existing exercises. Rebuild them from this migrated source with:

```bash
pnpm sync:jungol-robot
```

`judge.py` is kept in this source package and in `tools/dool/include/PYTHON/jungol_robot`, but it is
not included in the browser zip archives.
