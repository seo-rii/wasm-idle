const e=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,t=t=>e(t?.buffer),n=Int32Array.BYTES_PER_ELEMENT*2,r=new TextEncoder,i=new TextDecoder,a=e=>e instanceof Int32Array?e:new Int32Array(e),o=e=>new Uint8Array(e.buffer,e.byteOffset+n,e.byteLength-n),s=(e,t)=>{let n=r.encode(e);if(n.length<=t)return{chunk:e,bytes:n,rest:``};let i=0,a=e.length;for(;i<a;){let n=Math.ceil((i+a)/2);r.encode(e.slice(0,n)).length<=t?i=n:a=n-1}let o=e.slice(0,i);return{chunk:o,bytes:r.encode(o),rest:e.slice(i)}},c=(e,t)=>{if(!e.length)return!1;let n=a(t),r=o(n),i=e[0],{bytes:c,rest:l}=s(i,r.length);return r.fill(0),r.set(c),Atomics.store(n,1,c.length),Atomics.add(n,0,1),Atomics.notify(n,0),l?e[0]=l:e.shift(),!0},l=e=>{let t=a(e),n=Atomics.load(t,1);if(n===-1)return null;let r=o(t);return i.decode(r.slice(0,n))},u=(e,n)=>{if(!e||!t(e))return null;let r=Atomics.load(e,0);for(n();;)if(Atomics.wait(e,0,r,100)===`not-equal`)return l(e)};var d=class extends Error{code;phase;runtimeId;profileId;recoverable;constructor(e,t){super(e,{cause:t.cause}),this.name=`WasmIdleError`,this.code=t.code,this.phase=t.phase,this.runtimeId=t.runtimeId,this.profileId=t.profileId,this.recoverable=t.recoverable??!1}},f=class extends d{constructor(e,t={}){super(e,{...t,code:`protocol`,phase:t.phase??`protocol`,recoverable:t.recoverable??!1}),this.name=`ProtocolError`}};function p(e){if(e.schemaVersion!==1)throw TypeError(`Unsupported runtime trust profile schema: ${String(e.schemaVersion)}`);if(!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(e.profileId))throw TypeError(`Runtime trust profile ID must be a non-empty stable identifier`);if(![`none`,`allowlist`,`unrestricted`].includes(e.network.mode))throw TypeError(`Unsupported runtime network mode: ${String(e.network.mode)}`);let t=e.network.allowedOrigins.map(e=>{let t;try{t=new URL(e)}catch{throw TypeError(`Runtime network allowlist contains an invalid origin: ${e}`)}if(t.protocol!==`https:`&&t.protocol!==`http:`||t.pathname!==`/`||t.search||t.hash||t.username||t.password)throw TypeError(`Runtime network allowlist requires HTTP(S) origins: ${e}`);return t.origin}),n=[...new Set(t)].sort();if(e.network.mode===`allowlist`&&n.length===0)throw TypeError(`Runtime network allowlist mode requires at least one origin`);if(e.network.mode!==`allowlist`&&n.length>0)throw TypeError(`Runtime network mode ${e.network.mode} cannot declare allowed origins`);if(![`none`,`ephemeral`,`persistent`].includes(e.storage.mode))throw TypeError(`Unsupported runtime storage mode: ${String(e.storage.mode)}`);if(![`none`,`allowlist`].includes(e.environment.mode))throw TypeError(`Unsupported runtime environment mode: ${String(e.environment.mode)}`);for(let t of e.environment.allowedNames)if(!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(t))throw TypeError(`Runtime environment allowlist contains an invalid name: ${t}`);let r=[...new Set(e.environment.allowedNames)].sort();if(e.environment.mode===`allowlist`&&r.length===0)throw TypeError(`Runtime environment allowlist mode requires at least one name`);if(e.environment.mode===`none`&&r.length>0)throw TypeError(`Runtime environment mode none cannot declare allowed names`);if(!Number.isSafeInteger(e.threads.maxThreads)||e.threads.maxThreads<0)throw TypeError(`Runtime maxThreads must be a non-negative safe integer`);if(!Number.isSafeInteger(e.workers.maxNestedWorkers)||e.workers.maxNestedWorkers<0)throw TypeError(`Runtime maxNestedWorkers must be a non-negative safe integer`);if(typeof e.sharedArrayBuffer!=`boolean`)throw TypeError(`Runtime sharedArrayBuffer capability must be boolean`);if(!e.sharedArrayBuffer&&e.threads.maxThreads>0)throw TypeError(`Runtime threads require SharedArrayBuffer capability`);if(![`none`,`wasm-only`,`javascript-and-wasm`].includes(e.dynamicCode))throw TypeError(`Unsupported runtime dynamic-code mode: ${String(e.dynamicCode)}`);if(typeof e.sameOriginAccess!=`boolean`)throw TypeError(`Runtime sameOriginAccess capability must be boolean`);return Object.freeze({schemaVersion:1,profileId:e.profileId,network:Object.freeze({mode:e.network.mode,allowedOrigins:Object.freeze(n)}),storage:Object.freeze({mode:e.storage.mode}),environment:Object.freeze({mode:e.environment.mode,allowedNames:Object.freeze(r)}),threads:Object.freeze({maxThreads:e.threads.maxThreads}),workers:Object.freeze({maxNestedWorkers:e.workers.maxNestedWorkers}),sharedArrayBuffer:e.sharedArrayBuffer,dynamicCode:e.dynamicCode,sameOriginAccess:e.sameOriginAccess})}p({schemaVersion:1,profileId:`restricted-browser-worker-v1`,network:{mode:`none`,allowedOrigins:[]},storage:{mode:`ephemeral`},environment:{mode:`none`,allowedNames:[]},threads:{maxThreads:0},workers:{maxNestedWorkers:0},sharedArrayBuffer:!1,dynamicCode:`wasm-only`,sameOriginAccess:!1}),5*BigInt64Array.BYTES_PER_ELEMENT,BigInt(2**53-1),typeof SharedArrayBuffer==`function`&&Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype,`byteLength`)?.get;const m=Object.freeze(`C.CPP.OBJC.PYTHON3.JAVA.RUST.GO.D.CSHARP.FSHARP.VBNET.ELIXIR.ERLANG.PROLOG.GLEAM.PERL.TCL.AWK.PASCAL.FORTH.J.BQN.JANET.JULIA.NIM.BASH.CLOJURESCRIPT.FORTRAN.COBOL.TINYGO.OCAML.JAVASCRIPT.TYPESCRIPT.ASSEMBLYSCRIPT.WAT.WASM.LUA.ZIG.LISP.RUBY.HASKELL.R.OCTAVE.DUCKDB.SQLITE.PHP`.split(`.`)),h=new Set([`C`,`CPP`,`PYTHON3`,`JAVA`]);new Set(m.filter(e=>!h.has(e)));const g={"C#":{canonicalId:`CSHARP`,kind:`spelling`},"F#":{canonicalId:`FSHARP`,kind:`spelling`},VB:{canonicalId:`VBNET`,kind:`spelling`},VISUALBASIC:{canonicalId:`VBNET`,kind:`spelling`},OBJECTIVEC:{canonicalId:`OBJC`,kind:`spelling`},OBJECTIVE_C:{canonicalId:`OBJC`,kind:`spelling`},"OBJECTIVE-C":{canonicalId:`OBJC`,kind:`spelling`},ERL:{canonicalId:`ERLANG`,kind:`spelling`},SWIPL:{canonicalId:`PROLOG`,kind:`implementation`},SWI:{canonicalId:`PROLOG`,kind:`implementation`},TCLSH:{canonicalId:`TCL`,kind:`implementation`},GAWK:{canonicalId:`AWK`,kind:`implementation`},PAS:{canonicalId:`PASCAL`,kind:`spelling`},FPC:{canonicalId:`PASCAL`,kind:`implementation`},GFORTH:{canonicalId:`FORTH`,kind:`implementation`},JL:{canonicalId:`JULIA`,kind:`spelling`},NIMROD:{canonicalId:`NIM`,kind:`spelling`},SH:{canonicalId:`BASH`,kind:`compatibility`},SHELL:{canonicalId:`BASH`,kind:`compatibility`},CLJS:{canonicalId:`CLOJURESCRIPT`,kind:`spelling`},F77:{canonicalId:`FORTRAN`,kind:`dialect`},COB:{canonicalId:`COBOL`,kind:`spelling`},CBL:{canonicalId:`COBOL`,kind:`spelling`},GNUCOBOL:{canonicalId:`COBOL`,kind:`implementation`},DLANG:{canonicalId:`D`,kind:`spelling`},JS:{canonicalId:`JAVASCRIPT`,kind:`spelling`},AS:{canonicalId:`ASSEMBLYSCRIPT`,kind:`spelling`},PYTHON:{canonicalId:`PYTHON3`,kind:`spelling`},PYPY3:{canonicalId:`PYTHON3`,kind:`implementation`,deprecated:!0,message:`PYPY3 runs the Pyodide implementation; use PYTHON3 instead.`},HS:{canonicalId:`HASKELL`,kind:`spelling`},RB:{canonicalId:`RUBY`,kind:`spelling`},SCHEME:{canonicalId:`LISP`,kind:`compatibility`,message:`SCHEME selects the bundled Puppy Scheme-compatible runtime.`},SCM:{canonicalId:`LISP`,kind:`compatibility`,message:`SCM selects the bundled Puppy Scheme-compatible runtime.`},TS:{canonicalId:`TYPESCRIPT`,kind:`spelling`},MATLAB:{canonicalId:`OCTAVE`,kind:`compatibility`,message:`MATLAB selects GNU Octave compatibility, not MATLAB.`},SQL:{canonicalId:`SQLITE`,kind:`dialect`,message:`SQL selects the SQLite dialect and engine.`},WASM32:{canonicalId:`WASM`,kind:`spelling`}};Object.freeze(Object.keys(g)),Object.freeze(Object.fromEntries(Object.entries(g).map(([e,t])=>[e,Object.freeze({alias:e,deprecated:!1,...t})]))),Object.freeze({maxFiles:256,maxFileBytes:2*1024*1024,maxTotalBytes:8*1024*1024,maxPathBytes:1024,caseSensitive:!1}),new TextEncoder,Object.freeze({assetTimeoutMs:6e4,startupTimeoutMs:6e4,compileTimeoutMs:12e4,runTimeoutMs:3e4,maxOutputBytes:1024*1024,maxDiagnostics:1e3,maxWorkspaceBytes:8*1024*1024,maxAssetBytes:128*1024*1024,maxWasmMemoryBytes:512*1024*1024,maxWorkers:1,maxThreads:1}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),Symbol.toStringTag)?.get,Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,`byteLength`)?.get;const _=Object.freeze({profileId:`ruby-3.4.1-ruby-wasm-2.9.3-2.9.4`,artifactRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,rubyVersion:`3.4.1`,rubyRevision:`48d4efcb85000e1ebae42004e963b5d0cedddcf2`,rubyWasmVersion:`2.9.3-2.9.4`,rubyWasmRevision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,wasiSdkVersion:`22.0`,manifestFingerprint:`5584f97b962de660bcff8b2144e289bd1814420bdae887f62edbd1f573e39263`,manifestReceipt:Object.freeze({bytes:7803,sha256:`2024d75c2250b11c891db52060608e2defe07eea94967cade3ef4480069740e2`}),moduleJavaScriptReceipt:Object.freeze({bytes:54623,sha256:`d832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71`}),wasmReceipt:Object.freeze({bytes:9051961,sha256:`4bffd8398d79eed9e5bbe7cd809a88bd3cb861642054a6f3d63b2abfa80f3030`,uncompressedBytes:30608059,uncompressedSha256:`81bc8bbb2130ea34f30826e03d850661bb6cb1c7fe72be598584f12b2810c9de`})});Object.freeze({profile:_});const v=`assets/ruby_stdlib-C40Yu-vu.wasm`;_.manifestFingerprint,Object.freeze({"runtime.mjs":_.moduleJavaScriptReceipt,[v]:Object.freeze({bytes:_.wasmReceipt.uncompressedBytes,sha256:_.wasmReceipt.uncompressedSha256})});const y=v,b=`${y}.gz.bin`;Object.freeze([Object.freeze({name:`@bjorn3/browser_wasi_shim`,version:`0.4.2`,requestedRange:`^0.4.2`,tarballUrl:`https://registry.npmjs.org/@bjorn3/browser_wasi_shim/-/browser_wasi_shim-0.4.2.tgz`,tarballBytes:31373,tarballSha256:`9c0281520d0e99f027ec7c1c79b4036c0f8168ed9bf98aba19db4737a1333782`,integrity:`sha512-/iHkCVUG3VbcbmEHn5iIUpIrh7a7WPiwZ3sHy4HZKZzBdSadwdddYDZAII2zBvQYV0Lfi8naZngPCN7WPHI/hA==`,attestationUrl:null,repository:`https://github.com/bjorn3/browser_wasi_shim`,revision:`4a55f2a519d0ddfa7e4609c42e0c9769c37c9ae8`,license:`MIT OR Apache-2.0`,files:26,bytes:114555,treeSha256:`4454a5e0d68941440b947fdb705f8aa8fca789c5a3d040902bfe2cda8ffde248`}),Object.freeze({name:`@ruby/3.4-wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/3.4-wasm-wasi/-/3.4-wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:29998123,tarballSha256:`92c1821dd2f03e20d23a3ca86e1d844571722eab88bc168dd659fff1bc987ad4`,integrity:`sha512-Ze2grGTnyT6meSI1j5NHKIpeadecOsMuKAjPFeyU5K85MSeHJWZdNXS7QLF0a0E1kIwQcYHafU10Gz5fPqECsw==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2f3.4-wasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:20,bytes:97451582,treeSha256:`b3e9c5a8939d5fe7b7af968ada4f04020846915536f331a4c87f953778ce3778`}),Object.freeze({name:`@ruby/wasm-wasi`,version:`2.9.3-2.9.4`,requestedRange:`2.9.3-2.9.4`,tarballUrl:`https://registry.npmjs.org/@ruby/wasm-wasi/-/wasm-wasi-2.9.3-2.9.4.tgz`,tarballBytes:84917,tarballSha256:`47487299c5be0e32cd6d761b6a11afd63d01b60da8362849fda5e0e007242997`,integrity:`sha512-WxW9wON/TIf+8Ktng8qDJeV/6iH8kw+YwxOsOyXdAdLJgfYDPAXOqpIVd/96y2C9V8VJ2yqZm/IRv6nLeV6EKg==`,attestationUrl:`https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2fwasm-wasi@2.9.3-2.9.4`,repository:`https://github.com/ruby/ruby.wasm`,revision:`3318796e2c9f0f75c98c669cabdc422cf8218ec2`,license:`MIT`,files:50,bytes:472758,treeSha256:`9971e5cbb59e695715351d31c4c7079de5a678de63de87b814e4ee76b0adddf3`})]),Object.freeze({entry:Object.freeze({path:`scripts/runtime-modules/ruby.ts`,bytes:257,sha256:`501625656ed69b9876ddd6320e08f45bf8e0c236d791ba04458c64f3864d9812`}),script:Object.freeze({path:`scripts/sync-wasm-ruby.mjs`,bytes:46491,sha256:`85c0470fd9d903350761fb6996580f38b6178f8119d4aae25eb2b7cb9c216b3b`}),tool:Object.freeze({name:`vite`,version:`8.0.8`,requestedRange:`^8.0.8`,tarballUrl:`https://registry.npmjs.org/vite/-/vite-8.0.8.tgz`,integrity:`sha512-dbU7/iLVa8KZALJyLOBOQ88nOXtNG8vxKuOT4I2mD+Ya70KPceF4IAmDsmU0h1Qsn5bPrvsY9HJstCRh3hG6Uw==`,license:`MIT`,files:47,bytes:2190838,treeSha256:`b3462dd488501c9744a64040f6169ab8afe0d4ec257c5fa822f7ccf5fd779536`}),packageTreeReceiptFormat:`sha256-json-sorted-path-bytes-sha256-v1`}),Object.freeze([Object.freeze({id:`vite-8-es2022-single-module-bundle`,input:`scripts/runtime-modules/ruby.ts`,output:`runtime.mjs`}),Object.freeze({id:`node-zlib-gzip-level-9`,input:y,output:b})]),Object.freeze([Object.freeze({targetPath:`LICENSE`,mediaType:`text/plain`,spdx:`MIT`,size:1067,sha256:`90357d3794c968704914d42a52354a83f2d8b10cb43df3b63ef1ca0e5bbc0bf2`}),Object.freeze({targetPath:`NOTICE`,mediaType:`text/markdown`,spdx:`LicenseRef-Ruby-Wasm-Third-Party-Notices`,size:51134,sha256:`343c246a6e1f1234e29e51707a54799ea82b50d3a2a41c5221fa12058b2395b2`}),Object.freeze({targetPath:`THIRD_PARTY_NOTICES.md`,mediaType:`text/markdown`,spdx:`LicenseRef-Provenance-Notice`,size:1248,sha256:`e3550c79802a5bf13dc140df11843182131a4b3aac069f0e5824e3cc0378fc68`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-MIT`,mediaType:`text/plain`,spdx:`MIT`,size:1023,sha256:`23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`}),Object.freeze({targetPath:`licenses/browser-wasi-shim/LICENSE-APACHE`,mediaType:`text/plain`,spdx:`Apache-2.0`,size:11357,sha256:`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`})]),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"dyld.mjs":Object.freeze({bytes:82322,sha256:`cc1835b8530f71e29727a71648b635a5cf28f46ed84451f2de17b194d60033d4`}),"rootfs.tar.zst":Object.freeze({bytes:49091550,sha256:`35f68f56fdb72111f150ba05ad31efed2f6fc77ee7026fb4b197ae7901a67adf`}),"bsdtar.wasm":Object.freeze({bytes:1240004,sha256:`e13ebb15ca0971f6629a6313bc043c532dd9be3a0e6bb0b7f8a395de835ad0c0`})}),Object.freeze({"compiler.wasm-runtime.js":Object.freeze({bytes:13936,sha256:`bd103f277be99fd2f3ffc0248b3558e6c2c85a44902bfeef042c6bedcf0b2c63`}),"compiler.wasm":Object.freeze({bytes:4299273,sha256:`9eb047426613c3ed3006838daae49e29929ad0d560ec6b1f8b50e15e2c3865d6`}),"compile-classlib-teavm.bin":Object.freeze({bytes:200621,sha256:`71746dc82ddad5ad8be829f461c235a747bdaf121d1b7abd16dbbbbe6a17f53d`}),"runtime-classlib-teavm.bin":Object.freeze({bytes:2394175,sha256:`f0c9c8c0426e310d08751e57cc88fdfd63ea2f428e4d6cb1b7e59a3dc20844ad`})}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const x=`emperl.js`,S=`emperl.wasm`,C=`emperl.data`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/LICENSE_artistic.txt":`Artistic-1.0-Perl`,"licenses/LICENSE_gpl.txt":`GPL-1.0-or-later`}),Object.freeze({[x]:`text/javascript`,[S]:`application/wasm`,[C]:`application/octet-stream`}),Object.freeze({"emperl.js.gz.bin":Object.freeze({logicalPath:x,encoding:`gzip`}),"emperl.wasm.gz.bin":Object.freeze({logicalPath:S,encoding:`gzip`}),"emperl.data.gz.bin":Object.freeze({logicalPath:C,encoding:`gzip`})});const w=`janet.js`,T=`janet.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({[w]:`text/javascript`,[T]:`application/wasm`}),Object.freeze({[w]:Object.freeze({logicalPath:w,encoding:`identity`}),"janet.wasm.gz.bin":Object.freeze({logicalPath:T,encoding:`gzip`})});const E=Object.freeze([`ENVIRONMENT=worker`,`MODULARIZE=1`,`EXPORT_ES6=1`,`FORCE_FILESYSTEM=1`,`INVOKE_RUN=0`,`EXIT_RUNTIME=1`,`JANET_REDUCED_OS`]);Object.freeze({options:E,runner:Object.freeze({path:`scripts/runtime-build/wasm-janet-runner.c`,verifiedBuildInput:!1,bytes:1378,sha256:`1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"julia.data":`application/octet-stream`,"julia.js":`text/javascript`,"julia.wasm":`application/wasm`}),Object.freeze({"julia.data.gz.bin":Object.freeze({logicalPath:`julia.data`,encoding:`gzip`}),"julia.js.gz.bin":Object.freeze({logicalPath:`julia.js`,encoding:`gzip`}),"julia.wasm.gz.bin":Object.freeze({logicalPath:`julia.wasm`,encoding:`gzip`})}),Object.freeze({stdin:`streaming`,workspace:!1,abort:!0,artifacts:!1,streamingOutput:!0}),Object.freeze({"clang/clang.js":`text/javascript`,"clang/clang.wasm":`application/wasm`,"clang/lld.wasm":`application/wasm`,"clang/memfs.wasm":`application/wasm`,"clang/sysroot.tar":`application/x-tar`,"nim/nim-bundle.js":`text/javascript`,"nim/nim.wasm":`application/wasm`,"nim/nimbase.h":`text/x-c-header`}),Object.freeze({"clang/clang.js.bin":Object.freeze({logicalPath:`clang/clang.js`,encoding:`identity`}),"clang/clang.wasm.gz.bin":Object.freeze({logicalPath:`clang/clang.wasm`,encoding:`gzip`}),"clang/lld.wasm.gz.bin":Object.freeze({logicalPath:`clang/lld.wasm`,encoding:`gzip`}),"clang/memfs.wasm.gz.bin":Object.freeze({logicalPath:`clang/memfs.wasm`,encoding:`gzip`}),"clang/sysroot.tar.gz.bin":Object.freeze({logicalPath:`clang/sysroot.tar`,encoding:`gzip`}),"nim/nim-bundle.js.gz.bin":Object.freeze({logicalPath:`nim/nim-bundle.js`,encoding:`gzip`}),"nim/nim.wasm.gz.bin":Object.freeze({logicalPath:`nim/nim.wasm`,encoding:`gzip`}),"nim/nimbase.h.bin":Object.freeze({logicalPath:`nim/nimbase.h`,encoding:`identity`})}),Object.freeze({"clang/clang.js.bin":`clangJavaScript`,"clang/clang.wasm.gz.bin":`clangWasm`,"clang/lld.wasm.gz.bin":`lldWasm`,"clang/memfs.wasm.gz.bin":`memfsWasm`,"clang/sysroot.tar.gz.bin":`sysroot`,"nim/nim-bundle.js.gz.bin":`nimJavaScript`,"nim/nim.wasm.gz.bin":`nimWasm`,"nim/nimbase.h.bin":`nimbase`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const D=`sdk/index.mjs`,O=`sdk/wasmer_js_bg.wasm`,k=`bash.webc`;Object.freeze({[D]:`text/javascript`,[O]:`application/wasm`,[k]:`application/octet-stream`}),Object.freeze({"sdk/index.mjs.bin":Object.freeze({logicalPath:D,encoding:`identity`}),"sdk/wasmer_js_bg.wasm.gz.bin":Object.freeze({logicalPath:O,encoding:`gzip`}),"bash.webc.gz.bin":Object.freeze({logicalPath:k,encoding:`gzip`})}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const A=`compiler.js`,j=`rtl.js`,M=`system.pas`;Object.freeze({[A]:`text/javascript`,[j]:`text/javascript`,[M]:`text/plain`}),Object.freeze({"compiler.js.gz.bin":Object.freeze({logicalPath:A,encoding:`gzip`}),"rtl.js.bin":Object.freeze({logicalPath:j,encoding:`identity`}),"system.pas.bin":Object.freeze({logicalPath:M,encoding:`identity`})}),Object.freeze({kind:`opaque-vendored`,repository:`https://github.com/seo-rii/wasm-idle.git`,path:`static/wasm-pascal`,provenance:`legacy-import`,verifiedBuildInput:!1}),Object.freeze({target:`browser`,compiler:`native pas2js`,entrypoint:`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,integrationSources:Object.freeze([`runtimes/wasm-pascal/src/system.pas`,`runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas`,`runtimes/wasm-pascal/src/webfilecache.pp`]),transformations:Object.freeze([`strip trailing horizontal whitespace and normalize final newline`,`gzip compiler.js with Node zlib level 9`]),verifiedBuildInput:!1}),Object.freeze({spdx:`LGPL-2.1-only WITH Independent-modules-exception`,sourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt`,exceptionSourceUrl:`https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE`,verifiedBuildInput:!1,evidence:`upstream license URLs recorded; texts were not vendored with the legacy generation`}),new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0});const N=`require.js`,ee=`tcl/wacl-custom.data`,te=`tcl/wacl-library.data`,P=`tcl/wacl.js`,ne=`tcl/wacl.wasm`;new TextEncoder,new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({"licenses/REQUIREJS.txt":`MIT`,"licenses/TCL.txt":`TCL`,"licenses/WACL.txt":`BSD-3-Clause`}),Object.freeze({[N]:`text/javascript`,[ee]:`application/octet-stream`,[te]:`application/octet-stream`,[P]:`text/javascript`,[ne]:`application/wasm`}),Object.freeze({[N]:Object.freeze({logicalPath:N,encoding:`identity`}),"tcl/wacl-custom.data.bin":Object.freeze({logicalPath:ee,encoding:`identity`}),"tcl/wacl-library.data.gz.bin":Object.freeze({logicalPath:te,encoding:`gzip`}),[P]:Object.freeze({logicalPath:P,encoding:`identity`}),"tcl/wacl.wasm.gz.bin":Object.freeze({logicalPath:ne,encoding:`gzip`})}),new TextDecoder(`utf-8`,{fatal:!0});const re=Object.freeze({"index.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`}),"puppyc.core.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.core2.wasm":Object.freeze({mediaType:`application/wasm`,role:`runtime`}),"puppyc.js":Object.freeze({mediaType:`text/javascript`,role:`runtime`})}),ie=Object.freeze(Object.keys(re).sort());Object.freeze(ie.filter(e=>re[e].role===`runtime`)),[`artifact`,`assets`,`components`,`fingerprint`,`format`,`license`,`licenseExpression`,`metadata`,`notices`,`profileId`,`provenanceLevel`,`runtime`,`storage`,`transformations`].sort(),[`mediaType`,`path`,`role`,`sha256`,`size`].sort(),[`encoding`,`logicalPath`,`path`,`sha256`,`size`].sort(),[`path`,`sha256`,`size`,`spdx`].sort(),[`mediaType`,`path`,`sha256`,`size`].sort(),new TextDecoder(`utf-8`,{fatal:!0}),Object.freeze({wasmMemoryBytes:0,nestedWorkers:0,threads:0}),new TextEncoder;const ae=new TextDecoder(`utf-8`,{fatal:!0}),oe=/^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:whl|tar|zip)$/u;function se(e){let t;try{t=JSON.parse(ae.decode(e))}catch{throw new f(`Python runtime lock file is not valid UTF-8 JSON`,{phase:`asset`,runtimeId:`python`})}if(typeof t!=`object`||!t||!(`packages`in t)||typeof t.packages!=`object`||t.packages===null||Array.isArray(t.packages))throw new f(`Python runtime lock file has an invalid packages map`,{phase:`asset`,runtimeId:`python`});let n=Object.values(t.packages);if(n.length>4096)throw new f(`Python runtime lock file has too many package assets`,{phase:`asset`,runtimeId:`python`});let r=new Set;for(let e of n){if(typeof e!=`object`||!e||!(`file_name`in e))throw new f(`Python runtime lock file has an invalid package entry`,{phase:`asset`,runtimeId:`python`});let t=e.file_name;if(typeof t!=`string`||t.length>1024||!oe.test(t))throw new f(`Python runtime lock file has an unsafe package asset name`,{phase:`asset`,runtimeId:`python`});r.add(t)}return{lock:t,packageAssets:r}}const ce=new TextDecoder,le=/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u,ue=globalThis.fetch.bind(globalThis),de=globalThis.XMLHttpRequest;let F=null,I=null,L=new Map,fe=!1,pe=0;const R=new Map,z=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},B=()=>{if(!F)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(F.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${F.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${F.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${F.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},me=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},V=e=>{let t=B();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},H=e=>{if(!I)return!1;let t;try{t=new URL(e)}catch{return!1}return t.protocol===I.protocol&&t.origin===I.origin&&t.pathname.startsWith(I.pathname)},U=e=>{let t=B();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)?null:L.get(n.href)||(H(n.href)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`)},W=e=>U(e)!==null,he=async e=>{let t=++pe;return await new Promise((n,r)=>{R.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},ge=async(e,t,n)=>{let r=V(e);if(!r||U(r)!==t||!F)throw Error(`Untracked runtime asset request`);let i=F.maxAssetBytes??134217728,a=await ue(r,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,...n?{integrity:n}:{}});if(a.url){let e;try{e=new URL(a.url)}catch{let e=Error(`Runtime asset response URL is invalid: ${a.url}`);throw z(a,e),e}if(e.href!==r){let t=Error(`Runtime asset response URL mismatch: expected ${r}, received ${e.href}`);throw z(a,t),t}}if(!a.ok){let e=Error(`Failed to load ${t}: ${a.status}`);throw z(a,e),e}let o=a.headers.get(`content-length`),s;if(o!==null){let e=Number(o);if(!/^\d+$/u.test(o.trim())||!Number.isSafeInteger(e)){let e=Error(`Runtime asset ${t} has an invalid Content-Length`);throw z(a,e),e}s=e||void 0}if(s!==void 0&&s>i){let e=Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw z(a,e),e}let c=a.headers.get(`content-type`)||void 0;if(!a.body){let e=new Uint8Array(await a.arrayBuffer());if(e.byteLength>i)throw Error(`Runtime asset ${t} exceeds the ${i} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:s??e.byteLength}}),{bytes:e,mimeType:c}}let l=a.body.getReader(),u=!1,d=e=>{if(!u){u=!0;try{Promise.resolve(l.cancel(e)).catch(()=>void 0)}catch{}}},f=0,p,m;try{for(p=new Uint8Array(s||Math.min(65536,i));;){let{done:e,value:n}=await l.read();if(e)break;if(!n)continue;let r=f+n.byteLength;if(r>i){let e=Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw d(e),e}if(r>p.byteLength){let e=Math.min(i,Math.max(r,p.byteLength*2)),t=new Uint8Array(e);t.set(p.subarray(0,f)),p=t}p.set(n,f),f=r,self.postMessage({assetProgress:{asset:t,loaded:f,total:s}})}}catch(e){throw d(e),e}finally{try{l.releaseLock()}catch(e){m={error:e}}}if(m)throw m.error;return f!==p.byteLength&&(p=p.slice(0,f)),self.postMessage({assetProgress:{asset:t,loaded:f,total:s??f}}),{bytes:p,mimeType:c}};async function G(e,t){let n=U(e);if(!n||!F)throw Error(`Untracked runtime asset request`);return F.useAssetBridge?await he(n):await ge(e,n,t)}function _e(e){return new Response(me(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function ve(){if(de===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=V(t);if(!n||!W(n)){if(n&&H(n))throw Error(`Untracked runtime asset request`);let r=n||(t instanceof URL?t.href:String(t));this.native=new de,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await G(this.url),t=me(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=ce.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function ye(){fe||(fe=!0,globalThis.fetch=(async(e,t)=>{let n=V(e);if(!n||!W(n)){if(n&&H(n))throw Error(`Untracked runtime asset request`);return ue(e,t)}let r=t?.integrity??(typeof Request<`u`&&e instanceof Request?e.integrity:void 0);return _e(await G(n,typeof r==`string`?r:void 0))}),ve())}function be(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);I=null,L=new Map,F=e,ye()}function xe(e){if(!F)throw Error(`Runtime asset config unavailable`);if(F.useAssetBridge)throw Error(`Direct runtime asset allowlists require direct asset loading`);if(e===null){I=null,L=new Map;return}if(!Array.isArray(e.assets))throw TypeError(`Direct runtime asset allowlist must be an array`);if(e.assets.length>4096)throw Error(`Direct runtime asset allowlist has too many entries`);let t=e.runtimeAssets??[];if(!Array.isArray(t))throw TypeError(`Direct core runtime asset allowlist must be an array`);if(t.length>64)throw Error(`Direct core runtime asset allowlist has too many entries`);let n;try{n=new URL(e.baseUrl)}catch{throw Error(`Direct runtime asset base URL is invalid: ${e.baseUrl}`)}if(n.protocol!==`http:`&&n.protocol!==`https:`)throw Error(`Direct runtime asset base URL must use HTTP(S): ${e.baseUrl}`);if(n.username||n.password||n.hash||n.search)throw Error(`Direct runtime asset base URL must not include credentials, a query, or a fragment: ${e.baseUrl}`);n.pathname.endsWith(`/`)||(n.pathname+=`/`);let r=(e,t,n)=>{for(let r of t){if(typeof r!=`string`||r.length>1024||!le.test(r))throw Error(`Direct runtime asset name is unsafe: ${String(r)}`);e.set(new URL(r,n).href,r)}},i=new Map;r(i,e.assets,n);let a=B();if(!a)throw Error(`Runtime asset config unavailable`);r(i,t,a),I=n,L=i}function Se(e){let t=e?.assetResponse;if(!t)return!1;let n=R.get(t.id);return n?(R.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}async function Ce(e){if(!F)throw Error(`Runtime asset config unavailable`);let t=V(e);if(!t||!W(t))throw Error(`Untracked runtime asset request`);return await G(t)}self.document={querySelector(){return null},querySelectorAll(){return[]}};let we,K,Te,Ee,q,J,Y=``,X=!1;const De=/^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:[A-Za-z0-9._+-]{0,64})?$/u,Oe=[`pyodide.mjs`,`pyodide.asm.js`,`pyodide-lock.json`,`pyodide.asm.wasm`,`python_stdlib.zip`],ke=e=>{if(typeof e!=`string`||!De.test(e))throw Error(`Pyodide runtime version is invalid`);return new URL(`v${encodeURIComponent(e)}/full/`,`https://cdn.jsdelivr.net/pyodide/`).href};function Z(e,t){self.postMessage({progress:{percent:e,stage:t}})}async function Ae(e){let t=await Ce(e),n=URL.createObjectURL(new Blob([t.bytes.slice().buffer],{type:t.mimeType||`text/javascript`}));try{return await import(n)}finally{URL.revokeObjectURL(n)}}async function Q(e){if(J)return;let t=e.endsWith(`/`)?e:`${e}/`;await Ae(`pyodide.asm.js`);let n=await Ae(`pyodide.mjs`),r=t,i;if(!X){r=ke(n.version);let e=se((await Ce(`pyodide-lock.json`)).bytes);xe({baseUrl:r,assets:[...e.packageAssets],runtimeAssets:Oe}),i=e.lock}let{loadPyodide:a}=n;J=await a({indexURL:e,packageBaseUrl:r,...i?{lockFileContents:i}:{}})}async function je(e){e&&await J.loadPackagesFromImports(e)}function $(e){return e.replaceAll(`\\`,`/`).split(`/`).filter(e=>e&&e!==`.`&&e!==`..`).join(`/`)}function Me(e=[]){let t=J.FS;for(let n of e){let e=$(n.path);if(!e)continue;let r=e.split(`/`).slice(0,-1).join(`/`);r&&t.mkdirTree(r),t.writeFile(e,n.content,{encoding:`utf8`})}}self.onmessage=async e=>{if(Se(e.data))return;let{code:n,buffer:r,debugBuffer:i,watchBuffer:a,watchResultBuffer:o,load:s,interrupt:d,assets:f,prepare:p,stdin:m,debug:h=!1,breakpoints:g=[],pauseOnEntry:_=!1,activePath:v,debugPath:y,workspaceFiles:b}=e.data;if(s)try{let e=f;Y=e?.baseUrl||Y,X=e?.useAssetBridge===!0,be(e||null),postMessage({output:`Loading Pyodide...`}),Z(2,`Loading Pyodide module`),await Q(Y),Z(100,`Pyodide runtime ready`),postMessage({output:` Done.
\r`}),postMessage({load:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}else if(p){postMessage({output:`Loading packages...`});try{Z(5,`Preparing Python workspace`),await Q(Y),Me(b),Z(15,`Resolving Python imports`),await je([n,...(b||[]).map(e=>e.content)].join(`
`)),Z(100,`Python packages ready`),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}}else if(typeof n==`string`){try{await Q(Y),Me(b),await je([n,...(b||[]).map(e=>e.content)].join(`
`))}catch(e){self.postMessage({error:e.message||`Unknown error`});return}let e=Date.now();if(we=new Int32Array(r),K=new Int32Array(i),Te=new Int32Array(a),Ee=new Int32Array(o),q=new Uint8Array(d),h&&!t(K)){self.postMessage({error:`Python debugging requires SharedArrayBuffer.`});return}t(q)&&J.setInterruptBuffer(q);let s=e=>e===!0?`True`:e===!1?`False`:e==null?`None`:e.toString(),f=typeof m==`string`,p=f?m:null;self.prompt=self[`__pyodide__input_`+e]=e=>{if(e&&postMessage({output:e}),f){let e=p;return p=null,e}return u(we,()=>postMessage({buffer:!0}))},self[`__pyodide__output_`+e]=(...e)=>{let t=` `,n=`\r
`,r=``,i=[];for(let r of e)r?.end===void 0?r?.sep===void 0?i.push(r):t=s(r.sep):n=s(r.end);for(let e=0;e<i.length;e++)(typeof i[e]==`string`||!i[e]?.end&&!i[e]?.sep)&&(r+=s(i[e]),e<i.length-1&&(r+=t));r+=n,postMessage({output:r})};let x=`__wasm_idle_python_debug_pause_${e}`,S=`__wasm_idle_python_debug_wait_${e}`,C=`__wasm_idle_python_debug_watch_read_${e}`,w=`__wasm_idle_python_debug_watch_write_${e}`,T=`__wasm_idle_python_debug_breakpoints_${e}`,E=`__wasm_idle_python_execution_ready_${e}`,D=!1;self[E]=()=>{D||(D=!0,delete self[E],postMessage({progress:{kind:`ready`,state:`running`,reason:`started`,label:`Python program started`}}))},self[x]=(e,t,n,r)=>{let i,a;try{i=JSON.parse(n)}catch{i=[]}try{a=JSON.parse(r)}catch{a=[]}postMessage({debugEvent:{type:`pause`,line:Number(e),reason:t,locals:i,callStack:a}})},self[S]=()=>{let e=Atomics.load(K,0);for(;;){if(q?.[0]===2||(Atomics.wait(K,0,e,100),q?.[0]===2))return-1;let t=Atomics.exchange(K,1,0);if(t)return t}},self[C]=()=>l(Te)||``,self[w]=e=>{c([e],Ee)},self[T]=()=>{let e=Atomics.load(K,2),t=Math.max(0,Math.min(Atomics.load(K,3),K.length-4)),n=[];for(let e=0;e<t;e+=1){let t=Atomics.load(K,4+e);Number.isInteger(t)&&t>0&&n.push(t)}return JSON.stringify({version:e,lines:n})};let O=$(v||``)||`__wasm_idle_user__.py`,k=$(y||``)||O,A=JSON.stringify(O),j=JSON.stringify(k),M=JSON.stringify([...Array.isArray(g)?g:[]].map(e=>Number(e)).filter(e=>Number.isInteger(e)&&e>0));try{await J.runPythonAsync(`import ast
import builtins
import inspect
import json
import sys
from js import __pyodide__input_${e}, __pyodide__output_${e}
from js import ${E} as __wasm_idle_execution_ready
${h?`from js import ${x}, ${S}`:``}
${h?`from js import ${C}, ${w}`:``}
${h?`from js import ${T}`:``}

__wasm_idle_input = __pyodide__input_${e}
def __wasm_idle_input_wrapper(prompt = ""):
    value = __wasm_idle_input(prompt)
    if value is None:
        raise EOFError
    if value.endswith("\\r\\n"):
        value = value[:-2]
    elif value.endswith("\\n") or value.endswith("\\r"):
        value = value[:-1]
    return value
__wasm_idle_output = __pyodide__output_${e}
builtins.input = __wasm_idle_input_wrapper
builtins.print = __wasm_idle_output


if not globals().get("__wasm_idle_img_inited__", False):
    globals()["__wasm_idle_img_inited__"] = True
    import base64, io, time
    try:
        from js import postMessage
    except Exception:
        postMessage = None
    _MAX_WIDTH = 1280
    _MAX_HEIGHT = 720
    _WEBP_QUALITY = 85
    try:
        from PIL import Image
        _RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
    except Exception:
        Image = None
        _RESAMPLE = None

    def __wasm_idle_rasterize_svg(raw):
        try:
            import cairosvg
            return cairosvg.svg2png(bytestring=raw)
        except Exception:
            return None

    def __wasm_idle_to_webp(raw):
        if Image is None or _RESAMPLE is None:
            return None
        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
            if _MAX_WIDTH > 0 and _MAX_HEIGHT > 0:
                img.thumbnail((_MAX_WIDTH, _MAX_HEIGHT), _RESAMPLE)
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "A" in img.mode else "RGB")
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=_WEBP_QUALITY, method=6)
            return buf.getvalue()
        except Exception:
            return None

    def __wasm_idle_send_img(mime, raw):
        try:
            if postMessage is None:
                return
            if raw is None:
                return
            if isinstance(raw, str):
                raw_bytes = raw.encode("utf-8")
            else:
                raw_bytes = raw
            if mime == "image/svg+xml":
                raster = __wasm_idle_rasterize_svg(raw_bytes)
                if raster:
                    raw_bytes = raster
                    mime = "image/png"
            webp = __wasm_idle_to_webp(raw_bytes)
            if webp:
                raw_bytes = webp
                mime = "image/webp"
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            ts = int(time.time() * 1000)
            postMessage({"type": "img", "data": {"mime": mime, "b64": b64, "ts": ts}})
        except Exception:
            pass

    def __wasm_idle_capture_fig(fig):
        try:
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight")
            __wasm_idle_send_img("image/png", buf.getvalue())
            buf.close()
        except Exception:
            pass

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.figure import Figure
        _orig_show = plt.show

        def _show(*args, **kwargs):
            try:
                figs = [plt.figure(num) for num in plt.get_fignums()]
                if not figs:
                    figs = [plt.gcf()]
                for fig in figs:
                    __wasm_idle_capture_fig(fig)
                plt.close("all")
            except Exception:
                pass
            try:
                return _orig_show(*args, **kwargs)
            except Exception:
                return None

        plt.show = _show

        _orig_fig_show = Figure.show

        def _fig_show(self, *args, **kwargs):
            try:
                __wasm_idle_capture_fig(self)
            except Exception:
                pass
            try:
                return _orig_fig_show(self, *args, **kwargs)
            except Exception:
                return None

        Figure.show = _fig_show
    except Exception:
        pass

    try:
        from IPython import display as _ip_display
        _orig_display = _ip_display.display

        def _display(*objs, **kwargs):
            for obj in objs:
                try:
                    if hasattr(obj, "_repr_png_"):
                        data = obj._repr_png_()
                        if data:
                            __wasm_idle_send_img("image/png", data)
                            continue
                    if hasattr(obj, "_repr_svg_"):
                        data = obj._repr_svg_()
                        if data:
                            __wasm_idle_send_img("image/svg+xml", data)
                            continue
                except Exception:
                    pass
            try:
                return _orig_display(*objs, **kwargs)
            except Exception:
                return None

        _ip_display.display = _display
    except Exception:
        pass


${h?`
__wasm_idle_debug_breakpoints = set(${M})
__wasm_idle_debug_breakpoint_version = -1
__wasm_idle_debug_pause_on_entry = ${_?`True`:`False`}
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_resume_skip = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_next_line = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_refresh_breakpoints():
    global __wasm_idle_debug_breakpoints
    global __wasm_idle_debug_breakpoint_version
    snapshot = json.loads(${T}())
    version = int(snapshot.get("version", -1))
    if version == __wasm_idle_debug_breakpoint_version:
        return
    __wasm_idle_debug_breakpoint_version = version
    __wasm_idle_debug_breakpoints = set(int(line) for line in snapshot.get("lines", []) if int(line) > 0)

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename == ${j}:
            depth += 1
        current = current.f_back
    return depth

def __wasm_idle_debug_preview(value, depth = 0):
    if depth >= 2:
        return "..."
    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (bytes, bytearray)):
        text = repr(bytes(value))
        return text if len(text) <= 80 else text[:77] + "..."
    if isinstance(value, str):
        text = repr(value)
        return text if len(text) <= 80 else text[:77] + "..."
    if isinstance(value, list):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        return "[" + ", ".join(items) + "]"
    if isinstance(value, tuple):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append("...")
        if len(value) == 1 and items:
            return "(" + items[0] + ",)"
        return "(" + ", ".join(items) + ")"
    if isinstance(value, dict):
        items = []
        for index, (key, item) in enumerate(value.items()):
            if index >= 6:
                items.append("...")
                break
            items.append(__wasm_idle_debug_preview(key, depth + 1) + ": " + __wasm_idle_debug_preview(item, depth + 1))
        return "{" + ", ".join(items) + "}"
    if isinstance(value, set):
        items = [__wasm_idle_debug_preview(item, depth + 1) for item in sorted(list(value), key = repr)[:6]]
        if len(value) > 6:
            items.append("...")
        return "{" + ", ".join(items) + "}"
    try:
        text = repr(value)
        return text if len(text) <= 80 else text[:77] + "..."
    except Exception:
        return "?"

def __wasm_idle_debug_locals(frame):
    locals_preview = []
    for name, value in frame.f_locals.items():
        if name == "__builtins__" or name.startswith("__wasm_idle_") or name.startswith("."):
            continue
        locals_preview.append({"name": name, "value": __wasm_idle_debug_preview(value)})
    locals_preview.sort(key = lambda item: item["name"])
    return locals_preview

def __wasm_idle_debug_stack(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename == ${j}:
            stack.append({"functionName": current.f_code.co_name, "line": current.f_lineno})
        current = current.f_back
    return stack

def __wasm_idle_debug_trace(frame, event, arg):
    global __wasm_idle_debug_pause_on_entry
    global __wasm_idle_debug_step_mode
    global __wasm_idle_debug_resume_skip
    global __wasm_idle_debug_next_depth
    global __wasm_idle_debug_next_line
    global __wasm_idle_debug_step_out_depth

    if frame.f_code.co_filename != ${j}:
        return None
    if event != "line":
        return __wasm_idle_debug_trace

    __wasm_idle_debug_refresh_breakpoints()
    depth = __wasm_idle_debug_depth(frame)
    line = frame.f_lineno
    if __wasm_idle_debug_resume_skip == (depth, line):
        return __wasm_idle_debug_trace
    if __wasm_idle_debug_resume_skip is not None:
        __wasm_idle_debug_resume_skip = None

    reason = None
    if __wasm_idle_debug_pause_on_entry:
        reason = "entry"
    elif line in __wasm_idle_debug_breakpoints:
        reason = "breakpoint"
    elif __wasm_idle_debug_step_mode == "step":
        reason = "step"
    elif __wasm_idle_debug_step_mode == "next" and __wasm_idle_debug_next_depth is not None and depth <= __wasm_idle_debug_next_depth and line != __wasm_idle_debug_next_line:
        reason = "nextLine"
    elif __wasm_idle_debug_step_mode == "out" and __wasm_idle_debug_step_out_depth is not None and depth <= __wasm_idle_debug_step_out_depth:
        reason = "stepOut"

    if reason is None:
        return __wasm_idle_debug_trace

    __wasm_idle_debug_pause_on_entry = False
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None

    ${x}(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = ${S}()
        if command < 0:
            raise KeyboardInterrupt()
        if command != 5:
            break
        try:
            expression = ${C}()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        ${w}(result)
    __wasm_idle_debug_resume_skip = (depth, line)
    if command == 2:
        __wasm_idle_debug_step_mode = "step"
    elif command == 3:
        __wasm_idle_debug_step_mode = "next"
        __wasm_idle_debug_next_depth = depth
        __wasm_idle_debug_next_line = line
    elif command == 4:
        __wasm_idle_debug_step_mode = "out"
        __wasm_idle_debug_step_out_depth = max(0, depth - 1)
    return __wasm_idle_debug_trace

sys.settrace(__wasm_idle_debug_trace)
`:``}

try:
    __wasm_idle_globals = {
        "__name__": "__main__",
        ${JSON.stringify(E)}: __wasm_idle_execution_ready,
    }
    __wasm_idle_compiled = compile(
        ${JSON.stringify(n)},
        ${A},
        "exec",
        flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
    )
    __wasm_idle_globals.pop(${JSON.stringify(E)})()
    __wasm_idle_result = eval(
        __wasm_idle_compiled,
        __wasm_idle_globals,
        __wasm_idle_globals,
    )
    if inspect.isawaitable(__wasm_idle_result):
        await __wasm_idle_result
finally:
    __wasm_idle_globals.pop(${JSON.stringify(E)}, None)
    del __wasm_idle_execution_ready
    sys.settrace(None)
    ${h?`
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_resume_skip = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_next_line = None
    __wasm_idle_debug_step_out_depth = None
`:``}
`),self.postMessage({results:!0})}catch(e){self.postMessage({error:e.message||`Unknown error`})}finally{delete self[E],delete self[x],delete self[S],delete self[C],delete self[w],delete self[T]}}};