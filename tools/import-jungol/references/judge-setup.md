# Judge Setup

## SPJ

- Prefer official checkers from Polygon/problemtools/Kattis packages.
- Store as `spj/<problemId>/Main.cpp` unless the nojam repo has a stronger local convention.
- Validate compile flags with `g++ -O2 -Wall -Wextra -std=c++17`.
- Upload with `node scripts/upload.mjs <target> --upload-spj`.
- Set `info.spj=true` only when the checker is uploaded or known to be attached.

## InteractiveIOJudge

Use this when the contestant program and judge must communicate over stdin/stdout.

Interactor contract used by dool/oxus:

```text
interactor/Main <inputPath> <outputPath> <answerPath>
```

- Interactor stdin reads contestant stdout.
- Interactor stdout writes contestant stdin.
- Exit code `0`: accepted.
- Exit code `3`: interactor/internal failure, normally CE/infrastructure.
- Any other nonzero exit: wrong answer.
- Write diagnostic messages to stderr.

Required nojam/remote metadata:

- `judgeType: "InteractiveIOJudge"`
- `interactor: { "language": "CPP" }` or the actual interactor language.
- `info.interactive=true`
- `info.spj=true`
- `stop=false` only after local and remote verification.
- `placeholder` should demonstrate the protocol.
- `lang` should restrict languages to those supported by the interactive runner. Use `["CPP"]` when unsure.

Local validation pattern:

1. Compile interactor and accepted solution.
2. Spawn solution and interactor.
3. Pipe solution stdout to interactor stdin.
4. Pipe interactor stdout to solution stdin.
5. Require interactor exit code `0`.

## Function-Implementation Interactive Tasks

Some "interactive" imports are not stdin/stdout interaction on Jungol. Check whether the target platform expects:

- a submitted function body,
- a fixed `Main` wrapper,
- custom headers,
- or a two-step/competitive judge.

Do not force these into `InteractiveIOJudge` unless the statement protocol is truly stdin/stdout.
