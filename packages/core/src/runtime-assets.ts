export interface RuntimeAssetIntegrityEntry {
	sha256: string;
	bytes?: number;
	mediaType?: string;
}

export type RuntimeAssetIntegrityMap = Record<string, string | RuntimeAssetIntegrityEntry>;

export interface RuntimeAssetProfileKeySource {
	profileId: string;
	manifestSchemaVersion: number;
	manifestSha256: string;
	protocolVersion: number;
	trustProfileId?: string;
	trustProfileSchemaVersion?: number;
}

export interface RuntimeAssetLoaderKeySource {
	baseUrl?: string;
	loader?: unknown;
	loaderKey?: string;
	integrity?: RuntimeAssetIntegrityMap;
	allowedBaseUrls?: string[];
}

export interface RuntimeAssetKeySource {
	rootUrl?: string;
	runtimeProfiles?: Readonly<Record<string, RuntimeAssetProfileKeySource>>;
	python?: RuntimeAssetLoaderKeySource;
	java?: RuntimeAssetLoaderKeySource;
	clang?: RuntimeAssetLoaderKeySource;
	clangd?: RuntimeAssetLoaderKeySource;
	rust?: { compilerUrl?: string; debugModuleUrl?: string };
	go?: { compilerUrl?: string };
	assemblyscript?: { moduleUrl?: string };
	duckdb?: { moduleUrl?: string };
	d?: { moduleUrl?: string };
	dotnet?: { moduleUrl?: string };
	elixir?: { bundleUrl?: string };
	erlang?: { bundleUrl?: string };
	ocaml?: { moduleUrl?: string; manifestUrl?: string };
	tinygo?: { appUrl?: string; moduleUrl?: string };
	typescript?: { moduleUrl?: string };
	wat?: { moduleUrl?: string };
	lua?: { moduleUrl?: string };
	haskell?: {
		moduleUrl?: string;
		rootfsUrl?: string;
		bsdtarUrl?: string;
		mainSoPath?: string;
		searchDirs?: string[];
	};
	zig?: { compilerUrl?: string; stdlibUrl?: string };
	lisp?: { moduleUrl?: string };
	ruby?: { moduleUrl?: string; wasmUrl?: string };
	r?: { baseUrl?: string };
	octave?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	prolog?: { baseUrl?: string; workerUrl?: string };
	gleam?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	perl?: { baseUrl?: string; workerUrl?: string };
	tcl?: { baseUrl?: string; workerUrl?: string };
	awk?: { baseUrl?: string; workerUrl?: string };
	pascal?: { baseUrl?: string; workerUrl?: string };
	forth?: { baseUrl?: string; workerUrl?: string };
	j?: { baseUrl?: string; workerUrl?: string };
	bqn?: { baseUrl?: string; workerUrl?: string };
	janet?: { baseUrl?: string; workerUrl?: string };
	julia?: { baseUrl?: string; workerUrl?: string };
	nim?: { baseUrl?: string; workerUrl?: string };
	bash?: { moduleUrl?: string; webcUrl?: string; workerUrl?: string };
	clojurescript?: { baseUrl?: string; workerUrl?: string };
	cobol?: { baseUrl?: string };
	swift?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	sqlite?: { moduleUrl?: string; wasmUrl?: string };
	php?: { moduleUrl?: string };
}

export type RuntimeAssetKeyInput = string | RuntimeAssetKeySource | undefined;

type RuntimeAssetName = Exclude<keyof RuntimeAssetKeySource, 'rootUrl' | 'runtimeProfiles'>;

interface RuntimeAssetKeyField {
	runtime: RuntimeAssetName;
	property: string;
	key: string;
	serialize?: (value: unknown) => string | boolean;
}

const hasValue = (value: unknown) => !!value;

const joinStringList = (value: unknown) => (Array.isArray(value) ? value.join('\0') : '');

const joinSortedStringList = (value: unknown) =>
	Array.isArray(value) ? [...value].sort().join('\0') : '';

const serializeIntegrity = (value: unknown) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([asset, entry]) => {
			if (typeof entry === 'string') return [asset, entry];
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [asset, ''];
			const metadata = entry as Record<string, unknown>;
			return [
				asset,
				{
					sha256: typeof metadata.sha256 === 'string' ? metadata.sha256 : '',
					bytes: typeof metadata.bytes === 'number' ? metadata.bytes : undefined,
					mediaType:
						typeof metadata.mediaType === 'string' ? metadata.mediaType : undefined
				}
			];
		});
	return JSON.stringify(entries);
};

const loaderIdentities = new WeakMap<object, string>();
let nextLoaderIdentity = 0;

const LOADER_RUNTIMES = ['python', 'java', 'clang', 'clangd'] as const;

const RUNTIME_ASSET_KEY_FIELDS = [
	{ runtime: 'python', property: 'baseUrl', key: 'pythonBaseUrl' },
	{ runtime: 'python', property: 'loader', key: 'hasPythonLoader', serialize: hasValue },
	{
		runtime: 'python',
		property: 'integrity',
		key: 'pythonIntegrity',
		serialize: serializeIntegrity
	},
	{
		runtime: 'python',
		property: 'allowedBaseUrls',
		key: 'pythonAllowedBaseUrls',
		serialize: joinSortedStringList
	},
	{ runtime: 'java', property: 'baseUrl', key: 'javaBaseUrl' },
	{ runtime: 'java', property: 'loader', key: 'hasJavaLoader', serialize: hasValue },
	{ runtime: 'java', property: 'integrity', key: 'javaIntegrity', serialize: serializeIntegrity },
	{
		runtime: 'java',
		property: 'allowedBaseUrls',
		key: 'javaAllowedBaseUrls',
		serialize: joinSortedStringList
	},
	{ runtime: 'clang', property: 'baseUrl', key: 'clangBaseUrl' },
	{ runtime: 'clang', property: 'loader', key: 'hasClangLoader', serialize: hasValue },
	{
		runtime: 'clang',
		property: 'integrity',
		key: 'clangIntegrity',
		serialize: serializeIntegrity
	},
	{
		runtime: 'clang',
		property: 'allowedBaseUrls',
		key: 'clangAllowedBaseUrls',
		serialize: joinSortedStringList
	},
	{ runtime: 'clangd', property: 'baseUrl', key: 'clangdBaseUrl' },
	{ runtime: 'clangd', property: 'loader', key: 'hasClangdLoader', serialize: hasValue },
	{
		runtime: 'clangd',
		property: 'integrity',
		key: 'clangdIntegrity',
		serialize: serializeIntegrity
	},
	{
		runtime: 'clangd',
		property: 'allowedBaseUrls',
		key: 'clangdAllowedBaseUrls',
		serialize: joinSortedStringList
	},
	{ runtime: 'rust', property: 'compilerUrl', key: 'rustCompilerUrl' },
	{ runtime: 'rust', property: 'debugModuleUrl', key: 'rustDebugModuleUrl' },
	{ runtime: 'go', property: 'compilerUrl', key: 'goCompilerUrl' },
	{ runtime: 'assemblyscript', property: 'moduleUrl', key: 'assemblyScriptModuleUrl' },
	{ runtime: 'duckdb', property: 'moduleUrl', key: 'duckDbModuleUrl' },
	{ runtime: 'd', property: 'moduleUrl', key: 'dModuleUrl' },
	{ runtime: 'dotnet', property: 'moduleUrl', key: 'dotnetModuleUrl' },
	{ runtime: 'elixir', property: 'bundleUrl', key: 'elixirBundleUrl' },
	{ runtime: 'erlang', property: 'bundleUrl', key: 'erlangBundleUrl' },
	{ runtime: 'ocaml', property: 'moduleUrl', key: 'ocamlModuleUrl' },
	{ runtime: 'ocaml', property: 'manifestUrl', key: 'ocamlManifestUrl' },
	{ runtime: 'tinygo', property: 'appUrl', key: 'tinygoAppUrl' },
	{ runtime: 'tinygo', property: 'moduleUrl', key: 'tinygoModuleUrl' },
	{ runtime: 'typescript', property: 'moduleUrl', key: 'typeScriptModuleUrl' },
	{ runtime: 'wat', property: 'moduleUrl', key: 'watModuleUrl' },
	{ runtime: 'lua', property: 'moduleUrl', key: 'luaModuleUrl' },
	{ runtime: 'haskell', property: 'moduleUrl', key: 'haskellModuleUrl' },
	{ runtime: 'haskell', property: 'rootfsUrl', key: 'haskellRootfsUrl' },
	{ runtime: 'haskell', property: 'bsdtarUrl', key: 'haskellBsdtarUrl' },
	{ runtime: 'haskell', property: 'mainSoPath', key: 'haskellMainSoPath' },
	{
		runtime: 'haskell',
		property: 'searchDirs',
		key: 'haskellSearchDirs',
		serialize: joinStringList
	},
	{ runtime: 'zig', property: 'compilerUrl', key: 'zigCompilerUrl' },
	{ runtime: 'zig', property: 'stdlibUrl', key: 'zigStdlibUrl' },
	{ runtime: 'lisp', property: 'moduleUrl', key: 'lispModuleUrl' },
	{ runtime: 'ruby', property: 'moduleUrl', key: 'rubyModuleUrl' },
	{ runtime: 'ruby', property: 'wasmUrl', key: 'rubyWasmUrl' },
	{ runtime: 'r', property: 'baseUrl', key: 'rBaseUrl' },
	{ runtime: 'octave', property: 'baseUrl', key: 'octaveBaseUrl' },
	{ runtime: 'octave', property: 'workerUrl', key: 'octaveWorkerUrl' },
	{ runtime: 'octave', property: 'manifestUrl', key: 'octaveManifestUrl' },
	{ runtime: 'prolog', property: 'baseUrl', key: 'prologBaseUrl' },
	{ runtime: 'prolog', property: 'workerUrl', key: 'prologWorkerUrl' },
	{ runtime: 'gleam', property: 'baseUrl', key: 'gleamBaseUrl' },
	{ runtime: 'gleam', property: 'workerUrl', key: 'gleamWorkerUrl' },
	{ runtime: 'gleam', property: 'manifestUrl', key: 'gleamManifestUrl' },
	{ runtime: 'perl', property: 'baseUrl', key: 'perlBaseUrl' },
	{ runtime: 'perl', property: 'workerUrl', key: 'perlWorkerUrl' },
	{ runtime: 'tcl', property: 'baseUrl', key: 'tclBaseUrl' },
	{ runtime: 'tcl', property: 'workerUrl', key: 'tclWorkerUrl' },
	{ runtime: 'awk', property: 'baseUrl', key: 'awkBaseUrl' },
	{ runtime: 'awk', property: 'workerUrl', key: 'awkWorkerUrl' },
	{ runtime: 'pascal', property: 'baseUrl', key: 'pascalBaseUrl' },
	{ runtime: 'pascal', property: 'workerUrl', key: 'pascalWorkerUrl' },
	{ runtime: 'forth', property: 'baseUrl', key: 'forthBaseUrl' },
	{ runtime: 'forth', property: 'workerUrl', key: 'forthWorkerUrl' },
	{ runtime: 'j', property: 'baseUrl', key: 'jBaseUrl' },
	{ runtime: 'j', property: 'workerUrl', key: 'jWorkerUrl' },
	{ runtime: 'bqn', property: 'baseUrl', key: 'bqnBaseUrl' },
	{ runtime: 'bqn', property: 'workerUrl', key: 'bqnWorkerUrl' },
	{ runtime: 'janet', property: 'baseUrl', key: 'janetBaseUrl' },
	{ runtime: 'janet', property: 'workerUrl', key: 'janetWorkerUrl' },
	{ runtime: 'julia', property: 'baseUrl', key: 'juliaBaseUrl' },
	{ runtime: 'julia', property: 'workerUrl', key: 'juliaWorkerUrl' },
	{ runtime: 'nim', property: 'baseUrl', key: 'nimBaseUrl' },
	{ runtime: 'nim', property: 'workerUrl', key: 'nimWorkerUrl' },
	{ runtime: 'bash', property: 'moduleUrl', key: 'bashModuleUrl' },
	{ runtime: 'bash', property: 'webcUrl', key: 'bashWebcUrl' },
	{ runtime: 'bash', property: 'workerUrl', key: 'bashWorkerUrl' },
	{ runtime: 'clojurescript', property: 'baseUrl', key: 'clojurescriptBaseUrl' },
	{ runtime: 'clojurescript', property: 'workerUrl', key: 'clojurescriptWorkerUrl' },
	{ runtime: 'cobol', property: 'baseUrl', key: 'cobolBaseUrl' },
	{ runtime: 'swift', property: 'baseUrl', key: 'swiftBaseUrl' },
	{ runtime: 'swift', property: 'workerUrl', key: 'swiftWorkerUrl' },
	{ runtime: 'swift', property: 'manifestUrl', key: 'swiftManifestUrl' },
	{ runtime: 'sqlite', property: 'moduleUrl', key: 'sqliteModuleUrl' },
	{ runtime: 'sqlite', property: 'wasmUrl', key: 'sqliteWasmUrl' },
	{ runtime: 'php', property: 'moduleUrl', key: 'phpModuleUrl' }
] satisfies RuntimeAssetKeyField[];

const runtimeAssetRecord = (runtimeAssets: RuntimeAssetKeySource, runtime: RuntimeAssetName) =>
	runtimeAssets[runtime] as Record<string, unknown> | undefined;

const readRuntimeAssetKeyField = (
	runtimeAssets: RuntimeAssetKeySource,
	field: RuntimeAssetKeyField
) => {
	const value = runtimeAssetRecord(runtimeAssets, field.runtime)?.[field.property];
	if (field.serialize) return field.serialize(value);
	return typeof value === 'string' ? value : '';
};

export function createRuntimeAssetsKey(runtimeAssets: RuntimeAssetKeyInput): string | undefined {
	if (typeof runtimeAssets === 'string') return runtimeAssets;
	if (!runtimeAssets) return undefined;
	const keyParts: Record<string, string | boolean> = {
		rootUrl: runtimeAssets.rootUrl || ''
	};
	const runtimeProfiles: Array<[string, RuntimeAssetProfileKeySource]> = [];
	for (const [runtimeId, profile] of Object.entries(runtimeAssets.runtimeProfiles || {}).sort(
		([left], [right]) => left.localeCompare(right)
	)) {
		if (!runtimeId.trim() || !profile || typeof profile !== 'object') {
			throw new TypeError(
				'Runtime profile entries require a non-empty runtime ID and profile'
			);
		}
		if (typeof profile.profileId !== 'string' || !profile.profileId.trim()) {
			throw new TypeError(`Runtime profile ${runtimeId} requires a non-empty profile ID`);
		}
		if (
			!Number.isSafeInteger(profile.manifestSchemaVersion) ||
			profile.manifestSchemaVersion < 1
		) {
			throw new TypeError(
				`Runtime profile ${runtimeId} has an invalid manifest schema version`
			);
		}
		if (
			typeof profile.manifestSha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(profile.manifestSha256)
		) {
			throw new TypeError(`Runtime profile ${runtimeId} has an invalid manifest SHA-256`);
		}
		if (!Number.isSafeInteger(profile.protocolVersion) || profile.protocolVersion < 1) {
			throw new TypeError(`Runtime profile ${runtimeId} has an invalid protocol version`);
		}
		const hasTrustProfileId = profile.trustProfileId !== undefined;
		const hasTrustProfileSchemaVersion = profile.trustProfileSchemaVersion !== undefined;
		if (hasTrustProfileId !== hasTrustProfileSchemaVersion) {
			throw new TypeError(
				`Runtime profile ${runtimeId} requires both trust profile ID and schema version`
			);
		}
		if (
			hasTrustProfileId &&
			(typeof profile.trustProfileId !== 'string' ||
				!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(profile.trustProfileId))
		) {
			throw new TypeError(`Runtime profile ${runtimeId} has an invalid trust profile ID`);
		}
		if (
			hasTrustProfileSchemaVersion &&
			(!Number.isSafeInteger(profile.trustProfileSchemaVersion) ||
				(profile.trustProfileSchemaVersion ?? 0) < 1)
		) {
			throw new TypeError(
				`Runtime profile ${runtimeId} has an invalid trust profile schema version`
			);
		}
		runtimeProfiles.push([
			runtimeId,
			{
				profileId: profile.profileId,
				manifestSchemaVersion: profile.manifestSchemaVersion,
				manifestSha256: profile.manifestSha256,
				protocolVersion: profile.protocolVersion,
				trustProfileId: profile.trustProfileId,
				trustProfileSchemaVersion: profile.trustProfileSchemaVersion
			}
		]);
	}
	keyParts.runtimeProfiles = JSON.stringify(runtimeProfiles);
	for (const field of RUNTIME_ASSET_KEY_FIELDS) {
		keyParts[field.key] = readRuntimeAssetKeyField(runtimeAssets, field);
	}
	for (const runtime of LOADER_RUNTIMES) {
		const config = runtimeAssetRecord(runtimeAssets, runtime);
		const loader = config?.loader;
		let identity = '';
		if ((typeof loader === 'object' && loader !== null) || typeof loader === 'function') {
			const explicitKey = typeof config?.loaderKey === 'string' ? config.loaderKey : '';
			if (explicitKey) {
				identity = `key:${explicitKey}`;
			} else {
				identity = loaderIdentities.get(loader) || '';
				if (!identity) {
					identity = `instance:${++nextLoaderIdentity}`;
					loaderIdentities.set(loader, identity);
				}
			}
		}
		keyParts[`${runtime}LoaderIdentity`] = identity;
	}
	return JSON.stringify(keyParts);
}
