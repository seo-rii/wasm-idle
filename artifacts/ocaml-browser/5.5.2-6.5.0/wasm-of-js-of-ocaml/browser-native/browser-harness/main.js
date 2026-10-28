import { compileDiagnosticsNative, compileHelloNative, compileHelloNativeWasm, compileYojsonNative, compileYojsonNativeWasm } from './native-compile.js';
const output = document.querySelector('#output');
if (!output) {
    throw new Error('missing output element');
}
const statusElement = document.querySelector('#status');
if (!statusElement) {
    throw new Error('missing status element');
}
statusElement.textContent = 'Running browser-native compile requests...';
statusElement.textContent = 'Compiling hello.ml to browser-native JavaScript...';
const helloJsResult = await compileHelloNative();
statusElement.textContent = 'Compiling hello.ml to browser-native wasm...';
const helloWasmResult = await compileHelloNativeWasm();
statusElement.textContent = 'Compiling yojson package fixture to browser-native JavaScript...';
const yojsonJsResult = await compileYojsonNative();
statusElement.textContent = 'Compiling yojson package fixture to browser-native wasm...';
const yojsonWasmResult = await compileYojsonNativeWasm();
statusElement.textContent = 'Compiling diagnostics fixture...';
const diagnosticsResult = await compileDiagnosticsNative();
const compileSucceeded = helloJsResult.success &&
    helloWasmResult.success &&
    yojsonJsResult.success &&
    yojsonWasmResult.success;
const diagnosticsSucceeded = !diagnosticsResult.success &&
    diagnosticsResult.diagnostics.some((diagnostic) => diagnostic.file === 'type_error.ml');
statusElement.textContent =
    compileSucceeded && diagnosticsSucceeded
        ? 'Browser-native compile succeeded.'
        : !helloJsResult.success
            ? `Hello JS native failed at ${helloJsResult.stage}.`
            : !helloWasmResult.success
                ? `Hello wasm native failed at ${helloWasmResult.stage}.`
                : !yojsonJsResult.success
                    ? `Yojson JS native failed at ${yojsonJsResult.stage}.`
                    : !yojsonWasmResult.success
                        ? `Yojson wasm native failed at ${yojsonWasmResult.stage}.`
                        : `Diagnostics fixture did not fail as expected at ${diagnosticsResult.stage}.`;
output.textContent = JSON.stringify({
    hello: {
        js: helloJsResult,
        wasm: helloWasmResult
    },
    packages: {
        yojson: {
            js: yojsonJsResult,
            wasm: yojsonWasmResult
        }
    },
    diagnostics: {
        type_error: diagnosticsResult
    }
}, null, 2);
