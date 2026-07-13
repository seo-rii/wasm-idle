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

const cStdinSource = `#include <stdio.h>

int main(void) {
    int n = 0;
    if (scanf("%d", &n) != 1) {
        n = 0;
    }
    printf("main=%d\\n", n + 5);
    return 0;
}`;

const cppStdinSource = `#include <iostream>

int main() {
    int n = 0;
    std::cin >> n;
    std::cout << "main=" << (n + 5) << "\\n";
    return 0;
}`;

const objectiveCStdinSource = `#include <stdio.h>
#include <objc/runtime.h>
#include "Reader.h"

int main(void) {
    id reader = class_createInstance(objc_getClass("Reader"), 0);
    printf("main=%d\\n", [reader value]);
    return 0;
}`;

const objectiveCReaderHeaderSource = `#include <objc/runtime.h>

__attribute__((objc_root_class))
@interface Reader {
    Class isa;
}
- (int)value;
@end`;

const objectiveCReaderImplementationSource = `#include <stdio.h>
#include "Reader.h"

@implementation Reader
- (int)value {
    int n = 0;
    if (scanf("%d", &n) != 1) {
        n = 0;
    }
    return n + 5;
}
@end`;

const objectiveCFoundationStdinSource = `#include <stdio.h>
#import <Foundation/NSString.h>

int main(void) {
    int n = 0;
    if (scanf("%d", &n) != 1) {
        n = 0;
    }
    int value = n + 5;
    char buffer[] = "main=00";
    buffer[5] = (char)('0' + (value / 10) % 10);
    buffer[6] = (char)('0' + value % 10);
    NSString *line = [[NSString alloc] initWithUTF8String:buffer];
    printf("%s\\n", [line UTF8String]);
    [line release];
    return 0;
}`;

const objectiveCFoundationNSObjectStdinSource = `#include <stdio.h>
#include <objc/runtime.h>
#import <Foundation/NSObject.h>

int main(void) {
    int n = 0;
    if (scanf("%d", &n) != 1) {
        n = 0;
    }
    NSObject *object = [[NSObject alloc] init];
    printf("main=%d class=%s\\n", n + 5, object_getClassName(object));
    [object release];
    return 0;
}`;

const objectiveCFoundationConstantStringStdinSource = `#include <stdio.h>
#import <Foundation/NSString.h>

int main(void) {
    int n = 0;
    if (scanf("%d", &n) != 1) {
        n = 0;
    }
    NSString *line = @"main";
    printf("%s=%d\\n", [line UTF8String], n + 5);
    return 0;
}`;

const fortranStdinSource = `      PROGRAM MAIN
      INTEGER N
      READ *, N
      PRINT *, 'main=', N + 5
      END`;

const cobolStdinSource = `identification division.
program-id. main.
data division.
working-storage section.
01 input-value pic x(20).
procedure division.
accept input-value.
display "main=" input-value.
stop run.`;

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
			expect(summary.transcript).not.toContain('IO failure on output stream');
			expect(summary.transcript).not.toContain('unreachable');
		});
	}, 700_000);

	it('passes C and C++ stdin through the browser wasm-clang runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const cSummary = await runStdinBrowserProbe({
				browserUrl,
				expectedOutput: 'main=73',
				language: 'C',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: cStdinSource,
				stdinText: '68\n'
			});
			expect(cSummary.transcript).toContain('main=73');

			const cppSummary = await runStdinBrowserProbe({
				browserUrl,
				expectedOutput: 'main=73',
				language: 'CPP',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: cppStdinSource,
				stdinText: '68\n'
			});
			expect(cppSummary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes Objective-C stdin through the browser wasm-clang and libobjc2 runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				activePath: 'main.m',
				browserUrl,
				expectedOutput: 'main=73',
				language: 'OBJC',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: objectiveCStdinSource,
				stdinText: '68\n',
				workspaceFiles: [
					{ path: 'Reader.h', content: objectiveCReaderHeaderSource },
					{ path: 'Reader.m', content: objectiveCReaderImplementationSource }
				]
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes Objective-C Foundation stdin through the browser wasm-clang and GNUstep runtime path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_FOUNDATION_INIT !== '1') {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				activePath: 'main.m',
				browserUrl,
				expectedOutput: 'main=73',
				language: 'OBJC',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: objectiveCFoundationStdinSource,
				stdinText: '68\n'
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes Objective-C Foundation NSObject stdin through the browser GNUstep runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				activePath: 'main.m',
				browserUrl,
				expectedOutput: 'main=73',
				language: 'OBJC',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: objectiveCFoundationNSObjectStdinSource,
				stdinText: '68\n'
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes Objective-C Foundation constant NSString stdin through the browser GNUstep runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				activePath: 'main.m',
				browserUrl,
				expectedOutput: 'main=73',
				language: 'OBJC',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: objectiveCFoundationConstantStringStdinSource,
				stdinText: '68\n'
			});
			expect(summary.transcript).toContain('main=73');
		});
	}, 700_000);

	it('passes Fortran stdin through the browser f2c and wasm-clang runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_FORTRAN !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				browserUrl,
				expectedOutput: 'main=',
				language: 'FORTRAN',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: fortranStdinSource,
				stdinText: '68\n'
			});
			expect(summary.transcript).toContain('main=');
			expect(summary.transcript).toContain('73');
		});
	}, 700_000);

	it('passes COBOL stdin through the browser GnuCOBOL and wasm-llvm runtime path', async () => {
		if (
			process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1' &&
			process.env.WASM_IDLE_RUN_REAL_BROWSER_COBOL !== '1'
		) {
			return;
		}

		await withBrowserPreview(async (browserUrl) => {
			const summary = await runStdinBrowserProbe({
				activePath: 'main.cob',
				browserUrl,
				expectedOutput: 'main=73',
				language: 'COBOL',
				requireSharedArrayBuffer: false,
				runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
				source: cobolStdinSource,
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
