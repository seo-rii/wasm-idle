// <define:__CONTAINER_WORKBENCH_PROFILE__>
var define_CONTAINER_WORKBENCH_PROFILE_default = { profileLabel: "GNU Bash \xB7 BusyBox \xB7 Clang \xB7 persistent workspace", terminalDescription: "Start the shell, then send the example script below to compile and run C in your workspace. Files and pipes are shared with real BusyBox commands. No PTY or job control.", initialInput: `set -eu
mkdir -p /workspace/demo
cd /workspace/demo
printf '#include <stdio.h>\\nint main(void){puts("hello");return 0;}\\n' > main.c
clang main.c -o hello.wasm
./hello.wasm | grep hello > result.txt
cat result.txt
` };

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/errors.js
var ContainerError = class extends Error {
  code;
  name = "ContainerError";
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
};

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/adapters/wasix/owner.js
var ContainerOwnerError = class extends Error {
  code;
  name = "ContainerOwnerError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var VERSION = 1;
var CHUNK_BYTES = 65536;
var validNumber = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
var fail = (code, message) => {
  throw new ContainerOwnerError(code, message);
};
var control = /* @__PURE__ */ new Set(["dispose", "shell.interrupt", "shell.terminate", "shell.cancel"]);
function createContainerOwnerClient(port, options = {}) {
  const generation = options.generation ?? 1, timeout = options.requestTimeoutMs ?? 3e4, maxPending = options.maxPendingRequests ?? 32;
  const maxFile = options.maxFileBytes ?? 8 * 1024 * 1024, maxBackup = options.maxBackupBytes ?? 32 * 1024 * 1024;
  if (![generation, timeout, maxPending, maxFile, maxBackup].every(validNumber) || maxPending > 256 || timeout > 36e5 || maxFile > 256 * 1024 * 1024 || maxBackup > 512 * 1024 * 1024)
    throw new ContainerError("INVALID_ARGUMENT", "Invalid owner client limits");
  const pending = /* @__PURE__ */ new Map();
  let sequence = 0, closed = false, disposal, started = false;
  const close = (error, unexpected = false) => {
    if (closed)
      return;
    closed = true;
    if (unexpected) {
      try {
        port.postMessage({ version: VERSION, generation, id: ++sequence, op: "dispose", args: [] });
      } catch {
      }
    }
    for (const request of pending.values()) {
      if (request.timer)
        clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    options.signal?.removeEventListener("abort", abort);
    port.close();
    if (unexpected) {
      try {
        options.onFailure?.(error);
      } catch {
      }
    }
  };
  const abort = () => close(new ContainerOwnerError("ABORTED", "Owner Worker lifetime ended; cleanup is unconfirmed"), true);
  const call = (op, args = [], long = false) => {
    if (closed)
      return Promise.reject(new ContainerOwnerError("DISPOSED", "Owner client is closed"));
    if (pending.size >= maxPending + (control.has(op) ? 4 : 0) || sequence >= Number.MAX_SAFE_INTEGER)
      return Promise.reject(new ContainerOwnerError("RESOURCE_LIMIT", "Owner request budget exceeded"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = long ? void 0 : setTimeout(() => close(new ContainerOwnerError("ABORTED", "Owner request deadline exceeded; cleanup is unconfirmed"), true), timeout);
      pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage({ version: VERSION, generation, id, op, args });
      } catch (error) {
        if (timer)
          clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  };
  const ownedBytes = (value, max) => {
    if (!(value instanceof Uint8Array) || value.length > max)
      return fail("RESOURCE_LIMIT", "Owner request exceeds byte limit");
    return value.slice();
  };
  port.onmessage = (event) => {
    if (closed)
      return;
    const reply = event.data, request = pending.get(reply?.id);
    if (!reply || reply.version !== VERSION || reply.generation !== generation || typeof reply.ok !== "boolean" || !request) {
      close(new ContainerOwnerError("STARTUP_FAILED", "Invalid owner response generation or request"), true);
      return;
    }
    pending.delete(reply.id);
    if (request.timer)
      clearTimeout(request.timer);
    if (reply.ok)
      request.resolve(reply.value);
    else
      request.reject(new ContainerOwnerError(String(reply.value?.code ?? "STARTUP_FAILED"), String(reply.value?.message ?? "Owner request failed")));
  };
  port.onmessageerror = () => close(new ContainerOwnerError("STARTUP_FAILED", "Owner response could not be decoded"), true);
  port.start();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted)
    abort();
  return Object.freeze({
    fs: Object.freeze({
      readFile: (path) => call("fs.read", [path]),
      writeFile: (path, bytes, expected) => call("fs.write", [path, ownedBytes(bytes, maxFile), expected && { inode: expected.inode, bytes: ownedBytes(expected.bytes, maxFile) }]),
      stat: (path) => call("fs.stat", [path]),
      readdir: (path) => call("fs.readdir", [path]),
      mkdir: (path) => call("fs.mkdir", [path]),
      unlink: (path) => call("fs.unlink", [path])
    }),
    async startShell(settings = {}) {
      if (started)
        return fail("INVALID_ARGUMENT", "Each owner supports one SDK shell session");
      started = true;
      const result = await call("shell.start", [settings], true);
      const output = (index) => new ReadableStream({
        async pull(controller) {
          try {
            const bytes = await call("shell.read", [index], true);
            if (bytes === null)
              controller.close();
            else if (bytes instanceof Uint8Array && bytes.length <= CHUNK_BYTES)
              controller.enqueue(bytes);
            else
              throw new ContainerOwnerError("RESOURCE_LIMIT", "Invalid owner output chunk");
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: () => call("shell.cancel", [index])
      }, { highWaterMark: 0 });
      const stdin = new WritableStream({ write: (bytes) => call("shell.write", [ownedBytes(bytes, CHUNK_BYTES)], true), close: () => call("shell.eof", [], true), abort: () => call("shell.terminate") }, { highWaterMark: 1 });
      const exited = call("shell.exit", [], true);
      void exited.catch(() => {
      });
      const terminate = () => call("shell.terminate");
      return Object.freeze({ pid: result.pid, stdin, stdout: output(0), stderr: output(1), exited, terminate, dispose: terminate, interrupt: () => call("shell.interrupt") });
    },
    inspect: () => call("inspect"),
    flush: () => call("flush"),
    backup: () => call("backup"),
    restore: (bytes, settings) => call("restore", [ownedBytes(bytes, maxBackup), settings?.replace]),
    setAutosave: (enabled) => call("autosave", [enabled]),
    clearAssetCache: () => call("cache.clear"),
    collectGarbage: (settings = {}) => call("workspace.gc", [settings]),
    dispose() {
      return disposal ??= call("dispose").finally(() => close(new ContainerOwnerError("DISPOSED", "Owner client disposed")));
    }
  });
}

// ../../container-npm-latest-20261016-1tsvuzo3/publication/consumer/node_modules/@wasm-idle/container/dist/terminal/index.js
function attachTerminal(process, options) {
  const render = options.render, maxRenderBytes = options.maxRenderBytes ?? 4096;
  const maxPendingInputBytes = options.maxPendingInputBytes ?? 65536;
  if (typeof render !== "function" || !Number.isSafeInteger(maxRenderBytes) || maxRenderBytes < 1 || maxRenderBytes > 65536 || !Number.isSafeInteger(maxPendingInputBytes) || maxPendingInputBytes < 1 || maxPendingInputBytes > 1048576) {
    throw new ContainerError("INVALID_ARGUMENT", "Invalid terminal renderer or buffer limits");
  }
  let input;
  const readers = [];
  try {
    input = process.stdin.getWriter();
    readers.push(process.stdout.getReader());
    readers.push(process.stderr.getReader());
  } catch (error) {
    for (const reader of readers)
      reader.releaseLock();
    input?.releaseLock();
    throw error;
  }
  const writer = input;
  const controller = new AbortController();
  const stoppedError = new ContainerError("ABORTED", "Terminal rendering stopped");
  let stopped = false, inputClosed = false, exited = false, pendingInput = 0;
  const pendingWaits = /* @__PURE__ */ new Set();
  const interruptible = (work) => new Promise((resolve, reject) => {
    const stop = (error) => {
      pendingWaits.delete(stop);
      reject(error);
    };
    Promise.resolve(work).then((value) => {
      pendingWaits.delete(stop);
      resolve(value);
    }, stop);
    if (stopped)
      stop(stoppedError);
    else
      pendingWaits.add(stop);
  });
  let rejectFailure;
  const failed = new Promise((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => {
  });
  let failure;
  let termination, cleanup, closingInput;
  let renderTail = Promise.resolve();
  const released = [false, false];
  let inputReleased = false;
  const fail2 = (error) => {
    if (!failure) {
      failure = { error };
      rejectFailure(error);
    }
  };
  const terminate = () => {
    if (exited)
      return Promise.resolve();
    try {
      return termination ??= Promise.resolve(process.terminate());
    } catch (error) {
      return termination ??= Promise.reject(error);
    }
  };
  const releaseReader = (index) => {
    if (!released[index]) {
      readers[index].releaseLock();
      released[index] = true;
    }
  };
  const clean = (stopProcess) => {
    if (cleanup)
      return cleanup;
    let resolveCleanup, rejectCleanup;
    cleanup = new Promise((resolve, reject) => {
      resolveCleanup = resolve;
      rejectCleanup = reject;
    });
    stopped = true;
    inputClosed = true;
    controller.abort(stoppedError);
    for (const stop of pendingWaits)
      stop(stoppedError);
    const terminated = stopProcess ? terminate() : Promise.resolve();
    void (async () => {
      try {
        await Promise.all([terminated, Promise.allSettled([
          writer.abort(stoppedError),
          ...readers.map((reader, index) => released[index] ? Promise.resolve() : reader.cancel(stoppedError))
        ])]);
      } finally {
        for (let index = 0; index < readers.length; index++)
          releaseReader(index);
        if (!inputReleased) {
          writer.releaseLock();
          inputReleased = true;
        }
      }
    })().then(resolveCleanup, (error) => {
      fail2(error);
      rejectCleanup(error);
    });
    return cleanup;
  };
  const present = async (channel, text) => {
    if (!text || stopped)
      return;
    const next = renderTail.then(() => {
      if (stopped)
        throw stoppedError;
      return render({ channel, text, signal: controller.signal });
    });
    renderTail = next.catch((error) => {
      if (error !== stoppedError) {
        fail2(error);
        void clean(true).catch(fail2);
      }
    });
    await interruptible(next);
  };
  const drain = async (index, channel) => {
    const reader = readers[index];
    const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
    try {
      while (!stopped) {
        const { done, value } = await interruptible(reader.read());
        if (done) {
          await present(channel, decoder.decode());
          return;
        }
        if (!(value instanceof Uint8Array))
          throw new ContainerError("INVALID_ARGUMENT", "Terminal output requires bytes");
        for (let offset = 0; offset < value.length && !stopped; offset += maxRenderBytes) {
          await present(channel, decoder.decode(value.subarray(offset, offset + maxRenderBytes), { stream: true }));
        }
      }
    } catch (error) {
      if (error !== stoppedError) {
        fail2(error);
        void clean(true).catch(fail2);
      }
    } finally {
      releaseReader(index);
    }
  };
  const drains = [drain(0, "stdout"), drain(1, "stderr")];
  const exit = process.exited.then((result) => {
    exited = true;
    return result;
  });
  const completed = (async () => {
    try {
      const [result] = await Promise.race([Promise.all([exit, Promise.all(drains)]), failed]);
      await clean(false);
      if (failure)
        throw failure.error;
      return result;
    } catch (error) {
      fail2(error);
      try {
        await clean(true);
      } catch (cleanupError) {
        if (cleanupError === failure.error)
          throw cleanupError;
        throw new AggregateError([failure.error, cleanupError], "Terminal execution and cleanup failed");
      }
      throw failure.error;
    }
  })();
  void completed.catch(() => {
  });
  return {
    completed,
    async write(bytes) {
      if (stopped)
        throw new ContainerError("DISPOSED", "Terminal binding is closed");
      if (inputClosed)
        throw new ContainerError("INVALID_ARGUMENT", "Terminal input is closed");
      if (!(bytes instanceof Uint8Array))
        throw new ContainerError("INVALID_ARGUMENT", "Terminal input requires bytes");
      if (pendingInput + bytes.length > maxPendingInputBytes)
        throw new ContainerError("RESOURCE_LIMIT", "Terminal input queue exceeds its byte limit");
      if (!bytes.length)
        return;
      const owned = Uint8Array.from(bytes);
      pendingInput += owned.length;
      try {
        await interruptible(writer.write(owned));
      } finally {
        pendingInput -= owned.length;
      }
    },
    closeInput() {
      if (closingInput)
        return closingInput;
      if (inputClosed)
        return Promise.resolve();
      inputClosed = true;
      return closingInput = interruptible(writer.close());
    },
    terminate,
    async dispose() {
      await clean(!exited);
      await Promise.all(drains);
    }
  };
}

// examples/container/workbench.mjs
var encoder = new TextEncoder();
var maxFileBytes = 8 * 1024 * 1024;
var maxBackupBytes = 32 * 1024 * 1024;
var errorText = (error) => `${error?.code ?? error?.name ?? "ERROR"}: ${error?.message ?? String(error)}`;
function mountContainerWorkbench(element, client, options = {}) {
  element.innerHTML = `
    <header><h1>Container workspace</h1><p id="profile"></p><p>Publish an editor buffer to the workspace, then save the published revision. Browser storage can be evicted; keep an exported backup.</p></header>
    <div class="grid">
      <section aria-labelledby="files-heading"><h2 id="files-heading">Published files</h2>
        <form id="directory-form" class="row"><input id="directory" aria-label="Directory" value="/workspace"><button>Open</button></form>
        <ul id="files" aria-label="Workspace files"></ul><output id="file-status" role="status"></output>
      </section>
      <section aria-labelledby="editor-heading"><h2 id="editor-heading">File editor</h2>
        <div class="row"><input id="file-path" aria-label="File path" value="/workspace/main.c" readonly><button id="reload">Reload and discard buffer</button></div>
        <textarea id="editor" aria-label="File contents" spellcheck="false" disabled></textarea><p class="hint">UTF-8 text editor. Editing uses browser LF line endings; untouched file bytes are preserved.</p>
        <div class="row"><button id="publish" class="primary" disabled>Publish edit</button><button id="export-buffer" disabled>Export editor buffer</button></div>
        <output id="editor-status" role="status">Choose a UTF-8 file.</output>
      </section>
      <section class="wide" aria-labelledby="terminal-heading"><h2 id="terminal-heading">Process streams</h2>
        <p id="terminal-description" class="hint"></p>
        <div class="row"><button id="start" class="primary">Start session</button><button id="interrupt" disabled>Interrupt foreground</button><button id="stop" disabled>Stop session</button></div>
        <div class="streams"><div><label for="stdout">stdout</label><pre id="stdout" tabindex="0"></pre></div><div><label for="stderr">stderr</label><pre id="stderr" tabindex="0"></pre></div></div>
        <label for="input">UTF-8 input (sent exactly as written)</label><textarea id="input" rows="2" maxlength="65536" disabled></textarea>
        <div class="row"><button id="send" disabled>Send bytes</button><button id="eof" disabled>Send EOF</button></div>
        <output id="terminal-status" role="status">Session has not started.</output>
      </section>
      <section aria-labelledby="save-heading"><h2 id="save-heading">Workspace storage</h2>
        <div class="row"><button id="save" class="primary">Save published workspace</button><label><input id="autosave" type="checkbox">Autosave published changes</label></div>
        <output id="save-status" role="status"></output>
        <p class="hint">Save never publishes an editor buffer. Closing the owner does not save automatically.</p>
        <div class="row"><button id="backup">Export published workspace</button></div>
        <label for="restore-file">Workspace backup</label><input id="restore-file" type="file" accept=".json,application/json">
        <div class="row"><label><input id="replace" type="checkbox">Replace all published workspace files</label><button id="restore" disabled>Restore backup</button></div>
        <output id="backup-status" role="status"></output>
      </section>
      <section aria-labelledby="cache-heading"><h2 id="cache-heading">Downloaded assets</h2>
        <p class="hint">Asset cache and user workspace are separate stores. Loaded assets can remain in memory until this owner closes.</p>
        <div class="row"><button id="clear-cache">Clear downloaded assets</button><button id="gc">Collect orphan workspace blobs</button></div>
        <output id="cache-status" role="status"></output>
        <p class="hint">Orphan collection validates every retained recovery root before deleting unreferenced content. It never deletes a workspace to resolve a storage error.</p>
      </section>
    </div>
    <footer class="row"><button id="close">Close owner without saving</button><output id="connection-status" role="status"></output></footer>`;
  const node = (id) => element.querySelector(`#${id}`);
  node("profile").textContent = options.profileLabel ?? "Explicit host-provided runtime profile";
  node("terminal-description").textContent = options.terminalDescription ?? "Raw byte streams with UTF-8 display. This binding does not provide a PTY or job control.";
  node("input").value = options.initialInput ?? "";
  const status = (id, message, error = false) => {
    node(id).textContent = message;
    node(id).dataset.state = error ? "error" : "ready";
  };
  let disposed = false, disconnected = false, closing, terminal, session, started = false, inputClosed = false, inputSending = false, terminalRunning = false;
  let base, baseText = "", editorPath, editorBusy = false, inspection, refreshing;
  const events = new AbortController();
  const listen = (id, event, work) => node(id).addEventListener(event, work, { signal: events.signal });
  const modified = () => base !== void 0 && node("editor").value !== baseText;
  const restoreControls = () => {
    node("restore").disabled = disposed || disconnected || editorBusy || !node("replace").checked || !node("restore-file").files?.length;
  };
  const editorControls = () => {
    node("editor").disabled = disposed || editorBusy || !base;
    node("publish").disabled = disposed || disconnected || editorBusy || !modified();
    node("reload").disabled = disposed || disconnected || editorBusy;
    node("export-buffer").disabled = disposed || !base;
    restoreControls();
  };
  const download = async (name, bytes) => {
    if (options.onDownload) return options.onDownload(name, bytes.slice());
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };
  const refresh = () => {
    if (disposed || disconnected) return Promise.resolve();
    return refreshing ??= client.inspect().then((value) => {
      if (disposed || disconnected) return;
      inspection = value;
      const workspace = value.workspace, save = value.save;
      if (workspace) {
        const summary = `${workspace.state} \xB7 published revision ${workspace.generation} \xB7 saved revision ${workspace.committedGeneration ?? "none"}`;
        status("save-status", `${summary}${save?.pausedAfterError ? " \xB7 autosave paused; retry Save or export a backup." : ""}${workspace.lastError ? ` \xB7 ${workspace.lastError}` : ""}`, workspace.state === "error");
        node("autosave").checked = save?.autosave ?? false;
      } else status("save-status", "Memory workspace: published files last until the owner closes.");
      node("save").disabled = !workspace || disposed;
      node("autosave").disabled = !save || disposed;
      node("gc").disabled = !workspace || disposed;
      if (value.packages) {
        const assets = value.packages.assets;
        node("cache-status").dataset.cachedEntries = String(assets.cachedEntries);
      }
    }).catch((error) => {
      if (!disposed && !disconnected) status("connection-status", errorText(error), true);
    }).finally(() => {
      refreshing = void 0;
    });
  };
  const load = async (path, discard = false) => {
    if (disposed || disconnected || editorBusy) return;
    if (modified() && !discard) {
      status("editor-status", "Export the editor buffer or explicitly reload and discard it before opening another file.", true);
      return;
    }
    editorBusy = true;
    editorControls();
    try {
      const file = await client.fs.readFile(path);
      if (disposed) return;
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes);
      base = file;
      editorPath = path;
      node("file-path").value = path;
      node("editor").value = text;
      baseText = node("editor").value;
      status("editor-status", `Published revision ${file.generation}; editor buffer matches workspace.`);
    } catch (error) {
      if (!disposed) status("editor-status", `${errorText(error)}. Existing buffer was preserved. Binary files can be exported in a workspace backup.`, true);
    } finally {
      editorBusy = false;
      editorControls();
    }
  };
  const listFiles = async () => {
    if (disposed || disconnected) return;
    const path = node("directory").value;
    try {
      const entries = await client.fs.readdir(path);
      if (disposed || disconnected) return;
      node("files").replaceChildren();
      if (path !== "/workspace") {
        const item = document.createElement("li"), button = document.createElement("button");
        button.textContent = "../";
        button.dataset.path = path.slice(0, path.lastIndexOf("/")) || "/workspace";
        button.dataset.type = "directory";
        item.append(button);
        node("files").append(item);
      }
      for (const entry of entries.slice(0, 128)) {
        const item = document.createElement("li"), button = document.createElement("button");
        button.textContent = entry.name + (entry.type === "directory" ? "/" : "");
        button.dataset.path = `${path.replace(/\/$/u, "")}/${entry.name}`;
        button.dataset.type = entry.type;
        item.append(button);
        node("files").append(item);
      }
      status("file-status", `${entries.length} entries${entries.length > 128 ? "; first 128 shown" : ""}.`);
    } catch (error) {
      if (!disposed) status("file-status", errorText(error), true);
    }
  };
  listen("files", "click", (event) => {
    const button = event.target.closest("button[data-path]");
    if (!button || disposed) return;
    if (button.dataset.type === "directory") {
      node("directory").value = button.dataset.path;
      void listFiles();
    } else void load(button.dataset.path);
  });
  listen("directory-form", "submit", (event) => {
    event.preventDefault();
    void listFiles();
  });
  listen("editor", "input", () => {
    editorControls();
    status("editor-status", modified() ? "Unpublished editor buffer. Publish before compiling or saving." : `Editor buffer matches published revision ${base?.generation}.`);
  });
  listen("reload", "click", () => {
    if (editorPath && (!modified() || globalThis.confirm("Discard the unpublished editor buffer and reload this file?"))) void load(editorPath, true);
  });
  listen("export-buffer", "click", () => {
    void download(`${editorPath?.split("/").pop() ?? "buffer"}.unsaved.txt`, encoder.encode(node("editor").value)).catch((error) => status("editor-status", errorText(error), true));
  });
  listen("publish", "click", async () => {
    if (!base || editorBusy || disposed) return;
    const text = node("editor").value, bytes = encoder.encode(text);
    if (bytes.length > maxFileBytes) {
      status("editor-status", "Editor buffer exceeds 8 MiB; export it before reducing its size.", true);
      return;
    }
    editorBusy = true;
    editorControls();
    try {
      const result = await client.fs.writeFile(editorPath, bytes, { inode: base.inode, bytes: base.bytes });
      if (disposed) return;
      base = { ...result, bytes };
      baseText = text;
      status("editor-status", `Published revision ${result.generation}; not yet a durable save.`);
      await refresh();
    } catch (error) {
      if (!disposed) status("editor-status", `${errorText(error)}. Your unpublished buffer is intact; export it or reload explicitly.`, true);
    } finally {
      editorBusy = false;
      editorControls();
    }
  });
  listen("save", "click", async () => {
    node("save").disabled = true;
    status("save-status", "Saving published workspace\u2026");
    try {
      await client.flush();
    } catch (error) {
      status("save-status", `${errorText(error)}. Retry Save or export the published workspace.`, true);
    } finally {
      if (!disposed) {
        await refresh();
        node("save").disabled = disconnected || !inspection?.workspace;
      }
    }
  });
  listen("autosave", "change", async () => {
    try {
      await client.setAutosave(node("autosave").checked);
      await refresh();
    } catch (error) {
      status("save-status", errorText(error), true);
      await refresh();
    }
  });
  listen("backup", "click", async () => {
    node("backup").disabled = true;
    try {
      const bytes = await client.backup();
      await download("container-workspace.json", bytes);
      status("backup-status", `Exported ${bytes.length} bytes of published files. Unpublished editor buffers are separate.`);
    } catch (error) {
      status("backup-status", errorText(error), true);
    } finally {
      node("backup").disabled = disposed || disconnected;
    }
  });
  listen("replace", "change", restoreControls);
  listen("restore-file", "change", restoreControls);
  listen("restore", "click", async () => {
    const file = node("restore-file").files?.[0];
    if (!file || !node("replace").checked || disposed || disconnected || editorBusy) return;
    if (file.size > maxBackupBytes) {
      status("backup-status", "Backup exceeds the 32 MiB limit.", true);
      return;
    }
    if (modified()) {
      status("backup-status", "Export or explicitly discard your unpublished editor buffer before replacing the workspace.", true);
      return;
    }
    editorBusy = true;
    editorControls();
    try {
      await client.restore(new Uint8Array(await file.arrayBuffer()), { replace: true });
      if (disposed) return;
      base = void 0;
      editorPath = void 0;
      baseText = "";
      node("editor").value = "";
      node("file-path").value = "";
      editorControls();
      node("replace").checked = false;
      status("backup-status", "Backup restored to published memory. Save the workspace to commit it.");
      await listFiles();
      await refresh();
    } catch (error) {
      status("backup-status", `${errorText(error)}. The editor buffer was preserved; inspect published files before retrying.`, true);
    } finally {
      editorBusy = false;
      editorControls();
    }
  });
  listen("clear-cache", "click", async () => {
    node("clear-cache").disabled = true;
    try {
      await client.clearAssetCache();
      status("cache-status", "Downloaded assets cleared. Workspace files and recovery roots were preserved.");
    } catch (error) {
      status("cache-status", errorText(error), true);
    } finally {
      node("clear-cache").disabled = disposed || disconnected;
    }
  });
  listen("gc", "click", async () => {
    node("gc").disabled = true;
    try {
      const result = await client.collectGarbage();
      status("cache-status", `Removed ${result.deletedBlobs} orphan blobs (${result.deletedBytes} bytes); retained ${result.retainedRoots} recovery roots.${result.complete ? "" : " Budget reached; remaining blobs were preserved."}`);
    } catch (error) {
      status("cache-status", errorText(error), true);
    } finally {
      if (!disposed) {
        await refresh();
        node("gc").disabled = disconnected || !inspection?.workspace;
      }
    }
  });
  const terminalControls = (running) => {
    terminalRunning = running;
    for (const id of ["input", "send"]) node(id).disabled = !running || inputClosed || inputSending || disposed || disconnected;
    node("eof").disabled = !running || inputClosed || disposed || disconnected;
    for (const id of ["interrupt", "stop"]) node(id).disabled = !running || disposed || disconnected;
    node("start").disabled = started || disposed || disconnected;
  };
  listen("start", "click", async () => {
    if (started || disposed) return;
    started = true;
    terminalControls(false);
    status("terminal-status", "Preparing verified runtime assets\u2026");
    try {
      session = await client.startShell(options.startOptions ?? {});
      if (disposed) {
        await session.dispose();
        return;
      }
      terminal = attachTerminal(session, { maxRenderBytes: 4096, render: ({ channel, text, signal }) => {
        if (disposed || signal.aborted) return;
        const output = node(channel);
        output.textContent = (output.textContent + text).slice(-32768);
        output.scrollTop = output.scrollHeight;
      } });
      terminalControls(true);
      status("terminal-status", `Running process ${session.pid}.`);
      void terminal.completed.then((result) => {
        if (disposed) return;
        terminalControls(false);
        status("terminal-status", `${result.reason}; exit ${result.code ?? "none"}. Reload the page to open a new owner session.`, result.reason !== "exited");
        void refresh();
        void listFiles();
      }, (error) => {
        if (!disposed) {
          terminalControls(false);
          status("terminal-status", errorText(error), true);
        }
      });
    } catch (error) {
      if (!disposed) status("terminal-status", errorText(error), true);
      if (session) await session.dispose().catch(() => {
      });
    }
  });
  listen("send", "click", async () => {
    if (!terminal || inputClosed || inputSending || disposed || disconnected) return;
    inputSending = true;
    terminalControls(terminalRunning);
    try {
      await terminal.write(encoder.encode(node("input").value));
      node("input").value = "";
    } catch (error) {
      if (!disposed) status("terminal-status", errorText(error), true);
    } finally {
      inputSending = false;
      if (!disposed) terminalControls(terminalRunning);
    }
  });
  listen("eof", "click", async () => {
    inputClosed = true;
    terminalControls(true);
    try {
      await terminal?.closeInput();
    } catch (error) {
      if (!disposed) status("terminal-status", errorText(error), true);
    }
  });
  listen("interrupt", "click", async () => {
    try {
      const count = await session?.interrupt();
      if (!disposed && terminalRunning) status("terminal-status", `Interrupt delivered to ${count ?? 0} foreground commands.`);
    } catch (error) {
      if (!disposed) status("terminal-status", errorText(error), true);
    }
  });
  listen("stop", "click", () => {
    void terminal?.terminate().catch((error) => {
      if (!disposed) status("terminal-status", errorText(error), true);
    });
  });
  const timer = setInterval(() => {
    void refresh();
  }, 1e3);
  const ownerFailed = () => {
    if (disposed) return;
    disconnected = true;
    clearInterval(timer);
    for (const control2 of element.querySelectorAll("button,input")) control2.disabled = true;
    node("close").disabled = false;
    editorControls();
    terminalControls(false);
    status("connection-status", `${errorText(options.ownerSignal.reason)}. Owner cleanup was not acknowledged. Export the editor buffer before reloading; only saved workspace revisions can be restored.`, true);
  };
  options.ownerSignal?.addEventListener("abort", ownerFailed, { once: true });
  if (options.ownerSignal?.aborted) ownerFailed();
  const beforeUnload = (event) => {
    if (!disposed && (modified() || inspection?.workspace?.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  globalThis.addEventListener("beforeunload", beforeUnload);
  const dispose = () => closing ??= (async () => {
    disposed = true;
    clearInterval(timer);
    events.abort();
    options.ownerSignal?.removeEventListener("abort", ownerFailed);
    globalThis.removeEventListener("beforeunload", beforeUnload);
    for (const control2 of element.querySelectorAll("button,input,textarea")) control2.disabled = true;
    try {
      try {
        if (terminal) await terminal.dispose();
      } finally {
        await client.dispose();
      }
      status("connection-status", "Owner closed. Only explicitly saved workspace revisions will be restored.");
    } finally {
      await options.onDispose?.();
    }
  })();
  listen("close", "click", () => {
    void dispose().catch((error) => status("connection-status", errorText(error), true));
  });
  const ready = (async () => {
    await refresh();
    await listFiles();
    await load(options.initialPath ?? "/workspace/main.c");
  })();
  return Object.freeze({ ready, refresh, dispose });
}

// examples/container/main.mjs
var application = (async () => {
  const workspaceId = new URL(location.href).searchParams.get("workspace") ?? "container-workbench";
  if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(workspaceId)) throw new Error("Invalid workspace identifier");
  const worker = new Worker(new URL("./owner.mjs", import.meta.url), { type: "module", name: "container-workbench-owner" });
  const channel = new MessageChannel();
  const lifetime = new AbortController();
  const profile = define_CONTAINER_WORKBENCH_PROFILE_default;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("Owner startup deadline exceeded"));
      }, 3e4);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        if (event.data?.ready === true) resolve();
        else reject(new Error(`${event.data?.code ?? "STARTUP_FAILED"}: ${event.data?.message ?? "Owner startup failed"}`));
      };
      const failure = (error) => {
        clearTimeout(timer);
        lifetime.abort(error);
        reject(error);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        failure(new Error(event.message));
      };
      worker.onmessageerror = () => failure(new Error("Owner Worker response could not be decoded"));
      worker.postMessage({ port: channel.port1, workspaceId }, [channel.port1]);
    });
    const client = createContainerOwnerClient(channel.port2, { signal: lifetime.signal });
    const view = mountContainerWorkbench(document.querySelector("#app"), client, {
      ...profile,
      profileLabel: `Workspace ${workspaceId} \xB7 ${profile.profileLabel}`,
      ownerSignal: lifetime.signal,
      onDispose: () => worker.terminate()
    });
    await view.ready;
    return Object.freeze({ client, view });
  } catch (error) {
    channel.port2.close();
    worker.terminate();
    throw error;
  }
})();
void application.catch((error) => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `${error.message}. Existing stored files were preserved. Close any other tab using this workspace, then retry.`;
  document.querySelector("#app").replaceChildren(message);
});
export {
  application
};
