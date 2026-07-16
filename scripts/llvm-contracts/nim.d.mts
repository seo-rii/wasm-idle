export declare const NIM_LLVM_PROFILE: Readonly<{
	id: 'nim-llvm8';
	version: 1;
	nimVersion: '2.2.4';
	llvmVersion: '8.0.1';
	resourceDir: '/lib/clang/8.0.1';
	requiredAssets: readonly [
		'clang/clang.js',
		'clang/clang.wasm',
		'clang/lld.wasm',
		'clang/memfs.wasm',
		'clang/sysroot.tar'
	];
}>;
export declare function validateNimLlvmProfile(sourceDir: string): Promise<{
	profile: Readonly<{
		id: 'nim-llvm8';
		version: 1;
		nimVersion: '2.2.4';
		llvmVersion: '8.0.1';
		resourceDir: '/lib/clang/8.0.1';
		requiredAssets: readonly [
			'clang/clang.js',
			'clang/clang.wasm',
			'clang/lld.wasm',
			'clang/memfs.wasm',
			'clang/sysroot.tar'
		];
	}>;
	assetRoot: string;
	assets: Record<string, string>;
}>;
