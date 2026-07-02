#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserClangRuntime, loadRuntimeManifest, resolveRuntimeManifestUrl } from 'wasm-clang';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(RUNTIME_ROOT, '..', '..');
const CACHE_ROOT =
	process.env.WASM_IDLE_OBJECTIVEC_CACHE_DIR ||
	path.join(os.tmpdir(), 'wasm-idle-objectivec-runtime');
const LIBOBJC2_DIR = path.join(CACHE_ROOT, 'libobjc2');
const ROBIN_MAP_DIR = path.join(CACHE_ROOT, 'robin-map');
const BUILD_DIR = path.join(CACHE_ROOT, 'build');
const OBJECT_DIR = path.join(BUILD_DIR, 'obj');
const STATIC_DIR = path.join(REPO_ROOT, 'static', 'wasm-objectivec');

const LIBOBJC2_URL = 'https://github.com/gnustep/libobjc2.git';
const LIBOBJC2_REF = 'v2.3';
const ROBIN_MAP_URL = 'https://github.com/Tessil/robin-map.git';
const ROBIN_MAP_REF = 'v1.4.0';

const CLANG_BASE_URL = pathToFileURL(path.join(REPO_ROOT, 'static', 'clang') + path.sep);
const CLANG_MANIFEST_URL = resolveRuntimeManifestUrl(CLANG_BASE_URL);

const sourceFiles = [
	'alias_table.c',
	'builtin_classes.c',
	'caps.c',
	'category_loader.c',
	'class_table.c',
	'dtable.c',
	'encoding2.c',
	'gc_none.c',
	'hooks.c',
	'ivar.c',
	'loader.c',
	'protocol.c',
	'runtime.c',
	'sarray2.c',
	'selector_table.cc',
	'sendmsg2.c',
	'NSBlocks.m',
	'associate.m',
	'blocks_runtime_np.m',
	'properties.m',
	'mutation.m',
	'fast_paths.m',
	'blocks_runtime.m',
	'arc.mm',
	'block_to_imp_wasm.c'
];

const publicHeaders = [
	'Block.h',
	'Block_private.h',
	'objc/Availability.h',
	'objc/Object.h',
	'objc/Protocol.h',
	'objc/blocks_private.h',
	'objc/blocks_runtime.h',
	'objc/capabilities.h',
	'objc/developer.h',
	'objc/encoding.h',
	'objc/hooks.h',
	'objc/message.h',
	'objc/objc-api.h',
	'objc/objc-arc.h',
	'objc/objc-auto.h',
	'objc/objc-class.h',
	'objc/objc-exception.h',
	'objc/objc-runtime.h',
	'objc/objc-visibility.h',
	'objc/objc.h',
	'objc/runtime-deprecated.h',
	'objc/runtime.h',
	'objc/slot.h'
];

const shimFiles = {
	'objc/objc-config.h': '#pragma once\n',
	'sys/types.h': `#pragma once
#include <stddef.h>
#include <stdint.h>
#ifndef __ssize_t_defined
typedef long ssize_t;
#define __ssize_t_defined 1
#endif
#ifndef __mode_t_defined
typedef unsigned int mode_t;
#define __mode_t_defined 1
#endif
#ifndef __uid_t_defined
typedef unsigned int uid_t;
#define __uid_t_defined 1
#endif
#ifndef __gid_t_defined
typedef unsigned int gid_t;
#define __gid_t_defined 1
#endif
#ifndef __pid_t_defined
typedef int pid_t;
#define __pid_t_defined 1
#endif
`,
	'stdbool.h': `#pragma once
#ifndef __cplusplus
#define bool _Bool
#define true 1
#define false 0
#endif
`,
	pthread: `#pragma once
#include <stdint.h>
#define PTHREAD_ONCE_INIT 0
#define PTHREAD_MUTEX_INITIALIZER 0
#define PTHREAD_MUTEX_RECURSIVE 1
#define PTHREAD_COND_INITIALIZER 0
typedef int pthread_t;
typedef int pthread_key_t;
typedef int pthread_once_t;
typedef int pthread_mutex_t;
typedef int pthread_mutexattr_t;
typedef int pthread_cond_t;
typedef int pthread_condattr_t;
typedef int pthread_rwlock_t;
typedef int pthread_rwlockattr_t;
static inline int pthread_once(pthread_once_t *once, void (*init)(void)) { if (*once) return 0; *once = 1; init(); return 0; }
static inline int pthread_mutex_init(pthread_mutex_t *m, const pthread_mutexattr_t *a) { (void)a; *m = 0; return 0; }
static inline int pthread_mutexattr_init(pthread_mutexattr_t *a) { *a = 0; return 0; }
static inline int pthread_mutexattr_settype(pthread_mutexattr_t *a, int type) { (void)a; (void)type; return 0; }
static inline int pthread_mutexattr_destroy(pthread_mutexattr_t *a) { (void)a; return 0; }
static inline int pthread_mutex_destroy(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_lock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_trylock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_unlock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_cond_init(pthread_cond_t *c, const pthread_condattr_t *a) { (void)a; *c = 0; return 0; }
static inline int pthread_cond_destroy(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_cond_signal(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_cond_broadcast(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_cond_wait(pthread_cond_t *c, pthread_mutex_t *m) { (void)c; (void)m; return 0; }
static inline int pthread_cond_timedwait(pthread_cond_t *c, pthread_mutex_t *m, const void *ts) { (void)c; (void)m; (void)ts; return 0; }
static inline int pthread_key_create(pthread_key_t *key, void (*destructor)(void *)) { static int next = 1; (void)destructor; *key = next++; return 0; }
static inline int pthread_key_delete(pthread_key_t key) { (void)key; return 0; }
static inline void *pthread_getspecific(pthread_key_t key) { (void)key; return 0; }
static inline int pthread_setspecific(pthread_key_t key, const void *value) { (void)key; (void)value; return 0; }
static inline pthread_t pthread_self(void) { return 1; }
static inline int pthread_equal(pthread_t left, pthread_t right) { return left == right; }
static inline int pthread_create(pthread_t *thread, const void *attr, void *(*start)(void *), void *arg) { (void)attr; (void)start; (void)arg; *thread = 1; return -1; }
static inline int pthread_join(pthread_t thread, void **value) { (void)thread; (void)value; return 0; }
static inline int pthread_detach(pthread_t thread) { (void)thread; return 0; }
static inline int pthread_rwlock_init(pthread_rwlock_t *lock, const pthread_rwlockattr_t *attr) { (void)attr; *lock = 0; return 0; }
static inline int pthread_rwlock_destroy(pthread_rwlock_t *lock) { (void)lock; return 0; }
static inline int pthread_rwlock_rdlock(pthread_rwlock_t *lock) { (void)lock; return 0; }
static inline int pthread_rwlock_wrlock(pthread_rwlock_t *lock) { (void)lock; return 0; }
static inline int pthread_rwlock_unlock(pthread_rwlock_t *lock) { (void)lock; return 0; }
`,
	'pthread.h': '#include "pthread"\n',
	'unistd.h': `#pragma once
#ifndef _SC_PAGESIZE
#define _SC_PAGESIZE 30
#endif
static inline long sysconf(int name) { (void)name; return 65536; }
static inline unsigned int sleep(unsigned int seconds) { return seconds; }
`,
	'sys/mman.h': `#pragma once
#include <stdlib.h>
#define PROT_NONE 0
#define PROT_READ 1
#define PROT_WRITE 2
#define PROT_EXEC 4
#define MAP_PRIVATE 2
#define MAP_ANON 0x20
#define MAP_ANONYMOUS MAP_ANON
#define MAP_FAILED ((void *)-1)
static inline void *mmap(void *addr, unsigned long length, int prot, int flags, int fd, long offset) {
    (void)addr; (void)prot; (void)flags; (void)fd; (void)offset;
    return malloc(length);
}
static inline int munmap(void *addr, unsigned long length) { (void)length; free(addr); return 0; }
static inline int mprotect(void *addr, unsigned long length, int prot) { (void)addr; (void)length; (void)prot; return 0; }
`,
	'fcntl.h': '#pragma once\n#include_next <fcntl.h>\n',
	forward_list: `#pragma once
#include <initializer_list>
#include <vector>
namespace std {
template <typename T> class forward_list {
    vector<T> values;
public:
    using iterator = typename vector<T>::iterator;
    using const_iterator = typename vector<T>::const_iterator;
    forward_list() = default;
    forward_list(initializer_list<T> init) : values(init) {}
    bool empty() const { return values.empty(); }
    T& front() { return values.front(); }
    const T& front() const { return values.front(); }
    iterator begin() { return values.begin(); }
    iterator end() { return values.end(); }
    const_iterator begin() const { return values.begin(); }
    const_iterator end() const { return values.end(); }
    void push_front(const T& value) { values.insert(values.begin(), value); }
    iterator insert_after(iterator before, const T& value) {
        return values.insert(before == values.end() ? values.end() : before + 1, value);
    }
    iterator erase_after(iterator before) {
        return before == values.end() ? values.end() : values.erase(before + 1);
    }
};
}
`
};

const blockToImpWasmSource = `#include "objc/runtime.h"
#include "visibility.h"

PRIVATE void init_trampolines(void) {}

OBJC_PUBLIC IMP imp_implementationWithBlock(id block)
{
    (void)block;
    return 0;
}

OBJC_PUBLIC id imp_getBlock(IMP anImp)
{
    (void)anImp;
    return 0;
}

OBJC_PUBLIC BOOL imp_removeBlock(IMP anImp)
{
    (void)anImp;
    return NO;
}

OBJC_PUBLIC char *block_copyIMPTypeEncoding_np(id block)
{
    (void)block;
    return 0;
}
`;

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd || REPO_ROOT,
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
			env: process.env
		});
		let stdout = '';
		let stderr = '';
		if (options.capture) {
			child.stdout?.on('data', (chunk) => {
				stdout += chunk;
			});
			child.stderr?.on('data', (chunk) => {
				stderr += chunk;
			});
		}
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) {
				resolve(options.capture ? stdout.trim() : undefined);
				return;
			}
			reject(
				new Error(
					`${command} ${args.join(' ')} failed${
						signal ? ` with signal ${signal}` : ` with code ${String(code)}`
					}${stderr ? `\n${stderr}` : ''}`
				)
			);
		});
	});
}

async function exists(filePath) {
	const fileStat = await stat(filePath).catch(() => null);
	return !!fileStat;
}

async function ensureGitCheckout(directory, url, ref) {
	if (!(await exists(path.join(directory, '.git')))) {
		await mkdir(path.dirname(directory), { recursive: true });
		await rm(directory, { recursive: true, force: true });
		await run('git', ['clone', url, directory]);
	}
	await run('git', ['fetch', '--tags', '--quiet'], { cwd: directory });
	await run('git', ['checkout', '--quiet', ref], { cwd: directory });
}

async function gitOutput(directory, args) {
	return run('git', args, { cwd: directory, capture: true });
}

function patchLibobjc2Source(relativePath, source) {
	if (relativePath === 'class_table.c') {
		return source.replace(
			'm->imp((id)class, loadSel);',
			'((void (*)(id, SEL))m->imp)((id)class, loadSel);'
		);
	}
	if (relativePath === 'dtable.c') {
		return source.replace('void objc_resolve_class(Class);', 'BOOL objc_resolve_class(Class);');
	}
	if (relativePath === 'runtime.c') {
		return source.replace(
			'PRIVATE void objc_resolve_class(Class);',
			'PRIVATE BOOL objc_resolve_class(Class);'
		);
	}
	if (relativePath === 'associate.m') {
		return source.replace(
			`\t@try
\t{
\t\tif (OBJC_ASSOCIATION_ASSIGN != r->policy)
\t\t{
\t\t\tobjc_release(r->object);
\t\t}
\t}
\t@finally
\t{
\t\tr->policy = policy;
\t\tr->object = obj;
\t}`,
			`\tif (OBJC_ASSOCIATION_ASSIGN != r->policy)
\t{
\t\tobjc_release(r->object);
\t}
\tr->policy = policy;
\tr->object = obj;`
		);
	}
	return source;
}

function objectNameFor(relativePath) {
	return relativePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.o';
}

function isObjectiveCSource(relativePath) {
	return relativePath.endsWith('.m');
}

function isObjectiveCxxSource(relativePath) {
	return relativePath.endsWith('.mm');
}

function isCxxSource(relativePath) {
	return relativePath.endsWith('.cc') || isObjectiveCxxSource(relativePath);
}

async function addFileWithDirs(clang, filePath, contents) {
	const parts = filePath.split('/').slice(0, -1);
	let directory = '';
	for (const part of parts) {
		directory = directory ? `${directory}/${part}` : part;
		try {
			clang.memfs.addDirectory(directory);
		} catch {
			// Existing directories are fine; the memfs API does not expose an exists check.
		}
	}
	try {
		clang.memfs.addFile(filePath, contents);
	} catch (error) {
		throw new Error(`Failed to add ${filePath} to wasm-clang memfs: ${error.message}`, {
			cause: error
		});
	}
}

async function createRuntime() {
	const manifest = await loadRuntimeManifest(CLANG_MANIFEST_URL);
	const clang = new BrowserClangRuntime({
		stdout: (output) => process.stdout.write(output),
		stdin: () => '',
		log: process.env.WASM_IDLE_OBJECTIVEC_BUILD_LOG === '1',
		runtimeBaseUrl: CLANG_BASE_URL,
		manifest
	});
	await clang.ready;
	return clang;
}

const ignoredLocalIncludes = new Set([
	'dispatch/dispatch.h',
	'gc/gc.h',
	'gc/gc_typed.h',
	'nbutil.h',
	'rtlsupportapi.h',
	'safewindows.h',
	'Windows.h',
	'windows.h'
]);

const includePattern = /^\s*#\s*(?:include|import)(?:_next)?\s+[<"]([^>"]+)[>"]/gm;

async function resolveSourceHeaderPath(currentPath, includeName) {
	if (ignoredLocalIncludes.has(includeName)) return null;
	const currentDirectory = currentPath.includes('/') ? path.posix.dirname(currentPath) : '';
	const candidates = [];
	if (currentDirectory) candidates.push(path.posix.join(currentDirectory, includeName));
	candidates.push(includeName);
	if (!includeName.startsWith('objc/')) candidates.push(path.posix.join('objc', includeName));

	for (const candidate of candidates) {
		if (shimFiles[candidate] != null) return candidate;
		if (candidate.startsWith('tsl/')) {
			if (await exists(path.join(ROBIN_MAP_DIR, 'include', candidate))) return candidate;
			continue;
		}
		if (await exists(path.join(LIBOBJC2_DIR, candidate))) return candidate;
	}
	return null;
}

async function readSourceHeader(headerPath) {
	if (shimFiles[headerPath] != null) return shimFiles[headerPath];
	if (headerPath.startsWith('tsl/')) {
		return readFile(path.join(ROBIN_MAP_DIR, 'include', headerPath), 'utf8');
	}
	return readFile(path.join(LIBOBJC2_DIR, headerPath), 'utf8');
}

async function collectHeadersForSource(sourcePath, source, headers = new Set()) {
	includePattern.lastIndex = 0;
	for (const match of source.matchAll(includePattern)) {
		const headerPath = await resolveSourceHeaderPath(sourcePath, match[1]);
		if (!headerPath || headers.has(headerPath)) continue;
		headers.add(headerPath);
		await collectHeadersForSource(headerPath, await readSourceHeader(headerPath), headers);
	}
	return headers;
}

async function installHeaders(clang, relativePath, source) {
	const headers = await collectHeadersForSource(relativePath, source);
	for (const header of headers) {
		await addFileWithDirs(clang, header, await readSourceHeader(header));
	}
}

function compileArgsFor(relativePath, clang) {
	const resourceDir = clang.compilerConfig?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	const systemIncludeArgs = isCxxSource(relativePath)
		? [
				'-internal-isystem',
				'/include/c++/v1',
				'-internal-isystem',
				resourceIncludeDir,
				'-internal-isystem',
				'/include/wasm32-wasi',
				'-internal-isystem',
				'/include'
			]
		: [
				'-internal-isystem',
				resourceIncludeDir,
				'-internal-isystem',
				'/include/wasm32-wasi',
				'-internal-isystem',
				'/include'
			];
	const localIncludeArgs = isCxxSource(relativePath)
		? ['-iquote', '.', '-idirafter', '.']
		: ['-I.', '-Iobjc'];
	const baseArgs = [
		'-cc1',
		'-triple',
		'wasm32-wasi',
		'-emit-obj',
		'-disable-free',
		'-isysroot',
		'/',
		'-resource-dir',
		resourceDir,
		...systemIncludeArgs,
		...localIncludeArgs,
		'-ferror-limit',
		'20',
		'-O2',
		'-fvisibility=hidden',
		'-D__LIBOBJC_RUNTIME_INTERNAL__=1',
		'-D__OBJC_RUNTIME_INTERNAL__=1',
		'-D__GNUSTEP_RUNTIME__=1',
		'-D__GNUSTEP_RUNTIME_ABI__=20',
		'-DNO_LEGACY=1',
		'-DNO_SELECTOR_MISMATCH_WARNINGS=1',
		'-DEMBEDDED_BLOCKS_RUNTIME=1',
		'-D__wasm__=1',
		'-D__wasm32__=1',
		'-Wno-error=implicit-function-declaration',
		'-Wno-error=incompatible-function-pointer-types',
		'-Wno-error=int-conversion',
		'-Wno-deprecated-objc-isa-usage',
		'-o',
		objectNameFor(relativePath)
	];
	const languageArgs = isObjectiveCxxSource(relativePath)
		? ['-x', 'objective-c++', '-fobjc-runtime=gnustep-2.0']
		: isObjectiveCSource(relativePath)
			? ['-x', 'objective-c', '-fobjc-runtime=gnustep-2.0']
			: isCxxSource(relativePath)
				? ['-x', 'c++', '-std=gnu++17']
				: ['-x', 'c'];

	return [...baseArgs, ...languageArgs, relativePath];
}

async function compileObject(relativePath) {
	const clang = await createRuntime();
	const source =
		relativePath === 'block_to_imp_wasm.c'
			? blockToImpWasmSource
			: patchLibobjc2Source(
					relativePath,
					await readFile(path.join(LIBOBJC2_DIR, relativePath), 'utf8')
				);
	await installHeaders(clang, relativePath, source);
	await addFileWithDirs(clang, relativePath, source);
	const objectName = objectNameFor(relativePath);
	clang.memfs.addFile(objectName, new Uint8Array(0));
	const clangModule = await clang.getModule(clang.assetUrls.clang);
	try {
		await clang.run(clangModule, true, 'clang', ...compileArgsFor(relativePath, clang));
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectName));
		if (!objectBytes.length) throw error;
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectName));
	if (!objectBytes.length) {
		throw new Error(`${relativePath} did not produce an object file`);
	}
	const objectPath = path.join(OBJECT_DIR, objectName);
	await writeFile(objectPath, objectBytes);
	return objectPath;
}

async function findArchiver() {
	const candidates = [
		process.env.LLVM_AR,
		path.join(
			REPO_ROOT,
			'runtimes/wasm-clang/artifacts/toolchain-build-yowasp/emsdk/upstream/bin/llvm-ar'
		),
		path.join(
			REPO_ROOT,
			'runtimes/wasm-clang/artifacts/toolchain-build/tools/wasi-sdk-33.0-x86_64-linux/bin/llvm-ar'
		),
		'llvm-ar',
		'ar'
	].filter(Boolean);
	for (const candidate of candidates) {
		if (candidate.includes(path.sep) && !(await exists(candidate))) continue;
		return candidate;
	}
	throw new Error('Unable to locate llvm-ar/ar');
}

async function writeHeadersManifest() {
	const headers = {};
	for (const header of publicHeaders) {
		headers[header] = await readFile(path.join(LIBOBJC2_DIR, header), 'utf8');
	}
	headers['objc/objc-config.h'] = shimFiles['objc/objc-config.h'];
	headers['sys/types.h'] = shimFiles['sys/types.h'];
	await writeFile(
		path.join(STATIC_DIR, 'headers.json'),
		`${JSON.stringify(headers, null, '\t')}\n`
	);
}

await ensureGitCheckout(LIBOBJC2_DIR, LIBOBJC2_URL, LIBOBJC2_REF);
await ensureGitCheckout(ROBIN_MAP_DIR, ROBIN_MAP_URL, ROBIN_MAP_REF);
await rm(BUILD_DIR, { recursive: true, force: true });
await mkdir(OBJECT_DIR, { recursive: true });
await mkdir(STATIC_DIR, { recursive: true });

const objectPaths = [];
for (const sourceFile of sourceFiles) {
	console.log(`[objective-c] compiling ${sourceFile}`);
	objectPaths.push(await compileObject(sourceFile));
}

const archivePath = path.join(STATIC_DIR, 'libobjc.a');
await rm(archivePath, { force: true });
const archiver = await findArchiver();
await run(archiver, ['rcs', archivePath, ...objectPaths]);

const libobjc2Commit = await gitOutput(LIBOBJC2_DIR, ['rev-parse', 'HEAD']);
const robinMapCommit = await gitOutput(ROBIN_MAP_DIR, ['rev-parse', 'HEAD']);
await writeHeadersManifest();
await writeFile(
	path.join(STATIC_DIR, 'runtime-build.json'),
	`${JSON.stringify(
		{
			libobjc2: {
				url: LIBOBJC2_URL,
				ref: LIBOBJC2_REF,
				commit: libobjc2Commit
			},
			robinMap: {
				url: ROBIN_MAP_URL,
				ref: ROBIN_MAP_REF,
				commit: robinMapCommit
			},
			clangRuntime: {
				baseUrl: CLANG_BASE_URL.toString(),
				manifestUrl: CLANG_MANIFEST_URL.toString()
			},
			target: 'wasm32-wasi',
			notes: [
				'GNUstep libobjc2 is compiled with single-threaded WASI compatibility shims.',
				'User code links a constructor wrapper that calls clang Objective-C module load functions.',
				'WASM cannot host executable trampolines, so block-to-IMP bridge APIs return null.'
			],
			sources: sourceFiles
		},
		null,
		'\t'
	)}\n`
);

console.log(`[objective-c] wrote ${archivePath}`);
