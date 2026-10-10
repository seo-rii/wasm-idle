"""Native regression tests; this does not exercise the browser's Pyodide bridge."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "packages/lsp/src/python/package/wasm_idle_python_lsp/server.py"
messages = []
sys.modules["wasm_idle_lsp_bridge"] = types.SimpleNamespace(emit=lambda value: messages.append(json.loads(value)))
spec = importlib.util.spec_from_file_location("tested_python_lsp", PATH)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class Candidate:
    def __init__(self, name):
        self.name = self.name_with_symbols = self.complete = name
        self.type = "function"
        self.calls = 0

    def docstring(self, raw=False):
        self.calls += 1
        return f"documentation for {self.name}"


class FakeScript:
    instances = []
    count = 3

    def __init__(self, **kwargs):
        self.candidates = [Candidate(f"item{i}") for i in range(self.count)]
        self.instances.append(self)

    def complete(self, **kwargs):
        return self.candidates


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root_patch = patch.object(server, "WORKSPACE_ROOT", self.temp.name)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.script_patch = patch.object(server, "Script", FakeScript)
        self.script_patch.start()
        self.addCleanup(self.script_patch.stop)
        FakeScript.instances = []
        self.lsp = server.WasmIdlePythonLsp()
        self.uri = self.open("main.py")

    def open(self, name, text="x = 1\n"):
        uri = (Path(self.temp.name) / name).as_uri()
        self.lsp._handle_notification("textDocument/didOpen", {"textDocument": {
            "uri": uri, "text": text, "version": 1, "languageId": "python"
        }})
        return uri

    def complete(self, uri=None):
        return self.lsp._completion({"textDocument": {"uri": uri or self.uri}, "position": {"line": 0, "character": 0}})

    def change(self, uri=None):
        self.lsp._handle_notification("textDocument/didChange", {
            "textDocument": {"uri": uri or self.uri, "version": 2},
            "contentChanges": [{"text": "changed = 2\n"}]
        })

    def test_public_bridge_entrypoint_remains_callable(self):
        handle = server.create_bridge()
        handle(json.dumps({"jsonrpc": "2.0", "id": 7, "method": "initialize"}))
        self.assertEqual(messages[-1]["result"]["serverInfo"]["name"], server.SERVER_NAME)

    def test_advertises_resolve_and_preserves_full_sync(self):
        caps = self.lsp._initialize({})["capabilities"]
        self.assertTrue(caps["completionProvider"]["resolveProvider"])
        self.assertEqual(caps["textDocumentSync"], 1)

    def test_only_selected_documentation_is_computed_and_reused(self):
        items = self.complete()["items"]
        candidates = FakeScript.instances[-1].candidates
        self.assertEqual([c.calls for c in candidates], [0, 0, 0])
        resolved = self.lsp._completion_resolve(items[1])
        self.assertEqual(resolved["documentation"], "documentation for item1")
        self.lsp._completion_resolve(items[1])
        self.assertEqual([c.calls for c in candidates], [0, 1, 0])
        self.assertNotIn("documentation", items[1])

    def test_script_reused_until_source_changes(self):
        first = self.lsp._script(self.uri)
        self.assertIs(first, self.lsp._script(self.uri))
        self.change()
        self.assertIsNot(first, self.lsp._script(self.uri))

    def test_stale_completion_after_edit_is_not_resolved(self):
        item = self.complete()["items"][0]
        self.change()
        self.assertEqual(self.lsp._completion_resolve(item), item)
        self.assertNotIn("documentation", item)

    def test_editing_an_imported_file_invalidates_other_documents(self):
        other = self.open("dependency.py")
        item = self.complete()["items"][0]
        first = self.lsp._script(self.uri)
        self.change(other)
        self.assertEqual(self.lsp._completion_resolve(item), item)
        self.assertIsNot(first, self.lsp._script(self.uri))

    def test_close_and_watched_files_invalidate(self):
        item = self.complete()["items"][0]
        self.lsp._handle_notification("workspace/didChangeWatchedFiles", {})
        self.assertEqual(self.lsp._completion_resolve(item), item)
        item = self.complete()["items"][0]
        self.lsp._handle_notification("textDocument/didClose", {"textDocument": {"uri": self.uri}})
        self.assertEqual(self.lsp._completion_resolve(item), item)
        self.assertEqual(len(self.lsp._script_cache), 0)

    def test_completion_results_are_bounded_and_evicted_tokens_are_harmless(self):
        old = self.complete()["items"][0]
        for _ in range(server.MAX_COMPLETION_RESULTS + 1):
            self.complete()
        self.assertEqual(len(self.lsp._completion_results), server.MAX_COMPLETION_RESULTS)
        self.assertEqual(self.lsp._completion_resolve(old), old)

    def test_large_results_are_marked_incomplete(self):
        with patch.object(server, "MAX_COMPLETION_ITEMS", 2):
            result = self.complete()
        self.assertTrue(result["isIncomplete"])
        self.assertEqual(len(result["items"]), 2)

    def test_invalid_resolve_data_is_harmless(self):
        for data in (None, [], "bad", {"wasmIdleCompletion": True, "index": 0}, {"wasmIdleCompletion": 1, "index": -1}):
            item = {"label": "item0", "data": data}
            self.assertEqual(self.lsp._completion_resolve(item), item)

    def test_script_cache_is_bounded(self):
        uris = [self.open(f"file{i}.py") for i in range(server.MAX_CACHED_SCRIPTS + 2)]
        for uri in uris:
            self.lsp._script(uri)
        self.assertEqual(len(self.lsp._script_cache), server.MAX_CACHED_SCRIPTS)

    def test_resolve_and_shutdown_through_json_rpc(self):
        item = self.complete()["items"][0]
        self.lsp.handle(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "completionItem/resolve", "params": item}))
        self.assertIn("documentation", messages[-1]["result"])
        self.lsp.handle(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "shutdown"}))
        self.assertIsNone(messages[-1]["result"])
        self.assertTrue(self.lsp.shutdown_requested)
        self.assertEqual(len(self.lsp._completion_results), 0)

    def test_real_jedi_completion_and_resolve(self):
        try:
            from jedi import Script
        except ImportError:
            self.skipTest("native Jedi is not installed")
        uri = self.open("real.py", "import math\nmath.s")
        with patch.object(server, "Script", Script):
            result = self.lsp._completion({"textDocument": {"uri": uri}, "position": {"line": 1, "character": 6}})
            item = next(item for item in result["items"] if item["label"] == "sin")
            self.assertNotIn("documentation", item)
            self.assertIn("sin", self.lsp._completion_resolve(item)["documentation"])


if __name__ == "__main__":
    unittest.main()
