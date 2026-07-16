// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { WASI } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import {
	BrowserClangRuntime,
	createBrowserWasiHost,
	executeBrowserClangArtifact,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl,
	type BrowserClangArtifact
} from '@wasm-idle/llvm-core/clang';

const textDecoder = new TextDecoder();

const fortranStdinSource = `      PROGRAM MAIN
      INTEGER N
      READ *, N
      PRINT *, N + 5
      END`;

const compatSource = `#include <stdarg.h>
#include <stdio.h>
typedef void (*sighandler_t)(int);
int fiprintf(FILE *stream, const char *format, ...) { va_list ap; va_start(ap, format); int result = vfprintf(stream, format, ap); va_end(ap); return result; }
int siprintf(char *str, const char *format, ...) { va_list ap; va_start(ap, format); int result = vsprintf(str, format, ap); va_end(ap); return result; }
int __small_sprintf(char *str, const char *format, ...) { va_list ap; va_start(ap, format); int result = vsprintf(str, format, ap); va_end(ap); return result; }
sighandler_t signal(int signum, sighandler_t handler) { (void)signum; return handler; }
FILE *tmpfile(void) { return NULL; }
`;

const ensureTrailingNewline = (source: string) => (source.endsWith('\n') ? source : `${source}\n`);

function readStaticAsset(...segments: string[]) {
	return readFileSync(path.join(process.cwd(), 'static', ...segments));
}

async function translateFortranToC() {
	const f2cModule = await WebAssembly.compile(readStaticAsset('wasm-fortran', 'f2c.wasm'));
	const host = createBrowserWasiHost({
		args: ['main.f'],
		env: { TMPDIR: '/tmp' },
		files: [{ path: 'main.f', contents: ensureTrailingNewline(fortranStdinSource) }],
		programName: 'f2c.wasm'
	});
	const wasiInstance = new WASI(host.args, host.envEntries, host.fds, { debug: false });
	const instance = (await WebAssembly.instantiate(f2cModule, {
		wasi_snapshot_preview1: wasiInstance.wasiImport,
		wasi_unstable: wasiInstance.wasiImport
	})) as WebAssembly.Instance;
	const exitCode = wasiInstance.start(
		instance as unknown as {
			exports: {
				memory: WebAssembly.Memory;
				_start: () => unknown;
			};
		}
	);
	expect(exitCode).toBe(0);
	const generated = host.rootDirectory.contents.get('main.c') as
		| { data?: Uint8Array }
		| undefined;
	expect(generated?.data?.byteLength).toBeGreaterThan(0);
	return textDecoder.decode(generated!.data);
}

async function compileFortranProgram(cSource: string, clangBaseUrl: string) {
	const manifest = await loadRuntimeManifest(resolveRuntimeManifestUrl(clangBaseUrl));
	const clang = new BrowserClangRuntime({
		log: false,
		manifest,
		runtimeBaseUrl: clangBaseUrl,
		stdin: () => '',
		stdout: () => {}
	});
	await clang.ready;
	clang.memfs.addFile('f2c.h', readStaticAsset('wasm-fortran', 'f2c.h').toString('utf8'));
	clang.memfs.addFile('libf2c.a', readStaticAsset('wasm-fortran', 'libf2c.a'));
	await clang.compile({
		input: 'main.c',
		code: cSource,
		obj: 'main.o',
		language: 'C',
		compileArgs: ['-I.', '-w']
	});
	await clang.compile({
		input: 'f2c_compat.c',
		code: compatSource,
		obj: 'f2c_compat.o',
		language: 'C',
		compileArgs: ['-w']
	});
	const lld = await clang.getModule(clang.assetUrls.lld);
	await clang.run(
		lld,
		false,
		'wasm-ld',
		'--export-dynamic',
		'-z',
		'stack-size=1048576',
		'-Llib/wasm32-wasi/noeh',
		'-Llib/wasm32-wasi',
		'lib/wasm32-wasi/crt1.o',
		'main.o',
		'f2c_compat.o',
		'libf2c.a',
		'-lc',
		'-lm',
		`-L${(clang as any).compilerConfig?.compilerRuntimeLibDir || 'lib/clang/8.0.1/lib/wasi'}`,
		'-lclang_rt.builtins-wasm32',
		'-o',
		'main.wasm'
	);
	const bytes = Uint8Array.from(clang.memfs.getFileContents('main.wasm'));
	return {
		bytes,
		wasm: await WebAssembly.compile(bytes),
		target: 'wasm32-wasi',
		format: 'wasi-core-wasm',
		fileName: 'main.wasm',
		language: 'C'
	} satisfies BrowserClangArtifact;
}

describe('Fortran browser runtime', () => {
	it('translates real Fortran with f2c and preserves stdin through the generated WASI program', async () => {
		const cSource = await translateFortranToC();
		expect(cSource).toContain('s_rsle');
		expect(cSource).toContain('do_lio');

		const staticRoot = path.resolve(process.cwd(), 'static');
		const server = createServer((request, response) => {
			const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
			const assetPath = path.resolve(
				staticRoot,
				decodeURIComponent(requestUrl.pathname.slice(1))
			);
			if (!assetPath.startsWith(`${staticRoot}${path.sep}`)) {
				response.writeHead(403).end();
				return;
			}
			try {
				response.writeHead(200).end(readFileSync(assetPath));
			} catch {
				response.writeHead(404).end();
			}
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('HTTP test server did not bind');

		let artifact: BrowserClangArtifact;
		try {
			artifact = await compileFortranProgram(
				cSource,
				`http://127.0.0.1:${address.port}/clang/`
			);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
		}
		const outputChunks: string[] = [];
		let stdinConsumed = false;
		const result = await executeBrowserClangArtifact(artifact, {
			stdin: () => {
				if (stdinConsumed) return null;
				stdinConsumed = true;
				return '68\n';
			},
			stdout: (chunk) => outputChunks.push(chunk)
		});

		expect(result.exitCode).toBe(0);
		expect(outputChunks.join('')).toContain('73');
	}, 180_000);
});
