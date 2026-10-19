// pinned-sdk:sdk/src-js/worker.js
Error.stackTraceLimit = 50;
globalThis.onerror = console.error;
var pendingMessages = [];
var worker = void 0;
var handleMessage = async (data) => {
  if (worker) {
    await worker.handle(data);
  } else {
    pendingMessages.push(data);
  }
};
globalThis.onmessage = async (ev) => {
  if (ev.data.type == "init") {
    const { memory, module, id, sdkUrl: sdkUrl2 } = ev.data;
    const { init, ThreadPoolWorker } = await import(sdkUrl2);
    await init({ module, sdkUrl: sdkUrl2, memory });
    worker = new ThreadPoolWorker(id);
    for (const msg of pendingMessages.splice(0, pendingMessages.length)) {
      await worker.handle(msg);
    }
  } else {
    await handleMessage(ev.data);
  }
};

// pinned-sdk:entry/worker.js
var requiredMemory = { "shared": true, "minimumPages": 35, "maximumPages": 16384 };
var sdkUrl = new URL("./index.mjs", import.meta.url).href;
var workerUrl = new URL("./worker.mjs", import.meta.url).href;
function validate(value) {
  if (!value || !(value.module instanceof WebAssembly.Module)) throw new TypeError("SDK_PACKAGE_VERIFIED_MODULE_REQUIRED");
  if (!(value.memory instanceof WebAssembly.Memory) || typeof SharedArrayBuffer !== "function" || !(value.memory.buffer instanceof SharedArrayBuffer)) throw new TypeError("SDK_PACKAGE_SHARED_MEMORY_REQUIRED");
  const pages = value.memory.buffer.byteLength / 65536;
  if (pages < requiredMemory.minimumPages || pages > requiredMemory.maximumPages) throw new RangeError("SDK_PACKAGE_MEMORY_PROFILE");
  if (value.sdkUrl !== void 0 && String(value.sdkUrl) !== sdkUrl) throw new TypeError("SDK_PACKAGE_FIXED_MODULE_URL");
  if (value.workerUrl !== void 0 && String(value.workerUrl) !== workerUrl) throw new TypeError("SDK_PACKAGE_FIXED_WORKER_URL");
}
var upstreamOnMessage = globalThis.onmessage;
if (typeof upstreamOnMessage !== "function") throw new Error("SDK_PACKAGE_WORKER_BOOTSTRAP");
var initialized = false;
globalThis.onmessage = function(event) {
  if (event?.data?.type === "init") {
    validate(event.data);
    if (event.data.sdkUrl !== sdkUrl) throw new TypeError("SDK_PACKAGE_FIXED_MODULE_URL");
    if (!Number.isInteger(event.data.id) || event.data.id < 0 || event.data.id > 4294967295) throw new TypeError("SDK_PACKAGE_WORKER_ID");
    if (initialized) throw new TypeError("SDK_PACKAGE_DUPLICATE_WORKER_INIT");
    initialized = true;
  }
  return upstreamOnMessage.call(this, event);
};
