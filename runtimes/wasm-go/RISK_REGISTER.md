# Risk Register

이 문서는 `wasm-go` 프로젝트의 정적 리뷰 후속 이슈와 처리 결과를 기록합니다.

갱신 기준: 2026-04-08 static review follow-up

상태 기준:

- `열림`: 현재 트리 기준으로 아직 남아 있는 이슈
- `완료`: 현재 트리 기준으로 수정 또는 문서 정리가 끝난 항목
- `제안`: 후속 투자/정책 결정이 필요한 항목

---

## 🔴 버그 (Bugs)

### [BUG-001] main 빌드가 compile 산출물 없이 link 단계로 진행될 수 있음

**심각도**: 높음  
**상태**: 완료  
**위치**: `src/compiler.ts`, `test/compiler.test.ts`

**설명**:

- `packageKind: 'main'` 경로는 `compile` exit code만 확인하고 곧바로 `link` 입력을 구성했음
- 그 결과 `/workspace/pkg/main.a`가 실제로 비어 있어도 더 뒤 단계에서 애매하게 실패할 수 있었음

**영향**:

- 실패 지점이 늦어지고 원인 파악이 어려움

**완료 메모**:

- main 경로에도 library 경로와 동일한 compile output guard를 추가했고, 출력 누락 시 즉시 실패하도록 회귀 테스트를 추가함

---

### [BUG-002] compile 실패 진단이 stdout 때문에 stderr를 놓칠 수 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/compiler.ts`, `src/compiler-support.ts`, `test/compiler.test.ts`

**설명**:

- 진단 파싱이 `stdout || stderr` 형태를 사용해 `stdout`이 비어 있지 않으면 `stderr`를 완전히 버렸음

**영향**:

- 실제 컴파일 오류가 diagnostics에서 사라질 수 있음

**완료 메모**:

- diagnostics 입력을 `stderr` 우선 병합으로 바꿨고, stderr의 실제 오류와 stdout 배너가 함께 유지되는 회귀 테스트를 추가함

---

### [BUG-003] packed sysroot 바이트 길이를 로드 후 검증하지 않음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/runtime-asset.ts`, `test/runtime-asset.test.ts`

**설명**:

- runtime pack index는 범위를 `totalBytes` 기준으로 검증했지만, 실제로 다운로드/해제된 pack 바이트 길이 자체는 확인하지 않았음

**영향**:

- truncated download나 잘린 압축 해제가 더 늦은 단계의 모호한 오류로 바뀔 수 있음

**완료 메모**:

- reference/index/file payload 길이 불일치를 즉시 거부하도록 했고, 잘린 pack payload를 재현하는 테스트를 추가함

---

### [BUG-004] build plan이 실행되지 않는 timeout 값을 tool invocation에 전파함

**심각도**: 높음  
**상태**: 완료  
**위치**: `src/build-planner.ts`, `src/types.ts`, `test/build-planner.test.ts`

**설명**:

- planner는 `timeoutMs`를 invocation에 실어 보냈지만, 내장 실행기는 이를 실제로 사용하지 않았음

**영향**:

- plan 소비자가 timeout enforcement가 존재한다고 오해할 수 있었음

**완료 메모**:

- public build plan/tool invocation 계약에서 사용되지 않는 `timeoutMs` 전파를 제거하고 회귀 테스트를 추가함

---

## 🟡 문서/계약 정리 (Documentation and Contract)

### [DOC-001] custom manifest 사용 시 실행 제약이 문서와 오류 메시지에 드러나지 않음

**심각도**: 중간  
**상태**: 완료  
**위치**: `README.md`, `src/compiler.ts`, `test/compiler.test.ts`

**설명**:

- `options.manifest`를 직접 주면 내장 실행 경로가 꺼지고 `dependencies.runTool`이 필요했지만, 이 제약이 README와 실패 메시지에 충분히 드러나지 않았음

**영향**:

- 소비자가 planning-only 동작을 surprising failure로 겪을 수 있음

**완료 메모**:

- README와 실패 메시지에 custom manifest 제약을 명시했고, 테스트 기대도 그 계약에 맞게 갱신함

---

### [DOC-002] README가 현재 prototype 범위와 준비 가능한 타깃/호스트를 과장되게 설명함

**심각도**: 중간  
**상태**: 완료  
**위치**: `README.md`

**설명**:

- 첫 문단이 특정 `WORK.md` 링크를 전제했고
- `prepare:runtime` 호스트 지원 범위를 좁게 적지 않았으며
- `wasip2/wasm`, `wasip3/wasm`의 preview1-compatible alias 성격과 `private: true` 상태가 충분히 드러나지 않았음

**영향**:

- 외부 사용자와 내부 사용자가 repo 상태를 다르게 이해할 수 있음

**완료 메모**:

- README를 private prototype 기준으로 다시 적고, 지원 호스트/타깃 매트릭스/preview alias/custom manifest 제약을 명시함

---

## 🔵 개선/운영 (Improvements and Ops)

### [ARCH-001] compile cache key가 dependency/embed 순서에 민감함

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/build-planner.ts`, `test/build-planner.test.ts`

**설명**:

- `importcfg`/`embedcfg` 생성은 정렬된 입력을 사용했지만, compile cache key는 원래 배열 순서를 그대로 해시했음

**영향**:

- 의미상 같은 요청인데도 순서만 달라 cache miss가 발생할 수 있음

**완료 메모**:

- dependency/embed 입력을 정규화한 뒤 config 생성과 cache hashing에 같이 쓰도록 정리했고 회귀 테스트를 추가함

---

### [ARCH-002] guest FS/WASI 보조 로직이 실행기마다 중복돼 드리프트 위험이 있음

**심각도**: 중간  
**상태**: 완료  
**위치**: `src/browser-execution.ts`, `src/tool-runtime.ts`, `src/wasi-guest.ts`

**설명**:

- guest path 정규화, 바이트 복제, stdout/stderr capture, guest file 쓰기/읽기 로직이 두 실행 경로에 중복돼 있었음

**영향**:

- 작은 수정에도 경로 간 동작이 쉽게 어긋날 수 있음

**완료 메모**:

- 공통 `wasi-guest` 유틸로 묶어 두 실행 경로가 같은 헬퍼를 사용하도록 정리함

---

### [OPS-001] 저장소 루트에 기본 CI 워크플로가 없음

**심각도**: 중간  
**상태**: 완료  
**위치**: `.github/workflows/ci.yml`

**설명**:

- 로컬 `check`/`test`/`validate:runtime` 스크립트는 존재하지만 자동 검증 워크플로가 없었음

**영향**:

- 정적 리뷰에서 확인한 계약이 계속 유지되는지 자동으로 확인할 수 없었음

**완료 메모**:

- GitHub Actions workflow를 추가해 `npm ci`, `npm run check`, `npm test`, `npm run validate:runtime`를 자동 실행하도록 함
