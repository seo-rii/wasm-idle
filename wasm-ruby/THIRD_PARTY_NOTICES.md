# wasm-idle Ruby runtime notices

The checked-in `static/wasm-ruby` runtime is produced from the following
content-locked npm packages. The producer verifies the installed package trees,
the package-manager integrity receipts, the derived executable graph, and every
legal file before publication.

## ruby.wasm and CRuby

- Packages: `@ruby/3.4-wasm-wasi@2.9.3-2.9.4` and
  `@ruby/wasm-wasi@2.9.3-2.9.4`
- Source: <https://github.com/ruby/ruby.wasm>
- Attested source revision: `3318796e2c9f0f75c98c669cabdc422cf8218ec2`
- Embedded CRuby identity: Ruby 3.4.1 revision
  `48d4efcb85000e1ebae42004e963b5d0cedddcf2`

The npm provenance attestation identifies the `ruby.wasm` release workflow and
source revision. It does not establish a byte-reproducible build of every CRuby,
WASI SDK, or third-party input. The complete upstream binary-distribution notice
is preserved as `NOTICE`; the ruby.wasm MIT license is preserved as `LICENSE`.

## Browser WASI shim

- Package: `@bjorn3/browser_wasi_shim@0.4.2`
- Source: <https://github.com/bjorn3/browser_wasi_shim>
- Source revision recorded by npm: `4a55f2a519d0ddfa7e4609c42e0c9769c37c9ae8`
- License: MIT OR Apache-2.0

Both upstream license choices are preserved under
`licenses/browser-wasi-shim/`.
