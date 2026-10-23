import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const fixture = String.raw`
import json, sys, types
from pathlib import Path

messages = []
bridge_module = types.ModuleType("wasm_idle_lsp_bridge")
bridge_module.emit = lambda payload: messages.append(json.loads(payload))
sys.modules[bridge_module.__name__] = bridge_module
server_module = types.ModuleType("utf16_server")
exec(compile(_server_source, "server.py", "exec"), server_module.__dict__)
server = server_module.WasmIdlePythonLsp()
uri = "file:///workspace/main.py"
sequence = 0

def request(method, params=None):
    global sequence
    sequence += 1
    server.handle(json.dumps({"jsonrpc": "2.0", "id": sequence, "method": method, "params": params or {}}))
    response = next(message for message in messages if message.get("id") == sequence)
    assert "error" not in response, response
    return response["result"]

def notify(method, params):
    server.handle(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}))

def open_document(text):
    notify("textDocument/didOpen", {"textDocument": {"uri": uri, "text": text, "version": 1, "languageId": "python"}})

def position(text, line=0):
    return {"line": line, "character": len(text.encode("utf-16-le")) // 2}

def at_end(method, text):
    return request(method, {"textDocument": {"uri": uri}, "position": position(text.split("\n")[-1], text.count("\n"))})

result = {"capabilities": request("initialize")["capabilities"]}
result["completions"] = []
for prefix in ['"😀"; ', '"😀😀"; ', '"한글"; ']:
    text = prefix + "pri"
    open_document(text)
    completion = at_end("textDocument/completion", text)
    result["completions"].append(next(item for item in completion["items"] if item["label"] == "print"))

text = '"😀😀"; target = 42; target'
open_document(text)
result["hover"] = at_end("textDocument/hover", text)
result["definitions"] = at_end("textDocument/definition", text)
result["symbols"] = request("textDocument/documentSymbol", {"textDocument": {"uri": uri}})

# Definitions in unopened imported files must use the target file's text.
Path("/workspace/helper.py").write_text('"😀"; exported = 42\n', encoding="utf-8")
text = 'from helper import exported\n"😀"; exported'
open_document(text)
result["importedDefinitions"] = at_end("textDocument/definition", text)

text = 'def combine(first, second):\n    return first + second\n"😀"; combine(1, '
open_document(text)
result["signature"] = at_end("textDocument/signatureHelp", text)

text = '"😀"; value = )'
open_document(text)
result["diagnostics"] = [message["params"]["diagnostics"] for message in messages if message.get("method") == "textDocument/publishDiagnostics"][-1]

text = '"😀"; count = 1\r\nresult = count'
open_document(text)
notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{
    "range": {"start": position('"😀"; '), "end": position('"😀"; count')}, "text": "total"
}]})
result["editedSource"] = server.documents[uri].source
notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": 3}, "contentChanges": [{
    "range": {"start": position('"'), "end": position('"😀')}, "text": "한"
}]})
result["replacedEmojiSource"] = server.documents[uri].source

# These characters can occur inside a string without ending an LSP/Jedi line.
result["unicodeLineSeparators"] = []
for separator in ['\u0085', '\u2028', '\u2029', '\v', '\f']:
    prefix = '"a' + separator + '😀"; '
    open_document(prefix + 'pri')
    completion = at_end("textDocument/completion", prefix + 'pri')
    text = prefix + 'target = 42; target'
    open_document(text)
    definitions = at_end("textDocument/definition", text)
    symbols = request("textDocument/documentSymbol", {"textDocument": {"uri": uri}})
    open_document(prefix + 'value = )')
    diagnostics = [message["params"]["diagnostics"] for message in messages if message.get("method") == "textDocument/publishDiagnostics"][-1]
    open_document(prefix + 'count = 1\r\nresult = count')
    notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{
        "range": {"start": position(prefix), "end": position(prefix + 'count')}, "text": "total"
    }, {
        "range": {"start": position('result = ', 1), "end": position('result = count', 1)}, "text": "total"
    }]})
    result["unicodeLineSeparators"].append({
        "prefix": prefix,
        "hasPrintCompletion": any(item["label"] == "print" for item in completion["items"]),
        "definitions": definitions,
        "symbols": symbols,
        "diagnostics": diagnostics,
        "editedSource": server.documents[uri].source,
    })

result["lineEndings"] = []
for ending in ['\n', '\r\n', '\r']:
    document = server_module.Document(uri, '"😀"; one = 1' + ending + 'two = one' + ending)
    document.apply_change({
        "range": {"start": position('two = ', 1), "end": position('two = one', 1)}, "text": "total"
    })
    document.apply_change({
        "range": {"start": position('', 2), "end": position('', 2)}, "text": "three = 3"
    })
    result["lineEndings"].append({"ending": ending, "source": document.source})
json.dumps(result)
`;

describe('Python LSP UTF-16 positions with pinned Jedi', () => {
	let result: any;

	beforeAll(async () => {
		const root = fileURLToPath(new URL('../../../', import.meta.url));
		const child = `
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPyodide } from 'pyodide';
const root = process.argv[1];
const runtime = await loadPyodide();
const lock = JSON.parse(readFileSync(root + '/static/pyodide/pyodide-lock.json', 'utf8'));
const site = runtime.runPython('import sysconfig; sysconfig.get_paths()["purelib"]');
for (const name of ['parso', 'jedi']) {
  const entry = lock.packages[name];
  if (!/^[a-zA-Z0-9_.-]+\\.whl$/.test(entry.file_name)) throw new Error('Invalid wheel filename');
  const bytes = readFileSync(root + '/static/pyodide/' + entry.file_name);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Wheel integrity mismatch');
  runtime.unpackArchive(Uint8Array.from(bytes), 'whl', { extractDir: site });
}
runtime.globals.set('_server_source', readFileSync(root + '/packages/lsp/src/python/package/wasm_idle_python_lsp/server.py', 'utf8'));
process.stdout.write(runtime.runPython(${JSON.stringify(fixture)}));
`;
		const { stdout } = await promisify(execFile)(
			process.execPath,
			['--experimental-wasm-stack-switching', '--input-type=module', '-e', child, root],
			{ cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 60_000 }
		);
		result = JSON.parse(stdout);
	}, 70_000);

	it('converts UTF-16 cursor columns before completion, hover and signature requests', () => {
		expect(result.capabilities.positionEncoding).toBe('utf-16');
		expect(result.completions.map((item: any) => item.insertText)).toEqual(['nt', 'nt', 'nt']);
		expect(result.hover.contents.value).toContain('int');
		expect(result.signature.signatures[0].label).toContain('combine(first, second)');
	});

	it('converts definition and symbol ranges using the referenced document', () => {
		const location = {
			uri: 'file:///workspace/main.py',
			range: { start: { line: 0, character: 8 }, end: { line: 0, character: 14 } }
		};
		expect(result.definitions).toEqual([location]);
		expect(result.symbols.find((symbol: any) => symbol.name === 'target').location).toEqual(
			location
		);
		expect(result.importedDefinitions).toEqual([
			{
				uri: 'file:///workspace/helper.py',
				range: { start: { line: 0, character: 6 }, end: { line: 0, character: 14 } }
			}
		]);
	});

	it('publishes syntax diagnostic ranges after astral characters in UTF-16', () => {
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].range).toEqual({
			start: { line: 0, character: 14 },
			end: { line: 0, character: 15 }
		});
	});

	it('applies incremental edits after and across surrogate pairs without changing CRLF', () => {
		expect(result.editedSource).toBe('"😀"; total = 1\r\nresult = count');
		expect(result.replacedEmojiSource).toBe('"한"; total = 1\r\nresult = count');
	});

	it('keeps Unicode separators inside strings on the same protocol line', () => {
		for (const entry of result.unicodeLineSeparators) {
			const location = {
				uri: 'file:///workspace/main.py',
				range: {
					start: { line: 0, character: entry.prefix.length },
					end: { line: 0, character: entry.prefix.length + 'target'.length }
				}
			};
			expect(entry.hasPrintCompletion).toBe(true);
			expect(entry.definitions).toEqual([location]);
			expect(entry.symbols.find((symbol: any) => symbol.name === 'target').location).toEqual(
				location
			);
			expect(entry.diagnostics[0].range).toEqual({
				start: { line: 0, character: entry.prefix.length + 'value = '.length },
				end: { line: 0, character: entry.prefix.length + 'value = )'.length }
			});
			expect(entry.editedSource).toBe(entry.prefix + 'total = 1\r\nresult = total');
		}
	});

	it('preserves LF, CRLF and CR offsets through edits and trailing empty lines', () => {
		for (const { ending, source } of result.lineEndings) {
			expect(source).toBe(`"😀"; one = 1${ending}two = total${ending}three = 3`);
		}
	});
});
