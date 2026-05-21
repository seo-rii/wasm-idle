좋은 방향이다. 표준 준수를 우선한다면, 이 프로젝트는 “브라우저용 새 Go 구현”이 아니라 업스트림 Go toolchain을 브라우저에 이식하는 작업으로 정의하는 게 맞다. 기준 버전은 Go 1.26.1로 고정하는 걸 권한다. Go 1.24에서 go:wasmexport, WASI reactor/library, wasm 지원 파일의 lib/wasm 이동이 있었고, Go 1.26에서는 wasm의 작은 힙 구간 메모리 사용이 더 줄었다. 또 js/wasm 산출물은 같은 major 계열의 wasm_exec.js와 맞춰 써야 한다. �
Go.dev +3
내가 권하는 한 줄 설계는 이것이다.
업스트림 cmd/compile + cmd/link를 그대로 wasm으로 옮기고, 브라우저 쪽은 WASI 호스트 + 빌드 플래너 + 캐시만 만든다.
이렇게 잡는 이유는 분명하다. 공식 문서상 Go 툴체인은 Go로 작성되어 있고, cmd/compile은 단일 패키지를 컴파일해 -pack으로 archive를 바로 만들 수 있으며, 다음 패키지를 컴파일할 때는 의존 패키지의 소스가 아니라 컴파일된 결과물만 있으면 된다. 반면 go 명령은 build/run/test/mod/work/tool까지 포함한 큰 오케스트레이터다. 그리고 실제 컴파일러는 go/parser·go/types 중심이 아니라 cmd/compile/internal/syntax, types2, IR, linker 파이프라인 위에 서 있으므로, 표준 준수 목표라면 AST 기반 “유사 컴파일러”를 새로 쓰는 쪽보다 업스트림 컴파일러를 재사용하는 쪽이 훨씬 낫다. �
Go.dev +6
또 첫 호스트 타깃은 js/wasm보다 **wasip1/wasm**으로 두는 게 낫다. 공식 Go 자료에서 wasip1은 파일시스템·시계·랜덤 같은 자원을 WASI ABI로 다루고, “거의 대부분의 Go 기능”이 동작하며 표준 라이브러리 테스트를 통과한다고 설명한다. 반대로 브라우저 전용 syscall/js는 js/wasm에서만 쓰이고 아직 실험적이며, JS에서 들어온 Go 콜백이 막히면 이벤트 루프가 멈추고 fetch 같은 비동기 API는 즉시 deadlock을 낼 수 있다. 그래서 컴파일러/링커 자체는 wasip1/wasm으로 구동하고, 사용자 산출물 타깃은 1차 wasip1/wasm, 2차 js/wasm 순으로 늘리는 것이 가장 안정적이다. �
Go.dev +4
표준 준수의 범위를 먼저 나눠라
언어/컴파일러 준수
Go spec, 파서/타입체커/IR/코드생성/링커 결과를 업스트림과 최대한 같게 만든다.
이 층은 cmd/compile, cmd/link를 그대로 쓰는 것으로 달성한다. �
Go.dev +2
빌드/모듈 준수
go.mod, go.sum, GOPROXY, 체크섬 검증, 패키지 그래프, build tags, go:embed 등을 맞춘다.
이 층은 처음부터 cmd/go 전체를 넣기보다 브라우저용 빌드 플래너로 단계적으로 맞춘다. GOPROXY와 checksum DB는 공식 프로토콜이 있다. �
Go.dev +2
런타임/표준 라이브러리 준수
이건 타깃별로 분리해야 한다. wasip1/wasm은 CLI·stdio·fs 쪽이 강하고, js/wasm은 브라우저 API·DOM·fetch 쪽이 강하다. plain wasip1에는 소켓 열기 API가 완전하지 않아 HTTP 서버 같은 기능은 그대로는 못 맞춘다. js/wasm은 net/http 클라이언트가 fetch로 매핑된다. �
Go.dev +2
권장 아키텍처
A. toolchain core
브라우저에서 돌아가는 핵심은 업스트림 cmd/compile과 cmd/link다.
cmd/go는 초기에 넣지 말고, 나중에 go build/go run/go test 호환 레이어를 얹는다. �
Go.dev +3
B. browser host
컴파일러 모듈은 main thread가 아니라 Web Worker에서 돌린다.
Worker 안에 WASI 호스트를 두고 /, PWD=/, stdin/stdout/stderr, clock, random, fs를 제공한다.
GOOS=wasip1에서는 guest root / 매핑과 PWD=/ 설정이 안 되면 os.Getwd, ReadDir, ReadFile 오류가 어긋날 수 있으니 이건 초기 스펙에 박아두는 게 좋다. �
Go.dev +2
C. build planner
브라우저 바깥의 “OS/쉘”을 기대하지 않고, JS/TS 또는 작은 Go 프런트엔드 하나가 빌드 계획을 세운다.
이 플래너가 패키지 그래프를 계산하고 importcfg, embedcfg를 만든 뒤 go tool compile -pack ..., go tool link ...에 해당하는 호출을 수행한다. compile은 -importcfg, -embedcfg, -lang, -trimpath, -pack 같은 플래그를 이미 공식 지원한다. �
Go.dev +1
D. sysroot
표준 라이브러리는 처음부터 브라우저 안에서 소스 빌드하지 말고, 타깃별 precompiled sysroot로 시작한다.
즉 wasip1/wasm용 stdlib archive 집합 하나, 이후 js/wasm용 stdlib archive 집합 하나를 배포 자산으로 둔다.
이 방식이 가능한 이유는 cmd/compile이 의존 패키지의 소스가 아니라 컴파일된 출력만으로 다음 패키지를 컴파일할 수 있기 때문이다. �
Go.dev
E. module service
모듈 해상도는 GOPROXY 프로토콜 우선으로 간다.
공식 문서에 .mod, .info, .zip 요청 형식과 go.sum/checksum DB 검증 방식이 정리돼 있으니, 브라우저에서는 direct VCS보다 이 경로가 훨씬 표준적이고 구현도 단순하다.
1단계는 proxy-only, 2단계에서 GOPROXY 체인, 그다음에야 direct를 고민하면 된다. �
Go.dev
F. runtime split
산출물 실행기는 둘로 나눈다.
wasip1/wasm: 컴파일러, 테스트, CLI, stdio, fs.
js/wasm: 브라우저 앱, syscall/js, DOM, fetch, wasm_exec.js.
js/wasm은 공식 wasm_exec.js와 버전 계열을 맞춰야 하고, net/http 클라이언트가 fetch로 바뀌며 js.fetch:* 헤더로 일부 옵션을 제어한다. �
Go.dev +2
구현 순서
0단계: 버전 고정과 자산 매니페스트
go1.26.1 정확한 태그를 기준으로 잡고, 아래 자산을 하나의 manifest로 묶는다.
compile.wasm
link.wasm
stdlib-wasip1.sysroot
stdlib-js.sysroot(초기엔 비워도 됨)
wasm_exec.js
“같은 toolchain 버전으로 빌드된 자산만 섞어 쓴다”를 규칙으로 고정한다. js/wasm 쪽은 공식적으로도 wasm_exec.js와 major 버전 일치가 요구된다. �
Go.dev +2
1단계: 브라우저 WASI substrate
먼저 컴파일은 아직 안 하고, prebuilt wasip1/wasm hello world와 fs/time/random 샘플을 브라우저에서 안정적으로 실행시킨다.
성공 조건은 stdout/stderr, 종료 코드, / 매핑, PWD=/, 파일 읽기/쓰기, os.Getwd, time.Now, crypto/rand.Read가 기대대로 동작하는 것이다.
이 단계가 흔들리면 나중에 컴파일러를 올려도 표준 라이브러리 동작이 전부 흔들린다. �
Go.dev +2
2단계: cmd/compile MVP
업스트림 cmd/compile을 wasip1/wasm으로 빌드해 Worker 안에서 실행한다.
처음엔 single-package, no-import만 지원한다.
플래너가 소스 파일 묶음과 import path를 넘기고, 컴파일러는 .a archive를 낸다.
최소 플래그는 -p, -pack, -lang, -trimpath, -o 정도로 시작하면 된다. 이 단계의 목표는 “빌드 성공”보다 오류 메시지와 위치 정보가 업스트림과 같아지는 것이다. �
Go.dev
3단계: cmd/link 연결
업스트림 cmd/link를 붙여 main.a에서 실행 가능한 .wasm을 만든다.
이제 브라우저 안에서 “소스 입력 → compile → link → run” 전체 루프가 생긴다.
이 시점의 제품 정의는 “순수 Go, imports 거의 없음, 단일 패키지 앱이 브라우저 안에서 컴파일되고 실행된다” 정도면 충분하다. �
Go.dev
4단계: precompiled stdlib sysroot
이제 wasip1/wasm용 표준 라이브러리 archive들을 sysroot로 넣고 importcfg 해상도를 구현한다.
여기서 fmt, errors, bytes, strings, unicode/utf8, context, encoding/json, regexp, os, io/fs, time, crypto/rand 같은 패키지를 우선 연다.
//go:embed가 있는 순간 -embedcfg가 필요하므로, 이 단계에서 같이 구현하는 게 좋다. �
Go.dev
5단계: modules
go.mod/go.sum 파서, GOPROXY fetch, checksum verification, 모듈 캐시, 패키지 캐시를 구현한다.
브라우저 버전의 “표준 준수”는 여기서 크게 올라간다. 공식 프로토콜대로 .mod, .info, .zip를 받고 go.sum 및 checksum DB 규칙을 따르도록 설계하면 된다.
direct VCS는 뒤로 미루고, 1차는 proxy-only가 맞다. �
Go.dev
6단계: js/wasm 출력 모드 추가
두 번째 산출 타깃으로 GOOS=js GOARCH=wasm을 추가한다.
별도 stdlib sysroot를 만들고, 실행기는 공식 wasm_exec.js 기반으로 붙인다.
이 단계부터 syscall/js, DOM 바인딩, 브라우저 친화 net/http를 제공한다. 다만 syscall/js 자체는 실험적이고 callback deadlock 제약이 있으므로, UI thread와 Worker 경계를 더 엄격하게 유지해야 한다. �
Go.dev +2
7단계: persistent compiler service
성능이 문제되면 wasip1 쪽에서 컴파일러를 reactor/library 형태로 오래 살아 있게 만든다.
Go 1.24부터 -buildmode=c-shared로 WASI reactor를 만들 수 있고 go:wasmexport도 공식 지원된다.
다만 이걸 적용할 때 exported ABI는 작게 잡아야 한다. 공식 문서상 go:wasmimport/go:wasmexport는 bool, int32/64, uint32/64, float32/64, unsafe.Pointer, 일부 pointer류, string(인자만 가능) 등 제약이 있고, 포인터 제약도 남아 있다. 또 background goroutine은 exported call이 반환된 뒤 계속 돌지 않는다. 그래서 복잡한 결과는 JSON string return보다 linear memory + ptr/len 또는 임시 파일 방식이 안전하다. �
Go.dev +3
8단계: go build/go run/go test 호환 레이어
마지막에 브라우저용 go façade를 얹는다.
내부적으로는 여전히 build planner가 package graph, compile, link, run을 orchestrate한다.
공식 go 명령 문서와 go run/go test 동작을 참조해, 최소한 build, run, test의 사용자 경험만 맞추면 된다. go_js_wasm_exec, go_wasip1_wasm_exec 같은 공식 실행자 동작은 좋은 오라클이다. �
Go.dev +3
표준 라이브러리 지원 우선순위
1순위: pure Go / host-neutral
fmt, errors, bytes, strings, unicode/*, cmp, slices, sort, context, encoding/json, regexp, math/*
2순위: wasip1 host-backed
os, io/fs, path/filepath, archive/*, compress/*, time, crypto/rand
plain wasip1에서는 소켓 열기가 완전하지 않아 HTTP 서버는 후순위로 둔다. �
Go.dev
3순위: js/wasm browser-backed
syscall/js, DOM wrappers, net/http client
net/http는 fetch로 매핑되고 js.fetch:mode, js.fetch:credentials, js.fetch:redirect 같은 헤더가 특별 취급된다. �
Go.dev +1
명시적 후순위/비목표
cgo
plugin
os/exec
direct VCS mode
plain wasip1에서의 full socket server
“업스트림 cmd/go 전체를 그대로 브라우저에 얹기”
핵심은 지원률 숫자를 말하지 말고, wasip1/wasm과 js/wasm 각각의 패키지/기능 매트릭스를 따로 공개하는 것이다. 이게 가장 정직하고 표준적이다. �
Go.dev +2
테스트 전략
1. differential compiler tests
같은 소스 코퍼스를 native Go 1.26.1과 브라우저 compiler에 모두 넣고 비교한다.
비교 대상은
성공/실패 여부
stderr 텍스트
line/column
실행 stdout/stderr
종료 코드
초반에는 wasm 바이너리 바이트 비교보다 진단/행동 비교를 우선하라. �
Go.dev +2
2. 언어 회귀 코퍼스
generics, type inference, method set, interface satisfaction, init order, defer/panic/recover, maps/channels/select, unsafe, go:embed를 묶은 고정 코퍼스를 만든다.
표준 준수 목표라면 이 코퍼스가 제품의 진짜 KPI다.
3. stdlib 대상 allowlist 테스트
wasip1에서는 fmt, bytes, encoding/json, regexp, os, io/fs, time, crypto/rand부터 패키지별 allowlist를 만든다.
공식 설명상 wasip1은 stdlib 테스트를 통과하지만, plain socket opening은 빠져 있으니 네트워크 서버 패키지는 같은 버킷에 넣지 않는 게 맞다. �
Go.dev +1
4. module/proxy integrity tests
.mod, .info, .zip happy path
checksum mismatch
go.sum 누락/불일치
404/410 처리
캐시 hit/miss와 재검증
프록시 체인을 넣을 거면 comma fallback과 pipe fallback도 별도 테스트한다. 공식 모듈 레퍼런스에 이 규칙이 적혀 있다. �
Go.dev
5. target-specific host tests
wasip1
/ root 매핑 전/후 os.Getwd, ReadDir, missing file 에러
crypto/rand 동작
host call 동안 goroutine 전체 block 성질
js/wasm
js.FuncOf callback 안에서 blocking call
callback 안에서 http.Get/fetch를 새 goroutine 없이 호출하는 negative test
js.fetch:* 헤더 전달 테스트 �
Go.dev +3
6. browser integration tests
Node만으로 끝내지 말고 실제 Chromium + Playwright를 돌려라.
말씀한 seo-rii 스타일과 가장 잘 맞는 건 이 레이어다. wasm-idle도 실제 Chromium 경로에서 browser probe와 Playwright 테스트를 돌리고, stdin 한 줄 입력/EOF/terminal transcript를 회귀 테스트로 잡고 있다.
Go 쪽도 js/wasm은 공식 위키에 wasmbrowsertest 방식이 정리돼 있으니, browser test runner를 1급 시민으로 두는 게 좋다. �
GitHub +1
7. scheduler/cache tests
빌드 스케줄러·캐시 무효화·취소/재시도 로직이 Go로 작성된다면 testing/synctest를 쓰는 게 좋다.
Go 1.25부터 testing/synctest는 표준 라이브러리 정식 기능이고, 가상 시간과 bubble 모델로 동시성 테스트를 안정화해 준다. �
Go.dev
8. unsupported-feature tests
import "C"
plugin
os/exec
plain wasip1에서 socket listen
미지원 build tags
이런 입력이 들어왔을 때 침묵 실패가 아니라 명확한 에러가 나오는지 테스트해야 한다.
9. performance budgets
cold boot
warm rebuild
첫 module fetch
stdlib-heavy 프로젝트 첫 빌드
메모리 상한
이건 최적화 이전에도 baseline을 잡아둬야 한다. Go 1.26의 wasm 메모리 개선 덕을 보겠지만, 브라우저 안 컴파일은 여전히 무겁다. �
Go.dev
마지막으로, 함정 네 가지
첫째, go/parser/go/types 기반으로 새 컴파일러를 만들지 말 것. 공식 compiler README 자체가 그 패키지들이 실제 컴파일러에서 mostly unused라고 말한다. 표준 준수는 업스트림 compiler를 재사용할 때 가장 빨리 얻는다. �
Go.dev
둘째, cmd/go를 너무 일찍 넣지 말 것. go는 단순 컴파일러가 아니라 build/run/test/mod/work/tool 전체를 관리한다. 먼저 compile/link/module graph를 고정하고, 마지막에 go UX를 흉내 내는 편이 맞다. �
Go.dev +2
셋째, wasip1과 js/wasm을 하나의 “Go in browser”로 뭉개지 말 것. 파일/stdio/fs 중심 세계와 DOM/fetch 중심 세계는 다르다. capability matrix를 분리 공개해야 한다. wasip1은 full socket opening이 없고, js/wasm은 syscall/js 제약이 있다. �
Go.dev +2
넷째, 버전 섞어 쓰지 말 것. 특히 js/wasm은 wasm_exec.js와 toolchain 계열을 맞춰야 하고, Go 1.24 이후 wasm 지원 파일 위치도 바뀌었다. �
Go.dev +1
이 순서대로 가면 13단계에서 이미 **“브라우저 안에서 돌아가는 진짜 Go 컴파일러 + 링크 + 실행기”**가 생기고, 46단계에서 stdlib와 웹앱 모드가 붙는다. 표준 준수라는 목표에는 이 경로가 가장 곧다.
다음 단계는 이 스펙을 바탕으로 폴더 구조, manifest 형식, importcfg 생성 규칙, 캐시 키 설계까지 내려서 실제 구현 문서로 고정하는 것이다.