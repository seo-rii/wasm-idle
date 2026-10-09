# GolfScript runtime

The browser executes Darren Smith's original Ruby GolfScript interpreter from
[`darrenks/golfscript`](https://github.com/darrenks/golfscript/tree/cded542533c2c8f72ab2d5935714f739b0357690)
at commit `cded542533c2c8f72ab2d5935714f739b0357690`. `vendor/golfscript.rb` and
`static/wasm-golfscript/golfscript.rb` are byte-identical upstream source. Its
unchanged copyright and MIT license declaration from lines 3–4 is retained in
`LICENSE.txt`; upstream provides that declaration rather than a separate license file.

The existing verified Ruby 3.4.1/WASI VM hosts the complete upstream interpreter.
Each execution gets a fresh Ruby VM and stack, readonly source/workspace files,
and a fresh stdin stream. Preparation initializes Ruby without loading GolfScript
or parsing user source. The interpreter source has its own checked size/SHA-256
receipt, is transferred into the worker as owned bytes, and is verified there
before use. It is mounted separately from workspace byte quotas.

Run `node scripts/sync-wasm-golfscript.mjs` to reproducibly copy the checked source
and copyright notice. `--check` verifies all committed inputs and output receipts
offline. No new Ruby compiler or handwritten language implementation is involved.

The genuine CLI receives the active source path followed by the requested
interpreter options. `-q` suppresses implicit output, `-n` disables Ruby string
interpolation, and `-r` uses rational values for negative integer powers. `--`
passes following values as the original argument-array input instead of stdin.
With no argument-array input, the original interpreter consumes stdin through EOF
and starts with the entire input string on its stack. Its implicit final output
includes a newline, and it retains arbitrary-precision Ruby integers and upstream
Ruby interpolation semantics.

The WASI stdin descriptor is adapted to report pipe input to the original CLI;
the upstream interpreter itself is unchanged. Interactive terminal runs need EOF
after their input. Runtime mounts reserve `__wasm_idle_golfscript__`; caller files
cannot use that private namespace.
