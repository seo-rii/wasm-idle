# Risk Register

이 문서는 `wasm-rust` 프로젝트의 버그, 문서 불일치, 개선 사항을 기록합니다.

갱신 기준: 2026-04-08 static review follow-up 반영

상태 기준:

- `열림`: 현재 트리 기준으로 확인된 이슈
- `완료`: 현재 트리 기준으로 더 이상 추적할 필요가 없는 항목
- `제안`: 구조 개선 또는 후속 투자 항목

---

## 🔴 버그 (Bugs)

### [BUG-001] 브라우저 harness에서 wasm32-wasip3 옵션 누락

**심각도**: 낮음  
**상태**: 완료  
**위치**: `browser-harness/index.html`

**설명**:

- Target triple 선택 드롭다운에 `wasm32-wasip1`, `wasm32-wasip2`만 존재하고 `wasm32-wasip3`가 누락됨
- `README.md`, `docs/browser-compiler.md`, `src/types.ts` 기준으로는 `wasm32-wasip3` 지원이 이미 문서화/타입화되어 있음

**영향**:

- 브라우저 harness UI에서 wasip3 타겟을 직접 검증할 수 없음

**완료 메모**:

- `browser-harness/index.html`에 `wasm32-wasip3` 옵션을 복구했고 회귀 테스트를 추가함

---

### [BUG-002] 문서 내 retry 횟수 불일치

**심각도**: 낮음  
**상태**: 완료  
**위치**: `docs/real-rustc-history.md`, `README.md`, `docs/browser-compiler.md`, `src/compiler.ts`

**설명**:

- `docs/real-rustc-history.md`는 retry를 최대 `3`회라고 설명함
- `README.md`, `docs/browser-compiler.md`, `src/compiler.ts`의 실제 계약은 최대 `5`회임

**영향**:

- retry 정책을 기준으로 운영/디버깅하는 개발자에게 잘못된 기대를 줌

**완료 메모**:

- `docs/real-rustc-history.md`를 현재 구현(`5` attempts) 기준으로 정정함

---

### [BUG-003] syntax_error.rs 테스트 픽스처 세미콜론 누락

**심각도**: 정보성  
**상태**: 완료  
**위치**: `test/fixtures/syntax_error.rs`

**설명**:

- `println!("missing semicolon")` 뒤 세미콜론이 없지만, 파일명과 테스트 목적상 의도된 오류 케이스임

**영향**:

- 없음

**완료 메모**:

- 의도된 negative fixture로 확인됨. 별도 수정 불필요.

---

### [BUG-004] validate:standalone-browser가 최신 dist 빌드를 보장하지 않음

**심각도**: 중간  
**상태**: 완료  
**위치**: `scripts/validate-standalone-browser.mjs`, `package.json`

**설명**:

- `test:browser`는 `pnpm build` 후 `probe-browser-harness`를 수행함
- 반면 `validate:standalone-browser`는 `test:ci:fast`부터 시작하고, 이 fast lane은 `WASM_RUST_SKIP_DIST_TESTS=1`로 실행됨
- 따라서 소스 변경 후 `dist/`가 stale한 상태여도 validate 경로가 이전 산출물을 검증할 수 있음

**영향**:

- 브라우저 검증이 최신 번들을 방어한다는 보장이 깨짐
- 로컬 확인과 자동화 검증이 잘못된 성공 신호를 낼 수 있음

**완료 메모**:

- `validate:standalone-browser`가 `test:ci:fast` 뒤 `test:ci:browser`를 재사용하도록 변경됨
- 기본 GitHub Actions workflow도 이 wrapper를 실행하게 맞춤

---

### [BUG-005] 재시도된 attempt의 상세 로그가 최종 결과에서 유실됨

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/compiler.ts`

**설명**:

- 각 attempt 로그는 `attemptCompileLogs`에 모아 둔 뒤 `flushAttemptCompileLogs()`가 호출될 때만 `compileLogs`와 콘솔로 반영됨
- retry 분기에서는 retry warning만 `recordPersistentCompileLog()`로 남기고, 해당 attempt의 세부 로그는 flush하지 않은 채 다음 attempt로 넘어감
- 그 결과 `result.logs`에는 마지막 성공 attempt 또는 최종 실패 attempt의 정보만 남고, 중간에 어떤 오류가 있었는지 맥락이 사라짐

**영향**:

- retry가 핵심 복구 메커니즘인 현재 구조에서 관측 가능성이 크게 떨어짐
- flaky browser-rustc 경로 분석과 회귀 진단이 어려워짐

**완료 메모**:

- retry 직전에도 attempt 로그를 결과 버퍼에 병합하도록 바뀌어 `result.logs`에서 중간 시도를 확인할 수 있음
- transient failure kind도 구조화 신호를 우선 사용하도록 보강됨

---

### [BUG-006] default export compiler factory 타입이 named export보다 좁게 선언됨

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/types.ts`, `src/index.ts`, `test/public-api-types.test.ts`

**설명**:

- named export `createRustCompiler`는 `options?: CreateRustCompilerOptions`를 받음
- 하지만 public type `BrowserRustCompilerFactory`는 `() => Promise<BrowserRustCompiler>`로 남아 있었고, default export는 그 더 좁은 타입으로 고정돼 있었음
- 런타임은 정상이어도 TS 소비자에게는 "default export는 옵션 불가"처럼 보였음

**영향**:

- default import를 쓰는 소비자가 잘못된 타입 오류와 자동완성 정보를 받음

**완료 메모**:

- `BrowserRustCompilerFactory`를 optional options 시그니처로 넓혔고, public API 타입 계약을 `tsc`로 검증하는 회귀 테스트를 추가함

---

### [BUG-007] diagnostics test가 worker bootstrap retry 계약 변경을 따라가지 못함

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/compiler.ts`, `test/diagnostics.test.ts`

**설명**:

- `test/diagnostics.test.ts`는 worker bootstrap error가 즉시 반환되길 기대했음
- 한동안 `compileRust()`는 모든 bootstrap error를 `worker-bootstrap` retry 후보로 취급해 backoff sleep까지 수행했음
- 그 결과 `returns worker bootstrap errors directly`가 CI에서 5000ms timeout으로 실패했음

**영향**:

- 기본 CI가 green 상태를 잃고, bootstrap failure 계약이 테스트와 구현 사이에서 어긋남

**완료 메모**:

- transient bootstrap signature로 분류되는 경우에만 retry하도록 좁혔고, 일반 bootstrap failure는 바로 반환되게 복구함
- diagnostics test와 bootstrap retry test가 동시에 통과하는 상태로 검증함

---

### [BUG-008] browser harness probe 성공 판정이 hello-world stdout에 하드코딩됨

**심각도**: 중간  
**상태**: 완료  
**위치**: `scripts/probe-browser-harness.mjs`, `test/browser-harness.test.ts`

**설명**:

- probe 스크립트 top-level `success`는 각 target의 `runtime.stdout === "hi\n"`일 때만 true였음
- 하지만 `test/browser-harness.test.ts`는 richer `wasm32-wasip2` 샘플에서도 `result.success === true`를 기대하고, stdout에는 `preview2_component=`와 `factorial_plus_bonus=`가 포함되길 검증했음
- 즉 richer sample path에서는 probe의 success 판정과 테스트 기대가 동시에 만족될 수 없었음

**영향**:

- probe를 richer sample이나 다른 정상 출력 프로그램에 재사용할 때 false negative가 발생함

**완료 메모**:

- probe success를 `compile.success && runtime.exitCode === 0` 기본판정으로 일반화했고, 필요할 때만 explicit stdout expectation을 주입할 수 있게 함
- helper 단위 테스트를 추가해 hello-world와 richer sample stdout 모두를 회귀 검증함

---

### [BUG-009] browser CI가 clean runner에서 local runtime toolchain cache를 전제함

**심각도**: 중간  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`, `scripts/prepare-runtime.mjs`

**설명**:

- browser lane의 `pnpm build`는 `prepare-runtime.mjs`를 통해 `rustc.wasm`과 `llvm-wasm` cache root를 바로 참조했음
- 하지만 GitHub Actions workflow는 Chromium만 설치하고 browser runtime toolchain 입력은 준비하지 않았음
- 그 결과 clean runner에서는 `dist-emit-ir/bin/rustc.wasm` ENOENT로 browser CI가 실패했음

**영향**:

- browser CI가 실제로는 self-contained하지 않았고, 러너 상태에 따라 즉시 깨질 수 있었음

**완료 메모**:

- workflow가 latest release의 `dist/runtime` bundle을 먼저 hydrate하도록 바꾸고, `prepare-runtime.mjs`는 opt-in 환경변수에서만 prebuilt runtime fallback을 허용하도록 정리함
- fallback은 manifest와 referenced runtime assets가 모두 존재할 때만 재사용되도록 검증함
- legacy `runtime-manifest.json` / `runtime-manifest.v2.json` bundle도 현재 로더 지원 범위에 맞춰 reusable fallback 검사 대상으로 인정함

---

### [BUG-010] browser execution stdin이 empty chunk에서 바쁜 루프에 빠질 수 있음

**심각도**: 높음  
**상태**: 완료  
**위치**: `src/browser-execution.ts`, `src/browser-stdin.ts`

**설명**:

- `BufferedExecutionInput.read()`는 `stdin()`이 `null`이면 EOF로 처리했지만, 빈 문자열/빈 버퍼는 다시 읽기 루프를 계속 돌았음
- 그래서 소비자가 `''` 또는 zero-length bytes를 반복 반환하면 런타임이 진행 없이 바쁜 루프에 빠질 수 있었음

**영향**:

- read-to-end stdin 소비 경로에서 브라우저 실행이 hang처럼 보일 수 있음
- EOF sentinel 계약이 문서와 타입만으로는 충분히 강제되지 않았음

**완료 메모**:

- stdin EOF를 `null` sentinel로 명확히 고정했고, empty chunk / `undefined` 반환은 즉시 에러로 바꾸어 무한 루프 여지를 제거함
- 순수 stdin buffering 테스트를 추가해 회귀를 고정함

---

### [BUG-011] 공개 compile request의 `channel` / `mode`가 no-op surface로 남아 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/types.ts`, `src/compiler-support.ts`, `test/compiler-edge-cases.test.ts`

**설명**:

- `BrowserRustCompileRequest`에는 `channel`, `mode`가 남아 있었지만 핵심 compile 경로는 이 값을 읽지 않았음
- 호출자 입장에서는 실제 동작을 바꾸는 옵션처럼 보이지만, 구현상으로는 죽은 API surface였음

**영향**:

- 소비자가 존재하지 않는 기능을 기대하거나 잘못된 자동완성 계약을 따를 수 있음

**완료 메모**:

- 현재 미지원 surface로 명시하고, 값이 들어오면 즉시 unsupported error를 반환하게 바꿈
- 타입 주석과 fast-fail 테스트도 함께 추가함

---

### [BUG-012] runtime manifest fallback이 깨진 v3 publish를 가릴 수 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/runtime-manifest.ts`, `src/compiler-runtime.ts`, `test/runtime-manifest-edge.test.ts`

**설명**:

- 기존 로더는 `runtime-manifest.v3.json` 로드가 어떤 이유로든 실패하면 바로 `v2`, legacy `v1`로 내려갔음
- 그 결과 fetch/parse 오류나 잘못 게시된 `v3` manifest도 조용히 숨겨질 수 있었음

**영향**:

- 배포 회귀의 원인 파악이 늦어지고, 깨진 최신 bundle이 오래된 manifest로 위장될 수 있음

**완료 메모**:

- fallback은 `404`/missing 성격의 오류에만 허용하고, 그 외 `v3` load failure는 즉시 surface하도록 변경함
- HTTP status가 포함된 manifest load error를 추가했고 관련 회귀 테스트를 보강함

---

## 🟡 문서 불일치 (Documentation Inconsistencies)

### [DOC-001] reproduction.md의 validate 스크립트 단계 불일치

**심각도**: 중간  
**상태**: 완료  
**위치**: `docs/reproduction.md`, `README.md`, `scripts/validate-standalone-browser.mjs`

**설명**:

- `docs/reproduction.md`는 `validate:standalone-browser`가 `pnpm build`와 `pnpm test`를 수행한다고 기술함
- 실제 스크립트와 `README.md`는 `test:ci:fast -> probe:browser-harness -> browser vitest -> playwright` 순서를 사용함

**영향**:

- validate 경로가 무엇을 보장하는지 문서만으로 판단하기 어려움

**완료 메모**:

- `README.md`와 `docs/reproduction.md`가 현재 `test:ci:fast -> test:ci:browser` 흐름에 맞춰 갱신됨

---

### [DOC-002] 문서와 스크립트에 하드코딩된 절대 경로 존재

**심각도**: 낮음  
**상태**: 완료  
**위치**: `README.md`, `docs/reproduction.md`, `scripts/prepare-runtime.mjs`

**설명**:

- 문서에 `/home/seorii/dev/hancomac/wasm-rust`가 반복적으로 등장함
- `prepare-runtime.mjs` 기본 캐시 경로도 특정 사용자 홈 디렉터리에 묶여 있음

**영향**:

- 재현 문서와 로컬 스크립트가 특정 개발 환경에 종속된 인상을 줌

**완료 메모**:

- 문서 예시는 `/path/to/...` placeholder로 일반화했고, `prepare-runtime.mjs` 기본 cache root도 `$HOME/.cache/...` 기준으로 바꿈
- 관련 override는 `docs/environment-variables.md`에 정리함
- `prepare-wasip2-runtime.sh`, `prepare-wasip3-runtime.sh`, `probe-*` 스크립트에 남아 있던 `/home/seorii/...` 기본값도 `$HOME`, 현재 checkout, sibling repo 기준으로 일반화했고 정적 회귀 테스트를 추가함

---

### [DOC-003] browser-compiler 문서의 날짜 표현 이슈

**심각도**: 낮음  
**상태**: 완료  
**위치**: `docs/browser-compiler.md`

**설명**:

- 과거에는 `2025-10-01`이 미래 날짜처럼 보여 추적 대상이었음
- 현재 시점(2026-03-26)에서는 historical reference가 되었으므로, 기존 리스크 조건은 더 이상 성립하지 않음

**영향**:

- 현재 기준 없음

**완료 메모**:

- 기존 항목은 종료. 필요하면 향후에는 날짜 표현의 명확성 문제로 별도 재등록.

---

### [DOC-004] 공개 API 문서가 실제 export 표면보다 좁게 적혀 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `README.md`, `docs/consumer-integration.md`, `src/index.ts`

**설명**:

- 문서는 주로 `default`와 `createRustCompiler`만 공개 API로 설명함
- 실제 ESM surface는 `preloadBrowserRustRuntime`와 `executeBrowserRustArtifact`도 public export로 제공함
- `preloadBrowserRustRuntime`는 cold-start 지연 은닉에, `executeBrowserRustArtifact`는 target-aware 실행 재사용에 유용함

**영향**:

- 소비자 통합 문서가 실제 활용 가능한 API보다 좁아짐
- 통합 팀이 이미 제공된 helper를 재구현할 가능성이 있음

**완료 메모**:

- README와 consumer 문서에 `preloadBrowserRustRuntime`, `executeBrowserRustArtifact` 설명과 예시를 추가함

---

### [DOC-005] browser-compiler 문서의 manifest 설명이 부분적으로 stale함

**심각도**: 중간  
**상태**: 완료  
**위치**: `docs/browser-compiler.md`, `PROGRESS.md`, `src/compiler.ts`

**설명**:

- 문서 상단과 invariants는 `runtime-manifest.v3.json`을 현재 기본 포맷으로 설명함
- 그러나 command inventory의 `pnpm run prepare:runtime` 설명은 여전히 "v1 manifest, v2 manifest"를 패키징한다고 적혀 있음
- 실제 로더는 `runtime-manifest.v3.json`을 먼저 시도한 뒤 `v2`, legacy `v1`로 fallback함

**영향**:

- manifest 구조와 배포 산출물에 대한 독자의 mental model이 어긋남

**완료 메모**:

- `prepare:runtime` 설명을 `runtime-manifest.v3.json` 중심의 현재 배포 계약에 맞춰 정리함

---

### [DOC-006] retry warning 계약 설명과 실제 로그 노출 조건이 어긋남

**심각도**: 중간  
**상태**: 완료  
**위치**: `PROGRESS.md`, `docs/browser-compiler.md`, `src/compiler.ts`

**설명**:

- 문서와 진행 로그는 retry가 "visible warnings"로 surfaced 된다고 설명함
- 하지만 실제 구현의 `emitCompileLog()`와 `recordPersistentCompileLog()`는 `request.log`가 꺼져 있으면 로그를 전혀 내보내지 않음
- 현재 계약대로라면 "retry warning은 `log: true`일 때만 보인다"가 실제 동작에 더 가까움

**영향**:

- 소비자 쪽에서 retry 가시성에 대한 기대가 불명확해짐

**완료 메모**:

- 문서를 `compile({ log: true })` 기준의 실제 계약으로 맞춤

---

### [DOC-007] executeBrowserRustArtifact 문서 예시가 helper 호출 계약을 완전히 설명하지 못함

**심각도**: 중간  
**상태**: 완료  
**위치**: `README.md`, `docs/consumer-integration.md`, `src/browser-execution.ts`

**설명**:

- 문서 예시는 `executeBrowserRustArtifact(artifact, options)`만 보여 줌
- 지난 시점의 실제 시그니처는 `executeBrowserRustArtifact(artifact, runtimeBaseUrl, options)`였고, component artifact 경로에서 `runtimeBaseUrl`이 그대로 preview2 helper로 전달됐음
- 그래서 문서 예시만 따르면 component artifact 실행 계약을 오해하기 쉬웠음

**영향**:

- 소비자가 component artifact 실행 시 필요한 runtime asset base URL 계약을 잘못 이해할 수 있음

**완료 메모**:

- helper가 `(artifact, options)`와 `(artifact, runtimeBaseUrl, options)`를 모두 지원하도록 넓혔고, 문서에도 package-local `./runtime/` 기본값과 explicit override를 함께 적음

---

### [DOC-008] browser-compiler 문서가 progress 이벤트가 logs에도 복제된다고 읽힐 수 있음

**심각도**: 낮음  
**상태**: 완료  
**위치**: `docs/browser-compiler.md`, `src/compiler.ts`

**설명**:

- 문서는 `result.logs`에 retry warning과 `compiler-worker progress lines`가 포함된다고 설명했음
- 실제 구현은 worker의 `type: 'log'` 메시지만 로그 버퍼에 누적하고, `type: 'progress'`는 `onProgress`로만 전달함

**영향**:

- 소비자가 progress 상태를 로그 파싱으로 복원할 수 있다고 오해할 수 있음

**완료 메모**:

- 문서 표현을 retry warning과 forwarded `compiler-worker` log lines 기준으로 좁히고, progress는 `onProgress`가 canonical contract임을 유지함

---

### [DOC-009] README 상단 결과 요약에서 logRecords가 빠져 있음

**심각도**: 낮음  
**상태**: 완료  
**위치**: `README.md`

**설명**:

- README 상단 status block은 `compile()` 결과를 `{ success, stdout?, stderr?, diagnostics?, logs?, artifact }`로만 요약했음
- 아래 detailed result shape와 exported types는 이미 `logRecords`를 포함하고 있었음

**영향**:

- README 첫 요약만 보고 통합하는 소비자는 structured log metadata 존재를 놓칠 수 있음

**완료 메모**:

- 상단 계약 요약을 `{ ..., logs?, logRecords?, artifact }`로 갱신해 README 내부 result shape와 맞춤

---

### [DOC-010] browser-compiler 문서가 runtime 기본값과 어긋남

**심각도**: 중간  
**상태**: 완료  
**위치**: `docs/browser-compiler.md`, `docs/environment-variables.md`, `scripts/prepare-runtime.mjs`, `test/build-output.test.ts`

**설명**:

- `docs/browser-compiler.md`는 `WASM_RUST_RUNTIME_TARGET_TRIPLES` 기본값을 `wasm32-wasip1,wasm32-wasip2`로 적고, packaged `rustc.wasm` initial pages를 `8192`라고 적었음
- 실제 `prepare-runtime.mjs` 기본값은 `wasm32-wasip1,wasm32-wasip2,wasm32-wasip3`와 `16384`였음

**영향**:

- 운영 문서와 패키징 계약이 drift하여, 재현/검증 환경에서 잘못된 기본값을 전제하게 됨

**완료 메모**:

- 문서를 현재 코드 기준으로 정정했고, 기본값을 스크립트 export + 문서 계약 테스트로 묶어 재발을 줄임

---

### [DOC-011] `prepare` 플래그 이름이 실제 의미를 과장함

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/types.ts`, `src/compiler.ts`, `docs/consumer-integration.md`, `docs/browser-compiler.md`

**설명**:

- consumer 문서 예시는 `prepare: true`를 대표 옵션처럼 보여 줬지만, 실제 효과는 compile timeout floor를 `120000ms`로 올리는 것뿐이었음
- 이름만 보면 prewarm 또는 별도 준비 단계를 수행하는 것처럼 읽히기 쉬웠음

**영향**:

- 소비자가 compile lifecycle을 잘못 이해하거나, 존재하지 않는 사전 준비 단계를 기대할 수 있음

**완료 메모**:

- 새 public knob을 `extendedTimeout`으로 명시하고 문서를 그 이름 기준으로 정리함
- 기존 `prepare`는 하위 호환 alias로만 유지하며, 의미를 timeout floor 상승으로 명확히 문서화함

---

### [DOC-012] wasm32-wasip3 서술이 “기본 시도”와 “실제 산출물”을 함께 설명하지 못함

**심각도**: 중간  
**상태**: 완료  
**위치**: `README.md`, `docs/browser-compiler.md`, `docs/environment-variables.md`

**설명**:

- README는 실질 scope를 `wasip1/wasip2` 중심으로 설명했지만, `prepare-runtime.mjs` 기본 target list에는 `wasm32-wasip3`도 포함돼 있었음
- 실제 동작은 “기본으로 시도하되 permissive mode에서는 호스트 prerequisite가 없으면 warning 후 생략”에 가까웠음

**영향**:

- 사용자 입장에서 `wasip3`가 기본 대상인지, opt-in 대상인지, 언제 bundle에 들어가는지 혼란스러웠음

**완료 메모**:

- README와 browser/compiler/env 문서에 “default attempt + conditional inclusion” 모델을 명시적으로 적음

---

## 🟢 개선 사항 (Improvements)

### [IMP-001] 기본 CI에서 브라우저 검증 경로가 빠져 있음

**우선순위**: 높음  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`

**설명**:

- 기본 GitHub Actions workflow는 `pnpm run typecheck`와 `pnpm run test:ci`만 실행함
- 실제 Chromium/Playwright 경로(`test:ci:browser`, `test:browser`, `test:browser:playwright`)는 PR 단위에서 자동 검증되지 않음

**영향**:

- 실제 브라우저 회귀가 기본 CI 방어막 밖에 남음

**완료 메모**:

- 기본 workflow가 `pnpm run validate:standalone-browser`를 실행해 브라우저 경로를 PR 단위에서 검증함

---

### [IMP-002] TypeScript strict 모드 추가 활용 검토

**우선순위**: 낮음  
**상태**: 완료  
**위치**: `tsconfig.json`

**설명**:

- 현재 `strict: true`는 이미 활성화되어 있음
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 활성화함
- optional property를 `undefined`로 직접 흘리던 경계를 조건부 spread로 정리함

**영향**:

- 런타임 타입 안전성 추가 개선 여지

**완료 메모**:

- 기본 `tsc` 설정에 `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 반영함
- preview2 import/runtime progress/result payload 생성 경계가 stricter optional typing을 만족하도록 정리됨

---

### [IMP-003] browser harness의 favicon 잡음 제거

**우선순위**: 낮음  
**상태**: 완료  
**위치**: `browser-harness/index.html`

**설명**:

- harness 콘솔에 `favicon.ico` 404가 계속 남음

**영향**:

- 실제 진단 로그와 무해한 잡음이 섞임

**완료 메모**:

- harness head에 inline `data:,` favicon을 추가했고 정적 회귀 테스트를 넣음

---

### [IMP-004] 환경 변수 문서 일원화

**우선순위**: 낮음  
**상태**: 완료  
**위치**: 문서 전반

**설명**:

- `WASM_RUST_*` 환경 변수가 여러 문서에 흩어져 있고 단일 레퍼런스가 없음

**영향**:

- 운영/재현 설정 탐색 비용 증가

**완료 메모**:

- `docs/environment-variables.md`를 추가하고 README/reproduction/browser-compiler/consumer 문서에서 연결함

---

### [IMP-005] runtime-manifest fallback 정리 계획 수립

**우선순위**: 낮음  
**상태**: 완료  
**위치**: `src/compiler.ts`, `scripts/prepare-runtime.mjs`, 문서 전반

**설명**:

- 현재 배포 중심은 `runtime-manifest.v3.json`으로 정리됐지만, 로더는 여전히 `v2`와 legacy `v1` fallback을 유지함

**영향**:

- 하위 호환 분기와 문서 설명 부담이 계속 남음

**완료 메모**:

- 새 빌드는 `runtime-manifest.v3.json`만 publish하고, `v2`/legacy `v1`는 older bundle consumption용 fallback이라는 정책을 문서화함

---

### [IMP-006] clean-room 브라우저 검증 lane 부재

**우선순위**: 중간  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`, `package.json`, `test/ci-script-contract.test.ts`

**설명**:

- 기존 workflow는 hydrated release runtime + prebuilt fallback 경로로 standalone validation을 수행했음
- 실사용 검증에는 유용하지만, fallback 없는 clean-room 브라우저 경로를 따로 보지 못했음

**영향**:

- fresh runner에서 새 JS bundle이 hydrated runtime과 함께 정상 동작하는지 별도 신호가 없었음

**완료 메모**:

- `test:ci:browser:clean-room` 스크립트를 추가하고, 별도 `browser-clean-room` GitHub Actions job에서 hydrated runtime 기반 브라우저 검증을 fallback env 없이 수행하도록 구성함

---

### [IMP-007] 기본값/계약 single source of truth 리팩터링 확대

**우선순위**: 중간  
**상태**: 제안  
**위치**: `scripts/prepare-runtime.mjs`, 문서 전반, public 타입 전반

**설명**:

- 이번 변경으로 runtime target list / memory defaults는 스크립트 export와 문서 테스트로 일부 고정했지만, compile request 계약과 문서 설명은 여전히 여러 파일에 분산돼 있음

**영향**:

- 문서 drift와 API surface drift가 다시 발생할 여지가 남아 있음

**메모**:

- 다음 배치에서는 compile request defaults/flags와 runtime defaults를 생성 가능한 contract module로 더 끌어올리는 편이 좋음

---

### [IMP-008] `prepare-runtime.mjs` / `src/compiler.ts` 대형 파일 분리

**우선순위**: 중간  
**상태**: 제안  
**위치**: `scripts/prepare-runtime.mjs`, `src/compiler.ts`, `src/compiler-worker.ts`, `src/rustc-runtime.ts`

**설명**:

- env 파싱, target discovery, pack 작성, manifest 생성, compile orchestration이 대형 파일 몇 개에 집중돼 있음

**영향**:

- 문서 drift, 회귀, 부분 수정 비용이 커지고 테스트 경계도 흐려짐

**메모**:

- 다음 단계에서는 env/defaults, target discovery, pack writer, manifest builder, worker-orchestration 단위로 나누는 것이 가장 이득이 큼

---

### [IMP-009] `createRustCompiler()` async ergonomics 정리 필요

**우선순위**: 낮음  
**상태**: 제안  
**위치**: `src/index.ts`, consumer 문서

**설명**:

- 현재 factory는 `async`이지만 실질적으로는 즉시 `{ compile }` 래퍼만 반환함

**영향**:

- 소비자 입장에서 “왜 async인지”가 드러나지 않고, 향후 preload/cold-start 설계가 문서와 분리될 수 있음

**메모**:

- 다음 major에서 sync factory로 단순화하거나, 반대로 실질적 async 초기화를 이 경계로 올려 이유를 분명히 하는 방향을 검토할 가치가 있음

---

### [IMP-006] 느린 통합 테스트를 위한 별도 자동화 레인 보강

**우선순위**: 중간  
**상태**: 완료  
**위치**: `test/`, CI 설정

**설명**:

- `test:ci:fast`는 광범위한 유닛/통합 테스트를 포함하지만, 실제 브라우저 회귀와 일부 느린 경로는 기본 CI에서 빠짐

**영향**:

- 느린 통합 회귀가 수동 실행에 의존함

**완료 메모**:

- 기본 workflow가 `validate:standalone-browser`를 실행하면서 브라우저 통합 회귀가 수동 실행 경로에만 남지 않게 됨

---

### [IMP-007] retry 판정을 문자열 부분일치 대신 구조화된 failure kind로 전환

**우선순위**: 높음  
**상태**: 완료  
**위치**: `src/compiler.ts`

**설명**:

- 현재 retry 여부는 stderr를 소문자로 바꾼 뒤 여러 문자열 패턴에 대해 `includes()`로 판단함
- 브라우저 wording, 상위 레이어 wrapping, 에러 메시지 변경에 매우 취약함

**영향**:

- retry가 갑자기 동작하지 않거나, 반대로 잘못 retry할 수 있음

**완료 메모**:

- worker failure message에 `failureKind`를 실었고, retry policy는 kind 우선 + 문자열 fallback으로 판단함

---

### [IMP-008] src/compiler.ts의 역할 분리

**우선순위**: 중간  
**상태**: 완료  
**위치**: `src/compiler.ts`

**설명**:

- 파일 길이가 689줄이며, progress, retry 정책, worker orchestration, mirrored bitcode fallback, llvm link 호출을 주로 담당함
- mirrored bitcode -> llvm-wasm link 흐름이 timeout, worker error, worker settled 경로마다 반복됨

**영향**:

- 분기 누락과 회귀 위험이 커지고 테스트 경계도 거칠어짐

**완료 메모**:

- preload/cache 경로를 `src/compiler-preload.ts`로 분리함
- bundled runtime manifest/target resolution을 `src/compiler-runtime.ts`로 분리함
- request validation과 result/error helper를 `src/compiler-support.ts`로 분리해 `compiler.ts`의 책임을 줄임

---

### [IMP-009] result.logs가 로그 레벨 정보를 버리지 않도록 개선

**우선순위**: 중간  
**상태**: 완료  
**위치**: `src/compiler.ts`

**설명**:

- 내부 `BufferedCompileLog`는 `level`과 `message`를 모두 저장함
- 하지만 API 경계의 `readCompileLogs()`는 `string[]`만 반환해 warn/error/debug 구분을 잃음

**영향**:

- 소비자 쪽 UX에서 경고와 오류를 분리하기 어려움

**완료 메모**:

- 하위 호환 `result.logs`는 유지하고, level-preserving companion field `result.logRecords`를 추가함

---

### [IMP-010] test:browser와 validate:standalone-browser의 역할을 한 방향으로 정리

**우선순위**: 중간  
**상태**: 완료  
**위치**: `package.json`, `scripts/validate-standalone-browser.mjs`

**설명**:

- `test:browser`는 `build + probe`를 수행함
- `validate:standalone-browser`는 `test:ci:fast + probe + browser vitest + playwright`를 수행함
- 둘 다 브라우저 검증 경로지만 freshness 보장 범위와 책임이 달라 진입점 의미가 모호함

**영향**:

- 어떤 명령이 최종 검증 기준인지 한눈에 들어오지 않음

**완료 메모**:

- `validate:standalone-browser`가 `test:ci:browser`를 감싸는 canonical 경로로 정리됨

---

### [IMP-011] retry failure kind 적용 범위를 더 넓혀 문자열 fallback 의존을 줄이기

**우선순위**: 높음  
**상태**: 완료  
**위치**: `src/compiler.ts`, `src/compiler-worker.ts`, `src/worker-protocol.ts`

**설명**:

- 현재는 `helper-thread`, `worker-bootstrap`, `compile-timeout`만 구조화된 failure kind로 판정함
- metadata decode, invalid rlib, rustc panic 같은 여러 retry 경로는 여전히 stderr 부분일치에 기대고 있음

**영향**:

- 브라우저/런타임 에러 wording이 바뀌면 retry가 갑자기 꺼지거나 과하게 켜질 수 있음

**완료 메모**:

- shared classifier를 도입해 host와 worker가 같은 retryable failure kind 집합을 사용하도록 맞춤
- `runtime-trap`, `thread-pool-exhausted`, `stale-runtime-metadata`, `compiler-panicked` kind를 추가했고, worker가 retryable rustc 종료를 structured error로 올리도록 변경함
- host 쪽 retry 판정도 kind 우선, 문자열 분류 fallback 보조 경로로 정리함

---

### [IMP-012] browser CI를 Chromium 설치까지 포함한 self-contained 경로로 정리

**우선순위**: 중간  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`, `scripts/probe-browser-harness.mjs`, `test/browser-playwright-integration.test.ts`

**설명**:

- probe 스크립트와 direct Playwright integration test는 모두 `WASM_RUST_CHROMIUM_EXECUTABLE` 또는 `~/.cache/ms-playwright/chromium-*`만 바라봤음
- 기본 workflow는 브라우저 설치 없이 `validate:standalone-browser`를 실행해 clean runner에서 환경 상태 의존성이 남아 있었음
- Chromium 해상 로직과 manifest target 해상 로직도 probe/test 양쪽에 중복돼 있었음

**영향**:

- browser CI가 러너 캐시 상태에 따라 flaky해질 수 있고, 해상 로직 수정 시 두 경로를 따로 고쳐야 함

**완료 메모**:

- workflow에 pinned Playwright Chromium install step을 추가해 browser lane을 self-contained하게 만듦
- probe와 Playwright integration test가 공용 browser harness runtime helper를 재사용하도록 정리함

---

### [IMP-013] GitHub Actions JavaScript action 런타임 경고 추적

**우선순위**: 낮음  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`

**설명**:

- 최근 CI run summary에는 `actions/checkout@v4`, `actions/setup-node@v4` 관련 JavaScript action runtime 경고가 남아 있었음
- GitHub가 기본 런타임을 Node 24로 올리는 일정이 예고돼 있어, action major/version pin을 재검토할 시점이 다가오고 있음

**영향**:

- 당장 테스트 실패를 만들지는 않지만, 일정 시점 이후 workflow 경고나 호환성 이슈로 번질 수 있음

**완료 메모**:

- `actions/checkout`을 `v6`, `actions/setup-node`를 `v6`, `pnpm/action-setup`을 `v5`로 올려 Node 24 migration warning을 정리했고, workflow contract test에도 반영함

---

### [IMP-014] clean-run browser CI는 released runtime fallback과 current runtime freshness 사이의 tradeoff가 남음

**우선순위**: 낮음  
**상태**: 제안  
**위치**: `.github/workflows/ci.yml`, `scripts/prepare-runtime.mjs`

**설명**:

- clean GitHub runner에서는 latest release의 `dist/runtime` bundle을 hydrate한 뒤 browser lane을 진행함
- 이 방식은 CI를 self-contained하게 만들지만, current branch의 runtime packaging 변경을 clean-run e2e로 직접 검증하는 것은 아님

**영향**:

- `prepare-runtime.mjs`나 runtime asset layout의 회귀는 unit/script contract coverage로는 잡히더라도, clean-run browser lane에서는 latest release runtime에 의해 가려질 수 있음
- richer `wasm32-wasip2` browser sample은 hydrated bundle이 실제로 그 target을 포함할 때만 검증되므로, clean-run lane의 target coverage는 release artifact 상태에 계속 좌우됨

**권장 조치**:

- 장기적으로는 runtime source toolchain/cache artifact를 CI에서 provision하거나, branch-scoped runtime artifact build lane을 별도로 두는 편이 더 강한 검증이 됨

---

## 📋 요약

| ID | 유형 | 우선순위/심각도 | 상태 |
|---|---|---|---|
| BUG-001 | 버그 | 낮음 | 완료 |
| BUG-002 | 버그 | 낮음 | 완료 |
| BUG-003 | 버그 | 정보 | 완료 |
| BUG-004 | 버그 | 중간 | 완료 |
| BUG-005 | 버그 | 중간 | 완료 |
| BUG-006 | 버그 | 중간 | 완료 |
| BUG-007 | 버그 | 중간 | 완료 |
| BUG-008 | 버그 | 중간 | 완료 |
| BUG-009 | 버그 | 중간 | 완료 |
| DOC-001 | 문서 | 중간 | 완료 |
| DOC-002 | 문서 | 낮음 | 완료 |
| DOC-003 | 문서 | 낮음 | 완료 |
| DOC-004 | 문서 | 중간 | 완료 |
| DOC-005 | 문서 | 중간 | 완료 |
| DOC-006 | 문서 | 중간 | 완료 |
| DOC-007 | 문서 | 중간 | 완료 |
| DOC-008 | 문서 | 낮음 | 완료 |
| DOC-009 | 문서 | 낮음 | 완료 |
| IMP-001 | 개선 | 높음 | 완료 |
| IMP-002 | 개선 | 낮음 | 완료 |
| IMP-003 | 개선 | 낮음 | 완료 |
| IMP-004 | 개선 | 낮음 | 완료 |
| IMP-005 | 개선 | 낮음 | 완료 |
| IMP-006 | 개선 | 중간 | 완료 |
| IMP-007 | 개선 | 높음 | 완료 |
| IMP-008 | 개선 | 중간 | 완료 |
| IMP-009 | 개선 | 중간 | 완료 |
| IMP-010 | 개선 | 중간 | 완료 |
| IMP-011 | 개선 | 높음 | 완료 |
| IMP-012 | 개선 | 중간 | 완료 |
| IMP-013 | 개선 | 낮음 | 완료 |
| IMP-014 | 개선 | 낮음 | 제안 |
