# nojam Layout

## Core Paths

- `data/<org>/<contest>/problems.json`
- `data/<org>/<contest>/data/<problemId>/*.in|*.out`
- `data/<org>/<contest>/imgs/` for statement images
- `data/<org>/<contest>/solution/<problemId or letter>/`
- `spj/<problemId>/Main.cpp`
- `interactor/<problemId>/Main.cpp`
- `log/id.log` for upload ID ranges
- `tmp/imports/<contest-slug>/` for raw downloads and extraction

## problems.json

Required or common fields:

- `id`: local source ID, often BOJ ID for ICPC; string IDs are allowed for non-BOJ imports.
- `title`, `body`, `input`, `output`, `hint`: Korean base fields.
- `title_en`, `body_en`, `input_en`, `output_en`, `hint_en`: English fields.
- `i18n_en`: `true` when English fields are present and reviewed.
- `show`: usually `"hide"` for imports.
- `info`: booleans for `spj`, `interactive`, `twostep`, `competitive`, `subtask`.
- `stop`: `true` only when judging is not currently possible.
- `limit`: `{ "time": <ms>, "memory": <MB> }`.
- `example`: list of `{ "input": "...", "output": "...", "desc": null, "desc_en": null }`.
- `from`: exact contest provenance, e.g. `ICPC World Finals 2020 H`.
- `rel`: original-source links, e.g. `{ "from": "boj", "id": "23199", "site": null }`.

## Data Rules

- Every judged case should have a stable UID with `.in`; ordinary judges should also have `.out`.
- Interactive judges may upload empty `.out` files, but keep official answer files if the interactor needs them.
- Avoid spaces and unusual punctuation in uploaded case UIDs; use `_` or `-`.
- If a package has subtasks, preserve group boundaries and scores in `dataSet`.
- If any test group is incomplete, keep `stop=true` until fixed.

## problemset.json

- Use year fields, sorted descending.
- For Korea, place regional finals first, then insert `{"heading":"인터넷 예선"}` before online preliminaries.
- For a merged duplicate problem, prefer one uploaded problem and reflect the combined `from` on the remote entry.
