const workerGlobal = globalThis;

workerGlobal.dotnetSidecar = true;
workerGlobal.document ??= {
  addEventListener() {},
  baseURI: workerGlobal.location?.href || "",
  body: { appendChild() {} },
  createElement() {
    return { appendChild() {}, remove() {}, setAttribute() {}, style: {} };
  },
  dispatchEvent() {
    return true;
  },
  head: { appendChild() {} },
  location: workerGlobal.location,
  querySelectorAll() {
    return [];
  },
  removeEventListener() {},
};

await import("./dotnet.native.worker.mjs");
