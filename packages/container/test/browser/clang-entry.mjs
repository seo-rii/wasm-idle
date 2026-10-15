import {
	createContainer,
	createContainerPackageManager,
	validateDistribution
} from '../../src/index.ts';
import { createClangAdapter } from '../../src/adapters/clang/index.ts';
import { createWasiAdapter } from '../../src/adapters/wasi/index.ts';
import untar from '../../../llvm-core/runtime/core/src/tar.ts';
import { runHeaderCorpus } from '../fixtures/clang-headers/runner.mjs';

const encoder = new TextEncoder(),
	decoder = new TextDecoder();
const check = (condition, message) => {
	if (!condition) throw new Error(message);
};
const sha256 = async (bytes) =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
		value.toString(16).padStart(2, '0')
	).join('');
const config = await (await fetch('/fixture.json')).json();
const distribution = await validateDistribution({
	bytes: encoder.encode(config.manifest),
	expectedSha256: config.manifestSha256,
	adapterIds: ['llvm-clang-tool-host-v1'],
	allowedAssetURLs: config.assetURLs
});
const manager = createContainerPackageManager({
	distribution,
	capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'],
	maxCachedBytes: 128 * 1024 * 1024,
	persistentCache: {
		enabled: true,
		namespace: 'container-real-clang-browser',
		version: config.producerSha256,
		storageReserveBytes: 0
	}
});
let liveWorkers = 0,
	startedWorkers = 0;
function workerFactory(path) {
	return () => {
		const worker = new Worker(path, { type: 'module' });
		liveWorkers++;
		startedWorkers++;
		const terminate = worker.terminate.bind(worker);
		let dead = false;
		worker.terminate = () => {
			if (!dead) {
				dead = true;
				liveWorkers--;
			}
			terminate();
		};
		return worker;
	};
}
const linkerPath = '/opt/toolchains/fixture/bin/wasm-ld';
const adapter = createClangAdapter({
	clangSha256: config.clangSha256,
	linkerSha256: config.linkerSha256,
	linkerPath,
	workerFactory: workerFactory('/clang-worker.js')
});
const container = createContainer({
	packages: manager,
	adapters: [adapter, createWasiAdapter({ workerFactory: workerFactory('/wasi-worker.js') })],
	maxMemoryBytes: 2 ** 32,
	maxBytes: 256 * 1024 * 1024,
	maxProcesses: 1
});
const cwd = '/workspace/a b/한글',
	sysroot = '/usr/share/fixture-sysroot';
container.fs.mkdir('/workspace/a b');
container.fs.mkdir(cwd);
container.fs.mkdir('/workspace/include');
const write = (path, value) => container.fs.writeFile(path, encoder.encode(value));
const results = [];
let sysrootPrepared = false;
async function prepareSysroot() {
	if (sysrootPrepared) return;
	// Fixture preparation only: the runtime package manager does not extract tar.
	// The immutable archive was verified by the same loader as the compiler files.
	const prepared = await manager.prepare('llvm');
	const archive = prepared.packages[0].files.find(
		(file) => file.path === 'fixture-sysroot.tar'
	).bytes;
	const files = [],
		paths = new Set();
	const add = (path, value) => {
		check(
			path &&
				!path.startsWith('/') &&
				!path.split('/').some((part) => !part || part === '.' || part === '..') &&
				!paths.has(path),
			'Invalid sysroot fixture path'
		);
		paths.add(path);
		files.push({ path, ...value });
	};
	untar(archive, {
		addDirectory(path) {
			add(path.replace(/\/$/u, ''), { type: 'directory', mode: 0o555 });
		},
		addFile(path, data) {
			add(path, { type: 'file', mode: 0o444, data });
		}
	});
	check(
		files.length === 2285 && files.filter((file) => file.type === 'file').length === 2168,
		'Full pinned sysroot closure must be preserved'
	);
	container.fs.mountReadonly(sysroot, files);
	results.push({
		fixture: 'full-sysroot',
		sha256: await sha256(archive),
		entries: files.length,
		files: 2168
	});
	sysrootPrepared = true;
}
async function command(id, args, expected = 0) {
	await prepareSysroot();
	const start = performance.now();
	const result = await container.run('clang', args, {
		cwd,
		env: { PWD: '/deliberately-wrong-pwd', LANG: 'C' },
		timeoutMs: config.timeoutMs
	});
	results.push({
		id,
		args,
		cwd,
		code: result.code,
		reason: result.reason,
		elapsedMs: performance.now() - start,
		stdout: decoder.decode(result.stdout),
		stderr: decoder.decode(result.stderr),
		stdoutBytes: [...result.stdout],
		stderrBytes: [...result.stderr]
	});
	check(
		result.reason === 'exited' && result.code === expected,
		`${id}: ${JSON.stringify(results.at(-1))}`
	);
	check(liveWorkers === 0, `${id}: Worker was not reclaimed`);
	return result;
}
async function artifact(id, path, expected, options = {}) {
	const bytes = container.fs.readFile(`${cwd}/${path}`);
	const stdout = typeof expected === 'string' ? encoder.encode(expected) : expected;
	const stderr = options.stderr ?? new Uint8Array();
	const result = await container.run('wasm-run', [`${cwd}/${path}`], {
		cwd: '/',
		timeoutMs: 10000,
		stdin: options.stdin
	});
	check(
		result.reason === 'exited' &&
			result.code === 0 &&
			result.stdout.length === stdout.length &&
			result.stdout.every((byte, index) => byte === stdout[index]) &&
			result.stderr.length === stderr.length &&
			result.stderr.every((byte, index) => byte === stderr[index]),
		`${id}: artifact execution failed`
	);
	check(liveWorkers === 0, `${id}: artifact Worker was not reclaimed`);
	results.push({
		id,
		sha256: await sha256(bytes),
		bytes: bytes.length,
		code: result.code,
		reason: result.reason,
		stdinBytes: [...(options.stdin ?? [])],
		stdoutBytes: [...result.stdout],
		stderrBytes: [...result.stderr]
	});
}
globalThis.clangBrowserFixture = {
	metadata() {
		return {
			command: manager.resolveCommand('clang').name,
			isolated: crossOriginIsolated,
			userAgent: navigator.userAgent,
			liveWorkers,
			startedWorkers,
			manager: manager.inspect()
		};
	},
	async run(full) {
		let failure;
		const headerCorpus = {};
		try {
			await command('version', ['--version']);
			if (full && config.headerRegression) {
				await runHeaderCorpus({
					fs: container.fs, sysroot, cwd, sha256, evidence: headerCorpus,
					runCommand: (id, args) => command(id, args)
				});
			} else if (full) {
				write('/workspace/include/demo.h', '#define BASE 40\n');
				write(
					`${cwd}/helper.c`,
					'#include "demo.h"\nint answer(void){return BASE + EXTRA;}\n'
				);
				write(
					`${cwd}/main file.c`,
					'struct iov { const char *p; unsigned n; };\n__attribute__((import_module("wasi_snapshot_preview1"),import_name("fd_write"))) extern unsigned out(unsigned,struct iov*,unsigned,unsigned*);\nextern int answer(void);\nvoid _start(void){unsigned n; struct iov b={answer()==42?"hello\\n":"bad\\n",6};out(1,&b,1,&n);}\n'
				);
				const flags = ['--target=wasm32-wasi', '-I../../include', '-DEXTRA=2'];
				await command('compile-relative', [...flags, '-c', 'helper.c', '-o', 'helper.o']);
				const preprocessed = await command('preprocess', [...flags, '-E', 'helper.c']);
				check(
					/40\s*\+\s*2/u.test(decoder.decode(preprocessed.stdout)),
					'Clang must process include and define flags'
				);
				await command('assembly', [...flags, '-S', 'helper.c', '-o', 'helper.s']);
				check(
					container.fs.readFile(`${cwd}/helper.s`).length > 0,
					'Missing assembly output'
				);
				write(
					`${cwd}/compile.rsp`,
					'--target=wasm32-wasi -c "main file.c" -o "main file.o"'
				);
				await command('response-file', ['@compile.rsp']);
				const diagnostic = await command(
					'raw-diagnostic',
					['--container-deliberately-unsupported-option'],
					1
				);
				check(
					diagnostic.stdout.length === 0 &&
						decoder
							.decode(diagnostic.stderr)
							.includes('--container-deliberately-unsupported-option'),
					'Invalid options must reach raw stderr without silent dropping'
				);
				await command('multi-file-link', [
					'--target=wasm32-wasi',
					`-fuse-ld=${linkerPath}`,
					'-nostdlib',
					'-Wl,--export=_start,--max-memory=67108864,--export-memory',
					'main file.o',
					'helper.o',
					'-o',
					'hello.wasm'
				]);
				await artifact('multi-file-artifact', 'hello.wasm', 'hello\n');
				const defaults = [
					'--target=wasm32-wasi',
					`-fuse-ld=${linkerPath}`,
					`--sysroot=${sysroot}`,
					`-resource-dir=${sysroot}/lib/clang/22`,
					'-Wl,--max-memory=67108864'
				];
				write(
					`${cwd}/stdio.c`,
					'#include <stdio.h>\nint main(void){unsigned char b[4];size_t n=fread(b,1,sizeof b,stdin);puts("hello");fwrite(b,1,n,stdout);fwrite(b,1,n,stderr);return n==4?0:2;}\n'
				);
				await command('c-stdio-link', [...defaults, 'stdio.c', '-o', 'stdio.wasm']);
				const binaryInput = Uint8Array.of(0, 255, 195, 169);
				await artifact(
					'c-stdio-artifact',
					'stdio.wasm',
					Uint8Array.from([...encoder.encode('hello\n'), ...binaryInput]),
					{ stdin: binaryInput, stderr: binaryInput }
				);
				write(
					`${cwd}/templates.cpp`,
					'#include <vector>\n#include <numeric>\n#include <map>\n#include <string>\n#include <cstdio>\nint main(){std::vector<int> v{1,2,3};std::map<std::string,int> m{{"sum",std::accumulate(v.begin(),v.end(),0)}};std::printf("sum=%d\\n",m.at("sum"));}\n'
				);
				await command('cpp-template-link', [
					...defaults,
					'--driver-mode=g++',
					'-std=c++20',
					'-fno-exceptions',
					'templates.cpp',
					'-o',
					'cpp.wasm'
				]);
				await artifact('cpp-template-artifact', 'cpp.wasm', 'sum=6\n');
			}
		} catch (error) {
			failure = error;
		} finally {
			await container.dispose();
			await manager.dispose();
		}
		const inspection = await container.inspect();
		return {
			passed: !failure,
			error: failure?.message,
			full,
			results,
			...(config.headerRegression ? { headerCorpus } : {}),
			liveWorkers,
			startedWorkers,
			inspection,
			cacheNames: await caches.keys()
		};
	}
};
