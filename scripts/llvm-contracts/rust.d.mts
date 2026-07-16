export declare const RUST_LLVM_PROFILE: Readonly<{
	id: 'rustc-llvm-worker';
	version: 2;
	rustVersion: '1.79.0-dev-browser-split-v3';
	rustcLlvmVersion: '18.1.3';
	rustcLlvmCommit: 'af8f9eb15a2fc282f2ec1f34cd75c16c69ab9982';
	browserLlvmVersion: '16.0.4';
	browserLlvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07';
	llvmVersion: '16.0.4';
	llvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07';
	manifest: 'runtime/runtime-manifest.v3.json';
	requiredAssets: readonly [
		'runtime/rustc/rustc.wasm.gz',
		'runtime/llvm/llc.js',
		'runtime/llvm/llc.wasm.gz',
		'runtime/llvm/lld.js'
	];
	optionalLldAssets: readonly ['runtime/llvm/lld.wasm.gz', 'runtime/llvm/lld.data.gz'];
}>;
export declare const RUST_INTEGRATED_PROFILE: Readonly<{
	id: 'rustc-integrated-llvm';
	version: 1;
	rustVersion: '1.99.0-browser-integrated-v1';
	rustcLlvmVersion: '22.1.8';
	manifest: 'runtime/runtime-manifest.v3.json';
}>;
export declare function validateRustRuntimeProfile(sourceDir: string): Promise<
	| {
			profile: Readonly<{
				id: 'rustc-integrated-llvm';
				version: 1;
				rustVersion: '1.99.0-browser-integrated-v1';
				rustcLlvmVersion: '22.1.8';
				manifest: 'runtime/runtime-manifest.v3.json';
			}>;
			manifestPath: string;
			llvmAssetDir: null;
			hasEmscriptenLld: boolean;
	  }
	| {
			profile: Readonly<{
				id: 'rustc-llvm-worker';
				version: 2;
				rustVersion: '1.79.0-dev-browser-split-v3';
				rustcLlvmVersion: '18.1.3';
				rustcLlvmCommit: 'af8f9eb15a2fc282f2ec1f34cd75c16c69ab9982';
				browserLlvmVersion: '16.0.4';
				browserLlvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07';
				llvmVersion: '16.0.4';
				llvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07';
				manifest: 'runtime/runtime-manifest.v3.json';
				requiredAssets: readonly [
					'runtime/rustc/rustc.wasm.gz',
					'runtime/llvm/llc.js',
					'runtime/llvm/llc.wasm.gz',
					'runtime/llvm/lld.js'
				];
				optionalLldAssets: readonly [
					'runtime/llvm/lld.wasm.gz',
					'runtime/llvm/lld.data.gz'
				];
			}>;
			manifestPath: string;
			llvmAssetDir: string;
			hasEmscriptenLld: boolean;
	  }
>;
export declare const validateRustLlvmProfile: typeof validateRustRuntimeProfile;
