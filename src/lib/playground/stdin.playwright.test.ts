// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const pythonStdinSource = `line = input()
print(f"main={int(line.strip()) + 5}")`;

const javaStdinSource = `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int n = scanner.hasNextInt() ? scanner.nextInt() : 0;
        System.out.println("main=" + (n + 5));
    }
}`;

const elixirStdinSource = `line = IO.gets("") || "0"
{n, _} = Integer.parse(String.trim(line))
IO.puts("main=#{n + 5}")`;

const assemblyScriptStdinSource = `@external("env", "readLine")
declare function readLine(): string | null;

export function main(): string {
  const line = readLine();
  return line == null ? "EOF" : line;
}`;

const watStdinSource = `(module
  (import "env" "readByte" (func $readByte (result i32)))
  (func (export "main") (result i32)
    call $readByte
  )
)`;

const wasmStdinSource =
	'AGFzbQEAAAABBQFgAAF/AhABA2VudghyZWFkQnl0ZQAAAwIBAAcIAQRtYWluAAEKBgEEABAACw==';

const rubyStdinSource = `line = STDIN.gets&.strip || ""
puts "main=#{line}"`;

const haskellStdinSource = `main :: IO ()
main = do
  line <- getLine
  let n = read line :: Int
  putStrLn ("main=" ++ show (n + 5))`;

const rStdinSource = `line <- readLines(stdin(), n = 1, warn = FALSE)
cat(sprintf("main=%s\\n", trimws(line[[1]])))`;

const sqliteOutputSource = `SELECT 'main=73' AS result;`;

const duckdbOutputSource = `SELECT 'main=73' AS result;`;

const phpStdinSource = `<?php
$input = trim(file_get_contents('php://input'));
echo "main=", $input, "\\n";`;

const csharpStdinSource = `using System;

class Program {
    static void Main() {
        var line = Console.ReadLine();
        Console.WriteLine($"main={line}");
    }
}`;

const vbnetStdinSource = `Imports System

Module Program
    Sub Main()
        Dim line = Console.ReadLine()
        Console.WriteLine("main={0}", line)
    End Sub
End Module`;

const javascriptStdinSource = `const fs = require('fs');
const line = fs.readLineSync(0);
console.log(\`main=\${Number(line.trim()) + 5}\`);`;

const typescriptStdinSource = `import fs from 'node:fs';

const line: string = (fs as any).readLineSync(0);
console.log(\`main=\${Number(line.trim()) + 5}\`);`;

const luaStdinSource = `local line = io.read("*l") or "0"
print("main=" .. tostring((tonumber(line) or 0) + 5))`;

const zigStdinSource = `const std = @import("std");

pub fn main() !void {
    var buffer: [32]u8 = undefined;
    const input = (try std.io.getStdIn().reader().readUntilDelimiterOrEof(&buffer, '\\n')) orelse "0";
    const n = try std.fmt.parseInt(i32, std.mem.trim(u8, input, " \\t\\r\\n"), 10);
    try std.io.getStdOut().writer().print("main={d}\\n", .{n + 5});
}`;

let previewBuildReady: Promise<void> | null = null;

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const serverMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
		const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
		if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
			previewBuildReady ??= runBrowserPreparationScripts(['build:preview'], {
				timeoutMs: 900_000
			});
			await previewBuildReady;
		}
		const previewServer = reuseProvidedBrowserUrl
			? {
					origin: new URL(configuredBrowserUrl).origin,
					browserUrl: configuredBrowserUrl,
					close: async () => {}
				}
			: await startBrowserPreviewServer(
					configuredBrowserUrl
						? {
								origin: new URL(configuredBrowserUrl).origin,
								basePath: new URL(configuredBrowserUrl).pathname,
								serverMode
							}
						: { origin: 'http://localhost:4573', serverMode }
				);

		try {
			await action(previewServer.browserUrl);
		} finally {
			await previewServer.close();
		}
	});
}

describe('wasm-idle browser stdin connection', () => {
	it('passes terminal stdin and output through real browser runtime paths', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1') {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const pythonSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'PYTHON',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: pythonStdinSource,
				stdinText: '68\n'
			});
			expect(pythonSummary.transcript).toContain('main=73');

			const javaSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'JAVA',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: javaStdinSource,
				stdinText: '68\n'
			});
			expect(javaSummary.transcript).toContain('main=73');

			const elixirSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'ELIXIR',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: elixirStdinSource,
				stdinText: '68\n'
			});
			expect(elixirSummary.transcript).toContain('main=73');

			const assemblyScriptSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'ASSEMBLYSCRIPT',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
				source: assemblyScriptStdinSource,
				stdinText: '73\n'
			});
			expect(assemblyScriptSummary.transcript).toContain('main=73');

			const watSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=75',
				language: 'WAT',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
				source: watStdinSource,
				stdinText: 'K\n'
			});
			expect(watSummary.transcript).toContain('main=75');

			const wasmSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=75',
				language: 'WASM',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
				source: wasmStdinSource,
				stdinText: 'K\n'
			});
			expect(wasmSummary.transcript).toContain('main=75');

			const rubySummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'RUBY',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: rubyStdinSource,
				stdinText: '73\n'
			});
			expect(rubySummary.transcript).toContain('main=73');

			const haskellSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'HASKELL',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: haskellStdinSource,
				stdinText: '68\n'
			});
			expect(haskellSummary.transcript).toContain('main=73');

			const rSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'R',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: rStdinSource,
				stdinText: '73\n'
			});
			expect(rSummary.transcript).toContain('main=73');

			const sqliteSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'SQLITE',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
				source: sqliteOutputSource,
				stdinText: ''
			});
			expect(sqliteSummary.transcript).toContain('main=73');

			const duckdbSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'DUCKDB',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
				source: duckdbOutputSource,
				stdinText: ''
			});
			expect(duckdbSummary.transcript).toContain('main=73');

			const phpSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'PHP',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: phpStdinSource,
				stdinText: '73\n'
			});
			expect(phpSummary.transcript).toContain('main=73');

			const javascriptSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'JAVASCRIPT',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '240000'),
				source: javascriptStdinSource,
				stdinText: '68\n'
			});
			expect(javascriptSummary.transcript).toContain('main=73');

			const typescriptSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'TYPESCRIPT',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '240000'),
				source: typescriptStdinSource,
				stdinText: '68\n'
			});
			expect(typescriptSummary.transcript).toContain('main=73');

			const luaSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'LUA',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '240000'),
				source: luaStdinSource,
				stdinText: '68\n'
			});
			expect(luaSummary.transcript).toContain('main=73');

			const zigSummary = await runStdinBrowserProbe({
				browserUrl: browserUrl,
				expectedOutput: 'main=73',
				language: 'ZIG',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
				source: zigStdinSource,
				stdinText: '68\n'
			});
			expect(zigSummary.transcript).toContain('main=73');
		});
	}, 900_000);

	it('passes C# stdin through a fresh dotnet browser runtime path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1') {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				browserUrl,
				expectedOutput: 'main=73',
				language: 'CSHARP',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '600000'),
				source: csharpStdinSource,
				stdinText: '73\n'
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes VB.NET stdin through a fresh dotnet browser runtime path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1') {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				browserUrl,
				expectedOutput: 'main=73',
				language: 'VBNET',
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '600000'),
				source: vbnetStdinSource,
				stdinText: '73\n'
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);
});
