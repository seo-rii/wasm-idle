# Terminal byte binding

The optional `@wasm-idle/container/terminal` entrypoint connects a process's byte
streams to a host-owned renderer. It owns the three stream locks until completion
or disposal. Attach it before obtaining other readers or a writer for that process.

```ts
import { attachTerminal } from '@wasm-idle/container/terminal';

const process = await container.spawn('my-command');
const terminal = attachTerminal(process, {
  async render({ channel, text, signal }) {
    // Render text safely, for example through textContent or a terminal renderer.
    // Respect signal when scheduling work; do not interpret guest output as HTML.
    await renderer.append(channel, text, { signal });
  }
});
await terminal.write(new TextEncoder().encode('input\n'));
await terminal.closeInput(); // Explicit EOF; writing an empty array is not EOF.
const result = await terminal.completed;
```

The binding drains stdout and stderr concurrently and decodes each through its own
streaming UTF-8 decoder. A code point split across byte chunks remains intact;
invalid or unfinished sequences become replacement characters at this UI boundary.
BOM and NUL characters are preserved. Decoding never modifies a pipe or file, and
stderr is not merged into stdout. Order is preserved within each channel; there is
no global ordering promise between independent channels.

Renderer calls are serialized. Awaiting a renderer promise applies backpressure to
both process output streams. `maxRenderBytes` bounds the source bytes decoded per
step (default 4096; allowed 1–65536), with at most one pending step per channel.
The decoder may retain the few bytes of an incomplete UTF-8 sequence between steps;
the limit is not a character-count promise. The current process output chunk is
also retained until consumed, so the process's bounded pipe policy still matters.
The renderer owns its scrollback and DOM limits; the binding does not accumulate a
transcript or parse ANSI sequences.

`write()` copies its input before queuing, including Node Buffer inputs. Await it
before sending more input. `maxPendingInputBytes` bounds bytes retained by pending
writes (default 65536; allowed 1–1048576). Exceeding that limit rejects with
`RESOURCE_LIMIT`; the binding does not silently truncate input. `closeInput()` is
idempotent and closes stdin after queued writes. Empty writes do not wait or close
stdin. Input after explicit EOF rejects with `INVALID_ARGUMENT`; input after
completion or disposal rejects with `DISPOSED`.

`completed` resolves with the original process result after guest cleanup, both
output streams have drained, decoders have flushed, and all stream locks have been
released. Nonzero exits and runtime errors retain their process result. A renderer
or stream failure stops the process and rejects `completed` with the original
failure. Termination or stream cleanup cannot be guaranteed for an unrelated custom
process implementation that does not fulfill the `ContainerProcess` contract.

`terminate()` requests process termination and continues rendering buffered output.
Its promise covers the process stop; await `completed` to wait for the remaining UI
output. `dispose()` stops the process, aborts the rendering signal, discards pending
UI output and releases stream locks. It is idempotent and does not wait for an
arbitrary renderer promise that ignores cancellation. An already invoked renderer
must check its signal before performing later UI work. The signal is also aborted
when normal completion releases the binding. A slow renderer can delay `completed`
until it finishes or the binding is disposed.

This is a presentation binding, not a PTY or a shell session. It does not provide
`isatty`, termios, terminal resizing, job control, signal mapping, command parsing,
command resolution or a shell interpreter. Byte input reaches the attached
process unchanged: for example, a Ctrl-C byte does not itself request termination.
Use `terminate()` for the explicit host termination action. Full shell integration
remains gated separately.

## Validation

The checked-in `terminal.c`/`terminal.wasm` is a real WASI guest built by
`scripts/build-fixtures.mjs`. Node Worker contracts cover split Korean UTF-8,
independent decoders, malformed binary UI output, exact binary stdin and workspace
bytes, EOF, blocked stdin, blocked rendering, CPU-loop termination, renderer errors,
nonzero exit and runtime traps. Every scenario verifies lock/process cleanup and
starts another real guest in the same container. Protocol tests separately cover
serialized renderer calls, input ownership and queue limits, transactional lock
acquisition and disposal reentrancy.

`pnpm --dir packages/container test:terminal` repeats the shared seven scenarios in
isolated Chromium under restrictive CSP. Its JSON evidence records the exact
application commit, source and guest hashes, browser/OS, worker counts and results;
CI writes this to `.codex/container-terminal.json`. These contracts qualify the SDK
binding, not an application renderer, PTY or actual shell.

The committed `test/fixtures/terminal-browser-evidence.json` records the first
passing Chromium 153/Linux run: seven scenarios, fifteen Workers created and none
remaining, cross-origin isolation enabled, and no CSP or page errors. Its source
hashes identify the tested implementation independently of later documentation
or evidence commits.
