# wasm-idle Native Debugger extension

This Chromium Manifest V3 extension connects the playground to the browser's actual
JavaScript/WebAssembly debugger. It does not insert statements into user programs.
Compilation and execution stay in the browser.
Chromium 125 or newer is required for the extension API's child debugger sessions.

1. Open `chrome://extensions` (or the Chromium equivalent) and enable Developer mode.
2. Choose **Load unpacked** and select this `extensions/debugger` directory.
3. Open wasm-idle, click this extension's toolbar icon once, and check that its badge says **ON**.
4. Select JavaScript, TypeScript or Java and start **Debug** in the playground.

Click the icon again to disconnect. Reloading or navigating the tab can require enabling
the extension again. Opening the browser's own DevTools may detach this extension;
the playground reports that disconnect and ends its session.

The extension requests `debugger`, `activeTab`, and `scripting`. It has no host-wide
content script or remote server. A toolbar click attaches only to that tab; the page
bridge accepts only connections to named wasm-idle execution Workers. Debugger
commands are restricted to execution control, source locations, and variable inspection.
Chrome displays its own debugger attachment indicator.

TypeScript uses the existing SWC strip-only compiler, which preserves source lines.
Java's TeaVM metadata supports Java source breakpoints and mapped frames. TeaVM GC
does not emit Java local-variable metadata; the Java adapter does not advertise locals
or expression evaluation. This is distinct from the existing exception stack decoder.

Run `node --test extensions/debugger/debugger.test.mjs` for native JavaScript and
TypeScript breakpoints, local values, stepping and stdin/stdout. The actual container
owner and nested execution Worker are covered by
`WASM_IDLE_RUN_CDP_CONTAINER=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ node --test extensions/debugger/container.test.mjs`
against a local development server. The real TeaVM compiler gate is
`WASM_IDLE_RUN_CDP_JAVA=1 node --test extensions/debugger/java.test.mjs`.
Each test uses a temporary Chromium profile and enables the production action handler;
it does not install an extension into a personal browser profile.
