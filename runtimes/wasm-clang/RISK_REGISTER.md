# Risk Register

이 문서는 `wasm-clang` 프로젝트의 정적 리뷰 후속 이슈와 구조 개선 메모를 기록합니다.

갱신 기준: 2026-04-09 static review follow-up 반영

상태 기준:

- `열림`: 현재 트리 기준으로 아직 해결되지 않은 항목
- `완료`: 현재 트리 기준으로 수정이 반영된 항목
- `제안`: 더 큰 구조 개선 또는 후속 투자 항목

---

## 🔴 버그 (Bugs)

### [BUG-001] 기본 build가 sibling `wasm-idle` checkout을 강제함

**심각도**: 중간  
**상태**: 완료  
**위치**: `package.json`, `README.md`, `scripts/bootstrap-from-wasm-idle.mjs`

**설명**:

- 기존 `build` 스크립트는 항상 `bootstrap:assets`를 먼저 실행해 `../wasm-idle/static`을 전제했음
- 저장소에는 이미 `artifacts/runtime-source/`가 커밋되어 있어 self-contained build가 가능했지만 문서와 스크립트가 이를 드러내지 못했음

**영향**:

- 신규 기여자와 CI 환경에서 실제보다 더 강한 workspace 의존성을 기대하게 만듦

**완료 메모**:

- 기본 `npm run build`를 vendored asset 기반 self-contained build로 변경함
- `npm run build:from-wasm-idle`를 별도 opt-in 갱신 경로로 분리함
- bootstrap 스크립트는 sibling checkout이 없을 때 명확한 오류를 내도록 정리함

---

### [BUG-002] 공개 compile API가 fileName/debug 옵션을 런타임으로 전달하지 않음

**심각도**: 높음  
**상태**: 완료  
**위치**: `src/compiler.ts`, `src/runtime.ts`, `src/types.ts`

**설명**:

- `BrowserClangCompileRequest`에 선언된 `fileName`, `debug`, `breakpoints`, `pauseOnEntry`가 public facade에서 누락되어 있었음
- 결과 artifact도 항상 고정 이름 산출물을 읽어 와 호출자 의도를 잃고 있었음

**영향**:

- 타입에 보이는 옵션과 실제 런타임 동작이 어긋나 디버그/실행 계약이 신뢰되지 않음

**완료 메모**:

- public compile path가 해당 옵션을 모두 전달하도록 수정함
- artifact 파일명과 디버그 메타데이터를 결과에 포함하도록 정리함
- compile output에서 diagnostics를 파싱해 실패 결과에 실어 주도록 보강함

---

### [BUG-003] `test.wasm` / `main.wasm` 하드코딩으로 산출물 이름과 argv0가 어긋남

**심각도**: 높음  
**상태**: 완료  
**위치**: `src/runtime.ts`, `src/browser-execution.ts`, `test/runtime.test.ts`, `test/public-api.test.ts`

**설명**:

- compile/link 경로는 내부적으로 `test.*` 이름을 강제했고, standalone executor는 항상 `main.wasm`을 argv0로 사용했음
- `fileName`을 지정해도 artifact 이름과 실행 시 프로그램명이 일치하지 않았음

**영향**:

- 디버깅, source identity, 프로그램명 의존 실행 흐름에서 혼란을 유발함

**완료 메모**:

- source file name에서 `*.o`, `*.wasm` 이름을 일관되게 파생하도록 수정함
- executor가 artifact의 `fileName` 또는 명시적 `programName`을 argv0로 사용하게 함

---

### [BUG-004] `artifact.wasm`이 죽은 필드로 남아 실행 시 재컴파일을 유발함

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/types.ts`, `src/compiler.ts`, `src/browser-execution.ts`, `test/public-api.test.ts`

**설명**:

- 기존 public artifact는 bytes를 `wasm` 필드에 중복 저장했고, executor는 이를 무시한 채 항상 `artifact.bytes`를 다시 컴파일했음

**영향**:

- API 의미가 흐려지고 불필요한 `WebAssembly.compile()` 비용이 발생함

**완료 메모**:

- compile 결과의 precompiled `WebAssembly.Module`을 `artifact.wasm`에 저장함
- executor는 해당 모듈이 있으면 재컴파일 없이 그대로 재사용함

---

### [BUG-005] 런타임 host에 개인 값과 직접 console 출력이 남아 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/app.ts`, `test/app.test.ts`

**설명**:

- `USER=jungol`이 기본 환경 변수로 하드코딩되어 있었음
- `proc_exit` 처리 경로가 직접 `console.log()`를 호출해 라이브러리 소비자 콘솔을 오염시켰음

**영향**:

- 공개 라이브러리 품질과 관측 가능성 제어에 악영향을 줌

**완료 메모**:

- 환경값을 중립적인 `USER=wasm-clang`으로 변경함
- 직접 console 출력 대신 기존 `trace()` 경로를 재사용하도록 수정함

---

### [BUG-006] public API 계약을 방어하는 테스트가 부족함

**심각도**: 중간  
**상태**: 완료  
**위치**: `test/public-api.test.ts`, `test/browser-execution.test.ts`

**설명**:

- 기존 테스트는 내부 runtime/app 동작 위주였고, README 수준의 public facade 계약은 직접 검증하지 않았음

**영향**:

- facade 누락이나 문서-코드 불일치가 늦게 발견될 수 있었음

**완료 메모**:

- public compile contract, diagnostics, preload, browser execution contract를 직접 검증하는 테스트를 추가함

---

## 🟡 구조 제안 (Architecture)

### [ARCH-001] `preloadBrowserClangRuntime()`를 명시적 shared session으로 승격할지 검토

**심각도**: 중간  
**상태**: 제안  
**위치**: `src/compiler.ts`, `src/runtime.ts`, `src/wasm.ts`

**설명**:

- 현재 `preloadBrowserClangRuntime()`는 warm-up helper로 동작하며, manifest/asset/module cache를 데우는 역할에 가깝다
- 이번 수정으로 asset buffer cache와 compiled module cache 재사용은 강화했지만, persistent `RuntimeSession`을 돌려주는 구조는 아님

**제안 메모**:

- 추후 `runtimeBaseUrl + manifest` 기준의 명시적 shared session 계층을 두고, preload/compile 간에 ready 상태와 관측용 로그를 더 명확히 공유할지 검토

---

### [ARCH-002] `Runtime` 책임을 session/compiler/executor 레이어로 분리

**심각도**: 낮음  
**상태**: 제안  
**위치**: `src/runtime.ts`, `src/app.ts`

**설명**:

- 현재 `Runtime`은 asset fetch/cache, sysroot 준비, compile/link/run, debug bookkeeping을 한 객체에 담고 있음

**제안 메모**:

- 후속 리팩터링에서 `RuntimeSession`, `CompilerDriver`, `Executor`, `Debugger` 경계로 분리하면 테스트와 유지보수가 쉬워질 가능성이 큼
