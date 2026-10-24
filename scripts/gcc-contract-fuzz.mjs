#!/usr/bin/env node
// Seeded API property fuzzing, not coverage-guided fuzzing or compiler qualification.
// Asset bytes below are inert integrity inputs, never a substitute for GCC.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
	console.log(`Usage: pnpm run fuzz:gcc-contract [--seed UINT32] [--iterations COUNT] [--case INDEX] [--out DIRECTORY]
Runs the actual manifest/parser/planner/integrity boundary with generated inputs.
Defaults: seed 20261024, 10000 cases, a new .cache/gcc-contract-fuzz-TIME-PID directory.
Every case has its own deterministic RNG; --case replays it without earlier cases.
Boundary cases run first; later cases mutate valid inputs. No compiler is executed.
An explicit --out directory must not already exist, to preserve earlier evidence.`);
	process.exit(0);
}
const options = {
	seed: '20261024',
	iterations: '10000',
	out: `.cache/gcc-contract-fuzz-${Date.now()}-${process.pid}`
};
for (let index = 0; index < args.length; index += 2) {
	const name = args[index].slice(2);
	assert(
		args[index].startsWith('--') &&
			['seed', 'iterations', 'case', 'out'].includes(name) &&
			args[index + 1],
		'Invalid arguments; see --help'
	);
	options[name] = args[index + 1];
}
function integer(value, maximum) {
	assert(/^\d+$/u.test(value), `Expected a non-negative integer: ${value}`);
	const number = Number(value);
	assert(Number.isSafeInteger(number) && number <= maximum, `Out of range: ${value}`);
	return number;
}
const seed = integer(options.seed, 0xffffffff);
const iterations = integer(options.iterations, 1_000_000);
assert(iterations > 0, 'Iteration count must be positive');
const replay = options.case === undefined ? undefined : integer(options.case, 999_999);
const output = path.resolve(root, options.out);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const reportPath = path.join(output, 'report.json');
const report = {
	schemaVersion: 1,
	kind: 'gcc-api-contract-seeded-fuzz',
	compilerExecuted: false,
	seed,
	requestedCases: replay === undefined ? iterations : 1,
	replayCase: replay,
	revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
	node: process.version,
	passed: 0,
	groups: {},
	success: false
};
const started = performance.now();
const encoder = new TextEncoder();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const corpusDigest = createHash('sha256');
const serialize = (value) =>
	JSON.stringify(value, (_key, item) =>
		item instanceof Uint8Array ? { type: 'Uint8Array', bytes: [...item] } : item
	);
const assets = {
	cc1Js: 'cc1.mjs',
	cc1Wasm: 'cc1.wasm',
	cc1plusJs: 'cc1plus.mjs',
	cc1plusWasm: 'cc1plus.wasm',
	asJs: 'as.mjs',
	asWasm: 'as.wasm',
	ldJs: 'ld.mjs',
	ldWasm: 'ld.wasm',
	sysroot: 'sysroot.tar'
};
const standards = {
	c: ['c99', 'gnu99', 'c11', 'gnu11', 'c17', 'gnu17', 'c2x', 'gnu2x'],
	cpp: [
		'c++11',
		'gnu++11',
		'c++14',
		'gnu++14',
		'c++17',
		'gnu++17',
		'c++20',
		'gnu++20',
		'c++23',
		'gnu++23'
	]
};
const maxBytes = 16 * 1024 * 1024;
const reserved = [
	'main.c',
	'main.cpp',
	'main.i',
	'main.ii',
	'program.s',
	'program.o',
	'program.elf'
];
let current;

// Mulberry32, independently derived for each index: replay never depends on the
// number of previous cases, Promise scheduling, wall time, or Math.random().
function random(caseIndex) {
	let state = (seed ^ Math.imul(caseIndex + 1, 0x9e3779b1)) >>> 0;
	return {
		int(maximum) {
			state = (state + 0x6d2b79f5) >>> 0;
			let value = Math.imul(state ^ (state >>> 15), state | 1);
			value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
			return ((value ^ (value >>> 14)) >>> 0) % maximum;
		},
		pick(values) {
			return values[this.int(values.length)];
		},
		bytes(length) {
			return Uint8Array.from({ length }, () => this.int(256));
		}
	};
}
function manifest(rng) {
	return {
		schemaVersion: 1,
		kind: 'gcc-x86_64-linux-gnu',
		host: 'wasm32-emscripten',
		target: 'x86_64-linux-gnu',
		compiler: { family: 'gcc', version: '13.3.0' },
		cpuProfiles: ['x86-64', 'avx2-fma'],
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13',
		resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/include',
		assets: Object.fromEntries(
			Object.entries(assets).map(([name, assetPath]) => [
				name,
				{
					path: assetPath,
					bytes: 8 + rng.int(4096),
					sha256: digest(rng.bytes(32))
				}
			])
		),
		gnu: {
			gccVersion: '13',
			glibcVersion: '2.39',
			distribution: `Contract fixture ${rng.int(100000)}`
		},
		qualification: { status: rng.pick(['verified', 'unverified']) }
	};
}
function safePath(rng) {
	const segments = [
		'include',
		'data',
		'nested',
		'name with spaces',
		'한글',
		'é',
		'%2e%2e',
		'__proto__',
		'-flags'
	];
	return (
		Array.from({ length: 1 + rng.int(5) }, () => rng.pick(segments)).join('/') +
		`-${rng.int(100000)}.h`
	);
}
function source(rng) {
	return Array.from({ length: rng.int(64) }, () =>
		rng.pick([
			'#pragma GCC push_options\n',
			'#pragma GCC target("avx2,fma")\n',
			'#pragma GCC optimize("O3")\n',
			'#pragma GCC pop_options\n',
			'\u0000',
			'\ud800',
			'\udfff',
			'\r\n',
			'한글é🙂',
			'"../escape"',
			'int main() {}\n'
		])
	).join('');
}
function request(rng) {
	const language = rng.pick(['c', 'cpp']);
	return {
		code: source(rng),
		language,
		cpu: rng.pick(['x86-64', 'avx2-fma']),
		emit: rng.pick(['assembly', 'object', 'executable']),
		optimization: rng.pick(['0', '1', '2', '3', 's']),
		standard: rng.pick(standards[language]),
		preprocessed: !!rng.int(2),
		files: Array.from({ length: rng.int(6) }, (_, index) => ({
			path: `file-${index}/${safePath(rng)}`,
			contents: rng.int(2) ? source(rng) : rng.bytes(rng.int(256))
		}))
	};
}
function deeplyFrozen(value) {
	assert(Object.isFrozen(value), 'Parsed manifest is not deeply frozen');
	for (const child of Object.values(value))
		if (child && typeof child === 'object') deeplyFrozen(child);
}
function checkPlan(input, parsed, api) {
	const snapshot = structuredClone(input);
	const plan = api.gccCompilePlan(input, parsed);
	assert.deepEqual(input, snapshot, 'Planner modified its caller input');
	const language = input.language ?? 'cpp',
		preprocessed = input.preprocessed ?? false;
	const cpu = input.cpu ?? 'x86-64',
		emit = input.emit ?? 'executable';
	const extension = preprocessed
		? language === 'c'
			? 'i'
			: 'ii'
		: language === 'c'
			? 'c'
			: 'cpp';
	assert.equal(plan.files[0].path, `/workspace/main.${extension}`);
	assert.deepEqual(plan.files[0].contents, encoder.encode(input.code), 'Source was rewritten');
	assert.equal(plan.files.length, 1 + (input.files?.length ?? 0));
	for (const [index, file] of (input.files ?? []).entries()) {
		const contents =
			typeof file.contents === 'string' ? encoder.encode(file.contents) : file.contents;
		assert.equal(plan.files[index + 1].path, `/workspace/${file.path}`);
		assert.deepEqual(plan.files[index + 1].contents, contents);
		if (file.contents instanceof Uint8Array) {
			assert.notEqual(
				plan.files[index + 1].contents.buffer,
				file.contents.buffer,
				'Caller bytes were not copied'
			);
			if (file.contents.length) {
				const before = plan.files[index + 1].contents[0];
				file.contents[0] ^= 255;
				assert.equal(
					plan.files[index + 1].contents[0],
					before,
					'Caller mutation changed the planned bytes'
				);
				file.contents[0] ^= 255;
			}
		}
	}
	assert(
		plan.files.every(
			(file) =>
				path.posix.normalize(file.path) === file.path && file.path.startsWith('/workspace/')
		)
	);
	assert.equal(new Set(plan.files.map((file) => file.path)).size, plan.files.length);
	assert.equal(plan.cpu, cpu);
	assert.equal(plan.emit, emit);
	assert.equal(plan.stages.length, emit === 'assembly' ? 1 : emit === 'object' ? 2 : 3);
	assert.equal(plan.stages[0].tool, language === 'c' ? 'cc1' : 'cc1plus');
	const cc = plan.stages[0].argv;
	assert(cc.includes('-march=x86-64') && !cc.some((arg) => arg.includes('native')));
	assert.equal(cc.includes('-mavx2'), cpu === 'avx2-fma');
	assert.equal(cc.includes('-mfma'), cpu === 'avx2-fma');
	assert.equal(cc.includes('-fexceptions'), language === 'cpp');
	assert.equal(cc.includes('-fpreprocessed'), preprocessed);
	assert.equal(cc.includes('-nostdinc'), !preprocessed);
	assert(cc.includes(`-O${input.optimization ?? '2'}`));
	assert(cc.includes(`-std=${input.standard ?? (language === 'c' ? 'gnu17' : 'gnu++20')}`));
	if (emit !== 'assembly') assert.equal(plan.stages[1].tool, 'as');
	if (emit === 'executable') {
		const linker = plan.stages[2];
		assert.equal(linker.tool, 'ld');
		assert(linker.argv.includes('-static') && linker.argv.includes('elf_x86_64'));
		assert.equal(linker.argv.includes('-lstdc++'), language === 'cpp');
	}
	assert.equal(
		plan.fileName,
		{ assembly: 'program.s', object: 'program.o', executable: 'program.elf' }[emit]
	);
}

// Small, explicit resource boundaries supplement the random cases; these allocate
// at most a few workspaces serially, instead of generating huge random allocations.
const boundaries = [
	...[-1, 0, 1].map((delta) => ({
		kind: 'workspace-byte-boundary',
		payload: { delta },
		run(api, parsed) {
			const input = {
				code: '',
				files: [{ path: 'bytes.bin', contents: new Uint8Array(maxBytes + delta) }]
			};
			if (delta > 0)
				assert.throws(() => api.gccCompilePlan(input, parsed), /workspace exceeds/);
			else checkPlan(input, parsed, api);
		}
	})),
	...[-1, 0, 1].map((delta) => ({
		kind: 'utf8-byte-boundary',
		payload: { delta },
		run(api, parsed) {
			const input = { code: '🙂'.repeat(maxBytes / 4 - 1) + 'a'.repeat(4 + delta) };
			if (delta > 0)
				assert.throws(() => api.gccCompilePlan(input, parsed), /workspace exceeds/);
			else checkPlan(input, parsed, api);
		}
	})),
	...[-1, 0, 1].map((delta) => ({
		kind: 'file-count-boundary',
		payload: { delta },
		run(api, parsed) {
			const input = {
				code: '',
				files: Array.from({ length: 1024 + delta }, (_, i) => ({
					path: `f${i}`,
					contents: ''
				}))
			};
			if (delta > 0)
				assert.throws(() => api.gccCompilePlan(input, parsed), /workspace exceeds/);
			else checkPlan(input, parsed, api);
		}
	})),
	...[-1, 0, 1].map((delta) => ({
		kind: 'path-length-boundary',
		payload: { delta },
		run(api) {
			const value = 'x'.repeat(4096 + delta);
			if (delta > 0) assert.throws(() => api.gccRelativePath(value), /relative path/);
			else assert.equal(api.gccRelativePath(value), value);
		}
	})),
	{
		kind: 'combined-workspace-boundary',
		payload: { sourceBytes: 3, fileBytes: maxBytes - 2 },
		run(api, parsed) {
			assert.throws(
				() =>
					api.gccCompilePlan(
						{
							code: '한',
							files: [{ path: 'data', contents: new Uint8Array(maxBytes - 2) }]
						},
						parsed
					),
				/workspace exceeds/
			);
		}
	}
];

function generated(rng, index, api) {
	const input = manifest(rng),
		parsed = api.parseCrossGccManifest(input);
	const group = index % 6;
	if (group === 0) {
		const value = request(rng);
		// Also exercise defaults independently of explicitly selected profiles.
		if (rng.int(3) === 0)
			for (const key of [
				'language',
				'cpu',
				'emit',
				'optimization',
				'standard',
				'preprocessed'
			])
				delete value[key];
		return {
			kind: 'valid-plan',
			payload: value,
			run() {
				checkPlan(value, parsed, api);
			}
		};
	}
	if (group === 1) {
		const value = request(rng);
		const mutations = [
			() => {
				value[
					rng.pick(['flags', 'argv', 'target', 'plugin', 'lto', 'march', 'constructor'])
				] = rng.pick([[], '-march=native', true]);
			},
			() => {
				value[rng.pick(['language', 'cpu', 'emit', 'optimization', 'standard'])] = rng.pick(
					['native', '-O3 -fplugin=bad', '../x', '', 3, {}, []]
				);
			},
			() => {
				value.code = rng.pick([null, 1, {}, [], true]);
			},
			() => {
				value.preprocessed = rng.pick([null, 1, '', {}, []]);
			},
			() => {
				value.files = rng.pick([1, true, 'file', {}]);
			},
			() => {
				value.files = [
					{
						path: safePath(rng),
						contents: rng.pick([null, 1, {}, [], new Uint16Array(1)])
					}
				];
			}
		];
		rng.pick(mutations)();
		return {
			kind: 'invalid-request',
			payload: value,
			run() {
				assert.throws(() => api.gccCompilePlan(value, parsed), Error);
			}
		};
	}
	if (group === 2) {
		const value = safePath(rng);
		const invalid = rng.pick([
			`../${value}`,
			`/${value}`,
			`${value}/..`,
			`${value}/.`,
			`${value}//file`,
			`${value}\\file`,
			`${value}\0file`,
			`${value}/${String.fromCharCode(rng.int(32))}`,
			'',
			null,
			0,
			[]
		]);
		return {
			kind: 'path-confinement',
			payload: { value, invalid },
			run() {
				assert.equal(api.gccRelativePath(value), value);
				assert.equal(path.posix.normalize(`/workspace/${value}`), `/workspace/${value}`);
				assert.throws(() => api.gccRelativePath(invalid), /relative path/);
				assert.throws(
					() =>
						api.gccCompilePlan(
							{ code: '', files: [{ path: invalid, contents: '' }] },
							parsed
						),
					/relative path/
				);
			}
		};
	}
	if (group === 3) {
		const prefix = safePath(rng),
			name = rng.pick(reserved);
		const paths = rng.pick([
			[prefix, prefix],
			[prefix, `${prefix}/child`],
			[`${prefix}/child`, prefix],
			[name],
			[`${name}/child`]
		]);
		const value = {
			code: source(rng),
			files: paths.map((filePath) => ({ path: filePath, contents: '' }))
		};
		return {
			kind: 'path-collision',
			payload: value,
			run() {
				assert.throws(
					() => api.gccCompilePlan(value, parsed),
					/reserved|Duplicate|collision/
				);
			}
		};
	}
	if (group === 4) {
		const copy = structuredClone(input),
			asset = rng.pick(Object.keys(assets));
		const mutations = [
			() => {
				input[
					rng.pick([
						'schemaVersion',
						'kind',
						'host',
						'target',
						'linkMode',
						'sysrootPath',
						'gccInstallation',
						'resourceDir'
					])
				] = rng.pick([null, 'unsupported', 0, []]);
			},
			() => {
				input.compiler = rng.pick([
					null,
					[],
					{},
					{ family: 'clang', version: '13.3.0' },
					{ family: 'gcc', version: '14.1.0' }
				]);
			},
			() => {
				input.cpuProfiles = rng.pick([
					[],
					['native'],
					['avx2-fma', 'x86-64'],
					['x86-64', 'avx2-fma', 'native']
				]);
			},
			() => {
				input.assets[asset].path = rng.pick([
					'../cc1.mjs',
					'/cc1.wasm',
					'https://evil.invalid/x',
					'sysroot.tar/extra',
					null
				]);
			},
			() => {
				input.assets[asset].bytes = rng.pick([
					-1,
					0,
					7,
					8.5,
					Number.MAX_SAFE_INTEGER + 1,
					'16',
					null
				]);
			},
			() => {
				input.assets[asset].sha256 = rng.pick([
					'',
					'f'.repeat(63),
					'f'.repeat(65),
					'A'.repeat(64),
					'g'.repeat(64),
					null
				]);
			},
			() => {
				input.gnu[rng.pick(['glibcVersion', 'distribution'])] = rng.pick([
					'',
					'\0',
					'x'.repeat(4097),
					null
				]);
			},
			() => {
				input.gnu.gccVersion = rng.pick(['12', '13.3.0', 13, null]);
			},
			() => {
				input.qualification.status = rng.pick(['trusted', 'VERIFIED', null]);
			},
			() => {
				delete input.assets[asset];
			}
		];
		rng.pick(mutations)();
		return {
			kind: 'manifest-mutation',
			payload: input,
			run() {
				assert.deepEqual(parsed, copy, 'Parser did not take an independent snapshot');
				deeplyFrozen(parsed);
				assert.throws(() => api.parseCrossGccManifest(input), Error);
			}
		};
	}
	// This uses the actual fetch/integrity path, but deliberately invalid/inert
	// bytes. Acceptance is a bug: the oracle requires the precise integrity error,
	// not an unrelated later parse, tar, Wasm, or module import failure.
	const files = new Map();
	for (const [name, assetPath] of Object.entries(assets)) {
		const bytes = rng.bytes(8 + rng.int(248));
		// Avoid accidental gzip magic: transport decompression is not this oracle.
		bytes[0] = 0;
		files.set(assetPath, bytes);
		input.assets[name] = { path: assetPath, bytes: bytes.length, sha256: digest(bytes) };
	}
	const receipt = encoder.encode(JSON.stringify(input));
	files.set('gcc-toolchain.v1.json', receipt);
	const corrupted = rng.pick(['gcc-toolchain.v1.json', ...Object.values(assets)]);
	const mode =
		corrupted === 'gcc-toolchain.v1.json' ? 'hash' : rng.pick(['hash', 'short', 'long']);
	const original = files.get(corrupted),
		position = 1 + rng.int(original.length - 1);
	if (mode === 'hash') {
		files.set(corrupted, Uint8Array.from(original));
		files.get(corrupted)[position] ^= 1 << rng.int(8);
	} else if (mode === 'short') files.set(corrupted, original.slice(0, -1));
	else files.set(corrupted, Uint8Array.from([...original, rng.int(256)]));
	return {
		kind: `asset-integrity-${mode}`,
		payload: {
			corrupted,
			mode,
			position,
			originalSha256: digest(original),
			mutatedSha256: digest(files.get(corrupted))
		},
		async run() {
			let loaded;
			await assert
				.rejects(
					async () => {
						loaded = await api.createCrossGccCompiler({
							manifestUrl: 'https://gcc-contract.invalid/gcc-toolchain.v1.json',
							manifestSha256: digest(receipt),
							fetchImpl: async (url) => {
								const bytes = files.get(new URL(String(url)).pathname.slice(1));
								assert(bytes);
								return new Response(bytes);
							}
						});
					},
					mode === 'hash' ? /SHA-256 mismatch/ : /size mismatch|byte limit/
				)
				.finally(() => loaded?.dispose());
		}
	};
}

try {
	const built = await build({
		stdin: {
			contents: `export { parseCrossGccManifest } from './packages/llvm-core/runtime/gcc/src/manifest.ts';
export { gccCompilePlan, gccRelativePath } from './packages/llvm-core/runtime/gcc/src/plan.ts';
export { createCrossGccCompiler } from './packages/llvm-core/runtime/gcc/src/compiler.ts';`,
			resolveDir: root,
			loader: 'ts'
		},
		bundle: true,
		write: false,
		platform: 'node',
		format: 'esm',
		logLevel: 'silent',
		alias: { '@wasm-idle/core': path.join(root, 'packages/core/src/index.ts') }
	});
	const api = await import(
		`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`
	);
	report.harnessSha256 = digest(await fs.readFile(fileURLToPath(import.meta.url)));
	report.bundledRuntimeSha256 = digest(built.outputFiles[0].contents);
	const indexes =
		replay === undefined ? Array.from({ length: iterations }, (_, i) => i) : [replay];
	for (const index of indexes) {
		const rng = random(index);
		current = { index, kind: 'case-generation', payload: {} };
		const test = index < boundaries.length ? boundaries[index] : generated(rng, index, api);
		current = { index, kind: test.kind, payload: test.payload };
		const serialized = serialize(current);
		corpusDigest.update(serialized + '\n');
		if (replay !== undefined) report.replayedCase = { ...current, sha256: digest(serialized) };
		await test.run(api, api.parseCrossGccManifest(manifest(rng)));
		report.passed++;
		report.groups[test.kind] = (report.groups[test.kind] ?? 0) + 1;
	}
	report.success = true;
} catch (error) {
	report.failure = {
		...current,
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
		replay: current
			? `pnpm run fuzz:gcc-contract --seed ${seed} --case ${current.index} --out .cache/gcc-contract-replay`
			: undefined
	};
	console.error(
		`GCC contract fuzz failed: ${report.failure.message}\n${report.failure.replay ?? ''}`
	);
	process.exitCode = 1;
} finally {
	report.milliseconds = Math.round(performance.now() - started);
	report.maxRssKiB = process.resourceUsage().maxRSS;
	report.corpusSha256 = corpusDigest.digest('hex');
	await fs.writeFile(
		reportPath,
		JSON.stringify(
			report,
			(_key, value) =>
				value instanceof Uint8Array ? { type: 'Uint8Array', bytes: [...value] } : value,
			2
		) + '\n'
	);
	console.log(
		JSON.stringify({
			kind: report.kind,
			seed,
			passed: report.passed,
			success: report.success,
			report: reportPath
		})
	);
}
