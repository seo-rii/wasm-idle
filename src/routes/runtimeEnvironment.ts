import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';

type ExamplePublicEnvironment = Readonly<Record<string, string | undefined>>;

const RUNTIME_ENVIRONMENT_FIELDS = {
	java: { baseUrl: 'PUBLIC_TEAVM_BASE_URL' },
	debug: { baseUrl: 'PUBLIC_WASM_DEBUG_RUNTIME_URL' },
	rust: { compilerUrl: 'PUBLIC_WASM_RUST_COMPILER_URL' },
	go: { compilerUrl: 'PUBLIC_WASM_GO_COMPILER_URL' },
	d: {
		moduleUrl: 'PUBLIC_WASM_D_MODULE_URL',
		manifestUrl: 'PUBLIC_WASM_D_MANIFEST_URL'
	},
	dotnet: { moduleUrl: 'PUBLIC_WASM_DOTNET_MODULE_URL' },
	ocaml: {
		moduleUrl: 'PUBLIC_WASM_OCAML_MODULE_URL',
		manifestUrl: 'PUBLIC_WASM_OCAML_MANIFEST_URL'
	},
	tinygo: {
		moduleUrl: 'PUBLIC_WASM_TINYGO_MODULE_URL',
		appUrl: 'PUBLIC_WASM_TINYGO_APP_URL'
	},
	elixir: { bundleUrl: 'PUBLIC_WASM_ELIXIR_BUNDLE_URL' },
	erlang: { bundleUrl: 'PUBLIC_WASM_ERLANG_BUNDLE_URL' },
	typescript: { moduleUrl: 'PUBLIC_WASM_TYPESCRIPT_MODULE_URL' },
	wat: { moduleUrl: 'PUBLIC_WASM_WAT_MODULE_URL' },
	lua: { moduleUrl: 'PUBLIC_WASM_LUA_MODULE_URL' },
	fennel: { compilerUrl: 'PUBLIC_WASM_FENNEL_COMPILER_URL' },
	zig: {
		compilerUrl: 'PUBLIC_WASM_ZIG_COMPILER_URL',
		stdlibUrl: 'PUBLIC_WASM_ZIG_STDLIB_URL'
	},
	haskell: {
		moduleUrl: 'PUBLIC_WASM_HASKELL_MODULE_URL',
		rootfsUrl: 'PUBLIC_WASM_HASKELL_ROOTFS_URL',
		bsdtarUrl: 'PUBLIC_WASM_HASKELL_BSDTAR_URL'
	},
	fortran: {
		baseUrl: 'PUBLIC_WASM_FORTRAN_BASE_URL',
		f2cWasmUrl: 'PUBLIC_WASM_FORTRAN_F2C_WASM_URL',
		libf2cUrl: 'PUBLIC_WASM_FORTRAN_LIBF2C_URL',
		f2cHeaderUrl: 'PUBLIC_WASM_FORTRAN_F2C_HEADER_URL',
		analyzerUrl: 'PUBLIC_WASM_FORTRAN_ANALYZER_URL'
	},
	cobol: { baseUrl: 'PUBLIC_WASM_COBOL_BASE_URL' },
	v: { baseUrl: 'PUBLIC_WASM_V_BASE_URL' },
	objectivec: {
		baseUrl: 'PUBLIC_WASM_OBJECTIVEC_BASE_URL',
		libobjcUrl: 'PUBLIC_WASM_OBJECTIVEC_LIBOBJC_URL',
		headersUrl: 'PUBLIC_WASM_OBJECTIVEC_HEADERS_URL',
		libgnustepBaseUrl: 'PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_URL',
		libgnustepBaseObjectUrl: 'PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL',
		foundationHeadersUrl: 'PUBLIC_WASM_OBJECTIVEC_FOUNDATION_HEADERS_URL',
		libffiUrl: 'PUBLIC_WASM_OBJECTIVEC_LIBFFI_URL'
	},
	lisp: {
		moduleUrl: 'PUBLIC_WASM_LISP_MODULE_URL',
		manifestUrl: 'PUBLIC_WASM_LISP_MANIFEST_URL',
		manifestFingerprint: 'PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT'
	},
	ruby: {
		moduleUrl: 'PUBLIC_WASM_RUBY_MODULE_URL',
		wasmUrl: 'PUBLIC_WASM_RUBY_WASM_URL'
	},
	r: { baseUrl: 'PUBLIC_WASM_R_BASE_URL' },
	octave: {
		baseUrl: 'PUBLIC_WASM_OCTAVE_BASE_URL',
		workerUrl: 'PUBLIC_WASM_OCTAVE_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_OCTAVE_MANIFEST_URL'
	},
	prolog: {
		baseUrl: 'PUBLIC_WASM_PROLOG_BASE_URL',
		workerUrl: 'PUBLIC_WASM_PROLOG_WORKER_URL'
	},
	gleam: {
		baseUrl: 'PUBLIC_WASM_GLEAM_BASE_URL',
		workerUrl: 'PUBLIC_WASM_GLEAM_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_GLEAM_MANIFEST_URL',
		manifestFingerprint: 'PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT'
	},
	perl: {
		baseUrl: 'PUBLIC_WASM_PERL_BASE_URL',
		workerUrl: 'PUBLIC_WASM_PERL_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_PERL_MANIFEST_URL'
	},
	tcl: {
		baseUrl: 'PUBLIC_WASM_TCL_BASE_URL',
		workerUrl: 'PUBLIC_WASM_TCL_WORKER_URL'
	},
	awk: { baseUrl: 'PUBLIC_WASM_AWK_BASE_URL', workerUrl: 'PUBLIC_WASM_AWK_WORKER_URL' },
	pascal: {
		baseUrl: 'PUBLIC_WASM_PASCAL_BASE_URL',
		workerUrl: 'PUBLIC_WASM_PASCAL_WORKER_URL'
	},
	clojurescript: {
		baseUrl: 'PUBLIC_WASM_CLOJURESCRIPT_BASE_URL',
		workerUrl: 'PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL'
	},
	rescript: {
		baseUrl: 'PUBLIC_WASM_RESCRIPT_BASE_URL',
		workerUrl: 'PUBLIC_WASM_RESCRIPT_WORKER_URL'
	},
	forth: {
		baseUrl: 'PUBLIC_WASM_FORTH_BASE_URL',
		workerUrl: 'PUBLIC_WASM_FORTH_WORKER_URL'
	},
	j: { baseUrl: 'PUBLIC_WASM_J_BASE_URL', workerUrl: 'PUBLIC_WASM_J_WORKER_URL' },
	bqn: { baseUrl: 'PUBLIC_WASM_BQN_BASE_URL', workerUrl: 'PUBLIC_WASM_BQN_WORKER_URL' },
	janet: {
		baseUrl: 'PUBLIC_WASM_JANET_BASE_URL',
		workerUrl: 'PUBLIC_WASM_JANET_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_JANET_MANIFEST_URL',
		manifestFingerprint: 'PUBLIC_WASM_JANET_MANIFEST_FINGERPRINT'
	},
	julia: {
		baseUrl: 'PUBLIC_WASM_JULIA_BASE_URL',
		workerUrl: 'PUBLIC_WASM_JULIA_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_JULIA_MANIFEST_URL',
		manifestFingerprint: 'PUBLIC_WASM_JULIA_MANIFEST_FINGERPRINT'
	},
	nim: {
		baseUrl: 'PUBLIC_WASM_NIM_BASE_URL',
		workerUrl: 'PUBLIC_WASM_NIM_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_NIM_MANIFEST_URL',
		manifestFingerprint: 'PUBLIC_WASM_NIM_MANIFEST_FINGERPRINT'
	},
	swift: {
		baseUrl: 'PUBLIC_WASM_SWIFT_BASE_URL',
		workerUrl: 'PUBLIC_WASM_SWIFT_WORKER_URL',
		manifestUrl: 'PUBLIC_WASM_SWIFT_MANIFEST_URL'
	},
	assemblyscript: { moduleUrl: 'PUBLIC_WASM_ASSEMBLYSCRIPT_MODULE_URL' },
	duckdb: { moduleUrl: 'PUBLIC_WASM_DUCKDB_MODULE_URL' },
	php: { moduleUrl: 'PUBLIC_WASM_PHP_MODULE_URL' },
	postgresql: { moduleUrl: 'PUBLIC_WASM_POSTGRESQL_MODULE_URL' },
	sqlite: {
		moduleUrl: 'PUBLIC_WASM_SQLITE_MODULE_URL',
		wasmUrl: 'PUBLIC_WASM_SQLITE_WASM_URL'
	},
	c3: { baseUrl: 'PUBLIC_WASM_C3_BASE_URL' },
	grain: { baseUrl: 'PUBLIC_WASM_GRAIN_BASE_URL' },
	hy: { baseUrl: 'PUBLIC_WASM_HY_BASE_URL' }
} satisfies {
	[Runtime in keyof PlaygroundRuntimeAssets]?: Partial<
		Record<keyof NonNullable<PlaygroundRuntimeAssets[Runtime]>, string>
	>;
};

/** Translate example-only environment values into ordinary SDK options. */
export function applyExampleRuntimeEnvironment(
	runtimeAssets: PlaygroundRuntimeAssets,
	environment: ExamplePublicEnvironment
): PlaygroundRuntimeAssets {
	const result = { ...runtimeAssets };
	for (const [runtime, fields] of Object.entries(RUNTIME_ENVIRONMENT_FIELDS)) {
		const configured = runtimeAssets[runtime as keyof PlaygroundRuntimeAssets];
		const config: Record<string, unknown> =
			typeof configured === 'object' && configured !== null ? { ...configured } : {};
		let changed = false;
		for (const [field, envKey] of Object.entries(fields)) {
			const explicit = config[field];
			if (
				field === 'manifestFingerprint' && typeof explicit === 'string'
					? explicit.trim()
					: explicit
			) {
				continue;
			}
			const value = environment[envKey]?.trim();
			if (!value) continue;
			config[field] = value;
			changed = true;
		}
		if (changed) Object.assign(result, { [runtime]: config });
	}
	// A supplied debug config owns its manifest trust, even when it omits a receipt.
	if (!runtimeAssets.debug) {
		const manifestSha256 = environment.PUBLIC_WASM_DEBUG_RUNTIME_MANIFEST_SHA256?.trim();
		if (manifestSha256) result.debug = { ...result.debug, manifestSha256 };
	}
	for (const runtime of ['gleam', 'janet', 'julia', 'nim'] as const) {
		if (runtimeAssets[runtime]?.workerReceipt) continue;
		const prefix = `PUBLIC_WASM_${runtime.toUpperCase()}`;
		const sha256 = environment[`${prefix}_WORKER_SHA256`]?.trim();
		const bytesSource = environment[`${prefix}_WORKER_BYTES`]?.trim();
		if (!sha256 && !bytesSource) continue;
		const bytes = bytesSource && /^\d+$/u.test(bytesSource) ? Number(bytesSource) : Number.NaN;
		if (
			!sha256 ||
			!/^[a-f0-9]{64}$/u.test(sha256) ||
			!Number.isSafeInteger(bytes) ||
			bytes <= 0
		) {
			throw new TypeError(
				`${prefix}_WORKER_SHA256 and _WORKER_BYTES require a valid receipt`
			);
		}
		result[runtime] = {
			...result[runtime],
			workerReceipt: Object.freeze({ bytes, sha256 })
		};
	}
	return result;
}
