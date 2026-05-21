# Risk Register

이 문서는 `wasm-tinygo` 프로젝트의 구조적 리스크와 장기 추적 이슈를 기록합니다.

갱신 기준: 2026-04-01 static TinyGo browser runtime follow-up

상태 기준:

- `열림`: 현재 트리 기준으로 확인된 이슈
- `완료`: 현재 트리 기준으로 더 이상 추적할 필요가 없는 항목
- `제안`: 구조 개선 또는 후속 투자 항목

---

## 🔴 버그 (Bugs)

### [BUG-001] pure-browser TinyGo runtime이 metadata wasm만 만들고 runnable artifact를 생성하지 못함

**심각도**: 높음  
**상태**: 열림  
**위치**: `src/runtime.ts`, `internal/tinygofrontend/frontend.go`, `internal/tinygobackend/backend.go`, `tests/browser-smoke.test.mjs`

**설명**:

- static-only browser path에서 `/api/tinygo/compile`를 차단하면 runtime은 `/working/out.exec.wasm` relink까지 진행한다.
- 하지만 relink 결과물의 export는 `tinygo_lowered_*` 계열 probe/hash 함수뿐이고 `_start`, `_initialize`, `main` 어느 것도 노출하지 않는다.
- 현재 lowered backend는 compile unit / lowering / IR 검증용 metadata C를 생성할 뿐, 실제 TinyGo program semantics를 수행하는 실행용 translation unit을 만들지 않는다.

**재현 메모**:

- `tests/browser-smoke.test.mjs`의 host compile 404 시나리오가 이 경로를 기대한다.
- 실제 activity log는 `build execution failed: execution artifact did not expose a supported WASI entrypoint`로 끝난다.
- relink 이전에는 runtime이 `--no-entry` / `--export-all`를 제거해 `_start` unresolved로 먼저 실패하던 버그가 있었고, 그 부분을 바로잡아도 여전히 runnable entrypoint는 생성되지 않는다.

**영향**:

- 정적 배포에서 TinyGo를 end-to-end 실행할 수 없다.
- localhost host compile seam이 없으면 `wasm-idle`과 `wasm-tinygo` demo 모두 실제 실행까지 도달하지 못한다.

**다음 단계**:

- browser backend가 검증용 metadata wasm과 별도로 실행용 translation unit / link plan을 생성해야 한다.
- 최소 요구사항은 relink 결과가 `_start` 또는 reactor-style `_initialize` + `main`을 제공하는 것이다.
- 그 전까지는 static-only TinyGo success를 완료로 판단하면 안 된다.

---

## 🟠 아키텍처 (Architecture)

### [ARCH-001] `go-llvm`가 cgo + system LLVM 전제를 가져서 browser/WASI direct compiler를 막음

**심각도**: 높음  
**상태**: 열림  
**위치**: `scripts/patch-tinygo-wasi.mjs`, upstream `tinygo.org/x/go-llvm`, upstream `builder/*`, `compiler/*`

**설명**:

- 2026-04-09 기준 `serial`, `tty`, `flock`, `tinygo-cgo`는 patch 단계에서 제거하거나 우회할 수 있게 됐다.
- temp output으로 `node scripts/build-tinygo-compiler.mjs`를 실행하면 `patchedEntryFailureReason` blocker가 `go-llvm` 하나만 남는다.
- 로컬 module cache의 `tinygo.org/x/go-llvm@v0.0.0-20250422114502-b8f170971e74`는 `ir.go`, `support.go`, `target.go`, `passes.go`, `version.go` 등 다수 파일에서 `import "C"`를 사용하고, `llvm_config_linux_llvm*.go` / `llvm_dep.go`는 Linux/Darwin + LLVM version build tags를 전제로 한다.
- 즉 현재 upstream TinyGo backend는 pure Go WASI/browser 환경에서 바로 빌드 가능한 상태가 아니다.

**영향**:

- browser 전용 TinyGo entrypoint는 이제 frontend/driver 쪽 incidental blocker 없이 backend 직전까지 간다.
- 하지만 LLVM 바인딩이 system LLVM + cgo 전제를 요구하므로 direct compiler wasm으로 승격되지 못하고 여전히 `patched-wasi-probe`로 떨어진다.

**다음 단계**:

- 가능한 전략을 명시적으로 분기해야 한다.
- 1. `go-llvm`의 WASI/browser용 대체 바인딩 또는 prebuilt backend shim을 vendor한다.
- 2. TinyGo backend를 host-side service/worker로 분리하고 browser 쪽은 frontend/compiler-driver까지만 담당한다.
- 3. upstream `go-llvm`에 pure-WASM 지원이 있는지 확인하고, 없다면 별도 포크로 재현한다.
- 이 항목이 해결되기 전까지는 “direct TinyGo compiler wasm” 완료로 간주하면 안 된다.
