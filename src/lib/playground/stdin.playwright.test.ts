// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';

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

const postgresqlStdinSource = `CREATE TABLE input_numbers (n integer);
COPY input_numbers FROM '/dev/blob';
SELECT 'main=' || (sum(n) + 5)::text AS result FROM input_numbers;
SELECT 'engine=' || split_part(version(), ' ', 1) AS engine;`;

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

const fsharpStdinSource = `open System

let line = Console.ReadLine()
printfn "main=%s" line`;

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

const fennelStdinSource = `(macro add-five [x] \`(+ ,x 5))
(let [line (or (io.read) "0")
      n (tonumber line)]
  (print (.. "main=" (add-five n))))`;

const luaStdinSource = `local line = io.read("*l") or "0"
print("main=" .. tostring((tonumber(line) or 0) + 5))`;

const schemeStdinSource = `(display "main=")
(display (read-char (current-input-port)))
(newline)`;

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

const cppUnicodeStdinSource = `#include<bits/stdc++.h>
using namespace std;
int main() {
    string s;
    cin>>s;
    cout<<s;
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

const configuredStdinRunTimeoutMs = Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '0') || 0;
const browserStdinTestTimeoutMs = Math.max(700_000, configuredStdinRunTimeoutMs + 120_000);
const runAllStdinBrowserCases = process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN === '1';
const runLispStdinBrowserCase = process.env.WASM_IDLE_RUN_REAL_BROWSER_LISP === '1';
const runFennelStdinBrowserCase = process.env.WASM_IDLE_RUN_REAL_BROWSER_FENNEL === '1';
const selectedStdinBrowserLanguages = new Set<string>([
	...(runLispStdinBrowserCase ? ['LISP'] : []),
	...(runFennelStdinBrowserCase ? ['FENNEL'] : [])
]);
const skipSharedStdinBrowserCase = (language: string) =>
	(!runSharedStdinBrowserCases && selectedStdinBrowserLanguages.size === 0) ||
	(selectedStdinBrowserLanguages.size > 0 &&
		!runAllStdinBrowserCases &&
		!selectedStdinBrowserLanguages.has(language));
const runDotnetBrowserCases = process.env.WASM_IDLE_RUN_REAL_BROWSER_DOTNET === '1';
const runSharedStdinBrowserCases =
	runAllStdinBrowserCases || process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN_SHARED_ONLY === '1';
const sharedStdinBrowserCases = [
	{
		language: 'PYTHON',
		source: pythonStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'JAVA',
		source: javaStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'ELIXIR',
		source: elixirStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'ASSEMBLYSCRIPT',
		source: assemblyScriptStdinSource,
		stdinText: '73\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 180_000
	},
	{
		language: 'WAT',
		source: watStdinSource,
		stdinText: 'K\n',
		expectedOutput: 'main=75',
		defaultRunTimeoutMs: 180_000
	},
	{
		language: 'WASM',
		source: wasmStdinSource,
		stdinText: 'K\n',
		expectedOutput: 'main=75',
		defaultRunTimeoutMs: 180_000
	},
	{
		language: 'RUBY',
		source: rubyStdinSource,
		stdinText: '73\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'HASKELL',
		source: haskellStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 420_000
	},
	{
		language: 'R',
		source: rStdinSource,
		stdinText: '73\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'SQLITE',
		source: sqliteOutputSource,
		stdinText: '',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 180_000
	},
	{
		language: 'DUCKDB',
		source: duckdbOutputSource,
		stdinText: '',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 180_000
	},
	{
		language: 'PHP',
		source: phpStdinSource,
		stdinText: '73\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'JAVASCRIPT',
		source: javascriptStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 240_000
	},
	{
		language: 'TYPESCRIPT',
		source: typescriptStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 240_000
	},
	{
		language: 'LUA',
		source: luaStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 240_000
	},
	{
		language: 'FENNEL',
		source: fennelStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 240_000
	},
	{
		language: 'LISP',
		source: schemeStdinSource,
		stdinText: 'K\n',
		expectedOutput: 'main=K',
		defaultRunTimeoutMs: 300_000
	},
	{
		language: 'ZIG',
		source: zigStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73',
		defaultRunTimeoutMs: 300_000
	}
] as const;
const clangStdinBrowserCases = [
	{
		name: 'C',
		language: 'C',
		source: cStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73'
	},
	{
		name: 'CPP',
		language: 'CPP',
		source: cppStdinSource,
		stdinText: '68\n',
		expectedOutput: 'main=73'
	},
	{
		name: 'CPP Unicode',
		language: 'CPP',
		source: cppUnicodeStdinSource,
		stdinText: '안녕\n',
		expectedOutput: '안녕'
	}
] as const;

let previewBuildReady: Promise<void> | null = null;
let previewServerPromise: ReturnType<typeof startBrowserPreviewServer> | null = null;

afterAll(async () => {
	const previewServer = await previewServerPromise?.catch(() => null);
	await previewServer?.close();
});

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		previewServerPromise ??= (async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				previewBuildReady ??= runBrowserPreparationScripts(['build:preview'], {
					timeoutMs: 900_000
				});
				await previewBuildReady;
			}
			return reuseProvidedBrowserUrl
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
		})();
		const previewServer = await previewServerPromise;
		await action(previewServer.browserUrl);
	});
}

describe('wasm-idle browser stdin connection', () => {
	for (const {
		defaultRunTimeoutMs,
		expectedOutput,
		language,
		source,
		stdinText
	} of sharedStdinBrowserCases)
		it(
			`passes ${language} input and output through its real browser runtime path`,
			{
				skip: skipSharedStdinBrowserCase(language),
				meta: {
					browser: true,
					requiredBrowser: !skipSharedStdinBrowserCase(language)
				},
				timeout: browserStdinTestTimeoutMs
			},
			async () => {
				expect.hasAssertions();

				await withBrowserPreview(async (browserUrl) => {
					const summary = await runStdinBrowserProbe({
						browserUrl,
						expectedOutput,
						language,
						runTimeoutMs: Number(
							process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || defaultRunTimeoutMs
						),
						source,
						stdinText
					});
					expect(summary.transcript).toContain(expectedOutput);
				});
			}
		);

	function expectOnlySelectedDotnetRuntime(
		requests: string[],
		selectedLanguage: 'csharp' | 'fsharp' | 'vbnet'
	) {
		const paths = requests.map((request) => new URL(request).pathname);
		expect(
			paths.some((path) => path.includes(`/wasm-dotnet/runtime/${selectedLanguage}/`))
		).toBe(true);
		for (const language of ['csharp', 'fsharp', 'vbnet'] as const) {
			if (language === selectedLanguage) continue;
			expect(paths.some((path) => path.includes(`/wasm-dotnet/runtime/${language}/`))).toBe(
				false
			);
		}
	}

	it(
		'passes C# stdin through a fresh dotnet browser runtime path',
		{
			skip: !runSharedStdinBrowserCases && !runDotnetBrowserCases,
			meta: {
				browser: true,
				requiredBrowser: runSharedStdinBrowserCases || runDotnetBrowserCases
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
				expectOnlySelectedDotnetRuntime(summary.runtimeRequests, 'csharp');
			});
		}
	);

	it(
		'passes F# stdin through a fresh dotnet browser runtime path',
		{
			skip: !runSharedStdinBrowserCases && !runDotnetBrowserCases,
			meta: {
				browser: true,
				requiredBrowser: runSharedStdinBrowserCases || runDotnetBrowserCases
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'FSHARP',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '600000'),
					source: fsharpStdinSource,
					stdinText: '73\n'
				});
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).not.toContain('unreachable');
				expectOnlySelectedDotnetRuntime(summary.runtimeRequests, 'fsharp');
			});
		}
	);

	it.each(clangStdinBrowserCases)(
		'passes $name stdin through the browser wasm-clang runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async ({ expectedOutput, language, source, stdinText }) => {
			expect.hasAssertions();

			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput,
					language,
					requireSharedArrayBuffer: false,
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
					source,
					stdinText
				});
				expect(summary.transcript).toContain(expectedOutput);
				const requestedPaths = summary.runtimeRequests.map(
					(request) => new URL(request).pathname
				);
				expect(
					requestedPaths.some((pathname) =>
						pathname.endsWith('/clang/bin/c-sysroot.tar.gz')
					)
				).toBe(true);
				expect(
					requestedPaths.some((pathname) =>
						pathname.endsWith('/clang/bin/cpp-addon.tar.gz')
					)
				).toBe(language === 'CPP');
				expect(
					requestedPaths.some((pathname) =>
						pathname.endsWith('/clang/bin/sysroot.tar.gz')
					)
				).toBe(false);
			});
		}
	);

	it(
		'reuses a precompiled <bits/stdc++.h> for later C++ stdin runs in the real browser',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();
			const stdcppSource = (offset: number) => `// precompiled header probe
#include <bits/stdc++.h>
using namespace std;
int main() {
	long long n;
	cin >> n;
	vector<long long> values{n, n + ${offset}};
	cout << "pch=" << accumulate(values.begin(), values.end(), 0LL) << endl;
}`;
			// The header is built in the background after the first compile, so later runs
			// keep editing the source until one compile reports that it used the header.
			const followUpRuns = [1, 2, 3, 4, 5].map((offset) => ({
				source: stdcppSource(offset),
				stdinText: '40\n',
				expectedOutput: `pch=${80 + offset}`
			}));

			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'pch=80',
					language: 'CPP',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
					source: stdcppSource(0),
					stdinText: '40\n',
					followUpRuns
				});
				expect(summary.transcript).toContain('pch=80');
				expect(summary.followUpRuns.map((run) => run.output)).toEqual(
					followUpRuns.map((run) => expect.stringContaining(run.expectedOutput))
				);
				expect(
					summary.followUpRuns.some((run) =>
						run.progressLabels.includes('Compiled with precompiled <bits/stdc++.h>')
					)
				).toBe(true);
			});
		}
	);

	it(
		'links a C-selected response-file C++ program in the real browser',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN !== '1',
			meta: {
				browser: true,
				requiredBrowser:
					runAllStdinBrowserCases ||
					process.env.WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN === '1'
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					activePath: 'main.c',
					argsInput: '@flags.rsp',
					browserUrl,
					expectedOutput: 'main=73',
					language: 'C',
					requireSharedArrayBuffer: false,
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
					source: `extern "C" int printf(const char *, ...);

int main() {
    int *values = new int[3]{70, 1, 2};
    printf("main=%d\\n", values[0] + values[1] + values[2]);
    delete[] values;
    return 0;
}`,
					stdinText: '',
					workspaceFiles: [{ path: 'flags.rsp', content: '-x c++ -std=c++20' }]
				});
				expect(summary.transcript).toContain('main=73');
				const requestedPaths = summary.runtimeRequests.map(
					(request) => new URL(request).pathname
				);
				expect(
					requestedPaths.some((pathname) =>
						pathname.endsWith('/clang/bin/cpp-addon.tar.gz')
					)
				).toBe(true);
				expect(
					requestedPaths.some((pathname) =>
						pathname.endsWith('/clang/bin/sysroot.tar.gz')
					)
				).toBe(false);
			});
		}
	);

	it(
		'passes Objective-C stdin through the browser wasm-clang and libobjc2 runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes Objective-C Foundation stdin through the browser wasm-clang and GNUstep runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1' &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_FOUNDATION_INIT !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1' &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC_FOUNDATION_INIT !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes Objective-C Foundation NSObject stdin through the browser GNUstep runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes Objective-C Foundation constant NSString stdin through the browser GNUstep runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes Fortran stdin through the browser f2c and wasm-clang runtime path',
		{
			skip:
				!runAllStdinBrowserCases && process.env.WASM_IDLE_RUN_REAL_BROWSER_FORTRAN !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_FORTRAN !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes PostgreSQL preloaded stdin through the browser PGlite runtime path',
		{
			skip:
				!runAllStdinBrowserCases &&
				process.env.WASM_IDLE_RUN_REAL_BROWSER_POSTGRESQL !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases &&
					process.env.WASM_IDLE_RUN_REAL_BROWSER_POSTGRESQL !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

			await withBrowserPreview(async (browserUrl) => {
				const postgresqlBrowserUrl = new URL(browserUrl);
				postgresqlBrowserUrl.searchParams.set('lang', 'postgresql');
				const summary = await runStdinBrowserProbe({
					activePath: 'main.sql',
					browserUrl: postgresqlBrowserUrl.href,
					expectedOutput: 'engine=PostgreSQL',
					language: 'POSTGRESQL',
					preloadStdin: true,
					requireSharedArrayBuffer: false,
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '420000'),
					source: postgresqlStdinSource,
					stdinText: '30\n38\n'
				});
				expect(summary.transcript).toMatch(/result\s+main=73/);
				expect(summary.transcript).toMatch(/engine\s+engine=PostgreSQL/);
				expect(
					summary.runtimeRequests.some((request) =>
						new URL(request).pathname.includes('/wasm-postgresql/assets/pglite-')
					)
				).toBe(true);
			});
		}
	);

	it(
		'passes COBOL stdin through the browser GnuCOBOL and llvm-core runtime path',
		{
			skip: !runAllStdinBrowserCases && process.env.WASM_IDLE_RUN_REAL_BROWSER_COBOL !== '1',
			meta: {
				browser: true,
				requiredBrowser: !(
					!runAllStdinBrowserCases && process.env.WASM_IDLE_RUN_REAL_BROWSER_COBOL !== '1'
				)
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
		}
	);

	it(
		'passes VB.NET stdin through a fresh dotnet browser runtime path',
		{
			skip: !runSharedStdinBrowserCases && !runDotnetBrowserCases,
			meta: {
				browser: true,
				requiredBrowser: runSharedStdinBrowserCases || runDotnetBrowserCases
			},
			timeout: browserStdinTestTimeoutMs
		},
		async () => {
			expect.hasAssertions();

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
				expectOnlySelectedDotnetRuntime(summary.runtimeRequests, 'vbnet');
			});
		}
	);
});
