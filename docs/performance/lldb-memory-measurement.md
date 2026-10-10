# LLDB lifecycle heap measurements must be fresh

## Observed failure, not an assumed runtime leak

At b784a159e3ef5fa4cc4962545d561ede1517d790, normal CI 38019085089 passed. The separate LLDB run 38019085090 completed stepping, crash recovery, transport stress and worker-lifecycle assertions but failed the post-stop renderer heap guard: 132063012 bytes of apparent growth against the unchanged 67108864-byte limit. This is retained as failed evidence. The new public-API test/documentation commit did not change production runtime code compared with the preceding feature head; that observation does not by itself prove the memory failure is harmless.

The test requests GC and immediately reads performance.memory.usedJSHeapSize. Chromium's MemoryInfo implementation ordinarily caches these values (50 ms in precise cross-origin-isolated mode, much longer with bucketization). Consequently an immediate post-GC query is not guaranteed to observe the post-GC heap. Chromium's PreciseMemoryInfo flag bypasses this cache and bucketization. GetHeapSize includes V8 used heap plus external memory, so replacing it with only CDP Runtime.getHeapUsage.usedSize would incorrectly omit the backing allocations relevant here.

Primary source: https://chromium.googlesource.com/chromium/src/+/abe0507666c40/third_party/blink/renderer/core/timing/memory_info.cc . CDP explicitly reports backingStorageSize separately: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage . These implementation details motivate measurement calibration, not a declaration that all observed product growth is a cache artifact.

## Change and invariants

The Linux LLDB CI job creates a temporary executable launcher that execs the exact installed Playwright Chromium with --enable-precise-memory-info and every caller argument unchanged. It uses the existing WASM_IDLE_CHROMIUM_EXECUTABLE override; the product test file and all assertions remain byte-for-byte unchanged. No heap limit, relaunch count, GC call, worker check, strict-CSP setting or runtime asset is relaxed. The wrapper refuses to overwrite an existing path, verifies executable access and safely quotes paths. This is test-only browser instrumentation, not a production browser requirement.

A calibration runs before the product test. A deliberately retained 96 MiB ArrayBuffer must exceed the same 64 MiB threshold; releasing it and requesting GC must return near baseline. This prevents a frozen low measurement from making the CI falsely pass. The actual LLDB product test still runs afterward and can fail independently. Local developers can generate the same launcher and set WASM_IDLE_CHROMIUM_EXECUTABLE when running the existing test command.

## Executed locally

On installed Chromium 144.0.7559.96, a four-cycle allocation probe without the flag reported a constant bucketized 10000000 bytes while CDP showed the allocation/release. With the flag, readings immediately reflected retained 128 MiB buffers and returned near baseline after release. This local page was not cross-origin-isolated, so it demonstrates cache/bucketization behavior but does not reproduce the product's isolated-page 50 ms timing exactly. The container blocked navigation to its local HTTP test server; no complete local product browser run is claimed.

The actual generated launcher and calibration subsequently ran: baseline 680301, retained 101342194, released 678729 bytes. The retained delta 100661893 exceeds 64 MiB; released delta is -1572. These are calibration observations, not a debugger memory reduction. The 22 focused launcher/workflow unit tests passed using Node 24.21.0 and Vitest 5.0.3. Fresh remote product CI on the new head remains the acceptance authority; if it fails, collect heap snapshots rather than increasing the guard or retrying until green.
