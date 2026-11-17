# Verilog browser execution

`VERILOG` runs original Icarus Verilog 14.0 development compiler and simulator
in a fresh browser Worker. The SDK defaults to `main.v`; the page uses `main.sv`. `.v` and `.sv`
files compile; `.sv` is recognized automatically. `.v` keeps its existing V-language
file association, so select Verilog explicitly for `.v` source. Source files in `workspaceFiles` are compiled together;
`.vh`/`.svh` headers and data files are available for includes and simulation I/O.
The editor currently uses plain text.

The default example reads an integer from the standard-input descriptor and
prints it:

```verilog
module main;
  integer value;
  initial begin
    if ($fscanf(32'h80000000, "%d", value) == 1)
      $display("value=%0d", value);
  end
endmodule
```

UTF-8 standard input may be prebuffered or supplied after execution starts.
EOF is delivered through the original C file I/O implementation. The standard
unbuffered simulator option preserves output without a final newline, and
`$stop` terminates the batch simulation. Source errors
and simulator messages preserve the original output; compiler source locations
are also sent as editor diagnostics. `programArgs` (or legacy `args`) follow the
generated VVP program, so `$value$plusargs` and `$test$plusargs` work normally.
Compiler arguments are rejected; this profile selects Verilog 2012 with Icarus's
usual partial SystemVerilog support. It does not claim full SystemVerilog support.

Execution supports cancellation, compile/run deadlines, output limits, private
file-growth limits and a combined Wasm memory bound across the three stages. Workspace files are isolated
for each run. Simulation writes and VCD files are not exported to the editor.
Native VPI plugins, external processes and network access are unavailable.
Prepare verifies the runtime and starts a worker without executing source.

Hosts serve `static/wasm-verilog/` under `runtimeAssets.rootUrl`. The worker and
all compiler/runtime payloads are pinned by length and SHA-256. The source pins,
original build recipe and license notices are under `runtimes/wasm-verilog/`.
Run `pnpm test:browser:verilog` for real Chromium compilation and simulation.

The six original engine payloads are stored as inert `*.gz.bin` files. The
receipt-verified preflight bounds delivery and decompression, verifies the
original uncompressed byte hashes, and transfers those original bytes to the
worker. This works without a service worker and survives production asset
compression; the small host worker and manifest retain their identity URLs.
