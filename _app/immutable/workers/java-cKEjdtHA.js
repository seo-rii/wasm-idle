function e(e){if(e.schemaVersion!==1)throw TypeError(`Unsupported runtime trust profile schema: ${String(e.schemaVersion)}`);if(!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(e.profileId))throw TypeError(`Runtime trust profile ID must be a non-empty stable identifier`);if(![`none`,`allowlist`,`unrestricted`].includes(e.network.mode))throw TypeError(`Unsupported runtime network mode: ${String(e.network.mode)}`);let t=e.network.allowedOrigins.map(e=>{let t;try{t=new URL(e)}catch{throw TypeError(`Runtime network allowlist contains an invalid origin: ${e}`)}if(t.protocol!==`https:`&&t.protocol!==`http:`||t.pathname!==`/`||t.search||t.hash||t.username||t.password)throw TypeError(`Runtime network allowlist requires HTTP(S) origins: ${e}`);return t.origin}),n=[...new Set(t)].sort();if(e.network.mode===`allowlist`&&n.length===0)throw TypeError(`Runtime network allowlist mode requires at least one origin`);if(e.network.mode!==`allowlist`&&n.length>0)throw TypeError(`Runtime network mode ${e.network.mode} cannot declare allowed origins`);if(![`none`,`ephemeral`,`persistent`].includes(e.storage.mode))throw TypeError(`Unsupported runtime storage mode: ${String(e.storage.mode)}`);if(![`none`,`allowlist`].includes(e.environment.mode))throw TypeError(`Unsupported runtime environment mode: ${String(e.environment.mode)}`);for(let t of e.environment.allowedNames)if(!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(t))throw TypeError(`Runtime environment allowlist contains an invalid name: ${t}`);let r=[...new Set(e.environment.allowedNames)].sort();if(e.environment.mode===`allowlist`&&r.length===0)throw TypeError(`Runtime environment allowlist mode requires at least one name`);if(e.environment.mode===`none`&&r.length>0)throw TypeError(`Runtime environment mode none cannot declare allowed names`);if(!Number.isSafeInteger(e.threads.maxThreads)||e.threads.maxThreads<0)throw TypeError(`Runtime maxThreads must be a non-negative safe integer`);if(!Number.isSafeInteger(e.workers.maxNestedWorkers)||e.workers.maxNestedWorkers<0)throw TypeError(`Runtime maxNestedWorkers must be a non-negative safe integer`);if(typeof e.sharedArrayBuffer!=`boolean`)throw TypeError(`Runtime sharedArrayBuffer capability must be boolean`);if(!e.sharedArrayBuffer&&e.threads.maxThreads>0)throw TypeError(`Runtime threads require SharedArrayBuffer capability`);if(![`none`,`wasm-only`,`javascript-and-wasm`].includes(e.dynamicCode))throw TypeError(`Unsupported runtime dynamic-code mode: ${String(e.dynamicCode)}`);if(typeof e.sameOriginAccess!=`boolean`)throw TypeError(`Runtime sameOriginAccess capability must be boolean`);return Object.freeze({schemaVersion:1,profileId:e.profileId,network:Object.freeze({mode:e.network.mode,allowedOrigins:Object.freeze(n)}),storage:Object.freeze({mode:e.storage.mode}),environment:Object.freeze({mode:e.environment.mode,allowedNames:Object.freeze(r)}),threads:Object.freeze({maxThreads:e.threads.maxThreads}),workers:Object.freeze({maxNestedWorkers:e.workers.maxNestedWorkers}),sharedArrayBuffer:e.sharedArrayBuffer,dynamicCode:e.dynamicCode,sameOriginAccess:e.sameOriginAccess})}e({schemaVersion:1,profileId:`restricted-browser-worker-v1`,network:{mode:`none`,allowedOrigins:[]},storage:{mode:`ephemeral`},environment:{mode:`none`,allowedNames:[]},threads:{maxThreads:0},workers:{maxNestedWorkers:0},sharedArrayBuffer:!1,dynamicCode:`wasm-only`,sameOriginAccess:!1}),5*BigInt64Array.BYTES_PER_ELEMENT,BigInt(2**53-1),typeof SharedArrayBuffer==`function`&&Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,`byteLength`)?.get;const t=Object.freeze(`C.C3.CPP.OBJC.PYTHON3.JAVA.RUST.GO.D.CSHARP.FSHARP.VBNET.ELIXIR.ERLANG.PROLOG.GLEAM.PERL.TCL.AWK.PASCAL.FORTH.J.BQN.JANET.JULIA.NIM.BASH.CLOJURESCRIPT.FORTRAN.LFORTRAN.COBOL.TINYGO.OCAML.JAVASCRIPT.TYPESCRIPT.ASSEMBLYSCRIPT.WAT.WASM.LUA.ZIG.LISP.RUBY.HASKELL.R.OCTAVE.DUCKDB.SQLITE.PHP`.split(`.`)),n=new Set([`C`,`CPP`,`PYTHON3`,`JAVA`]);new Set(t.filter(e=>!n.has(e)));const r={"C#":{canonicalId:`CSHARP`,kind:`spelling`},"F#":{canonicalId:`FSHARP`,kind:`spelling`},VB:{canonicalId:`VBNET`,kind:`spelling`},VISUALBASIC:{canonicalId:`VBNET`,kind:`spelling`},OBJECTIVEC:{canonicalId:`OBJC`,kind:`spelling`},OBJECTIVE_C:{canonicalId:`OBJC`,kind:`spelling`},"OBJECTIVE-C":{canonicalId:`OBJC`,kind:`spelling`},ERL:{canonicalId:`ERLANG`,kind:`spelling`},SWIPL:{canonicalId:`PROLOG`,kind:`implementation`},SWI:{canonicalId:`PROLOG`,kind:`implementation`},TCLSH:{canonicalId:`TCL`,kind:`implementation`},GAWK:{canonicalId:`AWK`,kind:`implementation`},PAS:{canonicalId:`PASCAL`,kind:`spelling`},FPC:{canonicalId:`PASCAL`,kind:`implementation`},GFORTH:{canonicalId:`FORTH`,kind:`implementation`},JL:{canonicalId:`JULIA`,kind:`spelling`},NIMROD:{canonicalId:`NIM`,kind:`spelling`},SH:{canonicalId:`BASH`,kind:`compatibility`},SHELL:{canonicalId:`BASH`,kind:`compatibility`},CLJS:{canonicalId:`CLOJURESCRIPT`,kind:`spelling`},F77:{canonicalId:`FORTRAN`,kind:`dialect`},COB:{canonicalId:`COBOL`,kind:`spelling`},CBL:{canonicalId:`COBOL`,kind:`spelling`},GNUCOBOL:{canonicalId:`COBOL`,kind:`implementation`},DLANG:{canonicalId:`D`,kind:`spelling`},JS:{canonicalId:`JAVASCRIPT`,kind:`spelling`},AS:{canonicalId:`ASSEMBLYSCRIPT`,kind:`spelling`},PYTHON:{canonicalId:`PYTHON3`,kind:`spelling`},PYPY3:{canonicalId:`PYTHON3`,kind:`implementation`,deprecated:!0,message:`PYPY3 runs the Pyodide implementation; use PYTHON3 instead.`},HS:{canonicalId:`HASKELL`,kind:`spelling`},RB:{canonicalId:`RUBY`,kind:`spelling`},SCHEME:{canonicalId:`LISP`,kind:`compatibility`,message:`SCHEME selects the bundled Puppy Scheme-compatible runtime.`},SCM:{canonicalId:`LISP`,kind:`compatibility`,message:`SCM selects the bundled Puppy Scheme-compatible runtime.`},TS:{canonicalId:`TYPESCRIPT`,kind:`spelling`},MATLAB:{canonicalId:`OCTAVE`,kind:`compatibility`,message:`MATLAB selects GNU Octave compatibility, not MATLAB.`},SQL:{canonicalId:`SQLITE`,kind:`dialect`,message:`SQL selects the SQLite dialect and engine.`},WASM32:{canonicalId:`WASM`,kind:`spelling`}};Object.freeze(Object.keys(r)),Object.freeze(Object.fromEntries(Object.entries(r).map(([e,t])=>[e,Object.freeze({alias:e,deprecated:!1,...t})]))),Object.freeze({maxFiles:256,maxFileBytes:2*1024*1024,maxTotalBytes:8*1024*1024,maxPathBytes:1024,caseSensitive:!1}),new TextEncoder,Object.freeze({assetTimeoutMs:6e4,startupTimeoutMs:6e4,compileTimeoutMs:12e4,runTimeoutMs:3e4,maxOutputBytes:1024*1024,maxDiagnostics:1e3,maxWorkspaceBytes:8*1024*1024,maxAssetBytes:128*1024*1024,maxWasmMemoryBytes:512*1024*1024,maxWorkers:1,maxThreads:1}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)?.get,Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,`byteLength`)?.get;const i=Object.freeze({profileId:`ruby-3.4.1-ruby-wasm-2.9.3-2.9.4`,artifactRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,rubyVersion:`3.4.1`,rubyRevision:`48d4efcb85000e1ebae42004e963b5d0cedddcf2`,rubyWasmVersion:`2.9.3-2.9.4`,rubyWasmRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,wasiSdkVersion:`22.0`,manifestFingerprint:`e8b1ff472882d0580a235bf31715b699fbb70d75d09ad0dc88b19ba7f42d9ed2`,manifestReceipt:Object.freeze({bytes:7832,sha256:`0f0c0cdb2548aebde61e0a2cb9b8d899ce5a4b51b9a21aac9bd96555fc46fe0a`}),moduleJavaScriptReceipt:Object.freeze({bytes:54623,sha256:`d832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71`}),wasmReceipt:Object.freeze({bytes:9051961,sha256:`4bffd8398d79eed9e5bbe7cd809a88bd3cb861642054a6f3d63b2abfa80f3030`,uncompressedBytes:30608059,uncompressedSha256:`81bc8bbb2130ea34f30826e03d850661bb6cb1c7fe72be598584f12b2810c9de`})});Object.freeze({profile:i});const a=`assets/ruby_stdlib-C40Yu-vu.wasm`;i.manifestFingerprint,Object.freeze({"runtime.mjs":i.moduleJavaScriptReceipt,[a]:Object.freeze({bytes:i.wasmReceipt.uncompressedBytes,sha256:i.wasmReceipt.uncompressedSha256})});const o=a,s=`${o}.gz.bin`;Object.freeze([Object.freeze({name:`@bjorn3/browser_wasi_shim`,version:`0.4.2`,requestedRange:`^0.4.2`,tarballUrl:`https://registry.npmjs.org/@bjorn3/browser_wasi_shim/-/browser_wasi_shim-0.4.2.tgz`,tarballBytes:31373,tarballSha256:`9c0281520d0e99f027ec7c1c79b4036c0f8168ed9bf98aba19db4737a1333782`,integrity:`sha512-/iHkCVUG3VbcbmEHn5iIUpIrh7a7WPiwZ3sHy4HZKZzBdSadwdddYDZAII2zBvQYV0Lfi8naZngPCN7WPHI/hA==`,attestationUrl:null,repository:`https://github.com/bjorn3/browser_wasi_shim`,revision:`4a55f2a519d0ddfa7e4609c42e0c9769c37c9ae8`,license:`MIT OR Apache-2.0`,files:26,bytes:114555,treeSha256:`4454a5e0d68941440b947fdb705f8aa8fca789c5a3d040902bfe2cda8ffde248`}),Object.freeze({name:`@ruby/3.4-wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/3.4-wasm-wasi/-/3.4-wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:29998123,tarballSha256:`92c1821dd2f03e20d23a3ca86e1d844571722eab88bc168dd659fff1bc987ad4`,integrity:`sha512-Ze2grGTnyT6meSI1j5NHKIpeadecOsMuKAjPFeyU5K85MSeHJWZdNXS7QLF0a0E1kIwQcYHafU10Gz5fPqECsw==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2f3.4-wasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:20,bytes:97451582,treeSha256:`b3e9c5a8939d5fe7b7af968ada4f04020846915536f331a4c87f953778ce3778`}),Object.freeze({name:`@ruby/wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/wasm-wasi/-/wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:84917,tarballSha256:`47487299c5be0e32cd6d761b6a11afd63d01b60da8362849fda5e0e007242997`,integrity:`sha512-WxW9wON/TIf+8Ktng8qDJeV/6iH8kw+YwxOsOyXdAdLJgfYDPAXOqpIVd/96y2C9V8VJ2yqZm/IRv6nLeV6EKg==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2fwasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:50,bytes:472758,treeSha256:`9971e5cbb59e695715351d31c4c7079de5a678de63de87b814e4ee76b0adddf3`})]),Object.freeze({entry:Object.freeze({path:`scripts/runtime-modules/ruby.ts`,bytes:257,sha256:`501625656ed69b9876ddd6320e08f45bf8e0c236d791ba04458c64f3864d9812`}),script:Object.freeze({path:`scripts/sync-wasm-ruby.mjs`,bytes:46815,sha256:`2805cc5794231142c9ef6f0843b31c64e8169064a106a807f08742e521de6b54`}),tool:Object.freeze({name:`vite`,version:`8.0.8`,requestedRange:`^8.0.8`,tarballUrl:`https://registry.npmjs.org/vite/-/vite-8.0.8.tgz`,integrity:`sha512-dbU7/iLVa8KZALJyLOBOQ88nOXtNG8vxKuOT4I2mD+Ya70KPceF4IAmDsmU0h1Qsn5bPrvsY9HJstCRh3hG6Uw==`,license:`MIT`,files:42,bytes:2185148,treeSha256:`63becb5aef9c86b925810f4298df7c05905aa0ff74e6b8ee3b98991ca6a25a25`}),packageTreeReceiptFormat:`sha256-json-sorted-path-bytes-sha256-v2-excludes-package-manager-bin`}),Object.freeze([Object.freeze({id:`vite-8-es2022-single-module-bundle`,input:`scripts/runtime-modules/ruby.ts`,output:`runtime.mjs`}),Object.freeze({id:`node-zlib-gzip-level-9`,input:o,output:s})]),Object.freeze([Object.freeze({targetPath:`LICENSE`,mediaType:`text/plain`,spdx:`MIT`,size:1067,sha256:`90357d3794c968704914d42a52354a83f2d8b10cb43df3b63ef1ca0e5bbc0bf2`}),Object.freeze({targetPath:`NOTICE`,mediaType:`text/markdown`,spdx:`LicenseRef-Ruby-Wasm-Third-Party-Notices`,size:51134,sha256:`343c246a6e1f1234e29e51707a54799ea82b50d3a2a41c5221fa12058b2395b2`}),Object.freeze({targetPath:`THIRD_PARTY_NOTICES.md`,mediaType:`text/markdown`,spdx:`LicenseRef-Provenance-Notice`,size:1248,sha256:`e3550c79802a5bf13dc140df11843182131a4b3aac069f0e5824e3cc0378fc68`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-MIT`,mediaType:`text/plain`,spdx:`MIT`,size:1023,sha256:`23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-APACHE`,mediaType:`text/plain`,spdx:`Apache-2.0`,size:11357,sha256:`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`})]),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"dyld.mjs":Object.freeze({bytes:82322,sha256:`cc1835b8530f71e29727a71648b635a5cf28f46ed84451f2de17b194d60033d4`}),"rootfs.tar.zst":Object.freeze({bytes:49091550,sha256:`35f68f56fdb72111f150ba05ad31efed2f6fc77ee7026fb4b197ae7901a67adf`}),"bsdtar.wasm":Object.freeze({bytes:1240004,sha256:`e13ebb15ca0971f6629a6313bc043c532dd9be3a0e6bb0b7f8a395de835ad0c0`})});const c=Object.freeze({"compiler.wasm-runtime.js":Object.freeze({bytes:13936,sha256:`bd103f277be99fd2f3ffc0248b3558e6c2c85a44902bfeef042c6bedcf0b2c63`}),"compiler.wasm":Object.freeze({bytes:4299273,sha256:`9eb047426613c3ed3006838daae49e29929ad0d560ec6b1f8b50e15e2c3865d6`}),"compile-classlib-teavm.bin":Object.freeze({bytes:200621,sha256:`71746dc82ddad5ad8be829f461c235a747bdaf121d1b7abd16dbbbbe6a17f53d`}),"runtime-classlib-teavm.bin":Object.freeze({bytes:2394175,sha256:`f0c9c8c0426e310d08751e57cc88fdfd63ea2f428e4d6cb1b7e59a3dc20844ad`})});new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const l=`emperl.js`,u=`emperl.wasm`,d=`emperl.data`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/LICENSE_artistic.txt":`Artistic-1.0-Perl`,"licenses/LICENSE_gpl.txt":`GPL-1.0-or-later`}),Object.freeze({[l]:`text/javascript`,[u]:`application/wasm`,[d]:`application/octet-stream`}),Object.freeze({"emperl.js.gz.bin":Object.freeze({logicalPath:l,encoding:`gzip`}),"emperl.wasm.gz.bin":Object.freeze({logicalPath:u,encoding:`gzip`}),"emperl.data.gz.bin":Object.freeze({logicalPath:d,encoding:`gzip`})});const f=`janet.js`,p=`janet.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({[f]:`text/javascript`,[p]:`application/wasm`}),Object.freeze({[f]:Object.freeze({logicalPath:f,encoding:`identity`}),"janet.wasm.gz.bin":Object.freeze({logicalPath:p,encoding:`gzip`})});const m=Object.freeze([`ENVIRONMENT=worker`,`MODULARIZE=1`,`EXPORT_ES6=1`,`FORCE_FILESYSTEM=1`,`INVOKE_RUN=0`,`EXIT_RUNTIME=1`,`JANET_REDUCED_OS`]);Object.freeze({options:m,runner:Object.freeze({path:`scripts/runtime-build/wasm-janet-runner.c`,verifiedBuildInput:!1,bytes:1378,sha256:`1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"julia.data":`application/octet-stream`,"julia.js":`text/javascript`,"julia.wasm":`application/wasm`}),Object.freeze({"julia.data.gz.bin":Object.freeze({logicalPath:`julia.data`,encoding:`gzip`}),"julia.js.gz.bin":Object.freeze({logicalPath:`julia.js`,encoding:`gzip`}),"julia.wasm.gz.bin":Object.freeze({logicalPath:`julia.wasm`,encoding:`gzip`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),Object.freeze({"clang/clang.js":`text/javascript`,"clang/clang.wasm":`application/wasm`,"clang/lld.wasm":`application/wasm`,"clang/memfs.wasm":`application/wasm`,"clang/sysroot.tar":`application/x-tar`,"nim/nim-bundle.js":`text/javascript`,"nim/nim.wasm":`application/wasm`,"nim/nimbase.h":`text/x-c-header`}),Object.freeze({"clang/clang.js.bin":Object.freeze({logicalPath:`clang/clang.js`,encoding:`identity`}),"clang/clang.wasm.gz.bin":Object.freeze({logicalPath:`clang/clang.wasm`,encoding:`gzip`}),"clang/lld.wasm.gz.bin":Object.freeze({logicalPath:`clang/lld.wasm`,encoding:`gzip`}),"clang/memfs.wasm.gz.bin":Object.freeze({logicalPath:`clang/memfs.wasm`,encoding:`gzip`}),"clang/sysroot.tar.gz.bin":Object.freeze({logicalPath:`clang/sysroot.tar`,encoding:`gzip`}),"nim/nim-bundle.js.gz.bin":Object.freeze({logicalPath:`nim/nim-bundle.js`,encoding:`gzip`}),"nim/nim.wasm.gz.bin":Object.freeze({logicalPath:`nim/nim.wasm`,encoding:`gzip`}),"nim/nimbase.h.bin":Object.freeze({logicalPath:`nim/nimbase.h`,encoding:`identity`})}),Object.freeze({"clang/clang.js.bin":`clangJavaScript`,"clang/clang.wasm.gz.bin":`clangWasm`,"clang/lld.wasm.gz.bin":`lldWasm`,"clang/memfs.wasm.gz.bin":`memfsWasm`,"clang/sysroot.tar.gz.bin":`sysroot`,"nim/nim-bundle.js.gz.bin":`nimJavaScript`,"nim/nim.wasm.gz.bin":`nimWasm`,"nim/nimbase.h.bin":`nimbase`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const h=`sdk/index.mjs`,g=`sdk/wasmer_js_bg.wasm`,_=`bash.webc`;Object.freeze({[h]:`text/javascript`,[g]:`application/wasm`,[_]:`application/octet-stream`}),Object.freeze({"sdk/index.mjs.bin":Object.freeze({logicalPath:h,encoding:`identity`}),"sdk/wasmer_js_bg.wasm.gz.bin":Object.freeze({logicalPath:g,encoding:`gzip`}),"bash.webc.gz.bin":Object.freeze({logicalPath:_,encoding:`gzip`})}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const v=`compiler.js`,y=`rtl.js`,ee=`system.pas`;Object.freeze({[v]:`text/javascript`,[y]:`text/javascript`,[ee]:`text/plain`}),Object.freeze({"compiler.js.gz.bin":Object.freeze({logicalPath:v,encoding:`gzip`}),"rtl.js.bin":Object.freeze({logicalPath:y,encoding:`identity`}),"system.pas.bin":Object.freeze({logicalPath:ee,encoding:`identity`})}),Object.freeze({kind:`opaque-vendored`,repository:`https://github.com/seo-rii/wasm-idle.git`,path:`static/wasm-pascal`,provenance:`legacy-import`,verifiedBuildInput:!1}),Object.freeze({target:`browser`,compiler:`native pas2js`,entrypoint:`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,integrationSources:Object.freeze([`runtimes/wasm-pascal/src/system.pas`,`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,`runtimes/wasm-pascal/src/webfilecache.pp`]),transformations:Object.freeze([`strip trailing horizontal whitespace and normalize final newline`,`gzip compiler.js with Node zlib level 9`]),verifiedBuildInput:!1}),Object.freeze({spdx:`LGPL-2.1-only WITH Independent-modules-exception`,sourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt`,exceptionSourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE`,verifiedBuildInput:!1,evidence:`upstream license URLs recorded; texts were not vendored with the legacy generation`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const b=`require.js`,te=`tcl/wacl-custom.data`,ne=`tcl/wacl-library.data`,x=`tcl/wacl.js`,re=`tcl/wacl.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/REQUIREJS.txt":`MIT`,"licenses/TCL.txt":`TCL`,"licenses/WACL.txt":`BSD-3-Clause`}),Object.freeze({[b]:`text/javascript`,[te]:`application/octet-stream`,[ne]:`application/octet-stream`,[x]:`text/javascript`,[re]:`application/wasm`}),Object.freeze({[b]:Object.freeze({logicalPath:b,encoding:`identity`}),"tcl/wacl-custom.data.bin":Object.freeze({logicalPath:te,encoding:`identity`}),"tcl/wacl-library.data.gz.bin":Object.freeze({logicalPath:ne,encoding:`gzip`}),[x]:Object.freeze({logicalPath:x,encoding:`identity`}),"tcl/wacl.wasm.gz.bin":Object.freeze({logicalPath:re,encoding:`gzip`})}),new TextDecoder(`utf-8`,{fatal:!0});const ie=Object.freeze({"index.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`}),"puppyc.core.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.core2.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`})}),ae=Object.freeze(Object.keys(ie).sort());Object.freeze(ae.filter(e=>ie[e].role===`runtime`)),[`artifact`,`assets`,`components`,`fingerprint`,`format`,`license`,`licenseExpression`,`metadata`,`notices`,`profileId`,`provenanceLevel`,`runtime`,`storage`,`transformations`].sort(),[`mediaType`,`path`,`role`,`sha256`,`size`].sort(),[`encoding`,`logicalPath`,`path`,`sha256`,`size`].sort(),[`path`,`sha256`,`size`,`spdx`].sort(),[`mediaType`,`path`,`sha256`,`size`].sort(),new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({wasmMemoryBytes:0,nestedWorkers:0,threads:0}),new TextEncoder;const oe=e=>{if(e&&typeof e==`object`){for(let t of Object.values(e))oe(t);Object.freeze(e)}return e};oe({profileId:`ruby-3.4.1-ruby-wasm-2.9.3-2.9.4-split-stdlib-v1`,version:`a6e2d91fdb9c4f33dc443d6c94195ec3d9d11369fa434ebc17ff6e1c35c09cac`,manifest:{path:`runtime-split.v1.json`,bytes:4304,sha256:`a6e2d91fdb9c4f33dc443d6c94195ec3d9d11369fa434ebc17ff6e1c35c09cac`},mountPaths:[`/usr`,`/usr/local`,`/usr/local/lib`,`/usr/local/lib/ruby`,`/usr/local/lib/ruby/3.4.0`,`/usr/local/lib/ruby/gems`,`/usr/local/lib/ruby/gems/3.4.0`,`/bundle`],assets:{module:{path:`runtime.mjs.bin`,encoding:`identity`,bytes:54623,sha256:`d832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71`,logicalBytes:54623,logicalSha256:`d832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71`},wasm:{path:`ruby-core.wasm.gz.bin`,encoding:`gzip`,bytes:5048770,sha256:`116edf97a5fbe0ec4451692ae3c0b03157e8e9b8979fee1e3c2b226eb11c511a`,logicalBytes:16626499,logicalSha256:`0b8058bf32efd1edb51f5c2116d19c7680e07884fafa6b37ceb49212fee96152`},stdlib:{path:`stdlib.pack.gz.bin`,encoding:`gzip`,bytes:4016901,sha256:`3fba398455d2e32eb847906c3d9a2c616c45ece5620477739766b1222b8f1fc1`,logicalBytes:14791446,logicalSha256:`245a8cae10b581a1119d8b9ab6f993b447d31828a483d69a210d4d5e03c2d7b9`}}}),new TextDecoder(`utf-8`,{fatal:!0});const se=globalThis.fetch?.bind(globalThis),ce=c[`compiler.wasm`];async function le(e,t,n,r){if(!Number.isSafeInteger(n)||n<1||t.bytes>n||!Number.isSafeInteger(t.bytes)||t.bytes<1||!/^[a-f0-9]{64}$/.test(t.sha256))throw e.body?.cancel().catch(()=>{}),Error(`Java compiler exceeds its asset limit or has an invalid receipt`);if(!e.ok||!e.body||!globalThis.crypto?.subtle)throw e.body?.cancel().catch(()=>{}),Error(`Java compiler streaming requires a successful body and Web Crypto`);let i=e.body.getReader(),a=new Uint8Array(t.bytes),o=0,s=!1,c=()=>{s||(s=!0,i.releaseLock())},l=async e=>{if(!s)try{await i.cancel(e)}finally{c()}},u=new ReadableStream({async pull(e){try{let{done:n,value:s}=await i.read();if(n){if(o!==t.bytes)throw Error(`Java compiler length mismatch`);let n=await crypto.subtle.digest(`SHA-256`,a);if(Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``)!==t.sha256)throw Error(`Java compiler SHA-256 mismatch`);c(),e.close();return}if(o+s.byteLength>t.bytes)throw Error(`Java compiler exceeds its receipt byte limit`);a.set(s,o),o+=s.byteLength,e.enqueue(Uint8Array.from(s)),r?.(o,t.bytes)}catch(t){e.error(t),await l(t).catch(()=>{})}},cancel:l});try{return await WebAssembly.compileStreaming(new Response(u,{headers:{"Content-Type":`application/wasm`}}),{builtins:[`js-string`]})}catch(e){throw await l(e).catch(()=>{}),e}}async function ue(e,t){if(typeof WebAssembly.compileStreaming!=`function`||!globalThis.crypto?.subtle||!se)return;let n=new URL(`compiler.wasm`,e);if(![`http:`,`https:`].includes(n.protocol)||n.username||n.password||n.hash)throw Error(`Invalid Java compiler URL`);let r=await se(n.href,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`});if(r.url&&new URL(r.url).href!==n.href)throw r.body?.cancel().catch(()=>{}),Error(`Java compiler response URL mismatch`);if(r.status===404){r.body?.cancel().catch(()=>{});return}return await le(r,ce,t,(e,t)=>{globalThis.postMessage?.({assetProgress:{asset:`compiler.wasm`,loaded:e,total:t}})})}function de(e){let t=`async function b(e,t){if(typeof e!=="string")`;if(e.split(t).length!==2)throw Error(`Unsupported TeaVM loader for compiled-module input`);return e.replace(t,`async function b(e,t){if(e instanceof WebAssembly.Module)return e;if(typeof e!=="string")`)}const S=`WasmIdleStdin`,fe=`// wasm-idle Scanner compatibility shim`,pe=`${fe}
final class Scanner implements AutoCloseable {
    private final java.io.InputStream input;
    private int bufferedChar = Integer.MIN_VALUE;
    private String bufferedToken = null;
    private boolean closed = false;

    Scanner(java.io.InputStream input) {
        this.input = input;
    }

    Scanner(String source) {
        this(
            new java.io.ByteArrayInputStream(
                source != null ? source.getBytes() : new byte[0]
            )
        );
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("Scanner closed");
        }
    }

    private int readByteInternal() {
        try {
            return input.read();
        } catch (java.io.IOException error) {
            throw new RuntimeException(error);
        }
    }

    private int readByte() {
        ensureOpen();
        if (bufferedChar != Integer.MIN_VALUE) {
            int value = bufferedChar;
            bufferedChar = Integer.MIN_VALUE;
            return value;
        }
        return readByteInternal();
    }

    private int peekByte() {
        ensureOpen();
        if (bufferedChar == Integer.MIN_VALUE) {
            bufferedChar = readByteInternal();
        }
        return bufferedChar;
    }

    private boolean isWhitespace(int value) {
        return value == ' ' || value == '\\n' || value == '\\r' || value == '\\t' || value == '\\f';
    }

    private boolean skipWhitespace() {
        int value = peekByte();
        while (value != -1 && isWhitespace(value)) {
            readByte();
            value = peekByte();
        }
        return value != -1;
    }

    private String readTokenValue() {
        java.lang.StringBuilder token = new java.lang.StringBuilder();
        int value = peekByte();
        while (value != -1 && !isWhitespace(value)) {
            token.append((char) readByte());
            value = peekByte();
        }
        return token.toString();
    }

    public boolean hasNext() {
        ensureOpen();
        if (bufferedToken != null) {
            return true;
        }
        if (!skipWhitespace()) {
            return false;
        }
        bufferedToken = readTokenValue();
        return true;
    }

    public String next() {
        ensureOpen();
        if (bufferedToken != null) {
            String token = bufferedToken;
            bufferedToken = null;
            return token;
        }
        if (!skipWhitespace()) {
            throw new RuntimeException("No more tokens");
        }
        return readTokenValue();
    }

    public String nextLine() {
        ensureOpen();
        java.lang.StringBuilder line = new java.lang.StringBuilder();
        if (bufferedToken != null) {
            line.append(bufferedToken);
            bufferedToken = null;
        }
        int value = peekByte();
        if (line.length() == 0 && value == -1) {
            return "";
        }
        if (line.length() == 0 && value == '\\r') {
            readByte();
            if (peekByte() == '\\n') {
                readByte();
            }
            return "";
        }
        if (line.length() == 0 && value == '\\n') {
            readByte();
            return "";
        }
        while (true) {
            value = readByte();
            if (value == -1 || value == '\\n' || value == '\\r') {
                break;
            }
            line.append((char) value);
        }
        if (value == '\\r' && peekByte() == '\\n') {
            readByte();
        }
        return line.toString();
    }

    public int nextInt() {
        return Integer.parseInt(next());
    }

    public long nextLong() {
        return Long.parseLong(next());
    }

    public float nextFloat() {
        return Float.parseFloat(next());
    }

    public double nextDouble() {
        return Double.parseDouble(next());
    }

    public boolean hasNextInt() {
        if (!hasNext()) {
            return false;
        }
        try {
            Integer.parseInt(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextLong() {
        if (!hasNext()) {
            return false;
        }
        try {
            Long.parseLong(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextFloat() {
        if (!hasNext()) {
            return false;
        }
        try {
            Float.parseFloat(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextDouble() {
        if (!hasNext()) {
            return false;
        }
        try {
            Double.parseDouble(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public void close() {
        if (closed) {
            return;
        }
        closed = true;
        try {
            input.close();
        } catch (java.io.IOException error) {
            throw new RuntimeException(error);
        }
    }
}`,me=(e,t,n)=>{let r=e.includes(`System.in`),i=/\bScanner\b/.test(e)&&!e.includes(fe)&&!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(e)&&!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(e);if(!r)return i?{usesStdin:!1,stdinCacheKey:``,transformedCode:`${e.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`).trimEnd()}\n\n${pe}\n`,helperSourcePath:null,helperSource:null}:{usesStdin:!1,stdinCacheKey:``,transformedCode:e,helperSourcePath:null,helperSource:null};let a=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1]||``,o=a?`${a.replaceAll(`.`,`/`)}/${S}.java`:`${S}.java`,s=e.replaceAll(`System.in`,`${S}.open()`);i&&(s=s.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`),s=`${s.trimEnd()}\n\n${pe}\n`);let c=[...new TextEncoder().encode(t)].map(e=>e>127?e-256:e).join(`, `);return{usesStdin:!0,stdinCacheKey:JSON.stringify([n,t]),transformedCode:s,helperSourcePath:o,helperSource:`${a?`package ${a};\n\n`:``}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${S} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${c} };
    private static final boolean HAS_EXPLICIT_INPUT = ${n?`true`:`false`};
    private static final ${S} INSTANCE = new ${S}();
    private int position = 0;

    private ${S}() {
    }

    static InputStream open() {
        return INSTANCE;
    }

    private int readFromHost() {
        Window current = Window.current();
        if (current == null) {
            return -1;
        }
        JSMapLike<JSObject> globals = current.cast();
        JSObject stdin = globals.get("wasmIdleJavaStdin");
        if (stdin == null) {
            return -1;
        }
        JSFunction readByte = stdin.<JSMapLike<JSObject>>cast().get("readByte").cast();
        Object value = readByte.call(stdin);
        return value != null ? Integer.parseInt(value.toString()) : -1;
    }

    @Override
    public int read(byte[] b, int off, int len) {
        if (b == null) {
            throw new NullPointerException();
        }
        if (off < 0 || len < 0 || len > b.length - off) {
            throw new IndexOutOfBoundsException();
        }
        if (len == 0) {
            return 0;
        }
        if (position < INITIAL_DATA.length) {
            int count = Math.min(len, INITIAL_DATA.length - position);
            System.arraycopy(INITIAL_DATA, position, b, off, count);
            position += count;
            return count;
        }
        if (HAS_EXPLICIT_INPUT) {
            return -1;
        }
        int next = readFromHost();
        if (next == -1) {
            return -1;
        }
        b[off] = (byte) next;
        return 1;
    }

    @Override
    public int read() {
        if (position < INITIAL_DATA.length) {
            return INITIAL_DATA[position++] & 0xff;
        }
        return HAS_EXPLICIT_INPUT ? -1 : readFromHost();
    }
}
`}};function he(e){let t=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m),n=(e.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m)||e.match(/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m))?.[1];if(!n)throw Error(`Java source must define a top-level class, record, enum, or interface`);let r=t?.[1]||``;return{sourcePath:r?`${r.replaceAll(`.`,`/`)}/${n}.java`:`${n}.java`,mainClass:r?`${r}.${n}`:n}}const ge=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,_e=e=>ge(e?.buffer),ve=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const ye=new TextDecoder,be=e=>e instanceof Int32Array?e:new Int32Array(e),xe=e=>new Uint8Array(e.buffer,e.byteOffset+ve,e.byteLength-ve),Se=e=>{let t=be(e),n=Atomics.load(t,1);if(n===-1)return null;let r=xe(t);return ye.decode(r.slice(0,n))},Ce=(e,t)=>{if(!e||!_e(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return Se(e)},C=e=>e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`),we=(e,t)=>{try{Promise.resolve(e.cancel(t)).catch(()=>void 0)}catch{}};async function Te(e,{asset:t,maxAssetBytes:n,total:r,signal:i,onProgress:a}){let o=()=>Error(`Runtime asset ${t} exceeds the ${n} byte limit`);try{if(!Number.isSafeInteger(n)||n<=0)throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);if(r!==void 0&&(!Number.isSafeInteger(r)||r<0))throw TypeError(`Runtime asset total must be a non-negative safe integer`);if(r!==void 0&&r>n)throw o();if(i?.aborted)throw C(i)}catch(t){throw e.body&&we(e.body,t),t}let s=e.headers.get(`content-type`),c={status:200,headers:s?{"Content-Type":s}:void 0};if(!e.body){let t,s=i?new Promise((e,n)=>{t=()=>n(C(i)),i.addEventListener(`abort`,t,{once:!0})}):void 0;try{let t=e.arrayBuffer(),l=s?await Promise.race([t,s]):await t;if(i?.aborted)throw C(i);if(l.byteLength>n)throw o();if(a?.(l.byteLength,r??l.byteLength),i?.aborted)throw C(i);return new Response(l,c)}finally{t&&i?.removeEventListener(`abort`,t)}}let l=e.body.getReader(),u=!1,d=!1,f=0,p,m=()=>{d||(d=!0,l.releaseLock())},h=()=>i?.removeEventListener(`abort`,v),g=e=>{if(!u){u=!0,h(),we(l,e);try{m()}catch{}}},_=e=>{u||(g(e),p.error(e))},v=()=>{i&&_(C(i))},y=new ReadableStream({start(e){p=e,i?.addEventListener(`abort`,v,{once:!0}),i?.aborted&&v()},async pull(e){if(!u)try{let{done:t,value:s}=await l.read();if(u)return;if(i?.aborted)throw C(i);if(t){if(m(),a?.(f,r??f),u)return;u=!0,h(),e.close();return}if(!s)return;let c=f+s.byteLength;if(!Number.isSafeInteger(c)||c>n)throw o();f=c,a?.(f,r),u||e.enqueue(s)}catch(e){_(i?.aborted?C(i):e)}},cancel(e){g(e)}},{highWaterMark:0});return new Response(y,c)}const Ee=new TextDecoder,De=globalThis.fetch.bind(globalThis),w=globalThis.XMLHttpRequest;let T=null,E=null,D=new Map,Oe=!1,ke=0;const O=new Map,k=new Map,A=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},Ae=()=>{if(!T)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(T.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${T.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${T.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${T.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},je=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},j=e=>{let t=Ae();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},M=e=>{if(!E)return!1;let t;try{t=new URL(e)}catch{return!1}return t.protocol===E.protocol&&t.origin===E.origin&&t.pathname.startsWith(E.pathname)},N=e=>{let t=Ae();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)?null:D.get(n.href)||(M(n.href)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`)},P=e=>N(e)!==null,Me=async e=>{let t=++ke;return await new Promise((n,r)=>{O.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},Ne=async(e,t,n,r)=>{let i=j(e);if(!i||N(i)!==t||!T)throw Error(`Untracked runtime asset request`);let a=T.maxAssetBytes??134217728;r?.throwIfAborted();let o=await De(i,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,...n?{integrity:n}:{},...r?{signal:r}:{}});if(r?.aborted&&(A(o,r.reason),r.throwIfAborted()),o.url){let e;try{e=new URL(o.url)}catch{let e=Error(`Runtime asset response URL is invalid: ${o.url}`);throw A(o,e),e}if(e.href!==i){let t=Error(`Runtime asset response URL mismatch: expected ${i}, received ${e.href}`);throw A(o,t),t}}if(!o.ok){let e=Error(`Failed to load ${t}: ${o.status}`);throw A(o,e),e}let s=o.headers.get(`content-length`),c;if(s!==null){let e=Number(s);if(!/^\d+$/u.test(s.trim())||!Number.isSafeInteger(e)){let e=Error(`Runtime asset ${t} has an invalid Content-Length`);throw A(o,e),e}c=e||void 0}if(c!==void 0&&c>a){let e=Error(`Runtime asset ${t} exceeds the ${a} byte limit`);throw A(o,e),e}let l=o.headers.get(`content-type`)||void 0;return{response:o,maxAssetBytes:a,total:c,mimeType:l}},Pe=async(e,t,n)=>{let{response:r,maxAssetBytes:i,total:a,mimeType:o}=await Ne(e,t,n);if(!r.body){let e=new Uint8Array(await r.arrayBuffer());if(e.byteLength>i)throw Error(`Runtime asset ${t} exceeds the ${i} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:a??e.byteLength}}),{bytes:e,mimeType:o}}let s=r.body.getReader(),c=!1,l=e=>{if(!c){c=!0;try{Promise.resolve(s.cancel(e)).catch(()=>void 0)}catch{}}},u=0,d,f;try{for(d=new Uint8Array(a||Math.min(65536,i));;){let{done:e,value:n}=await s.read();if(e)break;if(!n)continue;let r=u+n.byteLength;if(r>i){let e=Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw l(e),e}if(r>d.byteLength){let e=Math.min(i,Math.max(r,d.byteLength*2)),t=new Uint8Array(e);t.set(d.subarray(0,u)),d=t}d.set(n,u),u=r,self.postMessage({assetProgress:{asset:t,loaded:u,total:a}})}}catch(e){throw l(e),e}finally{try{s.releaseLock()}catch(e){f={error:e}}}if(f)throw f.error;return u!==d.byteLength&&(d=d.slice(0,u)),self.postMessage({assetProgress:{asset:t,loaded:u,total:a??u}}),{bytes:d,mimeType:o}};async function F(e,t){let n=N(e);if(!n||!T)throw Error(`Untracked runtime asset request`);return T.useAssetBridge?await Me(n):await Pe(e,n,t)}function Fe(e){return new Response(je(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function Ie(){if(w===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=j(t);if(!n||!P(n)){if(n&&M(n))throw Error(`Untracked runtime asset request`);let r=n||(t instanceof URL?t.href:String(t));this.native=new w,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await F(this.url),t=je(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=Ee.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function Le(){Oe||(Oe=!0,globalThis.fetch=(async(e,t)=>{let n=j(e);if(!n||!P(n)){if(n&&M(n))throw Error(`Untracked runtime asset request`);return De(e,t)}let r=typeof Request<`u`&&e instanceof Request?e:void 0,i=t?.integrity??r?.integrity,a=typeof i==`string`?i:void 0,o=(t?.method??r?.method??`GET`).toUpperCase();if(T?.useAssetBridge===!1&&o===`GET`&&new URL(n).pathname.endsWith(`.wasm`)){let e=N(n),i=(t?.signal===void 0?r?.signal:t.signal)??void 0,{response:o,maxAssetBytes:s,total:c}=await Ne(n,e,a,i);return Te(o,{asset:e,maxAssetBytes:s,total:c,signal:i,onProgress:(t,n)=>self.postMessage({assetProgress:{asset:e,loaded:t,total:n}})})}return Fe(await F(n,a))}),Ie())}function Re(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);for(let e of k.values())e.reject(Error(`Runtime module configuration changed`));k.clear(),E=null,D=new Map,T=e,Le()}function ze(e){let t=e?.assetResponse;if(!t)return!1;let n=k.get(t.id);if(n)return k.delete(t.id),t.ok?t.module instanceof WebAssembly.Module?n.resolve(t.module):n.reject(Error(`Runtime module response is invalid`)):n.reject(Error(t.error||`Runtime module request failed`)),!0;let r=O.get(t.id);return r?(O.delete(t.id),t.ok?(r.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(r.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}async function I(e){if(!T)throw Error(`Runtime asset config unavailable`);let t=j(e);if(!t||!P(t))throw Error(`Untracked runtime asset request`);return await F(t)}let L=null,R=null,Be=``,z=``,B=``,V=null,H=new Uint8Array,U=0,W=``,G=``,K=``,q=null,J=[],Y=``,X=[],Z=new Set;const Ve=new TextDecoder,He=e=>new Int8Array(e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)),Q=()=>{z&&=(self.postMessage({output:z}),``)},$=()=>{B&&=(self.postMessage({output:B}),``)},Ue=e=>{z+=String.fromCharCode(e),e===10&&Q()},We=e=>{B+=String.fromCharCode(e),e===10&&$()};self.addEventListener(`message`,async e=>{if(ze(e.data))return;let{load:t,assets:n,buffer:r,code:i,prepare:a,args:o=[],stdin:s=``,hasExplicitStdin:c=!1,activePath:l,workspaceFiles:u=[]}=e.data;try{if(t){let e=n;Re(e||null);let t=e?.baseUrl||``,r=e?.streamCompiler===!0;if(!L||Be!==t){let[n,i,a]=await Promise.all([(async()=>{let[n,i]=await Promise.all([(async()=>{let e=Ve.decode((await I(`compiler.wasm-runtime.js`)).bytes);r&&(e=de(e));let t=URL.createObjectURL(new Blob([e],{type:`text/javascript;charset=utf-8`}));try{return await import(t)}finally{URL.revokeObjectURL(t)}})(),(async()=>{let n=r?await ue(t,e?.maxAssetBytes??128*1024*1024):void 0;return n?{bytes:n}:I(`compiler.wasm`)})()]),a=n.load,o=await a(i.bytes,{stackDeobfuscator:{enabled:!1}});return{load:a,lib:o.exports,compiler:o.exports.createCompiler()}})(),I(`compile-classlib-teavm.bin`).then(({bytes:e})=>He(e)),I(`runtime-classlib-teavm.bin`).then(({bytes:e})=>He(e))]);n.compiler.setSdk(i),n.compiler.setTeaVMClasslib(a),n.lib,L=n.compiler,R=n.load,Be=t,W=``,G=``,K=``,q=null,J=[],Y=``,X=[],Z=new Set}self.postMessage({load:!0});return}if(!L||!R)throw Error(`TeaVM compiler not loaded`);z=``,B=``;let e=c===!0,d=me(i,s,e),f=he(i),p=typeof l==`string`&&l?l:f.sourcePath,m=p.split(`/`).pop()||p;if(!Array.isArray(u)||!u.every(e=>e&&typeof e.path==`string`&&typeof e.content==`string`))throw Error(`Invalid Java workspace files`);let h=u,g=Y!==p||X.length!==h.length||X.some((e,t)=>e.path!==h[t]?.path||e.content!==h[t]?.content);if(d.usesStdin&&d.helperSourcePath&&(p===d.helperSourcePath||h.some(e=>e.path===d.helperSourcePath)))throw Error(`Java workspace conflicts with generated stdin helper: ${d.helperSourcePath}`);if(W!==i||G!==d.stdinCacheKey||g||!q){q=null,J=[];let e=f.mainClass;Z=new Set([p,...h.map(e=>e.path)].flatMap(e=>[e,e.split(`/`).pop()||e]));let t=[],n=[],r=L.onDiagnostic(e=>{let r=e.severity?String(e.severity).toLowerCase():`error`,i=e.fileName?`${e.fileName}:${e.lineNumber||0}${e.columnNumber?`:${e.columnNumber}`:``}`:`TeaVM`;t.push(`${i}: ${r}: ${e.message}`);let a=e.fileName?String(e.fileName):null;if(a&&!Z.has(a))return;let o={diagnostic:{fileName:a,lineNumber:Number(e.lineNumber)||1,columnNumber:Number(e.columnNumber)||1,severity:r===`warning`?`warning`:r===`other`?`other`:`error`,message:String(e.message||``)}};n.push(o),self.postMessage(o)}),a=()=>{if(typeof r==`function`){r();return}r?.destroy?.()};L.clearSourceFiles?.(),L.clearInputClassFiles?.(),L.clearOutputFiles?.(),L.addSourceFile(m,d.transformedCode);for(let e of h)L.addSourceFile(e.path.split(`/`).pop()||e.path,e.content);if(d.usesStdin&&d.helperSourcePath&&d.helperSource&&(L.addSourceFile(d.helperSourcePath.split(`/`).pop()||d.helperSourcePath,d.helperSource),Z.add(d.helperSourcePath),Z.add(d.helperSourcePath.split(`/`).pop()||d.helperSourcePath)),!L.compile())throw a(),Error(t.join(`
`)||`TeaVM javac compilation failed`);let o=Array.from(L.detectMainClasses());if(o.length!==1)throw a(),Error(o.length===0?`Main method not found`:`Multiple main methods found`);let s=L.generateWebAssembly({outputName:`app`,mainClass:e});if(a(),!s)throw Error(t.join(`
`)||`TeaVM WebAssembly generation failed`);W=i,G=d.stdinCacheKey,K=e,q=new Uint8Array(L.getWebAssemblyOutputFile(`app.wasm`)),Y=p,X=h.map(e=>({...e})),J=n}else for(let e of J)self.postMessage(e);if(a){self.postMessage({results:!0});return}V=new Int32Array(r),H=e?new Uint8Array:new TextEncoder().encode(s),U=0;let _=globalThis,v=_.window;_.window=_,_.wasmIdleJavaStdin={readByte(){for(;;){if(U<H.length)return H[U++]??-1;if(e)return-1;let t=Ce(V,()=>self.postMessage({buffer:!0}));if(t===null)return-1;H=new TextEncoder().encode(t),U=0}}};try{let e=await R(q,{installImports(e){e.teavmConsole.putcharStdout=Ue,e.teavmConsole.putcharStderr=We},stackDeobfuscator:{enabled:!1}});self.postMessage({progress:{kind:`ready`,state:`running`,reason:`started`,label:`Java program started`}}),e.exports.main(o),Q(),$(),self.postMessage({results:!0,mainClass:K})}finally{delete _.wasmIdleJavaStdin,v===void 0?Reflect.deleteProperty(_,`window`):_.window=v,H=new Uint8Array,U=0,V=null}}catch(e){Q(),$(),self.postMessage({error:e instanceof Error?e.message:String(e)})}});