---
name: import-jungol
description: End-to-end contest import into the hancomac/nojam format and Jungol/oxus upload workflow. Use when the user gives a programming contest or archive/source URLs and wants problems, statements, images, tests, solutions, SPJ, interactive judges, translations, validation, ID allocation, upload, and submission verification prepared for Jungol.
---

# Import Jungol

## Operating Rules

- Work in the existing nojam repository unless the user gives another path. Default: `/home/seorii/dev/hancomac/nojam`.
- Use official contest sources first: contest archive, BOJ, ICPC mirrors, Kattis/problemtools packages, Polygon packages, or repository releases.
- Preserve raw downloads under `tmp/imports/<contest-slug>/` and keep generated nojam artifacts under `data/<org>/<contest>/`, `spj/`, and `interactor/`.
- Before any upload that creates new problems, ask the user which Jungol ID to start from. Do not guess.
- Before patching existing uploaded problems, verify the remote ID by exact `from` match and show the mapping.
- Use subagents for translation or verification only when the user explicitly asks for subagents/delegation.

## Workflow

1. **Orient the contest**
   - Identify contest name, year, region, letters, official source URLs, language of statements, and whether BOJ IDs already exist.
   - Search current nojam entries for duplicates by exact `from`, title, BOJ relation, and contest/year.
   - For broad interactive audits, run `scripts/scan_interactive.py`.

2. **Download and stage sources**
   - Use nojam's existing contest-specific scripts when available.
   - Otherwise use `scripts/fetch_sources.py` to download/extract archives into `tmp/imports/<slug>/`.
   - Stage files into the nojam layout described in `references/nojam-layout.md`.
   - Keep statement images and diagrams; update HTML/image paths so uploaded statements render.

3. **Extract statements and metadata**
   - Build or update `problems.json` in contest order.
   - Include Korean base fields and English `*_en` fields when available. If the official statement is English-only, translate Korean base fields and keep English originals in `*_en`.
   - Normalize examples, limits, `from`, `rel`, `info`, `show`, and `stop`.
   - Use existing neighboring contests as format examples before inventing structure.

4. **Clean tests and solutions**
   - Put tests under `data/<problemId>/...` with `.in` and `.out` suffixes.
   - Rename odd extensions like `.in.01` to `case_01.in`.
   - Drop unusable generator-only files unless an interactor/checker needs them.
   - Add official accepted solutions under `solution/<problemId>/` or `solution/<letter>/`; if missing and submission verification is required, write a focused solution.

5. **SPJ and interactive setup**
   - Follow `references/judge-setup.md`.
   - For SPJ: prefer official checkers; otherwise write `spj/<problemId>/Main.cpp`.
   - For interactive: determine whether the problem is a function-implementation task, an offline oracle transform, or `InteractiveIOJudge`.
   - For `InteractiveIOJudge`, add `interactor/<problemId>/Main.cpp`, placeholder code, language restrictions, and local transcript tests.
   - Keep `stop=true` until the judge can actually run and at least one accepted solution has been verified.

6. **Validate locally**
   - Run `scripts/validate_nojam_contest.py <contest-root>` for structural checks.
   - Compile SPJ/interactors and run representative local judge simulations.
   - Submit or locally test official/example solutions where possible.
   - Fix data and judges before upload.

7. **Ask for upload ID**
   - Show the count of new problems and any exact remote remaps.
   - Ask: "몇 번 ID부터 업로드할까요?"
   - After the user answers, run `scripts/make_id_log.py --nojam <path> --target <contest-root> --start <id> --margin <n> --write`.

8. **Upload and verify**
   - Dry run first:
     ```bash
     node scripts/upload.mjs data/<org>/<contest> --dry-run --upload-spj --submit-solutions
     ```
   - Real upload only after checking the dry-run mapping:
     ```bash
     node scripts/upload.mjs data/<org>/<contest> --upload-spj --submit-solutions
     ```
   - For existing problems, use exact-ID patch scripts or uploader flags only after remote ID verification.
   - Poll submissions and report AC/WA/CE with IDs.

## Bundled Resources

- `references/nojam-layout.md`: file layout and `problems.json` conventions.
- `references/judge-setup.md`: SPJ and interactive judge requirements.
- `references/upload-checklist.md`: condensed import/upload checklist.
- `scripts/fetch_sources.py`: generic downloader/extractor for source archives.
- `scripts/scan_interactive.py`: local interactive problem audit.
- `scripts/validate_nojam_contest.py`: nojam contest structure validator.
- `scripts/make_id_log.py`: safe `log/id.log` range writer after user-provided start ID.
