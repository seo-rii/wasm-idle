import { attachTerminal } from '@wasm-idle/container/terminal';

const encoder = new TextEncoder();
const maxFileBytes = 8 * 1024 * 1024, maxBackupBytes = 32 * 1024 * 1024;
const errorText = error => `${error?.code ?? error?.name ?? 'ERROR'}: ${error?.message ?? String(error)}`;

/** A DOM binding. The private owner remains the source of published files and processes. */
export function mountContainerWorkbench(element, client, options = {}) {
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
  const node = id => element.querySelector(`#${id}`);
  node('profile').textContent = options.profileLabel ?? 'Explicit host-provided runtime profile';
  node('terminal-description').textContent = options.terminalDescription ?? 'Raw byte streams with UTF-8 display. This binding does not provide a PTY or job control.';
  const status = (id, message, error = false) => { node(id).textContent = message; node(id).dataset.state = error ? 'error' : 'ready'; };
  let disposed = false, disconnected = false, closing, terminal, session, started = false, inputClosed = false, inputSending = false, terminalRunning = false;
  let base, baseText = '', editorPath, editorBusy = false, inspection, refreshing;
  const events = new AbortController();
  const listen = (id, event, work) => node(id).addEventListener(event, work, { signal: events.signal });
  const modified = () => base !== undefined && node('editor').value !== baseText;
  const restoreControls = () => { node('restore').disabled = disposed || disconnected || editorBusy || !node('replace').checked || !node('restore-file').files?.length; };
  const editorControls = () => {
    node('editor').disabled = disposed || editorBusy || !base;
    node('publish').disabled = disposed || disconnected || editorBusy || !modified();
    node('reload').disabled = disposed || disconnected || editorBusy;
    node('export-buffer').disabled = disposed || !base;
    restoreControls();
  };
  const download = async (name, bytes) => {
    if (options.onDownload) return options.onDownload(name, bytes.slice());
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.hidden = true;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const refresh = () => {
    if (disposed || disconnected) return Promise.resolve();
    return refreshing ??= client.inspect().then(value => {
      if (disposed || disconnected) return;
      inspection = value;
      const workspace = value.workspace, save = value.save;
      if (workspace) {
        const summary = `${workspace.state} · published revision ${workspace.generation} · saved revision ${workspace.committedGeneration ?? 'none'}`;
        status('save-status', `${summary}${save?.pausedAfterError ? ' · autosave paused; retry Save or export a backup.' : ''}${workspace.lastError ? ` · ${workspace.lastError}` : ''}`, workspace.state === 'error');
        node('autosave').checked = save?.autosave ?? false;
      } else status('save-status', 'Memory workspace: published files last until the owner closes.');
      node('save').disabled = !workspace || disposed;
      node('autosave').disabled = !save || disposed;
      node('gc').disabled = !workspace || disposed;
      if (value.packages) {
        const assets = value.packages.assets;
        node('cache-status').dataset.cachedEntries = String(assets.cachedEntries);
      }
    }).catch(error => { if (!disposed && !disconnected) status('connection-status', errorText(error), true); }).finally(() => { refreshing = undefined; });
  };
  const load = async (path, discard = false) => {
    if (disposed || disconnected || editorBusy) return;
    if (modified() && !discard) { status('editor-status', 'Export the editor buffer or explicitly reload and discard it before opening another file.', true); return; }
    editorBusy = true; editorControls();
    try {
      const file = await client.fs.readFile(path);
      if (disposed) return;
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes);
      base = file; editorPath = path;
      node('file-path').value = path; node('editor').value = text;
      baseText = node('editor').value;
      status('editor-status', `Published revision ${file.generation}; editor buffer matches workspace.`);
    } catch (error) { if (!disposed) status('editor-status', `${errorText(error)}. Existing buffer was preserved. Binary files can be exported in a workspace backup.`, true); }
    finally { editorBusy = false; editorControls(); }
  };
  const listFiles = async () => {
    if (disposed || disconnected) return;
    const path = node('directory').value;
    try {
      const entries = await client.fs.readdir(path);
      if (disposed || disconnected) return;
      node('files').replaceChildren();
      if (path !== '/workspace') {
        const item = document.createElement('li'), button = document.createElement('button');
        button.textContent = '../'; button.dataset.path = path.slice(0, path.lastIndexOf('/')) || '/workspace'; button.dataset.type = 'directory'; item.append(button); node('files').append(item);
      }
      for (const entry of entries.slice(0, 128)) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.textContent = entry.name + (entry.type === 'directory' ? '/' : '');
        button.dataset.path = `${path.replace(/\/$/u, '')}/${entry.name}`; button.dataset.type = entry.type;
        item.append(button); node('files').append(item);
      }
      status('file-status', `${entries.length} entries${entries.length > 128 ? '; first 128 shown' : ''}.`);
    } catch (error) { if (!disposed) status('file-status', errorText(error), true); }
  };
  listen('files', 'click', event => {
    const button = event.target.closest('button[data-path]');
    if (!button || disposed) return;
    if (button.dataset.type === 'directory') { node('directory').value = button.dataset.path; void listFiles(); } else void load(button.dataset.path);
  });
  listen('directory-form', 'submit', event => { event.preventDefault(); void listFiles(); });
  listen('editor', 'input', () => { editorControls(); status('editor-status', modified() ? 'Unpublished editor buffer. Publish before compiling or saving.' : `Editor buffer matches published revision ${base?.generation}.`); });
  listen('reload', 'click', () => { if (editorPath && (!modified() || globalThis.confirm('Discard the unpublished editor buffer and reload this file?'))) void load(editorPath, true); });
  listen('export-buffer', 'click', () => { void download(`${editorPath?.split('/').pop() ?? 'buffer'}.unsaved.txt`, encoder.encode(node('editor').value)).catch(error => status('editor-status', errorText(error), true)); });
  listen('publish', 'click', async () => {
    if (!base || editorBusy || disposed) return;
    const text = node('editor').value, bytes = encoder.encode(text);
    if (bytes.length > maxFileBytes) { status('editor-status', 'Editor buffer exceeds 8 MiB; export it before reducing its size.', true); return; }
    editorBusy = true; editorControls();
    try {
      const result = await client.fs.writeFile(editorPath, bytes, { inode: base.inode, bytes: base.bytes });
      if (disposed) return;
      base = { ...result, bytes }; baseText = text;
      status('editor-status', `Published revision ${result.generation}; not yet a durable save.`); await refresh();
    } catch (error) { if (!disposed) status('editor-status', `${errorText(error)}. Your unpublished buffer is intact; export it or reload explicitly.`, true); }
    finally { editorBusy = false; editorControls(); }
  });
  listen('save', 'click', async () => {
    node('save').disabled = true; status('save-status', 'Saving published workspace…');
    try { await client.flush(); }
    catch (error) { status('save-status', `${errorText(error)}. Retry Save or export the published workspace.`, true); }
    finally { if (!disposed) { await refresh(); node('save').disabled = disconnected || !inspection?.workspace; } }
  });
  listen('autosave', 'change', async () => {
    try { await client.setAutosave(node('autosave').checked); await refresh(); }
    catch (error) { status('save-status', errorText(error), true); await refresh(); }
  });
  listen('backup', 'click', async () => {
    node('backup').disabled = true;
    try { const bytes = await client.backup(); await download('container-workspace.json', bytes); status('backup-status', `Exported ${bytes.length} bytes of published files. Unpublished editor buffers are separate.`); }
    catch (error) { status('backup-status', errorText(error), true); }
    finally { node('backup').disabled = disposed || disconnected; }
  });
  listen('replace', 'change', restoreControls); listen('restore-file', 'change', restoreControls);
  listen('restore', 'click', async () => {
    const file = node('restore-file').files?.[0];
    if (!file || !node('replace').checked || disposed || disconnected || editorBusy) return;
    if (file.size > maxBackupBytes) { status('backup-status', 'Backup exceeds the 32 MiB limit.', true); return; }
    if (modified()) { status('backup-status', 'Export or explicitly discard your unpublished editor buffer before replacing the workspace.', true); return; }
    editorBusy = true; editorControls();
    try {
      await client.restore(new Uint8Array(await file.arrayBuffer()), { replace: true });
      if (disposed) return;
      base = undefined; editorPath = undefined; baseText = ''; node('editor').value = ''; node('file-path').value = ''; editorControls();
      node('replace').checked = false; status('backup-status', 'Backup restored to published memory. Save the workspace to commit it.'); await listFiles(); await refresh();
    } catch (error) { status('backup-status', `${errorText(error)}. The editor buffer was preserved; inspect published files before retrying.`, true); }
    finally { editorBusy = false; editorControls(); }
  });
  listen('clear-cache', 'click', async () => {
    node('clear-cache').disabled = true;
    try { await client.clearAssetCache(); status('cache-status', 'Downloaded assets cleared. Workspace files and recovery roots were preserved.'); }
    catch (error) { status('cache-status', errorText(error), true); }
    finally { node('clear-cache').disabled = disposed || disconnected; }
  });
  listen('gc', 'click', async () => {
    node('gc').disabled = true;
    try { const result = await client.collectGarbage(); status('cache-status', `Removed ${result.deletedBlobs} orphan blobs (${result.deletedBytes} bytes); retained ${result.retainedRoots} recovery roots.${result.complete ? '' : ' Budget reached; remaining blobs were preserved.'}`); }
    catch (error) { status('cache-status', errorText(error), true); }
    finally { if (!disposed) { await refresh(); node('gc').disabled = disconnected || !inspection?.workspace; } }
  });
  const terminalControls = running => {
    terminalRunning = running;
    for (const id of ['input', 'send']) node(id).disabled = !running || inputClosed || inputSending || disposed || disconnected;
    node('eof').disabled = !running || inputClosed || disposed || disconnected;
    for (const id of ['interrupt', 'stop']) node(id).disabled = !running || disposed || disconnected;
    node('start').disabled = started || disposed || disconnected;
  };
  listen('start', 'click', async () => {
    if (started || disposed) return;
    started = true; terminalControls(false); status('terminal-status', 'Preparing verified runtime assets…');
    try {
      session = await client.startShell(options.startOptions ?? {});
      if (disposed) { await session.dispose(); return; }
      terminal = attachTerminal(session, { maxRenderBytes: 4096, render: ({ channel, text, signal }) => {
        if (disposed || signal.aborted) return;
        const output = node(channel); output.textContent = (output.textContent + text).slice(-32768); output.scrollTop = output.scrollHeight;
      } });
      terminalControls(true); status('terminal-status', `Running process ${session.pid}.`);
      void terminal.completed.then(result => {
        if (disposed) return; terminalControls(false);
        status('terminal-status', `${result.reason}; exit ${result.code ?? 'none'}. Reload the page to open a new owner session.`, result.reason !== 'exited');
        void refresh(); void listFiles();
      }, error => { if (!disposed) { terminalControls(false); status('terminal-status', errorText(error), true); } });
    } catch (error) { if (!disposed) status('terminal-status', errorText(error), true); if (session) await session.dispose().catch(() => {}); }
  });
  listen('send', 'click', async () => {
    if (!terminal || inputClosed || inputSending || disposed || disconnected) return;
    inputSending = true; terminalControls(terminalRunning);
    try { await terminal.write(encoder.encode(node('input').value)); node('input').value = ''; }
    catch (error) { if (!disposed) status('terminal-status', errorText(error), true); }
    finally { inputSending = false; if (!disposed) terminalControls(terminalRunning); }
  });
  listen('eof', 'click', async () => {
    inputClosed = true; terminalControls(true);
    try { await terminal?.closeInput(); } catch (error) { if (!disposed) status('terminal-status', errorText(error), true); }
  });
  listen('interrupt', 'click', async () => {
    try { const count = await session?.interrupt(); if (!disposed && terminalRunning) status('terminal-status', `Interrupt delivered to ${count ?? 0} foreground commands.`); }
    catch (error) { if (!disposed) status('terminal-status', errorText(error), true); }
  });
  listen('stop', 'click', () => { void terminal?.terminate().catch(error => { if (!disposed) status('terminal-status', errorText(error), true); }); });
  const timer = setInterval(() => { void refresh(); }, 1000);
  const ownerFailed = () => {
    if (disposed) return;
    disconnected = true; clearInterval(timer);
    for (const control of element.querySelectorAll('button,input')) control.disabled = true;
    node('close').disabled = false; editorControls(); terminalControls(false);
    status('connection-status', `${errorText(options.ownerSignal.reason)}. Owner cleanup was not acknowledged. Export the editor buffer before reloading; only saved workspace revisions can be restored.`, true);
  };
  options.ownerSignal?.addEventListener('abort', ownerFailed, { once: true });
  if (options.ownerSignal?.aborted) ownerFailed();
  const beforeUnload = event => { if (!disposed && (modified() || inspection?.workspace?.dirty)) { event.preventDefault(); event.returnValue = ''; } };
  globalThis.addEventListener('beforeunload', beforeUnload);
  const dispose = () => closing ??= (async () => {
    disposed = true; clearInterval(timer); events.abort(); options.ownerSignal?.removeEventListener('abort', ownerFailed); globalThis.removeEventListener('beforeunload', beforeUnload);
    for (const control of element.querySelectorAll('button,input,textarea')) control.disabled = true;
    try {
      try { if (terminal) await terminal.dispose(); }
      finally { await client.dispose(); }
      status('connection-status', 'Owner closed. Only explicitly saved workspace revisions will be restored.');
    }
    finally { await options.onDispose?.(); }
  })();
  listen('close', 'click', () => { void dispose().catch(error => status('connection-status', errorText(error), true)); });
  const ready = (async () => { await refresh(); await listFiles(); await load(options.initialPath ?? '/workspace/main.c'); })();
  return Object.freeze({ ready, refresh, dispose });
}
