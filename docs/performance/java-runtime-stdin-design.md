# Java: compile the program, not its input

## Two independent forms of reuse

The source compiler and TeaVM code generator are expensive compared with replacing an input buffer. Embedding stdin bytes in generated Java source makes an input edit look like a program edit; it also lets large input inflate source and emitted artifacts. The browser path now generates one fixed InputStream helper and supplies fresh input through a per-execution host object. Source/workspace/compiler changes still invalidate the artifact, but changing stdin or explicit/interactive mode does not.

The host owns UTF-8 bytes and a cursor. readChunk returns a view of at most 4096 bytes; readByte shares the same cursor for compatibility. Exhaustion releases the retained source allocation. Empty interactive chunks do not mean EOF; null does. Explicit input never falls through to an interactive wait. Disposal ends both read APIs and clears retained input.

The Java side owns a copied byte array for its current block. read(byte[],offset,length) copies from that block rather than requesting the host for each byte. Zero-length reads do not consume input, unsigned single-byte reads return 0..255, and EOF is sticky. This preserves the InputStream contract rather than providing a custom parser for Scanner or BufferedReader.

## Why the implementation changed after real CI

The first draft used a generated @JSBody method returning byte[]. Its host mocks could exercise the JavaScript text, but the pinned source compiler overflowed its stack before TeaVM code generation. A minimal @JSBody source also reproduced that failure, including with a single literal script. An annotation-free equivalent compiled. The repair uses existing precompiled classlib JSO overlay APIs: Window, JSMapLike, JSFunction and Int8Array. The helper itself declares no @JSBody method and does not disable compiler validation or enlarge the test stack.

JSObjects.hasProperty checks for readChunk before reading a missing property through a Java JSObject cast. This matters for the retained byte-only bridge: the real Wasm-GC test exposed a ClassCastException when an absent JavaScript property was read as a JSObject. The fallback is now exercised through the actual generated artifact, not only a mock.

The copied block is populated through Int8Array index reads. These still perform per-byte overlay access; this PR does not claim to eliminate every JS/Wasm boundary crossing or implement zero-copy Java arrays. What it removes is per-byte input acquisition/blocking protocol work and input-dependent recompilation. A future bulk-copy primitive must be verified with the pinned backend; @JSByRef is not assumed portable to Wasm GC.

## Cache and lifecycle boundaries

The helper protocol key is host-chunks-v2-jso, so artifacts created with the previous helper cannot be reused accidentally. Runtime startup still verifies asset views, overlaps downloads/initialization, rejects partial initialization and revokes loader Blob URLs. The startup test's dependency allowlist follows the extracted module; its existing readiness, retry and byte-view assertions remain intact.

Before a blocking input request the browser worker flushes pending prompts. It installs the host bridge and its Window alias only for execution, then disposes input and restores prior bindings in finally, including after runtime failures. A new Wasm instance gives the helper fresh static state. The standalone prepareJavaStdinInjection snapshot API is unchanged for external callers that intentionally compile input into source.

## Actually executed validation

Using the CI dependency/runtime snapshot (Node 24.21.0 / TypeScript 6.0.3 / Vitest 5.0.3), the real TeaVM compiler compiled the helper and program and generated one Wasm artifact. That exact byte sequence executed five input cases: empty, Korean/emoji/accented UTF-8, 110000-byte input, initial plus interactive chunks, and the byte-only legacy bridge. Assertions verify byte count and checksum, zero-length reads, stable EOF, unchanged artifact bytes and no byte fallback for a chunk-capable bridge.

The 110000-byte explicit case performs 28 block acquisitions including EOF. This is an observed call-count property of that fixture, not a measured browser throughput gain. The 13 startup and 14 prepare-cache tests also passed on the pinned focused setup; the 13 host/helper regressions are now collected in normal root CI. This is genuine TeaVM/Wasm execution in Node, not a browser UI benchmark. Browser terminal rendering, cancellation while waiting, long sessions and broad classlib programs still require their separate checks.

## Measurements before promotion

Compare unchanged-source/different-input runs, source edits, empty input, large input and interactive sessions. Record source-compile and code-generation counts, compile-to-ready time, artifact bytes, first prompt/output, block acquisition count, read throughput and retained memory. A result with fewer messages but worse wall time is not a successful optimization. Do not infer total application startup savings from warm input-only reruns.

Reference: TeaVM's JSO documentation describes overlay types, primitive-array conversion and Wasm-GC limitations: https://teavm.org/docs/runtime/jso.html . The pinned bundled compiler's actual behavior, rather than the latest upstream feature list, is the acceptance authority for this helper.
