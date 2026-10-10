# Python language-server latency and bounded analysis reuse

## Separate list delivery from documentation

The completion list is latency-sensitive: the editor needs candidate names and insertion text while the user types. Computing the documentation for every candidate delays that first response even though typically only one candidate is selected. The server advertises completionItem/resolve, returns a lightweight list with opaque cache tokens, and computes documentation when the editor resolves the selected entry. Repeated resolves reuse that entry's documentation.

This changes work scheduling, not Python semantic analysis. Jedi remains the authority. The list retains at most 2048 candidates and marks oversized results isIncomplete, enabling a narrower-prefix requery. Only two completion result sets and eight Script instances are retained. These object-count limits are not hard byte/heap bounds because Jedi's object graphs vary with the workspace.

## Workspace epoch and stale responses

A Script can depend on imported files, not just the current file. All open/change/save/close events, watched-file notifications, project changes and shutdown invalidate analysis and completion references. A global workspace epoch is conservative but correct for cross-file imports. Reusing a Script merely because the current document text is unchanged would risk stale results after editing a dependency.

Malformed, stale and evicted completion tokens return the original item without evaluating a stale Jedi object. Existing full text synchronization is preserved; incremental synchronization and shared Pyodide Modules are not implemented here. Client cancellation remains a separate concern: deferred documentation does not automatically cancel obsolete list or resolve requests.

## Actual packaging path

The Python worker imports server.py and __init__.py with Vite's ?raw handling, writes them into /wasm_idle_lsp/wasm_idle_python_lsp, and adds that parent directory to sys.path. Therefore this change is included by the normal LSP JavaScript worker build. It does not require a separately distributed wasm_idle_python_lsp wheel. Earlier draft wording about rebuilding such a wheel was inaccurate. Jedi and Parso are the separately pinned upstream dependency wheels.

The integration test verifies those dependency wheels against the checked-in Pyodide lock, unpacks real packages and installs the exact candidate Python sources. It executes all 13 regression cases under real Pyodide, explicitly requiring zero skips; those include controlled fake-Script cache accounting and a genuine Jedi completion case. It separately registers a real JavaScript emit module and drives create_bridge through initialize, didOpen, completion, selected-item resolve, edit/stale resolve and shutdown.

## Executed evidence and limits

The real integration passed using Pyodide 314.0.7, the distributed Jedi 0.19.2 / Parso 0.8.6 wheels, Node 24.21.0 and Vitest 5.0.3. The actual math.sin list item initially has no documentation; resolve supplies it; editing the document prevents the previous token from resolving. This is not a handwritten semantic fixture. Node Buffer values are converted to Uint8Array before Pyodide unpacking to match its supported typed-array boundary.

This extends the earlier native Python/Jedi 0.20 regression run with the deployed dependency versions. The test is collected in normal root CI. It exercises real Wasm and the JS/Python JSON-RPC bridge in Node, not the Monaco provider or a real browser Worker. Editor documentation display, cancellation, oversized-list requery and long-session retention still need their browser checks.

## Measurement design

Measure first completion-list latency, selected documentation latency, response bytes, Script construction count, stale-request rate and retained heap. Report cold startup separately from warm typing. Compare identical workspaces, cursor positions and completion output, and include dependency edits. Laziness moves work out of the list critical path; it may make the first selected documentation slightly later. No browser speedup percentage is claimed until both paths are measured.
