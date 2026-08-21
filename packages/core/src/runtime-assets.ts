export interface RuntimeAssetIntegrityEntry {
	sha256: string;
	bytes?: number;
	mediaType?: string;
	uncompressedSha256?: string;
	uncompressedBytes?: number;
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

export interface RuntimeAssetPackKeySource {
	index: string;
	asset: string;
	fileCount: number;
	totalBytes: number;
}

export interface RuntimeAssetKeySource {
	rootUrl?: string;
	runtimeProfiles?: Readonly<Record<string, RuntimeAssetProfileKeySource>>;
	python?: RuntimeAssetLoaderKeySource;
	java?: RuntimeAssetLoaderKeySource;
	clang?: RuntimeAssetLoaderKeySource;
	clangd?: RuntimeAssetLoaderKeySource;
	rust?: { compilerUrl?: string; manifestUrl?: string; debugModuleUrl?: string };
	go?: { compilerUrl?: string; manifestUrl?: string };
	assemblyscript?: { moduleUrl?: string };
	duckdb?: { moduleUrl?: string };
	d?: {
		moduleUrl?: string;
		manifestUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
	};
	dotnet?: { moduleUrl?: string };
	elixir?: { bundleUrl?: string; integrity?: RuntimeAssetIntegrityMap };
	erlang?: { bundleUrl?: string; integrity?: RuntimeAssetIntegrityMap };
	ocaml?: { moduleUrl?: string; manifestUrl?: string };
	tinygo?: {
		appUrl?: string;
		moduleUrl?: string;
		assetLoader?: unknown;
		assetLoaderKey?: string;
		assetPacks?: readonly RuntimeAssetPackKeySource[];
	};
	typescript?: { moduleUrl?: string; libUrl?: string };
	wat?: { moduleUrl?: string };
	lua?: { moduleUrl?: string };
	haskell?: {
		moduleUrl?: string;
		rootfsUrl?: string;
		bsdtarUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
		mainSoPath?: string;
		searchDirs?: string[];
	};
	fortran?: {
		baseUrl?: string;
		f2cWasmUrl?: string;
		libf2cUrl?: string;
		f2cHeaderUrl?: string;
		analyzerUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
	};
	zig?: {
		compilerUrl?: string;
		stdlibUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
	};
	objectivec?: {
		baseUrl?: string;
		libobjcUrl?: string;
		headersUrl?: string;
		libgnustepBaseUrl?: string;
		libgnustepBaseObjectUrl?: string;
		foundationHeadersUrl?: string;
		libffiUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
	};
	lisp?: { moduleUrl?: string; manifestUrl?: string; manifestFingerprint?: string };
	ruby?: {
		moduleUrl?: string;
		wasmUrl?: string;
		integrity?: RuntimeAssetIntegrityMap;
	};
	r?: { baseUrl?: string };
	octave?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	prolog?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		packageRevision?: string;
		swiplRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		dataReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	gleam?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	perl?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		artifactRevision?: string;
		webperlRevision?: string;
		perlRevision?: string;
		emscriptenRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		dataReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	tcl?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		artifactRevision?: string;
		waclRevision?: string;
		tclRevision?: string;
		requireJsRevision?: string;
		emscriptenRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		requireJsReceipt?: RuntimeAssetIntegrityEntry;
		customDataReceipt?: RuntimeAssetIntegrityEntry;
		libraryDataReceipt?: RuntimeAssetIntegrityEntry;
		glueReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	awk?: { baseUrl?: string; workerUrl?: string };
	pascal?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		compilerJavaScriptUrl?: string;
		rtlJavaScriptUrl?: string;
		systemPascalUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		artifactRevision?: string;
		pas2jsVersion?: string;
		pas2jsRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		compilerJavaScriptReceipt?: RuntimeAssetIntegrityEntry;
		rtlJavaScriptReceipt?: RuntimeAssetIntegrityEntry;
		systemPascalReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	forth?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		implementationVersion?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		runtimeReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	j?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		sourceRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		moduleReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	bqn?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		sourceRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		moduleReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	janet?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		artifactRevision?: string;
		janetVersion?: string;
		emscriptenVersion?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	julia?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		packageRevision?: string;
		importedByCommit?: string;
		juliaVersion?: string;
		emscriptenVersion?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		javascriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmReceipt?: RuntimeAssetIntegrityEntry;
		dataReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	nim?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		artifactRevision?: string;
		nimRevision?: string;
		llvmRevision?: string;
		memfsRevision?: string;
		emscriptenRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		nimJavaScriptReceipt?: RuntimeAssetIntegrityEntry;
		nimWasmReceipt?: RuntimeAssetIntegrityEntry;
		nimbaseReceipt?: RuntimeAssetIntegrityEntry;
		clangJavaScriptReceipt?: RuntimeAssetIntegrityEntry;
		clangWasmReceipt?: RuntimeAssetIntegrityEntry;
		lldWasmReceipt?: RuntimeAssetIntegrityEntry;
		memfsWasmReceipt?: RuntimeAssetIntegrityEntry;
		sysrootReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	bash?: {
		baseUrl?: string;
		manifestUrl?: string;
		moduleUrl?: string;
		wasmerWasmUrl?: string;
		webcUrl?: string;
		workerUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		bashPackageVersion?: string;
		bashSourceRevision?: string;
		wasmerSdkVersion?: string;
		wasmerSdkPackageIntegrity?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		sdkJavaScriptReceipt?: RuntimeAssetIntegrityEntry;
		wasmerWasmReceipt?: RuntimeAssetIntegrityEntry;
		webcReceipt?: RuntimeAssetIntegrityEntry;
	};
	clojurescript?: {
		baseUrl?: string;
		workerUrl?: string;
		manifestUrl?: string;
		manifestFingerprint?: string;
		profileId?: string;
		sourceRevision?: string;
		integrationRevision?: string;
		manifestReceipt?: RuntimeAssetIntegrityEntry;
		compilerReceipt?: RuntimeAssetIntegrityEntry;
		workerReceipt?: RuntimeAssetIntegrityEntry;
	};
	cobol?: { baseUrl?: string };
	swift?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	sqlite?: { moduleUrl?: string; wasmUrl?: string };
	php?: { moduleUrl?: string };
}

export type RuntimeAssetKeyInput = string | RuntimeAssetKeySource | undefined;

type RuntimeAssetName = Exclude<keyof RuntimeAssetKeySource, 'rootUrl' | 'runtimeProfiles'>;

type RuntimeAssetProperty<Runtime extends RuntimeAssetName> = Extract<
	keyof NonNullable<RuntimeAssetKeySource[Runtime]>,
	string
>;

type RuntimeAssetKeyField = {
	[Runtime in RuntimeAssetName]: {
		runtime: Runtime;
		property: RuntimeAssetProperty<Runtime>;
		key: string;
		serialize?: (value: unknown) => string | boolean;
	};
}[RuntimeAssetName];

type RuntimeAssetLoaderField = {
	[Runtime in RuntimeAssetName]: {
		runtime: Runtime;
		loaderProperty: RuntimeAssetProperty<Runtime>;
		loaderKeyProperty: RuntimeAssetProperty<Runtime>;
		identityKey: string;
	};
}[RuntimeAssetName];

type RuntimeAssetFieldId<Field> = Field extends {
	runtime: infer Runtime extends RuntimeAssetName;
	property: infer Property extends string;
}
	? `${Runtime}.${Property}`
	: never;

type RuntimeAssetLoaderFieldId<Field> = Field extends {
	runtime: infer Runtime extends RuntimeAssetName;
	loaderProperty: infer LoaderProperty extends string;
	loaderKeyProperty: infer LoaderKeyProperty extends string;
}
	? `${Runtime}.${LoaderProperty}` | `${Runtime}.${LoaderKeyProperty}`
	: never;

type RequiredRuntimeAssetFieldId = {
	[Runtime in RuntimeAssetName]: `${Runtime}.${RuntimeAssetProperty<Runtime>}`;
}[RuntimeAssetName];

const hasValue = (value: unknown) => !!value;

const joinStringList = (value: unknown) => (Array.isArray(value) ? value.join('\0') : '');

const joinSortedStringList = (value: unknown) =>
	Array.isArray(value) ? [...value].sort().join('\0') : '';

const serializeRuntimeAssetPacks = (value: unknown) => {
	if (value === undefined) return '';
	if (!Array.isArray(value)) throw new TypeError('Runtime asset packs must be an array');
	return JSON.stringify(
		value.map((entry, position) => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new TypeError(`Runtime asset pack ${position} must be an object`);
			}
			const pack = entry as Record<string, unknown>;
			if (typeof pack.index !== 'string' || !pack.index) {
				throw new TypeError(`Runtime asset pack ${position} requires an index`);
			}
			if (typeof pack.asset !== 'string' || !pack.asset) {
				throw new TypeError(`Runtime asset pack ${position} requires an asset`);
			}
			if (!Number.isSafeInteger(pack.fileCount) || (pack.fileCount as number) < 0) {
				throw new TypeError(`Runtime asset pack ${position} has an invalid file count`);
			}
			if (!Number.isSafeInteger(pack.totalBytes) || (pack.totalBytes as number) < 0) {
				throw new TypeError(`Runtime asset pack ${position} has an invalid byte size`);
			}
			return {
				index: pack.index,
				asset: pack.asset,
				fileCount: pack.fileCount,
				totalBytes: pack.totalBytes
			};
		})
	);
};

const serializeIntegrity = (value: unknown) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([asset, entry]) => {
			if (
				asset.startsWith('/') ||
				asset.includes('\\') ||
				asset.includes('\0') ||
				asset.includes('?') ||
				asset.includes('#') ||
				asset.split('/').some((segment) => !segment || segment === '.' || segment === '..')
			) {
				throw new TypeError(
					`Runtime integrity asset key must be normalized and relative: ${asset}`
				);
			}
			if (typeof entry === 'string') {
				if (!/^[a-f0-9]{64}$/u.test(entry)) {
					throw new TypeError(`Runtime integrity entry ${asset} has an invalid SHA-256`);
				}
				return [asset, entry];
			}
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new TypeError(
					`Runtime integrity entry ${asset} must be a digest or metadata object`
				);
			}
			const metadata = entry as Record<string, unknown>;
			if (typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.sha256)) {
				throw new TypeError(`Runtime integrity entry ${asset} has an invalid SHA-256`);
			}
			if (
				metadata.bytes !== undefined &&
				(!Number.isSafeInteger(metadata.bytes) || (metadata.bytes as number) < 0)
			) {
				throw new TypeError(`Runtime integrity entry ${asset} has an invalid byte size`);
			}
			if (
				metadata.mediaType !== undefined &&
				(typeof metadata.mediaType !== 'string' || !metadata.mediaType.includes('/'))
			) {
				throw new TypeError(`Runtime integrity entry ${asset} has an invalid media type`);
			}
			const hasUncompressedSha256 = metadata.uncompressedSha256 !== undefined;
			const hasUncompressedBytes = metadata.uncompressedBytes !== undefined;
			if (hasUncompressedSha256 !== hasUncompressedBytes) {
				throw new TypeError(
					`Runtime integrity entry ${asset} requires both uncompressed digest and size`
				);
			}
			if (
				hasUncompressedSha256 &&
				(typeof metadata.uncompressedSha256 !== 'string' ||
					!/^[a-f0-9]{64}$/u.test(metadata.uncompressedSha256))
			) {
				throw new TypeError(
					`Runtime integrity entry ${asset} has an invalid uncompressed SHA-256`
				);
			}
			if (
				hasUncompressedBytes &&
				(!Number.isSafeInteger(metadata.uncompressedBytes) ||
					(metadata.uncompressedBytes as number) < 0)
			) {
				throw new TypeError(
					`Runtime integrity entry ${asset} has an invalid uncompressed byte size`
				);
			}
			return [
				asset,
				{
					sha256: metadata.sha256,
					bytes: typeof metadata.bytes === 'number' ? metadata.bytes : undefined,
					mediaType:
						typeof metadata.mediaType === 'string' ? metadata.mediaType : undefined,
					uncompressedSha256:
						typeof metadata.uncompressedSha256 === 'string'
							? metadata.uncompressedSha256
							: undefined,
					uncompressedBytes:
						typeof metadata.uncompressedBytes === 'number'
							? metadata.uncompressedBytes
							: undefined
				}
			];
		});
	return JSON.stringify(entries);
};

const serializeIntegrityEntry = (value: unknown) =>
	value === undefined ? '' : serializeIntegrity({ worker: value });

const loaderIdentities = new WeakMap<object, string>();
let nextLoaderIdentity = 0;

const RUNTIME_ASSET_LOADER_FIELDS = [
	{
		runtime: 'python',
		loaderProperty: 'loader',
		loaderKeyProperty: 'loaderKey',
		identityKey: 'pythonLoaderIdentity'
	},
	{
		runtime: 'java',
		loaderProperty: 'loader',
		loaderKeyProperty: 'loaderKey',
		identityKey: 'javaLoaderIdentity'
	},
	{
		runtime: 'clang',
		loaderProperty: 'loader',
		loaderKeyProperty: 'loaderKey',
		identityKey: 'clangLoaderIdentity'
	},
	{
		runtime: 'clangd',
		loaderProperty: 'loader',
		loaderKeyProperty: 'loaderKey',
		identityKey: 'clangdLoaderIdentity'
	},
	{
		runtime: 'tinygo',
		loaderProperty: 'assetLoader',
		loaderKeyProperty: 'assetLoaderKey',
		identityKey: 'tinygoAssetLoaderIdentity'
	}
] as const satisfies readonly RuntimeAssetLoaderField[];

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
	{ runtime: 'rust', property: 'manifestUrl', key: 'rustManifestUrl' },
	{ runtime: 'rust', property: 'debugModuleUrl', key: 'rustDebugModuleUrl' },
	{ runtime: 'go', property: 'compilerUrl', key: 'goCompilerUrl' },
	{ runtime: 'go', property: 'manifestUrl', key: 'goManifestUrl' },
	{ runtime: 'assemblyscript', property: 'moduleUrl', key: 'assemblyScriptModuleUrl' },
	{ runtime: 'duckdb', property: 'moduleUrl', key: 'duckDbModuleUrl' },
	{ runtime: 'd', property: 'moduleUrl', key: 'dModuleUrl' },
	{ runtime: 'd', property: 'manifestUrl', key: 'dManifestUrl' },
	{
		runtime: 'd',
		property: 'integrity',
		key: 'dIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'dotnet', property: 'moduleUrl', key: 'dotnetModuleUrl' },
	{ runtime: 'elixir', property: 'bundleUrl', key: 'elixirBundleUrl' },
	{
		runtime: 'elixir',
		property: 'integrity',
		key: 'elixirIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'erlang', property: 'bundleUrl', key: 'erlangBundleUrl' },
	{
		runtime: 'erlang',
		property: 'integrity',
		key: 'erlangIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'ocaml', property: 'moduleUrl', key: 'ocamlModuleUrl' },
	{ runtime: 'ocaml', property: 'manifestUrl', key: 'ocamlManifestUrl' },
	{ runtime: 'tinygo', property: 'appUrl', key: 'tinygoAppUrl' },
	{ runtime: 'tinygo', property: 'moduleUrl', key: 'tinygoModuleUrl' },
	{
		runtime: 'tinygo',
		property: 'assetLoader',
		key: 'hasTinyGoAssetLoader',
		serialize: hasValue
	},
	{
		runtime: 'tinygo',
		property: 'assetPacks',
		key: 'tinygoAssetPacks',
		serialize: serializeRuntimeAssetPacks
	},
	{ runtime: 'typescript', property: 'moduleUrl', key: 'typeScriptModuleUrl' },
	{ runtime: 'typescript', property: 'libUrl', key: 'typeScriptLibUrl' },
	{ runtime: 'wat', property: 'moduleUrl', key: 'watModuleUrl' },
	{ runtime: 'lua', property: 'moduleUrl', key: 'luaModuleUrl' },
	{ runtime: 'haskell', property: 'moduleUrl', key: 'haskellModuleUrl' },
	{ runtime: 'haskell', property: 'rootfsUrl', key: 'haskellRootfsUrl' },
	{ runtime: 'haskell', property: 'bsdtarUrl', key: 'haskellBsdtarUrl' },
	{
		runtime: 'haskell',
		property: 'integrity',
		key: 'haskellIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'haskell', property: 'mainSoPath', key: 'haskellMainSoPath' },
	{
		runtime: 'haskell',
		property: 'searchDirs',
		key: 'haskellSearchDirs',
		serialize: joinStringList
	},
	{ runtime: 'fortran', property: 'baseUrl', key: 'fortranBaseUrl' },
	{ runtime: 'fortran', property: 'f2cWasmUrl', key: 'fortranF2cWasmUrl' },
	{ runtime: 'fortran', property: 'libf2cUrl', key: 'fortranLibf2cUrl' },
	{ runtime: 'fortran', property: 'f2cHeaderUrl', key: 'fortranF2cHeaderUrl' },
	{ runtime: 'fortran', property: 'analyzerUrl', key: 'fortranAnalyzerUrl' },
	{
		runtime: 'fortran',
		property: 'integrity',
		key: 'fortranIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'zig', property: 'compilerUrl', key: 'zigCompilerUrl' },
	{ runtime: 'zig', property: 'stdlibUrl', key: 'zigStdlibUrl' },
	{
		runtime: 'zig',
		property: 'integrity',
		key: 'zigIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'objectivec', property: 'baseUrl', key: 'objectiveCBaseUrl' },
	{ runtime: 'objectivec', property: 'libobjcUrl', key: 'objectiveCLibobjcUrl' },
	{ runtime: 'objectivec', property: 'headersUrl', key: 'objectiveCHeadersUrl' },
	{
		runtime: 'objectivec',
		property: 'libgnustepBaseUrl',
		key: 'objectiveCLibgnustepBaseUrl'
	},
	{
		runtime: 'objectivec',
		property: 'libgnustepBaseObjectUrl',
		key: 'objectiveCLibgnustepBaseObjectUrl'
	},
	{
		runtime: 'objectivec',
		property: 'foundationHeadersUrl',
		key: 'objectiveCFoundationHeadersUrl'
	},
	{ runtime: 'objectivec', property: 'libffiUrl', key: 'objectiveCLibffiUrl' },
	{
		runtime: 'objectivec',
		property: 'integrity',
		key: 'objectiveCIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'lisp', property: 'moduleUrl', key: 'lispModuleUrl' },
	{ runtime: 'lisp', property: 'manifestUrl', key: 'lispManifestUrl' },
	{ runtime: 'lisp', property: 'manifestFingerprint', key: 'lispManifestFingerprint' },
	{ runtime: 'ruby', property: 'moduleUrl', key: 'rubyModuleUrl' },
	{ runtime: 'ruby', property: 'wasmUrl', key: 'rubyWasmUrl' },
	{
		runtime: 'ruby',
		property: 'integrity',
		key: 'rubyIntegrity',
		serialize: serializeIntegrity
	},
	{ runtime: 'r', property: 'baseUrl', key: 'rBaseUrl' },
	{ runtime: 'octave', property: 'baseUrl', key: 'octaveBaseUrl' },
	{ runtime: 'octave', property: 'workerUrl', key: 'octaveWorkerUrl' },
	{ runtime: 'octave', property: 'manifestUrl', key: 'octaveManifestUrl' },
	{ runtime: 'prolog', property: 'baseUrl', key: 'prologBaseUrl' },
	{ runtime: 'prolog', property: 'workerUrl', key: 'prologWorkerUrl' },
	{ runtime: 'prolog', property: 'manifestUrl', key: 'prologManifestUrl' },
	{
		runtime: 'prolog',
		property: 'manifestFingerprint',
		key: 'prologManifestFingerprint'
	},
	{ runtime: 'prolog', property: 'profileId', key: 'prologProfileId' },
	{ runtime: 'prolog', property: 'packageRevision', key: 'prologPackageRevision' },
	{ runtime: 'prolog', property: 'swiplRevision', key: 'prologSwiplRevision' },
	{
		runtime: 'prolog',
		property: 'manifestReceipt',
		key: 'prologManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'prolog',
		property: 'javascriptReceipt',
		key: 'prologJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'prolog',
		property: 'wasmReceipt',
		key: 'prologWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'prolog',
		property: 'dataReceipt',
		key: 'prologDataReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'prolog',
		property: 'workerReceipt',
		key: 'prologWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'gleam', property: 'baseUrl', key: 'gleamBaseUrl' },
	{ runtime: 'gleam', property: 'workerUrl', key: 'gleamWorkerUrl' },
	{ runtime: 'gleam', property: 'manifestUrl', key: 'gleamManifestUrl' },
	{
		runtime: 'gleam',
		property: 'manifestFingerprint',
		key: 'gleamManifestFingerprint'
	},
	{
		runtime: 'gleam',
		property: 'workerReceipt',
		key: 'gleamWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'perl', property: 'baseUrl', key: 'perlBaseUrl' },
	{ runtime: 'perl', property: 'workerUrl', key: 'perlWorkerUrl' },
	{ runtime: 'perl', property: 'manifestUrl', key: 'perlManifestUrl' },
	{
		runtime: 'perl',
		property: 'manifestFingerprint',
		key: 'perlManifestFingerprint'
	},
	{ runtime: 'perl', property: 'profileId', key: 'perlProfileId' },
	{ runtime: 'perl', property: 'artifactRevision', key: 'perlArtifactRevision' },
	{ runtime: 'perl', property: 'webperlRevision', key: 'perlWebperlRevision' },
	{ runtime: 'perl', property: 'perlRevision', key: 'perlPerlRevision' },
	{ runtime: 'perl', property: 'emscriptenRevision', key: 'perlEmscriptenRevision' },
	{
		runtime: 'perl',
		property: 'manifestReceipt',
		key: 'perlManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'perl',
		property: 'javascriptReceipt',
		key: 'perlJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'perl',
		property: 'wasmReceipt',
		key: 'perlWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'perl',
		property: 'dataReceipt',
		key: 'perlDataReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'perl',
		property: 'workerReceipt',
		key: 'perlWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'tcl', property: 'baseUrl', key: 'tclBaseUrl' },
	{ runtime: 'tcl', property: 'workerUrl', key: 'tclWorkerUrl' },
	{ runtime: 'tcl', property: 'manifestUrl', key: 'tclManifestUrl' },
	{
		runtime: 'tcl',
		property: 'manifestFingerprint',
		key: 'tclManifestFingerprint'
	},
	{ runtime: 'tcl', property: 'profileId', key: 'tclProfileId' },
	{ runtime: 'tcl', property: 'artifactRevision', key: 'tclArtifactRevision' },
	{ runtime: 'tcl', property: 'waclRevision', key: 'tclWaclRevision' },
	{ runtime: 'tcl', property: 'tclRevision', key: 'tclTclRevision' },
	{ runtime: 'tcl', property: 'requireJsRevision', key: 'tclRequireJsRevision' },
	{ runtime: 'tcl', property: 'emscriptenRevision', key: 'tclEmscriptenRevision' },
	{
		runtime: 'tcl',
		property: 'manifestReceipt',
		key: 'tclManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'requireJsReceipt',
		key: 'tclRequireJsReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'customDataReceipt',
		key: 'tclCustomDataReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'libraryDataReceipt',
		key: 'tclLibraryDataReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'glueReceipt',
		key: 'tclGlueReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'wasmReceipt',
		key: 'tclWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'tcl',
		property: 'workerReceipt',
		key: 'tclWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'awk', property: 'baseUrl', key: 'awkBaseUrl' },
	{ runtime: 'awk', property: 'workerUrl', key: 'awkWorkerUrl' },
	{ runtime: 'pascal', property: 'baseUrl', key: 'pascalBaseUrl' },
	{ runtime: 'pascal', property: 'workerUrl', key: 'pascalWorkerUrl' },
	{ runtime: 'pascal', property: 'manifestUrl', key: 'pascalManifestUrl' },
	{
		runtime: 'pascal',
		property: 'compilerJavaScriptUrl',
		key: 'pascalCompilerJavaScriptUrl'
	},
	{ runtime: 'pascal', property: 'rtlJavaScriptUrl', key: 'pascalRtlJavaScriptUrl' },
	{ runtime: 'pascal', property: 'systemPascalUrl', key: 'pascalSystemPascalUrl' },
	{
		runtime: 'pascal',
		property: 'manifestFingerprint',
		key: 'pascalManifestFingerprint'
	},
	{ runtime: 'pascal', property: 'profileId', key: 'pascalProfileId' },
	{ runtime: 'pascal', property: 'artifactRevision', key: 'pascalArtifactRevision' },
	{ runtime: 'pascal', property: 'pas2jsVersion', key: 'pascalPas2jsVersion' },
	{ runtime: 'pascal', property: 'pas2jsRevision', key: 'pascalPas2jsRevision' },
	{
		runtime: 'pascal',
		property: 'manifestReceipt',
		key: 'pascalManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'pascal',
		property: 'compilerJavaScriptReceipt',
		key: 'pascalCompilerJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'pascal',
		property: 'rtlJavaScriptReceipt',
		key: 'pascalRtlJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'pascal',
		property: 'systemPascalReceipt',
		key: 'pascalSystemPascalReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'pascal',
		property: 'workerReceipt',
		key: 'pascalWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'forth', property: 'baseUrl', key: 'forthBaseUrl' },
	{ runtime: 'forth', property: 'workerUrl', key: 'forthWorkerUrl' },
	{ runtime: 'forth', property: 'manifestUrl', key: 'forthManifestUrl' },
	{
		runtime: 'forth',
		property: 'manifestFingerprint',
		key: 'forthManifestFingerprint'
	},
	{ runtime: 'forth', property: 'profileId', key: 'forthProfileId' },
	{
		runtime: 'forth',
		property: 'implementationVersion',
		key: 'forthImplementationVersion'
	},
	{
		runtime: 'forth',
		property: 'manifestReceipt',
		key: 'forthManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'forth',
		property: 'runtimeReceipt',
		key: 'forthRuntimeReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'forth',
		property: 'workerReceipt',
		key: 'forthWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'j', property: 'baseUrl', key: 'jBaseUrl' },
	{ runtime: 'j', property: 'workerUrl', key: 'jWorkerUrl' },
	{ runtime: 'j', property: 'manifestUrl', key: 'jManifestUrl' },
	{
		runtime: 'j',
		property: 'manifestFingerprint',
		key: 'jManifestFingerprint'
	},
	{ runtime: 'j', property: 'profileId', key: 'jProfileId' },
	{ runtime: 'j', property: 'sourceRevision', key: 'jSourceRevision' },
	{
		runtime: 'j',
		property: 'manifestReceipt',
		key: 'jManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'j',
		property: 'moduleReceipt',
		key: 'jModuleReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'j',
		property: 'wasmReceipt',
		key: 'jWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'j',
		property: 'workerReceipt',
		key: 'jWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'bqn', property: 'baseUrl', key: 'bqnBaseUrl' },
	{ runtime: 'bqn', property: 'workerUrl', key: 'bqnWorkerUrl' },
	{ runtime: 'bqn', property: 'manifestUrl', key: 'bqnManifestUrl' },
	{
		runtime: 'bqn',
		property: 'manifestFingerprint',
		key: 'bqnManifestFingerprint'
	},
	{ runtime: 'bqn', property: 'profileId', key: 'bqnProfileId' },
	{ runtime: 'bqn', property: 'sourceRevision', key: 'bqnSourceRevision' },
	{
		runtime: 'bqn',
		property: 'manifestReceipt',
		key: 'bqnManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bqn',
		property: 'moduleReceipt',
		key: 'bqnModuleReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bqn',
		property: 'wasmReceipt',
		key: 'bqnWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bqn',
		property: 'workerReceipt',
		key: 'bqnWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'janet', property: 'baseUrl', key: 'janetBaseUrl' },
	{ runtime: 'janet', property: 'workerUrl', key: 'janetWorkerUrl' },
	{ runtime: 'janet', property: 'manifestUrl', key: 'janetManifestUrl' },
	{
		runtime: 'janet',
		property: 'manifestFingerprint',
		key: 'janetManifestFingerprint'
	},
	{ runtime: 'janet', property: 'profileId', key: 'janetProfileId' },
	{ runtime: 'janet', property: 'artifactRevision', key: 'janetArtifactRevision' },
	{ runtime: 'janet', property: 'janetVersion', key: 'janetJanetVersion' },
	{ runtime: 'janet', property: 'emscriptenVersion', key: 'janetEmscriptenVersion' },
	{
		runtime: 'janet',
		property: 'manifestReceipt',
		key: 'janetManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'janet',
		property: 'javascriptReceipt',
		key: 'janetJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'janet',
		property: 'wasmReceipt',
		key: 'janetWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'janet',
		property: 'workerReceipt',
		key: 'janetWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'julia', property: 'baseUrl', key: 'juliaBaseUrl' },
	{ runtime: 'julia', property: 'workerUrl', key: 'juliaWorkerUrl' },
	{ runtime: 'julia', property: 'manifestUrl', key: 'juliaManifestUrl' },
	{
		runtime: 'julia',
		property: 'manifestFingerprint',
		key: 'juliaManifestFingerprint'
	},
	{ runtime: 'julia', property: 'profileId', key: 'juliaProfileId' },
	{ runtime: 'julia', property: 'packageRevision', key: 'juliaPackageRevision' },
	{ runtime: 'julia', property: 'importedByCommit', key: 'juliaImportedByCommit' },
	{ runtime: 'julia', property: 'juliaVersion', key: 'juliaJuliaVersion' },
	{ runtime: 'julia', property: 'emscriptenVersion', key: 'juliaEmscriptenVersion' },
	{
		runtime: 'julia',
		property: 'manifestReceipt',
		key: 'juliaManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'julia',
		property: 'javascriptReceipt',
		key: 'juliaJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'julia',
		property: 'wasmReceipt',
		key: 'juliaWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'julia',
		property: 'dataReceipt',
		key: 'juliaDataReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'julia',
		property: 'workerReceipt',
		key: 'juliaWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'nim', property: 'baseUrl', key: 'nimBaseUrl' },
	{ runtime: 'nim', property: 'workerUrl', key: 'nimWorkerUrl' },
	{ runtime: 'nim', property: 'manifestUrl', key: 'nimManifestUrl' },
	{
		runtime: 'nim',
		property: 'manifestFingerprint',
		key: 'nimManifestFingerprint'
	},
	{ runtime: 'nim', property: 'profileId', key: 'nimProfileId' },
	{ runtime: 'nim', property: 'artifactRevision', key: 'nimArtifactRevision' },
	{ runtime: 'nim', property: 'nimRevision', key: 'nimNimRevision' },
	{ runtime: 'nim', property: 'llvmRevision', key: 'nimLlvmRevision' },
	{ runtime: 'nim', property: 'memfsRevision', key: 'nimMemfsRevision' },
	{ runtime: 'nim', property: 'emscriptenRevision', key: 'nimEmscriptenRevision' },
	{
		runtime: 'nim',
		property: 'manifestReceipt',
		key: 'nimManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'nimJavaScriptReceipt',
		key: 'nimJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'nimWasmReceipt',
		key: 'nimWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'nimbaseReceipt',
		key: 'nimNimbaseReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'clangJavaScriptReceipt',
		key: 'nimClangJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'clangWasmReceipt',
		key: 'nimClangWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'lldWasmReceipt',
		key: 'nimLldWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'memfsWasmReceipt',
		key: 'nimMemfsWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'sysrootReceipt',
		key: 'nimSysrootReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'nim',
		property: 'workerReceipt',
		key: 'nimWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'bash', property: 'baseUrl', key: 'bashBaseUrl' },
	{ runtime: 'bash', property: 'manifestUrl', key: 'bashManifestUrl' },
	{ runtime: 'bash', property: 'moduleUrl', key: 'bashModuleUrl' },
	{ runtime: 'bash', property: 'wasmerWasmUrl', key: 'bashWasmerWasmUrl' },
	{ runtime: 'bash', property: 'webcUrl', key: 'bashWebcUrl' },
	{ runtime: 'bash', property: 'workerUrl', key: 'bashWorkerUrl' },
	{ runtime: 'bash', property: 'manifestFingerprint', key: 'bashManifestFingerprint' },
	{ runtime: 'bash', property: 'profileId', key: 'bashProfileId' },
	{ runtime: 'bash', property: 'bashPackageVersion', key: 'bashPackageVersion' },
	{ runtime: 'bash', property: 'bashSourceRevision', key: 'bashSourceRevision' },
	{ runtime: 'bash', property: 'wasmerSdkVersion', key: 'bashWasmerSdkVersion' },
	{
		runtime: 'bash',
		property: 'wasmerSdkPackageIntegrity',
		key: 'bashWasmerSdkPackageIntegrity'
	},
	{
		runtime: 'bash',
		property: 'manifestReceipt',
		key: 'bashManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bash',
		property: 'sdkJavaScriptReceipt',
		key: 'bashSdkJavaScriptReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bash',
		property: 'wasmerWasmReceipt',
		key: 'bashWasmerWasmReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'bash',
		property: 'webcReceipt',
		key: 'bashWebcReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'clojurescript', property: 'baseUrl', key: 'clojurescriptBaseUrl' },
	{ runtime: 'clojurescript', property: 'workerUrl', key: 'clojurescriptWorkerUrl' },
	{ runtime: 'clojurescript', property: 'manifestUrl', key: 'clojurescriptManifestUrl' },
	{
		runtime: 'clojurescript',
		property: 'manifestFingerprint',
		key: 'clojurescriptManifestFingerprint'
	},
	{ runtime: 'clojurescript', property: 'profileId', key: 'clojurescriptProfileId' },
	{
		runtime: 'clojurescript',
		property: 'sourceRevision',
		key: 'clojurescriptSourceRevision'
	},
	{
		runtime: 'clojurescript',
		property: 'integrationRevision',
		key: 'clojurescriptIntegrationRevision'
	},
	{
		runtime: 'clojurescript',
		property: 'manifestReceipt',
		key: 'clojurescriptManifestReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'clojurescript',
		property: 'compilerReceipt',
		key: 'clojurescriptCompilerReceipt',
		serialize: serializeIntegrityEntry
	},
	{
		runtime: 'clojurescript',
		property: 'workerReceipt',
		key: 'clojurescriptWorkerReceipt',
		serialize: serializeIntegrityEntry
	},
	{ runtime: 'cobol', property: 'baseUrl', key: 'cobolBaseUrl' },
	{ runtime: 'swift', property: 'baseUrl', key: 'swiftBaseUrl' },
	{ runtime: 'swift', property: 'workerUrl', key: 'swiftWorkerUrl' },
	{ runtime: 'swift', property: 'manifestUrl', key: 'swiftManifestUrl' },
	{ runtime: 'sqlite', property: 'moduleUrl', key: 'sqliteModuleUrl' },
	{ runtime: 'sqlite', property: 'wasmUrl', key: 'sqliteWasmUrl' },
	{ runtime: 'php', property: 'moduleUrl', key: 'phpModuleUrl' }
] as const satisfies readonly RuntimeAssetKeyField[];

type MissingRuntimeAssetField = Exclude<
	RequiredRuntimeAssetFieldId,
	| RuntimeAssetFieldId<(typeof RUNTIME_ASSET_KEY_FIELDS)[number]>
	| RuntimeAssetLoaderFieldId<(typeof RUNTIME_ASSET_LOADER_FIELDS)[number]>
>;

const RUNTIME_ASSET_FIELD_COVERAGE: [MissingRuntimeAssetField] extends [never] ? true : never =
	true;

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
	void RUNTIME_ASSET_FIELD_COVERAGE;
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
	for (const field of RUNTIME_ASSET_LOADER_FIELDS) {
		const config = runtimeAssetRecord(runtimeAssets, field.runtime);
		const loader = config?.[field.loaderProperty];
		let identity = '';
		if ((typeof loader === 'object' && loader !== null) || typeof loader === 'function') {
			const loaderKey = config?.[field.loaderKeyProperty];
			const explicitKey = typeof loaderKey === 'string' ? loaderKey : '';
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
		keyParts[field.identityKey] = identity;
	}
	return JSON.stringify(keyParts);
}
