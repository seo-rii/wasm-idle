from __future__ import annotations

import ast
import json
from collections import OrderedDict
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from jedi import Project, Script
except Exception:
    Project = None
    Script = None

from wasm_idle_lsp_bridge import emit

SERVER_NAME = "wasm-idle-python-lsp"
SERVER_VERSION = "0.2.0"
WORKSPACE_ROOT = "/workspace"

TEXT_DOCUMENT_SYNC_FULL = 1
DIAGNOSTIC_SEVERITY_ERROR = 1
MAX_CACHED_SCRIPTS = 8
MAX_COMPLETION_RESULTS = 2
MAX_COMPLETION_ITEMS = 2048

COMPLETION_ITEM_KIND = {
    "text": 1,
    "method": 2,
    "function": 3,
    "constructor": 4,
    "field": 5,
    "variable": 6,
    "class": 7,
    "interface": 8,
    "module": 9,
    "property": 10,
    "unit": 11,
    "value": 12,
    "enum": 13,
    "keyword": 14,
    "snippet": 15,
    "color": 16,
    "file": 17,
    "reference": 18,
    "folder": 19,
    "enumMember": 20,
    "constant": 21,
    "struct": 22,
    "event": 23,
    "operator": 24,
    "typeParameter": 25,
}

SYMBOL_KIND = {
    "file": 1,
    "module": 2,
    "namespace": 3,
    "package": 4,
    "class": 5,
    "method": 6,
    "property": 7,
    "field": 8,
    "constructor": 9,
    "enum": 10,
    "interface": 11,
    "function": 12,
    "variable": 13,
    "constant": 14,
}

COMPLETION_KIND_MAP = {
    "module": COMPLETION_ITEM_KIND["module"],
    "class": COMPLETION_ITEM_KIND["class"],
    "instance": COMPLETION_ITEM_KIND["variable"],
    "function": COMPLETION_ITEM_KIND["function"],
    "param": COMPLETION_ITEM_KIND["variable"],
    "path": COMPLETION_ITEM_KIND["file"],
    "keyword": COMPLETION_ITEM_KIND["keyword"],
    "statement": COMPLETION_ITEM_KIND["keyword"],
    "property": COMPLETION_ITEM_KIND["property"],
}

SYMBOL_KIND_MAP = {
    "module": SYMBOL_KIND["module"],
    "class": SYMBOL_KIND["class"],
    "function": SYMBOL_KIND["function"],
    "statement": SYMBOL_KIND["variable"],
    "instance": SYMBOL_KIND["variable"],
    "param": SYMBOL_KIND["variable"],
}


def _uri_to_path(uri: str) -> str:
    if uri.startswith("file://"):
        return unquote(urlparse(uri).path)

    parsed = urlparse(uri)
    if parsed.scheme and parsed.path:
        return unquote(parsed.path)

    return uri


def _path_to_uri(path: Path, document_uri: str) -> str:
    resolved_path = path.resolve()
    if resolved_path == Path(_uri_to_path(document_uri)).resolve():
        return document_uri
    if urlparse(document_uri).scheme == "file":
        return resolved_path.as_uri()
    return path.as_posix()


class Document:
    def __init__(
        self,
        uri: str,
        source: str,
        version: int | None = None,
        language_id: str | None = None,
    ) -> None:
        self.uri = uri
        self.source = source
        self.version = version
        self.language_id = language_id
        self.path = _uri_to_path(uri)

    @property
    def lines(self) -> list[str]:
        lines = self.source.splitlines(True)
        return lines or [""]

    def offset_at(self, position: dict) -> int:
        line = max(int(position.get("line", 0)), 0)
        character = max(int(position.get("character", 0)), 0)
        lines = self.lines
        if line >= len(lines):
            return len(self.source)

        offset = sum(len(lines[idx]) for idx in range(line))
        return offset + min(character, len(lines[line]))

    def apply_change(self, change: dict) -> None:
        if "range" not in change or change["range"] is None:
            self.source = change.get("text", "")
            return

        change_range = change["range"]
        start = self.offset_at(change_range["start"])
        end = self.offset_at(change_range["end"])
        self.source = self.source[:start] + change.get("text", "") + self.source[end:]


class WasmIdlePythonLsp:
    def __init__(self) -> None:
        self.workspace_root = WORKSPACE_ROOT
        Path(self.workspace_root).mkdir(parents=True, exist_ok=True)
        self.project = self._create_project(self.workspace_root)
        self.documents: dict[str, Document] = {}
        self.shutdown_requested = False
        self._script_cache: OrderedDict = OrderedDict()
        self._completion_results: OrderedDict = OrderedDict()
        self._completion_sequence = 0

    def _invalidate_analysis(self) -> None:
        # Imported documents affect other files too: invalidate the entire workspace epoch.
        self._script_cache.clear()
        self._completion_results.clear()

    def handle(self, payload: str) -> None:
        message = json.loads(payload)
        if message.get("jsonrpc") != "2.0":
            return

        method = message.get("method")
        if not method:
            return

        if "id" in message:
            self._handle_request(message["id"], method, message.get("params") or {})
        else:
            self._handle_notification(method, message.get("params") or {})

    def _emit(self, body: dict) -> None:
        emit(json.dumps(body))

    def _respond(self, msg_id, result=None, error: dict | None = None) -> None:
        response = {"jsonrpc": "2.0", "id": msg_id}
        if error is not None:
            response["error"] = error
        else:
            response["result"] = result
        self._emit(response)

    def _notify(self, method: str, params: dict) -> None:
        self._emit({"jsonrpc": "2.0", "method": method, "params": params})

    def _refresh_project(self, root_uri: str | None) -> None:
        if root_uri:
            self.workspace_root = _uri_to_path(root_uri)

        Path(self.workspace_root).mkdir(parents=True, exist_ok=True)
        self.project = self._create_project(self.workspace_root)
        self._invalidate_analysis()

    def _create_project(self, path: str):
        if Project is None:
            return None
        return Project(
            path=path,
            smart_sys_path=True,
            load_unsafe_extensions=False,
        )

    def _document(self, uri: str) -> Document:
        return self.documents[uri]

    def _mirror_document(self, uri: str) -> None:
        document = self._document(uri)
        path = Path(document.path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(document.source, encoding="utf-8")

    def _script(self, uri: str) -> Script:
        if Script is None:
            raise RuntimeError("Python semantic LSP features require jedi")
        document = self._document(uri)
        cached = self._script_cache.get(uri)
        if cached is not None and cached[:2] == (document.source, document.version):
            self._script_cache.move_to_end(uri)
            return cached[2]
        script = Script(code=document.source, path=document.path, project=self.project)
        self._script_cache[uri] = (document.source, document.version, script)
        self._script_cache.move_to_end(uri)
        while len(self._script_cache) > MAX_CACHED_SCRIPTS:
            self._script_cache.popitem(last=False)
        return script

    def _range_for_name(self, name) -> dict | None:
        if name.line is None or name.column is None:
            return None

        return {
            "start": {"line": name.line - 1, "character": name.column},
            "end": {"line": name.line - 1, "character": name.column + len(name.name)},
        }

    def _location_for_name(self, name, fallback_uri: str) -> dict | None:
        range_value = self._range_for_name(name)
        if range_value is None:
            return None

        module_path = getattr(name, "module_path", None)
        uri = fallback_uri
        if module_path is not None:
            uri = _path_to_uri(Path(module_path), fallback_uri)

        return {"uri": uri, "range": range_value}

    def _completion_kind(self, name_type: str) -> int:
        return COMPLETION_KIND_MAP.get(name_type, COMPLETION_ITEM_KIND["text"])

    def _symbol_kind(self, name_type: str) -> int:
        return SYMBOL_KIND_MAP.get(name_type, SYMBOL_KIND["variable"])

    def _publish_diagnostics(self, uri: str) -> None:
        document = self._document(uri)
        diagnostics: list[dict] = []

        try:
            ast.parse(document.source, filename=document.path)
        except SyntaxError as error:
            line = max((error.lineno or 1) - 1, 0)
            column = max((error.offset or 1) - 1, 0)
            diagnostics.append(
                {
                    "range": {
                        "start": {"line": line, "character": column},
                        "end": {"line": line, "character": column + 1},
                    },
                    "severity": DIAGNOSTIC_SEVERITY_ERROR,
                    "source": SERVER_NAME,
                    "message": error.msg or "Syntax error",
                }
            )

        self._notify(
            "textDocument/publishDiagnostics",
            {"uri": uri, "diagnostics": diagnostics},
        )

    def _hover_text(self, definitions) -> str | None:
        chunks: list[str] = []
        for definition in definitions:
            description = getattr(definition, "description", "") or definition.name
            doc = definition.docstring(raw=False).strip()
            block = description if not doc else f"{description}\n\n{doc}"
            if block and block not in chunks:
                chunks.append(block)

        if not chunks:
            return None

        return "\n\n---\n\n".join(chunks)

    def _initialize(self, params: dict) -> dict:
        root_uri = params.get("rootUri")
        if not root_uri and params.get("workspaceFolders"):
            root_uri = params["workspaceFolders"][0].get("uri")
        self._refresh_project(root_uri)
        capabilities = {
            "textDocumentSync": TEXT_DOCUMENT_SYNC_FULL,
        }
        if Script is not None:
            capabilities.update(
                {
                    "completionProvider": {
                        "triggerCharacters": [".", "(", "[", '"', "'"],
                        "resolveProvider": True,
                    },
                    "hoverProvider": True,
                    "definitionProvider": True,
                    "documentSymbolProvider": True,
                    "signatureHelpProvider": {"triggerCharacters": ["(", ","]},
                }
            )
        return {
            "capabilities": capabilities,
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    def _shutdown(self, _params: dict | None = None):
        self.shutdown_requested = True
        self._invalidate_analysis()
        return None

    def _completion(self, params: dict) -> dict:
        position = params["position"]
        uri = params["textDocument"]["uri"]
        document = self._document(uri)
        completions = self._script(uri).complete(
            line=position["line"] + 1,
            column=position["character"],
        )
        incomplete = len(completions) > MAX_COMPLETION_ITEMS
        completions = completions[:MAX_COMPLETION_ITEMS]
        self._completion_sequence += 1
        token = self._completion_sequence
        self._completion_results[token] = (uri, document.version, completions, {})
        while len(self._completion_results) > MAX_COMPLETION_RESULTS:
            self._completion_results.popitem(last=False)
        items = []
        for index, completion in enumerate(completions):
            items.append({
                "label": completion.name_with_symbols or completion.name,
                "kind": self._completion_kind(completion.type),
                "detail": completion.type,
                "insertText": completion.complete or completion.name,
                "data": {"wasmIdleCompletion": token, "index": index},
            })
        return {"isIncomplete": incomplete, "items": items}

    def _completion_resolve(self, params: dict) -> dict:
        # Never reinterpret a stale token against a new source or a different completion list.
        data = params.get("data")
        if not isinstance(data, dict):
            return params
        token, index = data.get("wasmIdleCompletion"), data.get("index")
        if type(token) is not int or type(index) is not int:
            return params
        cached = self._completion_results.get(token)
        if cached is None:
            return params
        uri, version, completions, docs = cached
        document = self.documents.get(uri)
        if document is None or document.version != version or not 0 <= index < len(completions):
            return params
        completion = completions[index]
        if params.get("label") != (completion.name_with_symbols or completion.name):
            return params
        try:
            if index not in docs:
                docs[index] = completion.docstring(raw=False).strip()
            doc = docs[index]
        except Exception:
            return params
        if not doc:
            return params
        return {**params, "documentation": doc}

    def _signature_help(self, params: dict) -> dict | None:
        position = params["position"]
        signatures = self._script(params["textDocument"]["uri"]).get_signatures(
            line=position["line"] + 1,
            column=position["character"],
        )
        if not signatures:
            return None

        items = []
        for signature in signatures:
            items.append(
                {
                    "label": signature.to_string(),
                    "documentation": signature.docstring(raw=False).strip() or None,
                    "parameters": [
                        {"label": parameter.to_string()} for parameter in signature.params
                    ],
                }
            )

        return {"signatures": items, "activeSignature": 0, "activeParameter": 0}

    def _hover(self, params: dict) -> dict | None:
        position = params["position"]
        definitions = self._script(params["textDocument"]["uri"]).infer(
            line=position["line"] + 1,
            column=position["character"],
        )
        hover_text = self._hover_text(definitions)
        if not hover_text:
            return None
        return {"contents": {"kind": "markdown", "value": hover_text}}

    def _definition(self, params: dict) -> list[dict] | None:
        position = params["position"]
        definitions = self._script(params["textDocument"]["uri"]).goto(
            line=position["line"] + 1,
            column=position["character"],
            follow_imports=True,
            follow_builtin_imports=True,
        )
        locations = [
            location
            for location in (
                self._location_for_name(definition, params["textDocument"]["uri"])
                for definition in definitions
            )
            if location is not None
        ]
        return locations or None

    def _document_symbols(self, params: dict) -> list[dict]:
        names = self._script(params["textDocument"]["uri"]).get_names(
            all_scopes=True,
            definitions=True,
            references=False,
        )
        symbols = []
        for name in names:
            location = self._location_for_name(name, params["textDocument"]["uri"])
            if location is None:
                continue
            symbols.append(
                {
                    "name": name.name,
                    "kind": self._symbol_kind(name.type),
                    "location": location,
                    "containerName": getattr(name, "full_name", None) or name.name,
                }
            )
        return symbols

    def _handle_request(self, msg_id, method: str, params: dict) -> None:
        try:
            handlers = {
                "initialize": self._initialize,
                "shutdown": self._shutdown,
            }
            if Script is not None:
                handlers.update(
                    {
                        "textDocument/completion": self._completion,
                        "completionItem/resolve": self._completion_resolve,
                        "textDocument/signatureHelp": self._signature_help,
                        "textDocument/hover": self._hover,
                        "textDocument/definition": self._definition,
                        "textDocument/documentSymbol": self._document_symbols,
                    }
                )
            handler = handlers.get(method)
            if handler is None:
                self._respond(
                    msg_id,
                    error={"code": -32601, "message": f"Method not found: {method}"},
                )
                return
            self._respond(msg_id, result=handler(params))
        except Exception as error:
            self._respond(
                msg_id,
                error={"code": -32603, "message": str(error) or "Internal server error"},
            )

    def _handle_notification(self, method: str, params: dict) -> None:
        try:
            if method == "initialized":
                return
            if method == "exit":
                self.shutdown_requested = True
                self._invalidate_analysis()
                return
            if method == "workspace/didChangeWatchedFiles":
                self._invalidate_analysis()
                return
            if method == "textDocument/didOpen":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                self.documents[text_document["uri"]] = Document(
                    uri=text_document["uri"],
                    source=text_document.get("text", ""),
                    version=text_document.get("version"),
                    language_id=text_document.get("languageId"),
                )
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didChange":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                for change in params.get("contentChanges", []):
                    document.apply_change(change)
                document.version = text_document.get("version")
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didSave":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                document = self._document(text_document["uri"])
                if "text" in params and params["text"] is not None:
                    document.source = params["text"]
                self._mirror_document(text_document["uri"])
                self._publish_diagnostics(text_document["uri"])
                return
            if method == "textDocument/didClose":
                self._invalidate_analysis()
                text_document = params["textDocument"]
                self.documents.pop(text_document["uri"], None)
                self._notify(
                    "textDocument/publishDiagnostics",
                    {"uri": text_document["uri"], "diagnostics": []},
                )
        except Exception:
            return


def create_bridge():
    server = WasmIdlePythonLsp()
    return server.handle
