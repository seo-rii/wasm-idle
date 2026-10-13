/**
 * Source ownership for required browser CI. Keep this module dependency-free: the
 * changed-runtimes job runs before package installation. Browser test files and
 * switches remain in support-matrix.mjs; the runner joins them by language ID.
 *
 * Families group existing browser suites to keep shared changes to a bounded CI
 * matrix. Adding a supported language requires an owner here and a real browser
 * test in the support matrix; the selection contract tests check both registries.
 */

/** @typedef {'clang' | 'dotnet' | 'esolangs' | 'go' | 'nim' | 'python' | 'stdin' | 'workers' | 'specialized'} RuntimeBrowserFamily */
/** @typedef {RuntimeBrowserFamily | 'debug' | 'workspace'} BrowserFamily */
/** @typedef {{ id: string; family: RuntimeBrowserFamily; languages: string[]; sourceNames: string[]; dependencies: string[] }} BrowserRuntime */

/**
 * @param {string} id
 * @param {RuntimeBrowserFamily} family
 * @param {{ languages?: string[]; sourceNames?: string[]; dependencies?: string[] }} options
 * @returns {BrowserRuntime}
 */
function runtime(
	id,
	family,
	{ languages = [id.toUpperCase()], sourceNames = [id], dependencies = [] } = {}
) {
	return { id, family, languages, sourceNames, dependencies };
}

/** @type {BrowserRuntime[]} */
export const runtimeBrowserRegistry = [
	runtime('clang', 'clang', { languages: ['C', 'CPP'] }),
	runtime('objectivec', 'clang', {
		languages: ['OBJC', 'OBJECTIVECXX'],
		sourceNames: ['objectivec', 'objectivecxx'],
		dependencies: ['clang']
	}),
	runtime('fortran', 'clang', { dependencies: ['clang'] }),
	runtime('cobol', 'clang', { dependencies: ['clang'] }),
	runtime('v', 'clang', { dependencies: ['clang'] }),
	runtime('dotnet', 'dotnet', { languages: ['CSHARP', 'FSHARP', 'VBNET'] }),
	runtime('go', 'go'),
	runtime('nim', 'nim'),
	runtime('python', 'python', { languages: ['PYTHON3'], sourceNames: ['python', 'pyodide'] }),
	...['brainfuck', 'befunge93', 'whitespace', 'malbolge', 'uhmlang', 'lolcode'].map((id) =>
		runtime(id, 'esolangs')
	),
	runtime('aheui', 'esolangs', { dependencies: ['python'] }),
	runtime('apecode', 'esolangs', { dependencies: ['python'] }),
	runtime('golfscript', 'esolangs', { dependencies: ['ruby'] }),
	runtime('java', 'stdin', { sourceNames: ['java', 'teavm'] }),
	runtime('elixir', 'stdin'),
	runtime('javascript', 'stdin', { sourceNames: ['javascript', 'js-sandbox'] }),
	runtime('typescript', 'stdin', { dependencies: ['javascript'] }),
	runtime('assemblyscript', 'stdin'),
	runtime('wat', 'stdin'),
	runtime('wasm', 'stdin'),
	runtime('lua', 'stdin'),
	runtime('fennel', 'stdin', { dependencies: ['lua'] }),
	runtime('zig', 'stdin'),
	runtime('lisp', 'stdin'),
	runtime('haskell', 'stdin'),
	runtime('r', 'stdin', { sourceNames: ['r', 'webr'] }),
	runtime('duckdb', 'stdin'),
	runtime('sqlite', 'stdin'),
	runtime('postgresql', 'stdin'),
	runtime('php', 'stdin'),
	...[
		'prolog',
		'gleam',
		'perl',
		'tcl',
		'awk',
		'pascal',
		'forth',
		'j',
		'bqn',
		'janet',
		'julia',
		'clojurescript'
	].map((id) => runtime(id, 'workers')),
	...[
		'rust',
		'd',
		'c3',
		'grain',
		'bash',
		'rescript',
		'tinygo',
		'commonlisp',
		'lfortran',
		'lean4',
		'ruby',
		'octave'
	].map((id) => runtime(id, 'specialized')),
	runtime('ocaml', 'specialized', { sourceNames: ['ocaml', 'of-js-of-ocaml'] }),
	runtime('erlang', 'specialized', { dependencies: ['elixir'] }),
	runtime('hy', 'specialized', { dependencies: ['python'] })
];

export const ALL_BROWSER_FAMILIES = /** @type {BrowserFamily[]} */ ([
	...new Set(runtimeBrowserRegistry.map(({ family }) => family)),
	'debug',
	'workspace'
]).sort();

/** @param {string} language @returns {RuntimeBrowserFamily} */
export function browserFamilyForLanguage(language) {
	const owners = runtimeBrowserRegistry.filter(({ languages }) => languages.includes(language));
	if (owners.length !== 1) {
		throw new Error(
			`Expected one required browser owner for ${language}, found ${owners.length}`
		);
	}
	return owners[0].family;
}

/** @param {string} file @param {string} name */
function ownsSource(file, name) {
	if (
		[
			`runtimes/${name}/`,
			`runtimes/wasm-${name}/`,
			`static/${name}/`,
			`static/wasm-${name}/`,
			`producers/wasm-${name}/`
		].some((prefix) => file.startsWith(prefix))
	)
		return true;
	const module = file.match(/^src\/lib\/playground\/(?:worker\/)?([^/.]+)/)?.[1];
	if (module) {
		if (module === name) return true;
		// Helper modules use camelCase; retain case to avoid r matching rust or j matching java.
		// "wasm" is also the naming prefix for unrelated runtime modules and scripts.
		if (
			name !== 'wasm' &&
			(module.startsWith(`${name}-`) ||
				(module.startsWith(name) && /^[A-Z]/.test(module.slice(name.length))))
		)
			return true;
		if (module.toLowerCase().startsWith(`wasm${name.replaceAll('-', '')}`)) {
			const suffix = module.slice(4 + name.replaceAll('-', '').length);
			if (/^[A-Z]/.test(suffix)) return true;
		}
	}
	return [
		`scripts/sync-${name}.`,
		`scripts/sync-wasm-${name}.`,
		`scripts/sync-wasm-${name}-`,
		...(name === 'wasm' ? [] : [`scripts/${name}-`, `scripts/runtime-workers/${name}-`]),
		`scripts/probe-${name}-`,
		`scripts/wasm-${name}-`,
		`scripts/llvm-contracts/${name}.`,
		`scripts/llvm-contracts/${name}/`,
		`scripts/runtime-workers/wasm-${name}-`,
		`scripts/runtime-build/wasm-${name}-`,
		`scripts/runtime-modules/${name}.`
	].some((prefix) => file.startsWith(prefix));
}

/** @param {string} file @returns {RuntimeBrowserFamily[]} */
export function runtimeBrowserFamiliesForSource(file) {
	const affected = new Set(
		runtimeBrowserRegistry
			.filter(({ sourceNames }) => sourceNames.some((name) => ownsSource(file, name)))
			.map(({ id }) => id)
	);
	// Expand transitive consumers, e.g. Python -> Aheui/APECode/Hy and Ruby -> GolfScript.
	for (let previousSize = -1; affected.size !== previousSize;) {
		previousSize = affected.size;
		for (const { id, dependencies } of runtimeBrowserRegistry) {
			if (dependencies.some((dependency) => affected.has(dependency))) affected.add(id);
		}
	}
	return [
		...new Set(
			runtimeBrowserRegistry.filter(({ id }) => affected.has(id)).map(({ family }) => family)
		)
	];
}
