export const RUBY_RUNTIME_ASSET_PATH = 'assets/ruby_stdlib-C40Yu-vu.wasm';

export const RUBY_RUNTIME_ASSET_NAMES = ['runtime.mjs', RUBY_RUNTIME_ASSET_PATH] as const;

export type RubyRuntimeAssetName = (typeof RUBY_RUNTIME_ASSET_NAMES)[number];
export interface RubyRuntimeAssetReceipt {
	bytes: number;
	sha256: string;
}
export type RubyRuntimeAssetReceipts = Readonly<
	Record<RubyRuntimeAssetName, Readonly<RubyRuntimeAssetReceipt>>
>;

export const RUBY_RUNTIME_ASSET_VERSION =
	'34cc30cd5a0e8b3381460aeb7891165c2b90a4dbb87c9e9a8c7483ae85875dbf';

export const RUBY_RUNTIME_ASSET_RECEIPTS = Object.freeze({
	'runtime.mjs': Object.freeze({
		bytes: 54_623,
		sha256: 'd832ed230a34df7db0a7ed823d4fc974fb532b532e0b0de0ad76033acec05b71'
	}),
	[RUBY_RUNTIME_ASSET_PATH]: Object.freeze({
		bytes: 30_608_059,
		sha256: '81bc8bbb2130ea34f30826e03d850661bb6cb1c7fe72be598584f12b2810c9de'
	})
}) satisfies RubyRuntimeAssetReceipts;

const snapshotRubyRuntimeAssetReceipt = (
	asset: RubyRuntimeAssetName,
	value: unknown
): Readonly<RubyRuntimeAssetReceipt> => {
	if (!value || typeof value !== 'object') {
		throw new TypeError(`Ruby runtime receipt is invalid for ${asset}`);
	}
	const receipt = value as Partial<RubyRuntimeAssetReceipt>;
	const bytes = receipt.bytes;
	const sha256 = receipt.sha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256)
	) {
		throw new TypeError(`Ruby runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
};

export function snapshotRubyRuntimeAssetReceipts(
	value: unknown = RUBY_RUNTIME_ASSET_RECEIPTS
): RubyRuntimeAssetReceipts {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Ruby runtime integrity must describe exactly two assets');
	}
	const receivedNames = Object.keys(value).sort();
	const expectedNames = [...RUBY_RUNTIME_ASSET_NAMES].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('Ruby runtime integrity must describe exactly two assets');
	}
	const receipts = value as Record<RubyRuntimeAssetName, unknown>;
	const moduleReceipt = receipts['runtime.mjs'];
	const wasmReceipt = receipts[RUBY_RUNTIME_ASSET_PATH];
	return Object.freeze({
		'runtime.mjs': snapshotRubyRuntimeAssetReceipt('runtime.mjs', moduleReceipt),
		[RUBY_RUNTIME_ASSET_PATH]: snapshotRubyRuntimeAssetReceipt(
			RUBY_RUNTIME_ASSET_PATH,
			wasmReceipt
		)
	});
}

export function deriveRubyRuntimeWasmUrl(moduleUrl: string, currentUrl = '') {
	const configuredModuleUrl = moduleUrl.trim();
	if (!configuredModuleUrl) {
		throw new TypeError('Ruby runtime module URL is required');
	}
	try {
		const module = currentUrl
			? new URL(configuredModuleUrl, currentUrl)
			: new URL(configuredModuleUrl);
		const wasm = new URL(RUBY_RUNTIME_ASSET_PATH, module);
		wasm.search = module.search;
		return wasm.href;
	} catch (error) {
		if (
			currentUrl ||
			(!configuredModuleUrl.startsWith('/') && !configuredModuleUrl.startsWith('./'))
		) {
			throw new TypeError('Ruby runtime module URL must be absolute or root-relative', {
				cause: error
			});
		}
		const hashIndex = configuredModuleUrl.indexOf('#');
		if (hashIndex !== -1) {
			throw new TypeError('Ruby runtime module URL must not include a fragment');
		}
		const queryIndex = configuredModuleUrl.indexOf('?');
		const modulePath =
			queryIndex === -1 ? configuredModuleUrl : configuredModuleUrl.slice(0, queryIndex);
		const query = queryIndex === -1 ? '' : configuredModuleUrl.slice(queryIndex);
		const separator = modulePath.lastIndexOf('/');
		return `${modulePath.slice(0, separator + 1)}${RUBY_RUNTIME_ASSET_PATH}${query}`;
	}
}
